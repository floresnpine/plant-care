// Run with the app served on :8123 (cd app && python3 -m http.server 8123), then: node tests/drive-sync.test.mjs /tmp
// End-to-end Drive sync test against a fake Google (OAuth redirect + Drive v3 REST), in a simulated iPhone.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const assert = require('assert');
const S = process.argv[2];
const BASE = 'http://localhost:8123/';

const files = new Map(); let nextId = 1; const log = [];
let tokenValid = true;
function parseMultipart(buf, ct) {
  const boundary = ct.match(/boundary=(.+)$/)[1];
  const parts = buf.toString('latin1').split(`--${boundary}`).slice(1, -1);
  const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
  const p2 = parts[1]; const i = p2.indexOf('\r\n\r\n');
  const body = Buffer.from(p2.slice(i + 4, p2.length - 2), 'latin1');
  return { meta, body };
}

async function fakeGoogle(rt) {
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' };
  const route = { request: () => rt.request(), fulfill: o => rt.fulfill({ ...o, headers: { ...CORS, ...(o.headers || {}) } }) };
  const req = route.request(); const url = new URL(req.url()); const m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
  if (url.hostname === 'accounts.google.com') {
    const p = url.searchParams;
    log.push(`auth ${p.get('prompt') || 'interactive'}`);
    return route.fulfill({ status: 302, headers: { location: `${p.get('redirect_uri')}#access_token=tok${Date.now()}&expires_in=3599&token_type=Bearer&state=${p.get('state')}` } });
  }
  if (url.hostname === 'oauth2.googleapis.com') return route.fulfill({ status: 200, body: '' });
  if (!tokenValid) return route.fulfill({ status: 401, body: '{}' });
  if (!/^Bearer tok/.test(req.headers()['authorization'] || '')) throw new Error('no auth on ' + m + ' ' + url + ' ' + JSON.stringify(req.headers()));
  const json = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const path = url.pathname;
  if (path === '/drive/v3/about') return json({ user: { emailAddress: 'liliya@example.com' } });
  if (path === '/drive/v3/files' && m === 'GET') {
    const q = url.searchParams.get('q');
    let list = [...files.values()].filter(f => !f.trashed);
    const name = q.match(/name = '([^']+)'/); if (name) list = list.filter(f => f.name === name[1]);
    const parent = q.match(/'([^']+)' in parents/); if (parent) list = list.filter(f => f.parents?.includes(parent[1]));
    if (q.includes('folder')) list = list.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    return json({ files: list.map(f => ({ id: f.id, name: f.name, size: String(f.body?.length || 0) })) });
  }
  if (path === '/drive/v3/files' && m === 'POST') { const meta = req.postDataJSON(); const id = `f${nextId++}`; files.set(id, { id, ...meta }); log.push(`mkdir ${meta.name}`); return json({ id }); }
  const one = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (one && m === 'GET') return route.fulfill({ status: 200, body: files.get(one[1]).body });
  if (one && m === 'DELETE') { log.push(`delete ${files.get(one[1]).name}`); files.delete(one[1]); return route.fulfill({ status: 204, body: '' }); }
  const up = path.match(/^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/);
  if (up) {
    const { meta, body } = parseMultipart(req.postDataBuffer(), req.headers()['content-type']);
    if (up[1]) { files.get(up[1]).body = body; log.push(`update ${files.get(up[1]).name}`); return json({ id: up[1] }); }
    const id = `f${nextId++}`; files.set(id, { id, ...meta, body }); log.push(`upload ${meta.name} ${body.length}b`); return json({ id });
  }
  throw new Error(`unhandled ${m} ${url}`);
}

async function phone(b) {
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.route(/accounts\.google\.com|www\.googleapis\.com|oauth2\.googleapis\.com/, fakeGoogle);
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.PLANT_CARE_CONFIG = { googleClientId: 'test.apps.googleusercontent.com' };" }));
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  return { p, errors };
}

// a big "camera photo" to check compression
const { p: gen } = await phone(await chromium.launch());
const bigPhoto = Buffer.from(await gen.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 4032; c.height = 3024; const g = c.getContext('2d');
  const d = g.createImageData(4032, 3024); for (let i = 0; i < d.data.length; i += 4) { const y = (i / 4 / 4032) | 0; d.data[i] = 60 + (y / 20) % 80 + Math.random() * 60; d.data[i + 1] = 110 + Math.random() * 90; d.data[i + 2] = 50 + Math.random() * 50; d.data[i + 3] = 255; } g.putImageData(d, 0, 0);
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95)); return [...new Uint8Array(await b.arrayBuffer())];
}));
require('fs').writeFileSync(`${S}/big.jpg`, bigPhoto);
console.log('camera photo:', Math.round(bigPhoto.length / 1024), 'KB, 4032x3024');

const b = await chromium.launch();
// Phone 1: add a plant with a photo, connect Drive, sync
const { p, errors } = await phone(b);
await p.goto(BASE + '#/new'); await p.waitForTimeout(400);
await p.fill('input[name=name]', 'Monstera');
const fc = p.waitForEvent('filechooser'); await p.click('[data-act=pick-cover]'); await (await fc).setFiles(`${S}/big.jpg`);
const t0 = Date.now(); await p.click('button[type=submit]'); await p.waitForURL(/#\/plant\//, { timeout: 30000 }); console.log('save took', Date.now() - t0, 'ms', errors);
const stored = await p.evaluate(async () => {
  const db = await new Promise(r => { const q = indexedDB.open('plant-care'); q.onsuccess = () => r(q.result); });
  const all = await new Promise(r => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => r(q.result); });
  const ph = all[0]; const bmp = await createImageBitmap(ph.blob);
  return { kb: Math.round(ph.blob.size / 1024), w: bmp.width, h: bmp.height, thumbKb: Math.round(ph.thumb.size / 1024) };
});
console.log('stored photo:', stored);
assert(stored.kb <= 600 && stored.w === 2048);
await p.goto(BASE + '#/settings'); await p.waitForTimeout(300);
await p.screenshot({ path: `${S}/drive-settings-off.png`, fullPage: true });
await p.click('[data-act=drive-connect]');
await p.waitForTimeout(3500);
console.log('after connect url:', p.url());
await p.screenshot({ path: `${S}/drive-settings-on.png`, fullPage: true });
console.log('status:', await p.locator('#sync-status').innerText());
// log watering → auto sync of data.json only
await p.goto(BASE + '#/'); await p.waitForTimeout(300);
await p.click('.card'); await p.waitForTimeout(300);
await p.click('.task-card.water [data-act=done]'); await p.waitForTimeout(4000);
const data = JSON.parse([...files.values()].find(f => f.name === 'data.json').body.toString());
assert.equal(data.events.filter(e => e.type === 'water').length, 2);
console.log('drive files:', [...files.values()].map(f => f.name));
// delete the photo → removed from Drive
await p.click('[data-act=view-photo]'); await p.waitForTimeout(300);
await p.click('#sheet [data-del]'); await p.waitForTimeout(300); await p.click('#sheet [data-ok]'); await p.waitForTimeout(4000);
assert(![...files.values()].some(f => f.name.startsWith('photo-')), 'photo deleted from Drive');
// re-add photo for restore test
const fc2 = p.waitForEvent('filechooser'); await p.click('[data-act=add-photo]'); await (await fc2).setFiles(`${S}/big.jpg`);
await p.waitForTimeout(300); await p.click('#sheet .btn.primary'); await p.waitForTimeout(5000);
// expired token: next change shows reconnect, reopening the app renews silently and syncs
tokenValid = false;
await p.click('.task-card.fert [data-act=done]'); await p.waitForTimeout(4000);
await p.goto(BASE + '#/'); await p.waitForTimeout(500);
console.log('banner when expired:', await p.locator('.banner').first().innerText());
tokenValid = true;
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('plant-care-google')); s.token = null; s.silentTried = 0; localStorage.setItem('plant-care-google', JSON.stringify(s)); });
await p.reload(); await p.waitForTimeout(4000);
const data2 = JSON.parse([...files.values()].find(f => f.name === 'data.json').body.toString());
console.log('fert events in Drive after silent renew:', data2.events.filter(e => e.type === 'fert').length, '| url', p.url());
console.log('phone 1 errors:', errors);

// Phone 2: fresh install, connect → restore prompt
const { p: p2, errors: e2 } = await phone(b);
await p2.goto(BASE + '#/settings'); await p2.waitForTimeout(400);
await p2.click('[data-act=drive-connect]'); await p2.waitForTimeout(2500);
await p2.screenshot({ path: `${S}/drive-restore-prompt.png` });
await p2.click('#sheet [data-ok]'); await p2.waitForTimeout(3000);
console.log('phone 2 plants:', await p2.locator('.card').count(), '| photo shown:', await p2.locator('.card img').count());
await p2.screenshot({ path: `${S}/drive-phone2.png`, fullPage: true });
console.log('phone 2 errors:', e2);
console.log(log.join('\n'));
await b.close(); process.exit(0);
