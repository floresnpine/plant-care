// Runs apps-script/Code.gs in Node against an in-memory stand-in for one Google Sheet,
// and answers like a deployed web app (text/plain POST in, JSON out with Access-Control-Allow-Origin: *).
import fs from 'node:fs';
import vm from 'node:vm';

export function fakeAppsScript(key) {
  const sheets = new Map(); // name -> array of rows
  const MAX_CELL = 50000;
  const sheetObj = name => {
    const rows = sheets.get(name);
    const range = (r, c, nr, nc) => ({
      setValues: vals => {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('range size mismatch');
        vals.forEach((v, i) => { rows[r - 1 + i] ??= []; v.forEach((x, j) => {
          if (typeof x === 'string' && x.length > MAX_CELL) throw new Error('cell too long');
          rows[r - 1 + i][c - 1 + j] = x;
        }); });
      },
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
      setFontWeight: () => {}, setNumberFormat: () => {},
    });
    return {
      getLastRow: () => rows.length,
      getRange: (a, c, nr = 1, nc = 1) => (typeof a === 'string' ? range(1, 1, 0, 0) : range(a, c, nr, nc)),
      deleteRows: (start, n) => rows.splice(start - 1, n),
      clearContents: () => rows.splice(0),
      setFrozenRows: () => {},
    };
  };
  const ss = {
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit',
    getSheetByName: n => (sheets.has(n) ? sheetObj(n) : null),
    insertSheet: n => { sheets.set(n, []); return sheetObj(n); },
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
  };
  vm.createContext(ctx);
  let src = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert(src.includes('@OnlyCurrentDoc'));
  assert(!/DriveApp|DocumentApp|openById|openByUrl|UrlFetchApp/.test(src), 'script must only touch its own spreadsheet');
  if (key) src = src.replace("const KEY = 'CHANGE-ME';", `const KEY = ${JSON.stringify(key)};`);
  vm.runInContext(src, ctx);

  const log = [];
  const CORS = { 'access-control-allow-origin': '*' };
  async function route(rt) {
    const req = rt.request(); const url = new URL(req.url());
    if (url.hostname !== 'script.google.com') throw new Error('unexpected request ' + url);
    if (req.method() !== 'POST') return rt.fulfill({ status: 200, headers: CORS, body: ctx.doGet().text });
    const ct = req.headers()['content-type'];
    if (ct && !ct.startsWith('text/plain')) throw new Error('would need a CORS preflight: ' + ct);
    const body = JSON.parse(req.postData());
    log.push(body.action + (body.name ? ' ' + body.name : ''));
    // The real web app answers with a 302 to script.googleusercontent.com; Playwright can't intercept
    // the followed request, so the answer is served directly with the same CORS header.
    const out = ctx.doPost({ postData: { contents: req.postData() } }).text;
    return rt.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: out });
  }
  return { route, sheets, log };
}

function assert(ok, msg = 'assertion failed') { if (!ok) throw new Error(msg); }
