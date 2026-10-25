// Runs apps-script/Code.gs in Node against in-memory stand-ins for DriveApp & co,
// and answers like a deployed web app (text/plain POST in, JSON out with Access-Control-Allow-Origin: *).
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

export function fakeAppsScript() {
  const props = new Map();
  const files = new Map(); // id -> {name, bytes, trashed, folder}
  const folders = new Map();
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const fileObj = f => ({
    getName: () => f.name,
    setContent: c => { f.bytes = Buffer.from(c); },
    setTrashed: t => { f.trashed = t; },
    getBlob: () => ({ getBytes: () => [...f.bytes].map(b => (b > 127 ? b - 256 : b)), getDataAsString: () => f.bytes.toString() }),
  });
  const folderObj = d => ({
    getId: () => d.id, getUrl: () => `https://drive.google.com/drive/folders/${d.id}`, isTrashed: () => false,
    getFiles: () => iter([...files.values()].filter(f => f.folder === d.id && !f.trashed).map(fileObj)),
    getFilesByName: n => iter([...files.values()].filter(f => f.folder === d.id && !f.trashed && f.name === n).map(fileObj)),
    createFile: (a, b) => {
      const f = typeof a === 'string' ? { name: a, bytes: Buffer.from(b) } : { name: a.name, bytes: a.bytes };
      Object.assign(f, { folder: d.id, trashed: false }); files.set(randomUUID(), f); return fileObj(f);
    },
  });
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    DriveApp: {
      getFolderById: id => { if (!folders.has(id)) throw new Error('no folder'); return folderObj(folders.get(id)); },
      getFoldersByName: n => iter([...folders.values()].filter(d => d.name === n).map(folderObj)),
      createFolder: n => { const d = { id: randomUUID(), name: n }; folders.set(d.id, d); return folderObj(d); },
    },
    Utilities: {
      base64Decode: s => [...Buffer.from(s, 'base64')],
      base64Encode: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
      newBlob: (bytes, type, name) => ({ name, bytes: Buffer.from(bytes.map(b => b & 255)) }),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);

  const log = [];
  const CORS = { 'access-control-allow-origin': '*' };
  async function route(rt) {
    const req = rt.request(); const url = new URL(req.url());
    if (url.hostname === 'script.google.com') {
      if (req.method() !== 'POST') return rt.fulfill({ status: 200, headers: CORS, body: ctx.doGet().text });
      if (req.headers()['content-type'] && !req.headers()['content-type'].startsWith('text/plain')) throw new Error('would need CORS preflight: ' + req.headers()['content-type']);
      const body = req.postData();
      log.push(JSON.parse(body).action + (JSON.parse(body).name ? ' ' + JSON.parse(body).name : ''));
      // The real web app answers with a 302 to script.googleusercontent.com; Playwright can't intercept
      // the followed request, so the answer is served directly with the same CORS header.
      const out = ctx.doPost({ postData: { contents: body } }).text;
      return rt.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: out });
    }
    throw new Error('unexpected request ' + url);
  }
  return { route, files, props, log };
}
