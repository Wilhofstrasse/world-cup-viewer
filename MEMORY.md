# World Cup Viewer — Memory

**Created:** 2026-06-17
**Status:** new (split out of gabriel-chess-cockpit on 17.06.2026)

## Context

Kid-friendly FIFA WM 2026 PWA — swipe SRF highlight summaries + a structured Spiele schedule (groups/rounds) with scores + scorers. Split from `gabriel-chess-cockpit` (which reverts to chess-only). Standalone Cloudflare Worker (serves `web/` + `/api/*`), own R2 (`world-cup-data`), own `*/15` cron, own deploy. **GitHub public + shareable.**

## Data sources (verified live 17.06.2026)

- **Clips:** SRGSSR Integration Layer, **keyless**, CORS `*`. List `episodeComposition/latestByShow/byUrn/{showUrn}` (paginate `next`); resolve `mediaComposition/byUrn/{urn}` → HLS (`srf-vod…akamaized.net`, tokenType NONE). Show `urn:srf:show:tv:c55b9fb8-e108-4994-a1d0-8c288bf8d5bc`. Client-side from the device (CH IP meets the `/ch/` geofence). Feed shows only the per-match "Die Live-Highlights bei A - B" reels.
- **Schedule structure:** **FIFA** `calendar/matches` (same keyless source as scores, since v1.3.0, 18.06.2026) carries round + group + teams + kickoff for ALL fixtures → the Spiele view renders it directly (`matches.js` reads `/api/wm/matches`, grouped by `round`→`group`). **SRF livecenter was RETIRED for the schedule** — it only lists matches SRF is streaming in a rolling window (67 vs FIFA's 72), so whole groups were incomplete (Deutschland–Curaçao was missing). SRF livecenter (`scheduledLivestreams/livecenter`) + `parseLiveCenterTitle` are now dead for Spiele; `fetchFixtures` in `il.js` is an unreferenced export (left for now). SRF IS still the Highlights clip source. **Operational:** Spiele now hard-depends on `wm/matches.json` in R2 (no SRF fallback) — the `*/15` cron keeps it warm; if it empties, Spiele shows an error until the next tick.
- **Scores / scorers / minutes:** **FIFA public API** (`api.fifa.com/api/v3`, KEYLESS, CORS-open, Akamai s-maxage=15) — default provider since v1.2.0 (18.06.2026). API-Football's FREE tier is paywalled to 2022–2024 (`"Free plans do not have access to this season"`), so it can't see WM 2026 at all. FIFA carries the full tournament. Recipe: `idCompetition=17`, `idSeason=285023`, `language=de-DE` (German team names align with the SRF schedule via `teamsMatch`). `calendar/matches?...&count=500` → fixtures+score+status (MatchStatus 0=fin/1=sched/3=live); `timelines/17/285023/{IdStage}/{IdMatch}` → goal events, `Type ∈ {0 goal, 41 penalty, 34 own-goal}`, minute from `MatchMinute`, scorer+team parsed from `EventDescription` (caps surname → `tidyName`; own goals prefixed "Eigentor durch "). Provider in `src/wm/fifa.ts`; `getProvider` switch (`WM_API_PROVIDER`, default "fifa"; "apifootball" needs a paid key). The Spiele view still merges this onto the keyless SRF schedule by tolerant team-match. Verified live: Argentinien 3-0 Algerien → Messi 17'/60'/76'.

## Setup / ops

See `README.md`. Secret: `APIFOOTBALL_KEY`. Bucket: `world-cup-data`. Deploy: `npm run deploy` (deploy-gate). Version surfaced live at `/api/version`; PWA footer shows it (appshell.js) + pull-to-refresh pill (ported from spesen).

## Resolved — "Spiele" tab blank on real iOS (v1.0.2, 17.06.2026)

Two compounding causes, found via workflow + Codex:

1. **CSS visibility:** `#view-spiele` shipped with the `[hidden]` attribute and `wm.css` only ever *hid* the inactive view, never *showed* the active one. JS clearing `[hidden]` was defeated by a stale cached stylesheet. → Fix: inline critical view-visibility CSS in `<head>` with `!important` show-rules (beats UA `[hidden]` + any stale cached `wm.css`), dropped `[hidden]` from markup, dual `body:not([data-tab])` fallback guards.
2. **Frozen service worker (the real masker):** `sw.js` was byte-identical across 1.0.0→1.0.1, so iOS never re-installed it and kept serving pre-fix assets — the fix physically never reached the device. `/api/version` masked it (reads the Worker var, not cached bytes).

**Fix mechanism — one-shot kill-switch** (`sw.js`): on first activate of a byte-changed worker, wipe ALL caches + `self.registration.unregister()` ONCE, drop a `KILL_DONE` sentinel cache, return. Re-registered worker sees the sentinel → just claims → persists (no thrash, push/offline return). Plus `register(sw.js,{updateViaCache:'none'})` so the SW script is never HTTP-cached again, and an appshell.js `/api/version`-mismatch one-shot `location.reload()` (sessionStorage-guarded) for same-bytes deploys. **Lesson: bumping app version without changing `sw.js` bytes does NOT update an installed iOS PWA — always touch the SHELL_CACHE name when shipping an asset fix.** Codex confirmed SHIP. Guaranteed device cure if the 24h SW check hasn't elapsed: delete + re-add the home-screen icon.

## Known bugs

- **Goal-marker count ≠ score (v1.9.2, observed 21.06.2026):** marker dots on the seek rail don't match the final score on tested games — count is visibly wrong by inspection (rail balls vs. `m.scoreA + m.scoreB` from FIFA). v3 tuning (`tor+e?!?|tre+ffer!?|go+a+l+!?` + NEGATIVE_CONTEXT compound stoplist + `DEDUP_SEC=15` + `MAX_MARKERS=8`) reduced false positives but base count accuracy still off. Whisper-only path on home Mac, medium DE model, `PRE_ROLL_SEC=4`. Next: cross-check whisper transcripts vs FIFA goal count, audit per-clip; consider scorer-minute reconciliation (FIFA goals carry `minute`, could pin markers instead of trusting whisper for count). Detector: `tools/goal-detector/detect.mjs`. LaunchAgent: `com.filipeandrade.goal-detector` every 30 min.

## Open decisions

- **Custom domain** — ✅ done: `wm.filipeandrade.com` (custom_domain route, no CF Access; public).
- **Canvas-sync design pass** — ✅ done (18.06.2026): component-library bundle in `design/canvas/` pushed via DesignSync to the claude.ai/design project **"Gabriel · WM 2026 Viewer"** (projectId `80d66392-…`). Filipe iterates there; re-push with `/design-sync`.
- **Scores/scorers** — ✅ done: keyless FIFA API (see Data sources). No paid key needed.
- **Goals follow-up (minor, Codex-flagged):** 0-0 finished matches re-fetch goals every tick (completion inferred from `goals.length>0`). Harden with an explicit `goalsFetched` flag if cap pressure shows. Also a `parseInt(IdMatch)` NaN guard would be tidy.
- **Calendar write-back** (`src/wm/calendar.ts`, tested core) — needs iCloud app-pw; optional for this kid-facing app (was a Filipe-facing feature).

## Next — new FIFA features (design-first, requested 18.06.2026)

Build these (one Codex-aligned workflow each: plan→code→test→debug→validate). Endpoints all verified in `docs/fifa-api.md`:
1. **Top scorers** (Golden Boot): `/topseasonplayerstatistics/season/285023/topscorers` — goals/assists/games.
2. **Lineups + formations + player photos**: `/live/football/17/285023/{stage}/{match}` — Tactics + Players[] (ShirtNumber, PlayerPicture).
3. **Player cards**: `/players/{id}` — height/birthplace/caps/career goals.
4. **Squads** (48 teams): `/teams/squads/all/17/285023`.
5. **Knockout bracket**: stage IDs in `docs/fifa-api.md`.
6. **Official tables** (upgrade computed standings): `/calendar/17/285023/289273/Standing` — adds `QualificationStatus` (qualified/eliminated badges) + official head-to-head tiebreakers.

**Design-first:** user wants a wireframe + hi-fi from **Claude Design** (claude.ai/design) BEFORE coding each feature, then build to match. NOTE: a Claude Code session cannot drive the Claude Design *generative agent* via tools (DesignSync only reads/writes the project's files). So either (a) hand the user a component-aware prompt to run in claude.ai/design himself, or (b) author wireframe+hifi mockups + push to his "Gabriel · WM 2026 Viewer" design project (projectId `80d66392-…`). User leans (a) — "ask Claude Design … I design myself." Confirm the path + which feature first.

**Inventory note:** this project has an anchor (`.claude/project.json`, uid `world-cup-viewer`) but is NOT in `inventory.json` — run `/park` from inside `~/Developer/world-cup-viewer` to heal it (this session's cwd was gabriel-chess-cockpit, so park mis-targeted).

## Links

- **FIFA API capability map:** `docs/fifa-api.md` — what api.fifa.com offers (standings endpoint `/calendar/17/285023/289273/Standing`, top scorers, lineups+photos, player bios, squads, bracket; NOT available: aggregate match stats, stadium capacity). Reference before building any new WM data feature.
- Repo: https://github.com/Wilhofstrasse/world-cup-viewer
- Dashboard: https://filipeandrade.com/secure/projects/
