// End-to-end Google Drive backup test in a simulated iPhone, against apps-script/Code.gs running on fake Drive.
// Serve the app first: (cd app && python3 -m http.server 8123). Then: node tests/drive-sync.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import { fakeAppsScript } from './fake-apps-script.mjs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = 'http://localhost:8123/';
const SCRIPT = 'https://script.google.com/macros/s/AKfycbTEST/exec';
const OUT = process.argv[2] || os.tmpdir();
const google = fakeAppsScript();
const b = await chromium.launch();

async function phone() {
  const ctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/script\.google(usercontent)?\.com/, google.route);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  return { p, errors };
}
const photoFiles = () => [...google.files.values()].filter(f => !f.trashed && f.name.startsWith('photo-'));
const driveData = () => JSON.parse([...google.files.values()].find(f => f.name === 'data.json').bytes.toString());

// A noisy 12 MP "camera photo" so compression has real work to do.
const { p: gen } = await phone();
const big = Buffer.from(await gen.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 4032; c.height = 3024; const g = c.getContext('2d');
  const d = g.createImageData(4032, 3024);
  for (let i = 0; i < d.data.length; i += 4) { d.data[i] = 60 + Math.random() * 90; d.data[i + 1] = 110 + Math.random() * 90; d.data[i + 2] = 50 + Math.random() * 50; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95)); return [...new Uint8Array(await blob.arrayBuffer())];
}));
fs.writeFileSync(`${OUT}/big.jpg`, big);
console.log(`camera photo: ${Math.round(big.length / 1024)} KB at 4032x3024`);

// Phone 1: plant with photo, compression check, connect, auto sync
const { p, errors } = await phone();
await p.goto(BASE + '#/new'); await p.waitForTimeout(400);
await p.fill('input[name=name]', 'Monstera');
let fc = p.waitForEvent('filechooser'); await p.click('[data-act=pick-cover]'); await (await fc).setFiles(`${OUT}/big.jpg`);
await p.click('button[type=submit]'); await p.waitForURL(/#\/plant\//, { timeout: 30000 });
const stored = await p.evaluate(async () => {
  const db = await new Promise(r => { const q = indexedDB.open('plant-care'); q.onsuccess = () => r(q.result); });
  const [ph] = await new Promise(r => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => r(q.result); });
  const bmp = await createImageBitmap(ph.blob);
  return { kb: Math.round(ph.blob.size / 1024), w: bmp.width, h: bmp.height };
});
console.log('saved photo:', stored);
assert(stored.kb <= 600 && stored.w === 2048 && stored.h === 1536);

await p.goto(BASE + '#/settings'); await p.waitForTimeout(300);
await p.fill('#drive-url', SCRIPT);
await p.click('[data-act=drive-connect]'); await p.waitForTimeout(3000);
assert.equal(photoFiles().length, 1, 'photo uploaded');
assert.equal(driveData().plants[0].name, 'Monstera');
console.log('status:', await p.locator('#sync-status').innerText());
await p.screenshot({ path: `${OUT}/drive-connected.png`, fullPage: true });

await p.goto(BASE + '#/'); await p.click('.card'); await p.waitForTimeout(300);
await p.click('.task-card.water [data-act=done]'); await p.waitForTimeout(4000);
assert.equal(driveData().events.filter(e => e.type === 'water').length, 2, 'watering synced');

await p.click('[data-act=view-photo]'); await p.waitForTimeout(300);
await p.click('#sheet [data-del]'); await p.waitForTimeout(300); await p.click('#sheet [data-ok]'); await p.waitForTimeout(4000);
assert.equal(photoFiles().length, 0, 'deleted photo removed from Drive');
fc = p.waitForEvent('filechooser'); await p.click('[data-act=add-photo]'); await (await fc).setFiles(`${OUT}/big.jpg`);
await p.waitForTimeout(400); await p.click('#sheet .btn.primary'); await p.waitForTimeout(5000);
assert.equal(photoFiles().length, 1);

// offline change: banner, then syncs when the app is opened again
await p.context().setOffline(true);
await p.click('.task-card.fert [data-act=done]'); await p.waitForTimeout(4000);
await p.goto(BASE + '#/').catch(() => {}); 
await p.context().setOffline(false);
await p.reload(); await p.waitForTimeout(4000);
assert.equal(driveData().events.filter(e => e.type === 'fert').length, 1, 'offline change synced on reopen');

await p.goto(BASE + '#/settings'); await p.waitForTimeout(300);
await p.click('[data-act=drive-code]'); await p.waitForTimeout(300);
const code = await p.evaluate(() => navigator.clipboard.readText());
assert.match(code, /^https:\/\/script\.google\.com\/.+#.{40,}$/);
console.log('phone 1 errors:', errors);

// A stranger with only the URL is refused
const { p: s } = await phone();
await s.goto(BASE + '#/settings'); await s.fill('#drive-url', SCRIPT); await s.click('[data-act=drive-connect]'); await s.waitForTimeout(1500);
console.log('stranger sees:', await s.locator('#toast').innerText());
assert.match(await s.locator('#toast').innerText(), /another phone/);

// Phone 2 with the code: offered a restore, gets plant and photo
const { p: p2, errors: e2 } = await phone();
await p2.goto(BASE + '#/settings'); await p2.fill('#drive-url', code); await p2.click('[data-act=drive-connect]'); await p2.waitForTimeout(2500);
await p2.screenshot({ path: `${OUT}/drive-restore.png` });
await p2.click('#sheet [data-ok]'); await p2.waitForTimeout(3000);
assert.equal(await p2.locator('.card').count(), 1);
assert.equal(await p2.locator('.card img').count(), 1);
console.log('phone 2 errors:', e2);
assert.deepEqual([...errors, ...e2], []);
console.log('requests:', google.log.join(', '));
console.log('drive sync: all checks passed');
await b.close();
