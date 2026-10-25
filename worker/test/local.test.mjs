// End-to-end check against `wrangler dev --test-scheduled` on :8787:
// sync a fake subscription, fire the cron, and decrypt what arrives at our fake push service.
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import ece from 'http_ece';

const W = 'http://127.0.0.1:8787';
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const got = [];
const srv = http.createServer((req, res) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => { got.push(Buffer.concat(c)); res.writeHead(201); res.end(); }); });
await new Promise(r => srv.listen(9911, r));
const b64 = b => b.toString('base64url');
const sub = { endpoint: 'http://127.0.0.1:9911/p', keys: { p256dh: b64(ua.getPublicKey()), auth: b64(auth) } };
const user = crypto.randomUUID() + 'abcdefgh';

const { publicKey } = await (await fetch(`${W}/vapid`)).json();
assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
const now = Date.now();
const sync = await (await fetch(`${W}/sync`, { method: 'POST', body: JSON.stringify({ user, subscription: sub, origin: 'https://x.github.io', reminders: [
  { key: 'a:water', label: '💧 Water Monstera', at: now - 1000 },
  { key: 'b:water', label: '💧 Water Pothos', at: now + 5 * 86400000 },
] }) })).json();
assert.equal(sync.reminders, 2);

await fetch(`${W}/__scheduled?cron=*/15+*+*+*+*`);
await new Promise(r => setTimeout(r, 1500));
assert.equal(got.length, 1, 'one push sent');
const msg = JSON.parse(ece.decrypt(got[0], { version: 'aes128gcm', privateKey: ua, authSecret: b64(auth) }).toString());
assert.equal(msg.body, '💧 Water Monstera');

await fetch(`${W}/__scheduled?cron=*/15+*+*+*+*`);
await new Promise(r => setTimeout(r, 1000));
assert.equal(got.length, 1, 'not re-sent until tomorrow');

const t = await (await fetch(`${W}/test`, { method: 'POST', body: JSON.stringify({ user }) })).json();
assert.ok(t.ok);
assert.equal(got.length, 2);
srv.close();
console.log('worker end-to-end: all checks passed');
