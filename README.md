# Plant Care 🌿

A small home-screen app for looking after houseplants: per-plant watering and fertilizing
schedules, a care log, a photo timeline, snoozable reminders, and push notifications on iPhone.

- **`app/`** is the web app, hosted on GitHub Pages. Plants, care history and photos are stored
  on the phone (IndexedDB). Settings › Back up now saves everything to a single file (via the
  share sheet, so you can put it in iCloud Drive); Restore loads it back.
- **`worker/`** is the reminder server, a free Cloudflare Worker. The app sends it the upcoming
  reminder times; a cron job every 15 minutes sends a Web Push when something is due, then
  once a day until it's logged or snoozed. It creates its own push (VAPID) keys on first use.

## Install on iPhone (iOS 16.4+)

1. Open the GitHub Pages address in **Safari**.
2. Tap **Share › Add to Home Screen**, then open Plant Care from the Home Screen.
3. In Settings, tap **Turn on reminders** and allow notifications.

## Deploying

- App: pushes to `main` that touch `app/` deploy to Pages (Settings › Pages › Source: GitHub Actions).
- Reminder server: pushes that touch `worker/` deploy to Cloudflare. Needs repo secrets
  `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`.
  Put the resulting `https://plant-care-reminders.<you>.workers.dev` address in `app/config.js`.

## Tests

```
cd worker && npm ci && npm test        # push encryption + VAPID checks
npx wrangler dev --test-scheduled &    # then:
node test/local.test.mjs               # sync → cron → push, end to end
```
