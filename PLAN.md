# World Cup Viewer — PLAN

## In plain English

An installable PWA for the FIFA World Cup 2026: a kid swipes through SRF match-highlight summaries, and a "Spiele" tab shows the schedule by group + round with scores and goalscorers. Shareable, secure (no secrets in the browser), works on iPhone + iPad.

## Design surface

- Tool: claude-design (canvas-sync)
- Brief: design/highlights-v1.md
- Repo: https://github.com/Wilhofstrasse/world-cup-viewer (branch: main)

## Architecture

One Cloudflare Worker serves the PWA (`web/` via `[assets]`) + `/api/wm/matches` + `/api/version` + a `*/15` ingest cron.

- **Highlights** — client-side, keyless: SRF Integration Layer lists + resolves clips (device in CH meets the geofence). No key, no proxy.
- **Spiele** — schedule structure keyless from SRF livecenter (group/round/teams/kickoff); scores + scorers overlaid from API-Football (Worker secret) and cached in R2 (`world-cup-data`).
- **Shell** — `appshell.js`: live version stamp + spesen-style pull-to-refresh pill. Network-first SW for fresh modules; offline shell for thumbnails/index.

## Status

v1.0.0 — split from `gabriel-chess-cockpit` on 17.06.2026 (chess reverted to chess-only). Working: clips feed (keyless), structured Spiele schedule (keyless), PTR pill, version stamp, README + feedback page. Pending: API-Football key (scores/scorers), deploy + custom domain, canvas-sync design pass.

## Next milestones

1. Deploy: create `world-cup-data` R2 bucket, `wrangler secret put APIFOOTBALL_KEY`, `npm run deploy`.
2. Custom domain (nice URL), no CF Access (public highlights).
3. Canvas-sync design pass on the feed + Spiele.
