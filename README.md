# World Cup Viewer

A kid-friendly, installable PWA for the **FIFA World Cup 2026** (11.06–19.07.2026):

- **Highlights** — a Reels-style vertical swipe feed of SRF match-summary clips.
- **Spiele** — the schedule structured by group + round, with scores + goalscorers.

Built for a phone home screen; works on iPad too. German UI.

## Live

- App: **https://wm.filipeandrade.com**
- Send feedback: open a [GitHub issue](https://github.com/Wilhofstrasse/world-cup-viewer/issues/new) or use the in-app **Feedback** page (`/feedback.html`).

## How it works

| Part | Source | Key needed? |
|---|---|---|
| Highlight clips (list + playback) | SRGSSR Integration Layer (`il.srgssr.ch`), keyless, CORS-open | **No** — resolved client-side from the device (the `/ch/` geofence is met by a Swiss IP). |
| Schedule / scores / scorers | API-Football (`v3.football.api-sports.io`) | **Yes** — free tier (~100 req/day). Key stays server-side. |

The schedule structure (groups/rounds/fixtures/kickoffs) comes keyless from SRF
livecenter; scores + scorers overlay from API-Football when the key is set.

## Security

- No secrets in the client. The API-Football key is a Cloudflare **Worker secret**, never shipped to the browser.
- Served over HTTPS. Content is public highlight clips + public match data — safe to share.

## Setup

1. **API-Football key** (free): register at <https://dashboard.api-football.com/register>, then:
   ```
   wrangler secret put APIFOOTBALL_KEY
   ```
2. **R2 bucket** for the cached match blob:
   ```
   wrangler r2 bucket create world-cup-data
   ```
3. Confirm `WM_LEAGUE_ID` (FIFA World Cup, default `1`) + `WM_SEASON` (`2026`) in `wrangler.toml`.

## Deploy

```
npm run deploy   # predeploy runs .deploy-gate.sh (clean tree + HEAD == origin)
```

## Develop

```
npm install
npm test         # parser, team-matcher, IL + API-Football mappers (fixture-based)
npm run typecheck
npm run dev      # wrangler dev
```

## Layout

- `web/` — the PWA. `index.html` + `wm/` (parse, il, feed, matches, app, css), `appshell.js` (version stamp + pull-to-refresh), `sw.js`, `vendor/hls.light.min.js`.
- `src/` — the Worker. `index.ts` (assets + `/api/wm/matches` + `/api/version` + cron), `wm/` (football provider, ingest, store, calendar, types).
- Design surface: `design/` (claude.ai/design via canvas-sync).
