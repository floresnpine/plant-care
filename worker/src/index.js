// Plant Care reminder server: stores each phone's push subscription and upcoming
// reminder times, and a cron job sends a push when something is due.
import { DurableObject } from 'cloudflare:workers';
import { generateVapidKeys, sendPush } from './webpush.js';

const DAY = 24 * 3600 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export class ReminderStore extends DurableObject {
  async vapid() {
    let v = await this.ctx.storage.get('vapid');
    if (!v) {
      v = await generateVapidKeys();
      await this.ctx.storage.put('vapid', v);
    }
    return v;
  }

  async publicKey() {
    return (await this.vapid()).publicKey;
  }

  // body: { user, subscription, origin, reminders: [{ key, label, at }] }
  async sync(body) {
    const key = `user:${body.user}`;
    const prev = (await this.ctx.storage.get(key)) || {};
    const record = {
      subscription: body.subscription ?? prev.subscription ?? null,
      origin: body.origin || prev.origin,
      reminders: Array.isArray(body.reminders) ? body.reminders.slice(0, 500) : prev.reminders || [],
      updated: Date.now(),
    };
    await this.ctx.storage.put(key, record);
    return { ok: true, hasSubscription: !!record.subscription, reminders: record.reminders.length };
  }

  async push(user, record, payload) {
    const vapid = await this.vapid();
    const subject = record.origin && record.origin.startsWith('https://') ? record.origin : 'mailto:plant-care@users.noreply.github.com';
    const res = await sendPush(record.subscription, JSON.stringify(payload), vapid, subject);
    if (res.status === 404 || res.status === 410) {
      record.subscription = null;
      await this.ctx.storage.put(`user:${user}`, record);
    }
    return { status: res.status, text: res.ok ? '' : await res.text() };
  }

  async test(user) {
    const record = await this.ctx.storage.get(`user:${user}`);
    if (!record?.subscription) return { ok: false, error: 'No push subscription for this device yet.' };
    const r = await this.push(user, record, { title: 'Plant Care', body: 'Reminders are working 🌱', tag: 'test' });
    return { ok: r.status >= 200 && r.status < 300, ...r };
  }

  async check(now = Date.now()) {
    const users = await this.ctx.storage.list({ prefix: 'user:' });
    let sent = 0;
    for (const [key, record] of users) {
      const user = key.slice(5);
      // Forget devices that have not opened the app in 120 days.
      if (now - record.updated > 120 * DAY) { await this.ctx.storage.delete(key); continue; }
      if (!record.subscription) continue;
      const due = record.reminders.filter(r => r.at <= now);
      if (!due.length) continue;

      const labels = due.map(r => r.label);
      const body = labels.length <= 3 ? labels.join('\n') : `${labels.slice(0, 3).join('\n')}\n+${labels.length - 3} more`;
      try {
        await this.push(user, record, { title: due.length === 1 ? 'Plant reminder 🌿' : `${due.length} plant reminders 🌿`, body, count: due.length, tag: 'due', url: './' });
        sent++;
      } catch (e) {
        console.log('push failed', user, e);
      }
      // Keep nudging once a day until the app reports the task as done or snoozed.
      for (const r of due) while (r.at <= now) r.at += DAY;
      await this.ctx.storage.put(key, record);
    }
    return { sent };
  }
}

function store(env) {
  return env.REMINDERS.get(env.REMINDERS.idFromName('main'));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const s = store(env);
    try {
      if (url.pathname === '/vapid' && request.method === 'GET') return json({ publicKey: await s.publicKey() });
      if (request.method === 'POST') {
        const body = await request.json();
        if (typeof body.user !== 'string' || body.user.length < 20) return json({ error: 'bad user id' }, 400);
        if (url.pathname === '/sync') return json(await s.sync(body));
        if (url.pathname === '/test') return json(await s.test(body.user));
      }
      if (url.pathname === '/') return json({ ok: true, service: 'plant-care reminders' });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },

  async scheduled(event, env) {
    await store(env).check();
  },
};
