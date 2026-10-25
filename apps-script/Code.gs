/**
 * Plant Care backup to Google Drive.
 *
 * Paste this whole file into a new project at script.google.com, then
 * Deploy > New deployment > Web app, with "Execute as: Me" and "Who has access: Anyone".
 * Copy the Web app URL into Plant Care > Settings > Google Drive.
 *
 * Everything is saved in a "Plant Care" folder in your Drive: data.json plus one JPEG per photo.
 * The first phone that connects sets a private key; later requests without that key are refused.
 * To reset the key, open Project Settings > Script properties and delete "KEY".
 */

const FOLDER_NAME = 'Plant Care';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    checkKey(req.key);
    return reply(handle(req));
  } catch (err) {
    return reply({ error: String(err.message || err) });
  }
}

function doGet() {
  return reply({ ok: true, app: 'plant-care' });
}

function handle(req) {
  const folder = getFolder();
  switch (req.action) {
    case 'ping':
      return { ok: true, folder: folder.getUrl() };
    case 'list': {
      const names = [];
      const it = folder.getFiles();
      while (it.hasNext()) names.push(it.next().getName());
      return { names: names };
    }
    case 'putPhoto': {
      if (!/^photo-[\w-]+\.jpg$/.test(req.name)) throw new Error('bad photo name');
      if (!folder.getFilesByName(req.name).hasNext()) {
        folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'image/jpeg', req.name));
      }
      return { ok: true };
    }
    case 'getPhoto': {
      const it = folder.getFilesByName(req.name);
      if (!it.hasNext()) return { data: null };
      return { data: Utilities.base64Encode(it.next().getBlob().getBytes()) };
    }
    case 'deletePhotos': {
      (req.names || []).forEach(function (name) {
        if (!/^photo-[\w-]+\.jpg$/.test(name)) return;
        const it = folder.getFilesByName(name);
        while (it.hasNext()) it.next().setTrashed(true);
      });
      return { ok: true };
    }
    case 'putData': {
      const it = folder.getFilesByName('data.json');
      if (it.hasNext()) it.next().setContent(req.data);
      else folder.createFile('data.json', req.data, 'application/json');
      return { ok: true };
    }
    case 'getData': {
      const it = folder.getFilesByName('data.json');
      return { data: it.hasNext() ? it.next().getBlob().getDataAsString() : null };
    }
    default:
      throw new Error('unknown action');
  }
}

function checkKey(key) {
  if (!key || String(key).length < 20) throw new Error('missing key');
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('KEY');
  if (!saved) props.setProperty('KEY', key);
  else if (saved !== key) throw new Error('wrong key');
}

function getFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* folder was removed, make a new one */ }
  }
  const found = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
