# Plant Care 🌿

A small home-screen app for looking after houseplants: per-plant watering and fertilizing
schedules, a "Today" list of what's due, snoozing, a care log, and a photo timeline.

Everything lives in `app/` and is hosted on GitHub Pages. Plants, care history and photos are
stored on the phone (IndexedDB). Photos are re-encoded to at most 2048px and about 600 KB.

## Google Sheet backup

`apps-script/Code.gs` is a small Apps Script that lives inside a Google Sheet. It is marked
`@OnlyCurrentDoc`, so Google only lets it open that one spreadsheet. The app posts to it after
every change (free, no Google Cloud project), and it writes only its own tabs: `Plants` (a readable
summary), `Data` and `Photos` (photos stored as text in 45,000-character pieces).

1. Create a Google Sheet, open Extensions › Apps Script, paste `Code.gs`.
2. Change `KEY` to a passphrase of at least 12 characters and save.
3. Deploy › New deployment › Web app. Execute as: Me. Who has access: Anyone. Authorize it.
4. In Plant Care › Settings › Google backup, paste the Web app URL and the same key.

Use the same URL and key on another phone to restore everything there. A file backup
(Settings › Backup file) is still available too.

## Install on iPhone

1. Open the GitHub Pages address in **Safari**.
2. Tap **Share › Add to Home Screen**, then open Plant Care from the Home Screen.

## Deploying

Pushes to `main` deploy `app/` to GitHub Pages (repo Settings › Pages › Source: GitHub Actions).

## Tests

`tests/drive-sync.test.mjs` runs the app in a simulated iPhone against `Code.gs` on a fake Sheet:
serve `app/` on port 8123, then `node tests/drive-sync.test.mjs`.
