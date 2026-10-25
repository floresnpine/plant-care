/**
 * @OnlyCurrentDoc
 *
 * Plant Care backup, kept inside this one Google Sheet.
 * "@OnlyCurrentDoc" above means Google only lets this script open the spreadsheet it belongs to:
 * it cannot see or change any other spreadsheet or file in your Drive.
 *
 * Setup:
 * 1. Change KEY below to a long passphrase only you know (at least 12 characters), then save.
 * 2. Deploy > New deployment > Web app, with "Execute as: Me" and "Who has access: Anyone".
 * 3. In Plant Care > Settings > Google Drive, paste the Web app URL and the same key.
 *
 * The script writes only to its own tabs: "Plants" (an easy-to-read summary), "Data" and "Photos".
 * Any other tabs you add are left alone.
 */

const KEY = 'CHANGE-ME';

const CHUNK = 45000; // a cell holds at most 50,000 characters
const PHOTO_NAME = /^photo-[\w-]+\.jpg$/;

function doPost(e) {
  try {
    if (KEY === 'CHANGE-ME' || KEY.length < 12) throw new Error('Set a KEY of at least 12 characters in the script, save, and deploy a new version');
    const req = JSON.parse(e.postData.contents);
    if (req.key !== KEY) throw new Error('wrong key');
    return reply(handle(req));
  } catch (err) {
    return reply({ error: String(err.message || err) });
  }
}

function doGet() {
  return reply({ ok: true, app: 'plant-care' });
}

function handle(req) {
  switch (req.action) {
    case 'ping':
      return { ok: true, folder: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
    case 'list':
      return { names: photoNames() };
    case 'putPhoto': {
      if (!PHOTO_NAME.test(req.name)) throw new Error('bad photo name');
      if (photoNames().indexOf(req.name) === -1) {
        const parts = split(req.data);
        const sh = tab('Photos');
        const start = sh.getLastRow() + 1;
        sh.getRange(start, 1, parts.length, 3).setValues(parts.map(function (p, i) { return [req.name, i, p]; }));
      }
      return { ok: true };
    }
    case 'getPhoto': {
      const rows = photoRows(req.name);
      return { data: rows.length ? rows.map(function (r) { return r[2]; }).join('') : null };
    }
    case 'deletePhotos': {
      const sh = tab('Photos');
      const names = req.names || [];
      // Each photo's rows sit together, so delete them as blocks, bottom first.
      const values = allRows(sh);
      for (let i = values.length - 1; i >= 0;) {
        if (names.indexOf(values[i][0]) === -1) { i--; continue; }
        let j = i;
        while (j > 0 && values[j - 1][0] === values[i][0]) j--;
        sh.deleteRows(j + 1, i - j + 1);
        i = j - 1;
      }
      return { ok: true };
    }
    case 'putData': {
      const sh = tab('Data');
      sh.clearContents();
      const parts = split(req.data);
      sh.getRange(1, 1, parts.length, 1).setValues(parts.map(function (p) { return [p]; }));
      writeSummary(JSON.parse(req.data));
      return { ok: true };
    }
    case 'getData': {
      const sh = tab('Data');
      const n = sh.getLastRow();
      if (!n) return { data: null };
      return { data: sh.getRange(1, 1, n, 1).getValues().map(function (r) { return r[0]; }).join('') };
    }
    default:
      throw new Error('unknown action');
  }
}

// A readable overview for looking at in the sheet. The app never reads it.
function writeSummary(data) {
  const sh = tab('Plants');
  sh.clearContents();
  const last = function (plantId, type) {
    let at = 0;
    (data.events || []).forEach(function (e) { if (e.plantId === plantId && e.type === type && e.at > at) at = e.at; });
    return at ? new Date(at) : '';
  };
  const every = function (n, unit) { return n ? n + ' ' + (unit || 'day') + (n === 1 ? '' : 's') : 'off'; };
  const rows = [['Plant', 'Where', 'Water every', 'Last watered', 'Fertilize every', 'Last fertilized', 'Photos', 'Notes']];
  (data.plants || []).forEach(function (p) {
    rows.push([p.name, p.location || '', every(p.waterEvery, p.waterUnit), last(p.id, 'water'), every(p.fertEvery, p.fertUnit),
      last(p.id, 'fert'), (data.photos || []).filter(function (ph) { return ph.plantId === p.id; }).length, p.notes || '']);
  });
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function tab(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    // Keep stored text exactly as written (never turned into numbers, dates or formulas).
    if (name !== 'Plants') sh.getRange('A:C').setNumberFormat('@');
  }
  return sh;
}

function allRows(sh) {
  const n = sh.getLastRow();
  return n ? sh.getRange(1, 1, n, 3).getValues() : [];
}

function photoNames() {
  const seen = {};
  allRows(tab('Photos')).forEach(function (r) { seen[r[0]] = true; });
  return Object.keys(seen);
}

function photoRows(name) {
  return allRows(tab('Photos')).filter(function (r) { return r[0] === name; }).sort(function (a, b) { return a[1] - b[1]; });
}

function split(text) {
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
  return parts.length ? parts : [''];
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
