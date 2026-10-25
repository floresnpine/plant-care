// Google backup through the person's own Apps Script inside a Google Sheet (see apps-script/Code.gs).
// No Google Cloud project and no sign-in: the app posts to the script's web-app URL with a key they chose.
// Requests are sent as text/plain so the browser doesn't need a CORS preflight.

const KEY = 'plant-care-drive';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export const conn = {
  get connected() { return !!load().url; },
  get url() { return load().url || ''; },
  get folder() { return load().folder || ''; },
  disconnect() { save({}); },
};

export async function connect(rawUrl, rawKey) {
  const url = rawUrl.trim();
  const key = rawKey.trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) throw new Error('That doesn\'t look like a web app address. It starts with https://script.google.com and ends with /exec.');
  if (key.length < 12) throw new Error('The key needs at least 12 characters, the same as in your script.');
  const res = await call('ping', {}, { url, key });
  save({ url, key, folder: res.folder });
  return res;
}

async function call(action, body = {}, s = load()) {
  if (!s.url) throw new Error('Google Drive is not connected');
  let res;
  try {
    res = await fetch(s.url, { method: 'POST', body: JSON.stringify({ action, key: s.key, ...body }) });
  } catch {
    throw new Error(navigator.onLine ? 'Your script didn\'t answer. In Apps Script, check the deployment is a Web app with access for "Anyone".' : 'You\'re offline. It will sync when you\'re back online.');
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('The script answered strangely. Check it is deployed with access for "Anyone".'); }
  if (data.error === 'wrong key') throw new Error('That key doesn\'t match the KEY in your script.');
  if (data.error) throw new Error(data.error);
  return data;
}

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.slice(r.result.indexOf(',') + 1));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const base64ToBlob = b64 => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jpeg' });
const photoName = id => `photo-${id}.jpg`;

// Pushes everything on the phone to Drive: new photos, removed photos, and the latest data.json.
export async function push({ plants, events, photos, meta }, onProgress = () => {}) {
  const { names } = await call('list');
  const existing = new Set(names);
  const missing = photos.filter(p => !existing.has(photoName(p.id)));
  let done = 0;
  for (const p of missing) {
    await call('putPhoto', { name: photoName(p.id), data: await blobToBase64(p.blob) });
    onProgress(++done, missing.length);
  }
  const keep = new Set(photos.map(p => photoName(p.id)));
  const gone = names.filter(n => /^photo-.*\.jpg$/.test(n) && !keep.has(n));
  if (gone.length) await call('deletePhotos', { names: gone });
  const data = {
    app: 'plant-care', version: 2, savedAt: Date.now(), plants, events, meta,
    photos: photos.map(({ blob, thumb, ...rest }) => rest),
  };
  await call('putData', { data: JSON.stringify(data) });
  return { uploaded: missing.length };
}

// Returns the saved data with each photo's full-size blob, or null if Drive has nothing yet.
export async function pull(onProgress = () => {}) {
  const { data: raw } = await call('getData');
  if (!raw) return null;
  const data = JSON.parse(raw);
  const photos = [];
  let done = 0;
  for (const p of data.photos || []) {
    const { data: b64 } = await call('getPhoto', { name: photoName(p.id) });
    if (b64) photos.push({ ...p, blob: base64ToBlob(b64) });
    onProgress(++done, data.photos.length);
  }
  return { ...data, photos };
}

export async function hasBackup() {
  return !!(await call('getData')).data;
}
