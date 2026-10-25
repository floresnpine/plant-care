import { db } from './db.js';

const DAY = 86400000;
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

const state = { plants: [], events: [], photos: [], settings: {} };
const urlCache = new Map();

const TASKS = {
  water: { verb: 'Water', done: 'Watered', every: 'waterEvery', icon: 'drop' },
  fert: { verb: 'Fertilize', done: 'Fertilized', every: 'fertEvery', icon: 'sprout' },
};

// ---------- helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);
const toDateInput = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromDateInput = (v, keepTime = true) => {
  const [y, m, d] = v.split('-').map(Number);
  const now = new Date();
  const dt = new Date(y, m - 1, d, keepTime ? now.getHours() : 12, keepTime ? now.getMinutes() : 0);
  // A past day gets midday so it sorts sensibly; today keeps the current time.
  if (dayStart(dt) !== dayStart(now)) dt.setHours(12, 0, 0, 0);
  return dt.getTime();
};
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ts).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
const fmtLong = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

function ago(ts) {
  const n = daysBetween(ts, Date.now());
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 60) return `${n} days ago`;
  return fmtDate(ts);
}

function photoUrl(photo, thumb = true) {
  const key = photo.id + (thumb ? ':t' : '');
  if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(thumb ? photo.thumb || photo.blob : photo.blob));
  return urlCache.get(key);
}

const ICONS = {
  drop: '<path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z"/>',
  sprout: '<path d="M12 20v-8"/><path d="M12 12c0-3.5-2.5-6-7-6 0 4 2.5 6 7 6z"/><path d="M12 14c0-3.5 2.5-6 7-6 0 4-2.5 6-7 6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l8-8"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
};
const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- care logic ----------

function lastEvent(plantId, type) {
  let best = null;
  for (const e of state.events) if (e.plantId === plantId && e.type === type && (!best || e.at > best.at)) best = e;
  return best;
}

// Returns null when the task is off for this plant.
function taskStatus(plant, type) {
  const every = Number(plant[TASKS[type].every]) || 0;
  if (every <= 0) return null;
  const last = lastEvent(plant.id, type);
  const base = last ? last.at : plant.createdAt;
  let due = dayStart(addDays(base, every));
  const snoozed = plant.snooze?.[type] && plant.snooze[type] > due ? plant.snooze[type] : null;
  if (snoozed) due = snoozed;
  const days = daysBetween(Date.now(), due);
  let text;
  if (days < 0) text = days === -1 ? '1 day overdue' : `${-days} days overdue`;
  else if (days === 0) text = 'Due today';
  else if (days === 1) text = 'Tomorrow';
  else text = `In ${days} days`;
  return { type, every, last, due, days, text, snoozed, isDue: days <= 0 };
}

function dueTasks() {
  const list = [];
  for (const p of state.plants) for (const type of Object.keys(TASKS)) {
    const s = taskStatus(p, type);
    if (s?.isDue) list.push({ plant: p, ...s });
  }
  return list.sort((a, b) => a.days - b.days || a.plant.name.localeCompare(b.plant.name));
}

function coverPhoto(plant) {
  const own = state.photos.filter(ph => ph.plantId === plant.id);
  return own.find(ph => ph.id === plant.coverId) || own.sort((a, b) => b.at - a.at)[0] || null;
}

async function logCare(plantId, type, at = Date.now(), note = '') {
  const ev = { id: uid(), plantId, type, at, note };
  await db.put('events', ev);
  state.events.push(ev);
  const plant = state.plants.find(p => p.id === plantId);
  if (plant?.snooze?.[type]) {
    delete plant.snooze[type];
    await db.put('plants', plant);
  }
  return ev;
}

async function deleteEvent(id) {
  await db.del('events', id);
  state.events = state.events.filter(e => e.id !== id);
}

async function snooze(plant, type, days) {
  plant.snooze = { ...(plant.snooze || {}), [type]: dayStart(addDays(Date.now(), days)) };
  await db.put('plants', plant);
}

// ---------- reminders (push) ----------

const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const workerUrl = () => (state.settings.workerUrl || window.PLANT_CARE_CONFIG?.workerUrl || '').replace(/\/+$/, '');

function reminderSlot(dayTs) {
  const [h, m] = (state.settings.reminderTime || '09:00').split(':').map(Number);
  const d = new Date(dayTs);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function upcomingReminders() {
  // Next reminder moment that is still ahead of us, so an overdue task is not re-sent instantly.
  let next = reminderSlot(Date.now());
  if (next <= Date.now()) next = reminderSlot(addDays(Date.now(), 1));
  const out = [];
  for (const p of state.plants) for (const type of Object.keys(TASKS)) {
    const s = taskStatus(p, type);
    if (!s) continue;
    out.push({ key: `${p.id}:${type}`, label: `${type === 'water' ? '💧' : '🌱'} ${TASKS[type].verb} ${p.name}`, at: Math.max(reminderSlot(s.due), next) });
  }
  return out;
}

let syncTimer;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncReminders, 600);
  updateBadge();
}

async function syncReminders() {
  const base = workerUrl();
  if (!base || !pushSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch(`${base}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: state.settings.userId, subscription: sub.toJSON(), origin: location.origin, reminders: upcomingReminders() }),
    });
    await db.setMeta('lastSync', Date.now());
  } catch (e) {
    console.warn('sync failed', e);
  }
}

function updateBadge() {
  const n = dueTasks().length;
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

async function enableReminders() {
  const base = workerUrl();
  if (!base) throw new Error('The reminder server is not set up yet.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can turn them on in iPhone Settings › Notifications › Plant Care.');
  const { publicKey } = await (await fetch(`${base}/vapid`)).json();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = b64ToBytes(publicKey);
  if (sub) {
    const cur = sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
    if (cur && cur.join() !== key.join()) { await sub.unsubscribe(); sub = null; }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await syncReminders();
}

async function sendTest() {
  const res = await fetch(`${workerUrl()}/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: state.settings.userId }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `Push service answered ${data.status}`);
}

// ---------- photos ----------

async function resizeImage(file, max, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function savePhoto(plantId, file, at = Date.now(), note = '') {
  const [blob, thumb] = await Promise.all([resizeImage(file, 1600, 0.82), resizeImage(file, 480, 0.75)]);
  const photo = { id: uid(), plantId, at, note, blob, thumb };
  await db.put('photos', photo);
  state.photos.push(photo);
  return photo;
}

async function deletePhoto(id) {
  await db.del('photos', id);
  state.photos = state.photos.filter(p => p.id !== id);
  for (const k of [id, id + ':t']) if (urlCache.has(k)) { URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); }
}

function pickImage() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// ---------- backup ----------

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const dataUrlToBlob = async url => (await fetch(url)).blob();

async function exportBackup() {
  const photos = [];
  for (const p of state.photos) photos.push({ ...p, blob: await blobToDataUrl(p.blob), thumb: p.thumb ? await blobToDataUrl(p.thumb) : null });
  const meta = (await db.all('meta')).filter(m => m.key !== 'userId' && m.key !== 'lastSync');
  const data = { app: 'plant-care', version: 1, exportedAt: Date.now(), plants: state.plants, events: state.events, photos, meta };
  const name = `plant-care-backup-${toDateInput(Date.now())}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Plant Care backup' });
    } catch (e) {
      if (e.name === 'AbortError') return false;
      throw e;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  await db.setMeta('lastBackup', Date.now());
  state.settings.lastBackup = Date.now();
  return true;
}

async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'plant-care') throw new Error("That file doesn't look like a Plant Care backup.");
  const photos = [];
  for (const p of data.photos || []) photos.push({ ...p, blob: await dataUrlToBlob(p.blob), thumb: p.thumb ? await dataUrlToBlob(p.thumb) : null });
  const meta = (data.meta || []).filter(m => m.key !== 'userId');
  meta.push({ key: 'userId', value: state.settings.userId });
  await db.replaceAll({ plants: data.plants || [], events: data.events || [], photos, meta });
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  await load();
}

// ---------- UI primitives ----------

function toast(msg, action) {
  $toast.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  $toast.classList.add('show');
  if (action) $toast.querySelector('button').onclick = () => { $toast.classList.remove('show'); action.run(); };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 4500);
}

function openSheet(html, bind) {
  $sheet.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet-panel" role="dialog">${html}</div>`;
  $sheet.classList.add('open');
  const close = () => { $sheet.classList.remove('open'); setTimeout(() => { if (!$sheet.classList.contains('open')) $sheet.innerHTML = ''; }, 250); };
  $sheet.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
  bind?.($sheet.querySelector('.sheet-panel'), close);
  return close;
}

function confirmSheet(title, body, okLabel, danger = true) {
  return new Promise(resolve => {
    openSheet(`<h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`,
    (el, close) => {
      el.querySelector('[data-ok]').onclick = () => { close(); resolve(true); };
      $sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
    });
  });
}

function thumbHtml(plant, cls = 'thumb') {
  const ph = coverPhoto(plant);
  return ph ? `<img class="${cls}" src="${photoUrl(ph)}" alt="">` : `<div class="${cls} placeholder">${icon('leaf')}</div>`;
}

function chip(s) {
  if (!s) return '';
  const tone = s.days < 0 ? 'late' : s.days === 0 ? 'due' : 'ok';
  return `<span class="chip ${s.type} ${tone}">${icon(TASKS[s.type].icon)}${esc(s.text)}</span>`;
}

// ---------- views ----------

function viewHome() {
  const due = dueTasks();
  const needsBackup = state.plants.length && (!state.settings.lastBackup || Date.now() - state.settings.lastBackup > 30 * DAY);
  const remindersOff = state.plants.length && workerUrl() && (!pushSupported() || Notification.permission !== 'granted');
  const plants = [...state.plants].sort((a, b) => a.name.localeCompare(b.name));

  return `
  <header class="top">
    <div><p class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</p><h1>My plants</h1></div>
    <a class="icon-btn" href="#/settings" aria-label="Settings">${icon('gear')}</a>
  </header>
  ${remindersOff ? `<a class="banner" href="#/settings">${icon('bell')}<span>Turn on reminders so you never miss a watering.</span></a>` : ''}
  ${needsBackup ? `<a class="banner soft" href="#/settings">${icon('box')}<span>${state.settings.lastBackup ? "It's been a while since your last backup." : 'Back up your plants and photos.'}</span></a>` : ''}
  ${state.plants.length ? `
  <section>
    <h2>Today</h2>
    ${due.length ? `<ul class="tasks">${due.map(t => `
      <li class="task ${t.type}">
        <a href="#/plant/${t.plant.id}" class="task-main">${thumbHtml(t.plant, 'thumb sm')}
          <div><strong>${TASKS[t.type].verb} ${esc(t.plant.name)}</strong><span class="${t.days < 0 ? 'late-text' : 'muted'}">${esc(t.text)}</span></div></a>
        <button class="icon-btn snooze" data-act="snooze" data-plant="${t.plant.id}" data-type="${t.type}" aria-label="Snooze">${icon('clock')}</button>
        <button class="done-btn ${t.type}" data-act="done" data-plant="${t.plant.id}" data-type="${t.type}" aria-label="${TASKS[t.type].done}">${icon('check')}</button>
      </li>`).join('')}</ul>` : `<div class="caught-up">${icon('leaf')}<span>All caught up. Your plants are happy.</span></div>`}
  </section>
  <section>
    <h2>All plants <span class="count">${plants.length}</span></h2>
    <div class="grid">${plants.map(p => `
      <a class="card" href="#/plant/${p.id}">
        ${thumbHtml(p, 'card-img')}
        <div class="card-body"><strong>${esc(p.name)}</strong>${p.location ? `<span class="muted small">${esc(p.location)}</span>` : ''}
          <div class="chips">${chip(taskStatus(p, 'water'))}${chip(taskStatus(p, 'fert'))}</div></div>
      </a>`).join('')}</div>
  </section>` : `
  <div class="empty">
    <div class="empty-art">${icon('sprout')}</div>
    <h2>Start your plant journal</h2>
    <p class="muted">Add a plant, set how often it likes water and food, and get a reminder when it's time.</p>
  </div>`}
  <a class="fab" href="#/new">${icon('plus')}<span>Add plant</span></a>`;
}

function taskCard(plant, type) {
  const s = taskStatus(plant, type);
  const t = TASKS[type];
  if (!s) return `<div class="task-card off ${type}"><div class="tc-head">${icon(t.icon)}<strong>${t.verb}</strong></div><p class="muted small">Off for this plant. Edit the plant to set a schedule.</p></div>`;
  return `
  <div class="task-card ${type} ${s.days < 0 ? 'late' : s.days === 0 ? 'due' : ''}">
    <div class="tc-head">${icon(t.icon)}<strong>${t.verb}</strong><span class="tc-status">${esc(s.text)}</span></div>
    <p class="muted small">Every ${s.every} day${s.every === 1 ? '' : 's'} · ${s.last ? `last ${ago(s.last.at)}` : 'not logged yet'}${s.snoozed ? ` · snoozed to ${fmtDate(s.snoozed)}` : ''}</p>
    <div class="tc-actions">
      <button class="btn ${type === 'water' ? 'water' : 'fert'}" data-act="done" data-plant="${plant.id}" data-type="${type}">${icon('check')}${t.done} today</button>
      <button class="btn ghost" data-act="done-on" data-plant="${plant.id}" data-type="${type}">${icon('calendar')}Other day</button>
      ${s.days <= 1 ? `<button class="btn ghost" data-act="snooze" data-plant="${plant.id}" data-type="${type}">${icon('clock')}Snooze</button>` : ''}
    </div>
  </div>`;
}

function viewPlant(id) {
  const p = state.plants.find(x => x.id === id);
  if (!p) return viewMissing();
  const photos = state.photos.filter(ph => ph.plantId === id).sort((a, b) => b.at - a.at);
  const events = state.events.filter(e => e.plantId === id).sort((a, b) => b.at - a.at);
  const cover = coverPhoto(p);
  const first = photos[photos.length - 1];

  return `
  <div class="hero ${cover ? '' : 'no-photo'}">
    ${cover ? `<img src="${photoUrl(cover, false)}" alt="">` : `<div class="hero-ph">${icon('leaf')}</div>`}
    <div class="hero-bar"><a class="icon-btn glass" href="#/" aria-label="Back">${icon('back')}</a><a class="icon-btn glass" href="#/edit/${p.id}" aria-label="Edit">${icon('edit')}</a></div>
  </div>
  <div class="detail">
    <h1>${esc(p.name)}</h1>
    ${p.location ? `<p class="muted">${esc(p.location)}</p>` : ''}
    ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ''}
    ${taskCard(p, 'water')}
    ${taskCard(p, 'fert')}

    <section>
      <div class="section-head"><h2>Photo timeline</h2><button class="btn small primary" data-act="add-photo" data-plant="${p.id}">${icon('camera')}Add photo</button></div>
      ${photos.length ? `
        ${photos.length > 1 && daysBetween(first.at, photos[0].at) > 0 ? `<p class="muted small">${photos.length} photos over ${daysBetween(first.at, photos[0].at)} day${daysBetween(first.at, photos[0].at) === 1 ? '' : 's'}</p>` : ''}
        <ol class="timeline">${photos.map(ph => `
          <li><button class="tl-photo" data-act="view-photo" data-photo="${ph.id}"><img src="${photoUrl(ph)}" alt="" loading="lazy"></button>
            <div class="tl-meta"><strong>${esc(fmtLong(ph.at))}</strong>${first && ph.id !== first.id ? `<span class="muted small">Day ${daysBetween(first.at, ph.at) + 1}</span>` : '<span class="muted small">First photo</span>'}${ph.note ? `<p>${esc(ph.note)}</p>` : ''}</div></li>`).join('')}
        </ol>` : `<button class="photo-empty" data-act="add-photo" data-plant="${p.id}">${icon('camera')}<span>Add a photo to start tracking growth</span></button>`}
    </section>

    <section>
      <h2>Care history</h2>
      ${events.length ? `<ul class="history">${events.map(e => `
        <li class="${e.type}">${icon(TASKS[e.type].icon)}<div><strong>${TASKS[e.type].done}</strong><span class="muted small">${esc(fmtLong(e.at))}${e.note ? ` · ${esc(e.note)}` : ''}</span></div>
          <button class="icon-btn subtle" data-act="del-event" data-event="${e.id}" aria-label="Delete entry">${icon('trash')}</button></li>`).join('')}</ul>`
        : '<p class="muted">Nothing logged yet.</p>'}
    </section>
  </div>`;
}

function viewEdit(id) {
  const p = id ? state.plants.find(x => x.id === id) : null;
  if (id && !p) return viewMissing();
  const today = toDateInput(Date.now());
  return `
  <header class="top sub"><a class="icon-btn" href="${p ? `#/plant/${p.id}` : '#/'}" aria-label="Back">${icon('back')}</a><h1>${p ? 'Edit plant' : 'New plant'}</h1><span></span></header>
  <form id="plant-form" class="form" autocomplete="off">
    ${p ? '' : `<button type="button" class="photo-pick" data-act="pick-cover"><span class="pp-inner">${icon('camera')}<span>Add a photo</span></span></button>`}
    <label>Name<input name="name" required maxlength="60" placeholder="Monstera" value="${esc(p?.name)}"></label>
    <label>Where it lives <span class="opt">optional</span><input name="location" maxlength="60" placeholder="Living room, east window" value="${esc(p?.location)}"></label>
    <fieldset class="sched water">
      <legend>${icon('drop')}Watering</legend>
      <label class="inline">Every <input name="waterEvery" type="number" inputmode="numeric" min="1" max="365" required value="${p ? p.waterEvery : 7}"> days</label>
      ${p ? '' : `<label>Last watered<input name="lastWater" type="date" max="${today}" value="${today}"></label>`}
    </fieldset>
    <fieldset class="sched fert">
      <legend>${icon('sprout')}Fertilizing</legend>
      <label class="inline">Every <input name="fertEvery" type="number" inputmode="numeric" min="0" max="365" value="${p ? p.fertEvery || '' : 30}" placeholder="off"> days</label>
      <p class="muted small">Leave empty to turn fertilizing reminders off.</p>
      ${p ? '' : `<label>Last fertilized <span class="opt">optional</span><input name="lastFert" type="date" max="${today}"></label>`}
    </fieldset>
    <label>Notes <span class="opt">optional</span><textarea name="notes" rows="3" maxlength="1000" placeholder="Likes bright indirect light, let soil dry out between waterings">${esc(p?.notes)}</textarea></label>
    <button class="btn primary block" type="submit">${p ? 'Save changes' : 'Add plant'}</button>
    ${p ? `<button class="btn danger-ghost block" type="button" data-act="del-plant" data-plant="${p.id}">${icon('trash')}Delete plant</button>` : ''}
  </form>`;
}

function viewSettings() {
  const s = state.settings;
  const supported = pushSupported();
  const perm = supported ? Notification.permission : 'unsupported';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  let status;
  if (!workerUrl()) status = 'The reminder server is not connected yet.';
  else if (ios && !isStandalone()) status = 'Add this app to your Home Screen first (Share › Add to Home Screen), then open it from there.';
  else if (!supported) status = 'This browser does not support push notifications. On iPhone you need iOS 16.4 or newer.';
  else if (perm === 'granted') status = 'Reminders are on.';
  else if (perm === 'denied') status = 'Notifications are blocked. Turn them on in iPhone Settings › Notifications › Plant Care.';
  else status = 'Reminders are off.';
  const canEnable = workerUrl() && supported && perm !== 'denied' && !(ios && !isStandalone());

  return `
  <header class="top sub"><a class="icon-btn" href="#/" aria-label="Back">${icon('back')}</a><h1>Settings</h1><span></span></header>
  <div class="form">
    <section class="panel">
      <h2>${icon('bell')}Reminders</h2>
      <p class="muted">${esc(status)}</p>
      <label class="inline">Remind me at <input type="time" id="reminder-time" value="${esc(s.reminderTime || '09:00')}"></label>
      ${canEnable ? `<button class="btn primary block" data-act="enable-push">${perm === 'granted' ? 'Refresh reminders' : 'Turn on reminders'}</button>` : ''}
      ${perm === 'granted' && workerUrl() ? '<button class="btn ghost block" data-act="test-push">Send a test notification</button>' : ''}
      <p class="muted small">You'll get one notification at this time on days something is due, and a daily nudge until you log it or snooze it.</p>
    </section>

    <section class="panel">
      <h2>${icon('box')}Backup</h2>
      <p class="muted">Your plants and photos are saved on this phone. A backup puts everything in one file you can save to iCloud Drive or Files, or send to yourself.</p>
      <p class="small">${s.lastBackup ? `Last backup: ${esc(fmtLong(s.lastBackup))}` : 'No backup yet.'}</p>
      <button class="btn primary block" data-act="backup">Back up now</button>
      <button class="btn ghost block" data-act="restore">Restore from a backup</button>
    </section>

    <details class="panel">
      <summary>Advanced</summary>
      <label>Reminder server address<input id="worker-url" type="url" inputmode="url" placeholder="https://plant-care-reminders.you.workers.dev" value="${esc(s.workerUrl || '')}"></label>
      <p class="muted small">Leave empty to use the built-in address${window.PLANT_CARE_CONFIG?.workerUrl ? ` (${esc(window.PLANT_CARE_CONFIG.workerUrl)})` : ''}.</p>
    </details>
    <p class="muted small center">Plant Care · ${state.plants.length} plants · ${state.photos.length} photos</p>
  </div>`;
}

function viewMissing() {
  return `<div class="empty"><h2>Plant not found</h2><a class="btn primary" href="#/">Back to my plants</a></div>`;
}

// ---------- sheets ----------

function snoozeSheet(plant, type) {
  const opts = [[1, 'Tomorrow'], [2, 'In 2 days'], [3, 'In 3 days'], [7, 'Next week']];
  openSheet(`<h3>Snooze ${TASKS[type].verb.toLowerCase()} for ${esc(plant.name)}</h3>
    <div class="sheet-list">${opts.map(([d, l]) => `<button class="btn ghost block" data-days="${d}">${l}<span class="muted small">${esc(fmtDate(addDays(Date.now(), d)))}</span></button>`).join('')}</div>
    <button class="btn ghost block" data-close>Cancel</button>`,
  (el, close) => el.querySelectorAll('[data-days]').forEach(b => b.onclick = async () => {
    await snooze(plant, type, Number(b.dataset.days));
    close();
    toast(`Snoozed until ${fmtDate(plant.snooze[type])}`);
    changed();
  }));
}

function doneOnSheet(plant, type) {
  const today = toDateInput(Date.now());
  openSheet(`<h3>${TASKS[type].done} ${esc(plant.name)}</h3>
    <form class="form tight"><label>Date<input type="date" name="date" value="${today}" max="${today}" required></label>
    <label>Note <span class="opt">optional</span><input name="note" maxlength="200" placeholder="${type === 'fert' ? 'Half-strength liquid feed' : 'Bottom watered'}"></label>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
  (el, close) => el.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    await logCare(plant.id, type, fromDateInput(f.get('date')), f.get('note').trim());
    close();
    toast(`${TASKS[type].done} on ${fmtDate(fromDateInput(f.get('date')))}`);
    changed();
  });
}

async function addPhotoFlow(plantId) {
  const file = await pickImage();
  if (!file) return;
  const preview = URL.createObjectURL(file);
  const today = toDateInput(Date.now());
  openSheet(`<img class="sheet-preview" src="${preview}" alt="">
    <form class="form tight"><label>Date taken<input type="date" name="date" value="${today}" max="${today}" required></label>
    <label>Note <span class="opt">optional</span><input name="note" maxlength="200" placeholder="New leaf unfurling!"></label>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save photo</button></div></form>`,
  (el, close) => el.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn.primary');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const f = new FormData(e.target);
    await savePhoto(plantId, file, fromDateInput(f.get('date')), f.get('note').trim());
    URL.revokeObjectURL(preview);
    close();
    render();
  });
}

function photoViewer(photoId) {
  const ph = state.photos.find(p => p.id === photoId);
  if (!ph) return;
  const plant = state.plants.find(p => p.id === ph.plantId);
  openSheet(`<img class="viewer-img" src="${photoUrl(ph, false)}" alt="">
    <p><strong>${esc(fmtLong(ph.at))}</strong>${ph.note ? `<br><span class="muted">${esc(ph.note)}</span>` : ''}</p>
    <div class="sheet-actions">
      <button class="btn ghost" data-cover>${plant?.coverId === ph.id ? 'Main photo ✓' : 'Make main photo'}</button>
      <button class="btn danger-ghost" data-del>${icon('trash')}Delete</button>
    </div>`, (el, close) => {
    el.querySelector('[data-cover]').onclick = async () => {
      plant.coverId = ph.id;
      await db.put('plants', plant);
      close();
      render();
    };
    el.querySelector('[data-del]').onclick = async () => {
      close();
      if (await confirmSheet('Delete this photo?', "It will be removed from this plant's timeline.", 'Delete')) {
        await deletePhoto(ph.id);
        render();
      }
    };
  });
}

// ---------- actions ----------

let pendingCover = null;

async function onAction(btn) {
  const act = btn.dataset.act;
  const plant = btn.dataset.plant && state.plants.find(p => p.id === btn.dataset.plant);
  const type = btn.dataset.type;
  try {
    switch (act) {
      case 'done': {
        const ev = await logCare(plant.id, type);
        changed();
        toast(`${TASKS[type].done} ${plant.name}`, { label: 'Undo', run: async () => { await deleteEvent(ev.id); changed(); } });
        break;
      }
      case 'done-on': return doneOnSheet(plant, type);
      case 'snooze': return snoozeSheet(plant, type);
      case 'add-photo': return addPhotoFlow(plant.id);
      case 'view-photo': return photoViewer(btn.dataset.photo);
      case 'del-event':
        if (await confirmSheet('Delete this entry?', 'This removes it from the care history.', 'Delete')) { await deleteEvent(btn.dataset.event); changed(); }
        break;
      case 'del-plant':
        if (await confirmSheet(`Delete ${plant.name}?`, 'Its care history and photos will be deleted too. This cannot be undone.', 'Delete plant')) {
          for (const e of state.events.filter(e => e.plantId === plant.id)) await db.del('events', e.id);
          for (const ph of state.photos.filter(ph => ph.plantId === plant.id)) await deletePhoto(ph.id);
          await db.del('plants', plant.id);
          state.plants = state.plants.filter(p => p.id !== plant.id);
          state.events = state.events.filter(e => e.plantId !== plant.id);
          location.hash = '#/';
          changed();
        }
        break;
      case 'pick-cover': {
        const file = await pickImage();
        if (!file) return;
        pendingCover = file;
        btn.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
        btn.classList.add('has-photo');
        break;
      }
      case 'enable-push':
        btn.disabled = true;
        await enableReminders();
        toast('Reminders are on 🌿');
        render();
        break;
      case 'test-push':
        await sendTest();
        toast('Test sent. It should arrive in a few seconds.');
        break;
      case 'backup':
        if (await exportBackup()) { toast('Backup saved'); render(); }
        break;
      case 'restore': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;
          if (!(await confirmSheet('Restore this backup?', 'Everything currently in the app will be replaced with the backup.', 'Restore'))) return;
          try {
            await importBackup(file);
            toast(`Restored ${state.plants.length} plants`);
            location.hash = '#/';
            changed();
          } catch (e) { toast(e.message); }
        };
        input.click();
        break;
      }
    }
  } catch (e) {
    console.error(e);
    toast(e.message || String(e));
    btn.disabled = false;
  }
}

async function onPlantSubmit(form) {
  const f = new FormData(form);
  const id = route().id;
  const existing = id && state.plants.find(p => p.id === id);
  const fertEvery = Number(f.get('fertEvery')) || 0;
  const plant = existing || { id: uid(), createdAt: Date.now(), snooze: {} };
  Object.assign(plant, {
    name: f.get('name').trim(),
    location: f.get('location').trim(),
    notes: f.get('notes').trim(),
    waterEvery: Math.max(1, Number(f.get('waterEvery')) || 7),
    fertEvery,
  });
  form.querySelector('[type=submit]').disabled = true;
  await db.put('plants', plant);
  if (!existing) {
    state.plants.push(plant);
    if (f.get('lastWater')) await logCare(plant.id, 'water', fromDateInput(f.get('lastWater')));
    if (f.get('lastFert') && fertEvery) await logCare(plant.id, 'fert', fromDateInput(f.get('lastFert')));
    if (pendingCover) await savePhoto(plant.id, pendingCover);
    pendingCover = null;
  }
  location.hash = `#/plant/${plant.id}`;
  changed();
}

function changed() {
  render();
  scheduleSync();
}

// ---------- routing ----------

function route() {
  const [, view = '', id] = location.hash.split('/');
  return { view, id };
}

let lastView;
function render() {
  const { view, id } = route();
  const key = `${view}/${id || ''}`;
  const keepScroll = key === lastView;
  const y = window.scrollY;
  if (view === 'plant') $app.innerHTML = viewPlant(id);
  else if (view === 'edit') $app.innerHTML = viewEdit(id);
  else if (view === 'new') $app.innerHTML = viewEdit(null);
  else if (view === 'settings') $app.innerHTML = viewSettings();
  else $app.innerHTML = viewHome();
  $app.dataset.view = view || 'home';
  window.scrollTo(0, keepScroll ? y : 0);
  if (!keepScroll && view !== 'new') pendingCover = null;
  lastView = key;
}

$app.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (btn) { e.preventDefault(); onAction(btn); }
});
$app.addEventListener('submit', e => {
  if (e.target.id === 'plant-form') { e.preventDefault(); onPlantSubmit(e.target); }
});
$app.addEventListener('change', async e => {
  if (e.target.id === 'reminder-time' && e.target.value) {
    state.settings.reminderTime = e.target.value;
    await db.setMeta('reminderTime', e.target.value);
    scheduleSync();
    toast(`Reminders will come at ${e.target.value}`);
  }
  if (e.target.id === 'worker-url') {
    state.settings.workerUrl = e.target.value.trim();
    await db.setMeta('workerUrl', state.settings.workerUrl);
    render();
  }
});
window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { render(); scheduleSync(); }
});

// ---------- boot ----------

async function load() {
  const [plants, events, photos, meta] = await Promise.all(['plants', 'events', 'photos', 'meta'].map(s => db.all(s)));
  state.plants = plants;
  state.events = events;
  state.photos = photos;
  state.settings = Object.fromEntries(meta.map(m => [m.key, m.value]));
  if (!state.settings.userId) {
    state.settings.userId = uid() + uid().slice(0, 8);
    await db.setMeta('userId', state.settings.userId);
  }
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  navigator.storage?.persist?.().catch(() => {});
  await load();
  render();
  scheduleSync();
}

boot();
