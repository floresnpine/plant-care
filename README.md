# Plant Care 🌿

A small home-screen app for looking after houseplants: per-plant watering and fertilizing
schedules, a "Today" list of what's due, snoozing, a care log, and a photo timeline.

Everything lives in `app/` and is hosted on GitHub Pages. Plants, care history and photos are
stored on the phone (IndexedDB). Settings › Back up now saves everything to a single file via the
share sheet (save it to iCloud Drive or Files); Restore loads it back.

## Install on iPhone

1. Open the GitHub Pages address in **Safari**.
2. Tap **Share › Add to Home Screen**, then open Plant Care from the Home Screen.

## Deploying

Pushes to `main` deploy `app/` to GitHub Pages (repo Settings › Pages › Source: GitHub Actions).
