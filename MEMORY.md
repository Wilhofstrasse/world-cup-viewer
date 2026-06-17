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

## Resolved — "Spiele" tab blank on real iOS (v1.0.2, 17.06.2026)

Two compounding causes, found via workflow + Codex:

1. **CSS visibility:** `#view-spiele` shipped with the `[hidden]` attribute and `wm.css` only ever *hid* the inactive view, never *showed* the active one. JS clearing `[hidden]` was defeated by a stale cached stylesheet. → Fix: inline critical view-visibility CSS in `<head>` with `!important` show-rules (beats UA `[hidden]` + any stale cached `wm.css`), dropped `[hidden]` from markup, dual `body:not([data-tab])` fallback guards.
2. **Frozen service worker (the real masker):** `sw.js` was byte-identical across 1.0.0→1.0.1, so iOS never re-installed it and kept serving pre-fix assets — the fix physically never reached the device. `/api/version` masked it (reads the Worker var, not cached bytes).

**Fix mechanism — one-shot kill-switch** (`sw.js`): on first activate of a byte-changed worker, wipe ALL caches + `self.registration.unregister()` ONCE, drop a `KILL_DONE` sentinel cache, return. Re-registered worker sees the sentinel → just claims → persists (no thrash, push/offline return). Plus `register(sw.js,{updateViaCache:'none'})` so the SW script is never HTTP-cached again, and an appshell.js `/api/version`-mismatch one-shot `location.reload()` (sessionStorage-guarded) for same-bytes deploys. **Lesson: bumping app version without changing `sw.js` bytes does NOT update an installed iOS PWA — always touch the SHELL_CACHE name when shipping an asset fix.** Codex confirmed SHIP. Guaranteed device cure if the 24h SW check hasn't elapsed: delete + re-add the home-screen icon.

## Open decisions

- **Custom domain** — ✅ done: `wm.filipeandrade.com` (custom_domain route, no CF Access; public).
- **Canvas-sync design pass** — `design/highlights-v1.md`; connect claude.ai/design to the public repo.
- **API-Football key** — needed for scores/scorers; schedule shows keyless without it.
- **Calendar write-back** (`src/wm/calendar.ts`, tested core) — needs iCloud app-pw; optional for this kid-facing app (was a Filipe-facing feature).

## Links

- Repo: https://github.com/Wilhofstrasse/world-cup-viewer
- Dashboard: https://filipeandrade.com/secure/projects/
