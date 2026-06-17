# World Cup Viewer — Memory

**Created:** 2026-06-17
**Status:** new (split out of gabriel-chess-cockpit on 17.06.2026)

## Context

Kid-friendly FIFA WM 2026 PWA — swipe SRF highlight summaries + a structured Spiele schedule (groups/rounds) with scores + scorers. Split from `gabriel-chess-cockpit` (which reverts to chess-only). Standalone Cloudflare Worker (serves `web/` + `/api/*`), own R2 (`world-cup-data`), own `*/15` cron, own deploy. **GitHub public + shareable.**

## Data sources (verified live 17.06.2026)

- **Clips:** SRGSSR Integration Layer, **keyless**, CORS `*`. List `episodeComposition/latestByShow/byUrn/{showUrn}` (paginate `next`); resolve `mediaComposition/byUrn/{urn}` → HLS (`srf-vod…akamaized.net`, tokenType NONE). Show `urn:srf:show:tv:c55b9fb8-e108-4994-a1d0-8c288bf8d5bc`. Client-side from the device (CH IP meets the `/ch/` geofence). Feed shows only the per-match "Die Live-Highlights bei A - B" reels.
- **Schedule structure:** SRF **livecenter** (keyless): `mediaList/video/scheduledLivestreams/livecenter` → titles "Fussball: FIFA WM 2026, {round}, Gruppe {X}, {A} - {B}". Rolling window (recent + upcoming).
- **Scores / scorers / minutes:** API-Football (`APIFOOTBALL_KEY` Worker secret). No keyless source carries scorer-minutes (verified: SwissTXT data path unreachable, OpenLigaDB has no 2026). The Spiele view merges API-Football onto the keyless schedule by tolerant team-match.

## Setup / ops

See `README.md`. Secret: `APIFOOTBALL_KEY`. Bucket: `world-cup-data`. Deploy: `npm run deploy` (deploy-gate). Version surfaced live at `/api/version`; PWA footer shows it (appshell.js) + pull-to-refresh pill (ported from spesen).

## Open decisions

- **Custom domain** (nice URL) — pending (e.g. `wm.filipeandrade.com` → the Worker, no CF Access; public highlights).
- **Canvas-sync design pass** — `design/highlights-v1.md`; connect claude.ai/design to the public repo.
- **API-Football key** — needed for scores/scorers; schedule shows keyless without it.
- **Calendar write-back** (`src/wm/calendar.ts`, tested core) — needs iCloud app-pw; optional for this kid-facing app (was a Filipe-facing feature).

## Links

- Repo: https://github.com/Wilhofstrasse/world-cup-viewer
- Dashboard: https://filipeandrade.com/secure/projects/
