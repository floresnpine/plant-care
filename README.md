# Plant Care 🌿

A small home-screen app for looking after houseplants: per-plant watering and fertilizing
schedules, a "Today" list of what's due, snoozing, a care log, and a photo timeline.

Everything lives in `app/` and is hosted on GitHub Pages. Plants, care history and photos are
stored on the phone (IndexedDB). Photos are re-encoded to at most 2048px and about 600 KB.

## Google Drive backup

`apps-script/Code.gs` is a small Google Apps Script that the app posts to after every change
(free, no Google Cloud project). It keeps a `Plant Care` folder in your Drive with `data.json`
and one JPEG per photo.

1. Open [script.google.com](https://script.google.com), New project, paste `Code.gs`, save.
2. Deploy › New deployment › Web app. Execute as: Me. Who has access: Anyone. Authorize it.
3. Copy the Web app URL into Plant Care › Settings › Google Drive › Connect.

The first phone to connect sets a private key. To add another phone, use Settings › Copy code for
another phone and paste that code instead of the URL. A file backup (Settings › Backup file) is
still available too.

## Install on iPhone

1. Open the GitHub Pages address in **Safari**.
2. Tap **Share › Add to Home Screen**, then open Plant Care from the Home Screen.

## Deploying

Pushes to `main` deploy `app/` to GitHub Pages (repo Settings › Pages › Source: GitHub Actions).

## Tests

`tests/drive-sync.test.mjs` runs the app in a simulated iPhone against `Code.gs` on a fake Drive:
serve `app/` on port 8123, then `node tests/drive-sync.test.mjs`.
