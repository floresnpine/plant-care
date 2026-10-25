// Google Drive sync, straight from the phone (no server).
// Sign-in uses Google's OAuth redirect flow, which works inside a home-screen web app.
// Everything goes into a visible "Plant Care" folder: data.json plus one JPEG per photo.
// The drive.file scope only lets the app see files it created itself.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'Plant Care';
const KEY = 'plant-care-google';

const redirectUri = () => location.origin + location.pathname;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export const auth = {
  get connected() { return !!load().connected; },
  get email() { return load().email || ''; },
  get token() {
    const s = load();
    return s.token && s.expires > Date.now() + 60_000 ? s.token : null;
  },
  get error() { return load().error || ''; },

  // Sends the page to Google. silent=true tries to renew without showing anything.
  signIn(clientId, { silent = false } = {}) {
    const state = crypto.randomUUID();
    save({ ...load(), state, returnTo: location.hash || '#/', silentTried: silent ? Date.now() : load().silentTried });
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state,
    });
    if (silent) p.set('prompt', 'none');
    if (load().email) p.set('login_hint', load().email);
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  },

  // Call on startup, before routing. Returns 'ok', 'error' or null when the URL is not a Google reply.
  handleRedirect() {
    if (!/[#&](access_token|error)=/.test(location.hash)) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    const s = load();
    history.replaceState(null, '', redirectUri() + (s.returnTo || '#/'));
    if (p.get('state') !== s.state) return null;
    delete s.state;
    delete s.returnTo;
    if (p.get('access_token')) {
      save({ ...s, connected: true, error: '', token: p.get('access_token'), expires: Date.now() + Number(p.get('expires_in') || 3600) * 1000 });
      return 'ok';
    }
    // A failed silent renewal just means we ask the person to tap Reconnect.
    save({ ...s, token: null, error: p.get('error') === 'access_denied' ? 'Google access was not allowed.' : 'Google needs you to sign in again.' });
    return 'error';
  },

  setEmail(email) { save({ ...load(), email }); },
  expire() { save({ ...load(), token: null }); },
  disconnect() {
    const t = load().token;
    if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${t}`, { method: 'POST' }).catch(() => {});
    save({});
  },
  // Lets the app try a silent renewal at most once every 10 minutes, so it can never loop.
  canTrySilent() { return Date.now() - (load().silentTried || 0) > 10 * 60_000; },
};

export class AuthError extends Error {}

async function call(url, opts = {}) {
  const token = auth.token;
  if (!token) throw new AuthError('Not signed in to Google');
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (res.status === 401) { auth.expire(); throw new AuthError('Google sign-in expired'); }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function list(query) {
  const files = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({ q: query, fields: 'nextPageToken,files(id,name,size)', pageSize: '1000', spaces: 'drive' });
    if (pageToken) p.set('pageToken', pageToken);
    const data = await (await call(`${API}/files?${p}`)).json();
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

async function folderId() {
  const found = await list(`name = '${q(FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  if (found.length) return found[0].id;
  const res = await call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (await res.json()).id;
}

async function upload({ id, name, parent, type, body }) {
  const boundary = `plantcare${crypto.randomUUID().replace(/-/g, '')}`;
  const meta = id ? {} : { name, parents: [parent] };
  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, body, `\r\n--${boundary}--`,
  ]);
  const res = await call(`${UPLOAD}/files${id ? `/${id}` : ''}?uploadType=multipart&fields=id`, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return (await res.json()).id;
}

const photoName = id => `photo-${id}.jpg`;

// Pushes everything on the phone to Drive: new photos, removed photos, and the latest data.json.
export async function push({ plants, events, photos, meta }, onProgress = () => {}) {
  const parent = await folderId();
  const files = await list(`'${parent}' in parents and trashed = false`);
  const byName = new Map(files.map(f => [f.name, f]));

  const missing = photos.filter(p => !byName.has(photoName(p.id)));
  let done = 0;
  for (const p of missing) {
    await upload({ name: photoName(p.id), parent, type: 'image/jpeg', body: p.blob });
    onProgress(++done, missing.length);
  }
  const keep = new Set(photos.map(p => photoName(p.id)));
  for (const f of files) if (/^photo-.*\.jpg$/.test(f.name) && !keep.has(f.name)) await call(`${API}/files/${f.id}`, { method: 'DELETE' });

  const data = {
    app: 'plant-care', version: 2, savedAt: Date.now(), plants, events, meta,
    photos: photos.map(({ blob, thumb, ...rest }) => rest),
  };
  await upload({ id: byName.get('data.json')?.id, name: 'data.json', parent, type: 'application/json', body: JSON.stringify(data) });
  return { uploaded: missing.length };
}

// Returns the saved data with each photo's full-size blob, or null if Drive has nothing yet.
export async function pull(onProgress = () => {}) {
  const parent = await folderId();
  const files = await list(`'${parent}' in parents and trashed = false`);
  const byName = new Map(files.map(f => [f.name, f]));
  const dataFile = byName.get('data.json');
  if (!dataFile) return null;
  const data = await (await call(`${API}/files/${dataFile.id}?alt=media`)).json();
  const photos = [];
  let done = 0;
  for (const p of data.photos || []) {
    const f = byName.get(photoName(p.id));
    if (!f) continue;
    photos.push({ ...p, blob: await (await call(`${API}/files/${f.id}?alt=media`)).blob() });
    onProgress(++done, data.photos.length);
  }
  return { ...data, photos };
}

export async function hasBackup() {
  const parent = await folderId();
  return (await list(`'${parent}' in parents and name = 'data.json' and trashed = false`)).length > 0;
}

export async function whoAmI() {
  const res = await call(`${API}/about?fields=user(emailAddress)`);
  return (await res.json()).user?.emailAddress || '';
}
