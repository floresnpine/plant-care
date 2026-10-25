// Verifies our encryption against the reference http_ece decoder and checks the VAPID JWT.
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import ece from 'http_ece';
import { generateVapidKeys, sendPush, b64urlEncode, b64urlDecode } from '../src/webpush.js';

const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const auth = crypto.randomBytes(16);

let captured;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { captured = { headers: req.headers, body: Buffer.concat(chunks) }; res.writeHead(201); res.end(); });
});
await new Promise(r => server.listen(0, r));
const endpoint = `http://127.0.0.1:${server.address().port}/push/abc`;

const vapid = await generateVapidKeys();
const sub = { endpoint, keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) } };
const msg = JSON.stringify({ title: 'Water Monstera', body: 'hello 🌱' });
const res = await sendPush(sub, msg, vapid, 'https://example.github.io');
assert.equal(res.status, 201);
server.close();

assert.equal(captured.headers['content-encoding'], 'aes128gcm');
const plain = ece.decrypt(captured.body, { version: 'aes128gcm', privateKey: ua, authSecret: b64urlEncode(auth) });
assert.equal(plain.toString(), msg);

const m = captured.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
const [h, p, s] = m[1].split('.');
const claims = JSON.parse(Buffer.from(b64urlDecode(p)).toString());
assert.equal(claims.aud, new URL(endpoint).origin);
assert.equal(claims.sub, 'https://example.github.io');
const pub = await crypto.subtle.importKey('raw', b64urlDecode(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
assert.ok(ok, 'JWT signature verifies');
console.log('webpush: all checks passed');
