# World Cup Viewer — agent rules (project-local)

> Visible to any LLM operating on this repo. Read on session-start.

## Scaffolded by

- Skill: `/project` (split out of `gabriel-chess-cockpit`, 17.06.2026)
- Recorded skill version: see `.claude/skill-version.txt`

## How to work here

Open `PLAN.md` first; `MEMORY.md` carries running context + verified data-source facts + open decisions. `README.md` is the public-facing setup.

### Quick rules

- **Plan/memory discipline.** `PLAN.md` authoritative; save durable context to `MEMORY.md`. Don't save speculative/session-only state.
- **Commits.** Commit on logical units; never force-push; never amend published commits ([P-160]).
- **Deploy gate.** `.deploy-gate.sh` is the only sanctioned deploy route ([P-140]): `npm run deploy`.
- **No secrets in the client.** `APIFOOTBALL_KEY` is a Worker secret. Clips are keyless. Repo is **public** — never commit a secret.
- **Versioning.** Bump `package.json` + `wrangler.toml [vars] APP_VERSION` + `web/appshell.js APP_BUILT` in lockstep on every deploy; surfaced at `/api/version` + the PWA footer.

### Data sources (don't guess — verified, see MEMORY.md)

- Clips + schedule structure: SRF Integration Layer / livecenter (`il.srgssr.ch`), keyless, CORS-open.
- Scores/scorers: API-Football (`v3.football.api-sports.io`), key server-side. No keyless source for scorer-minutes.

## Design / canvas-sync

UI design via claude.ai/design against `design/highlights-v1.md` (connects through GitHub OAuth to this public repo). Refine the feed + Spiele presentation; the verified data layer (`web/wm/*`, `src/wm/*`) stays.

## Reference paths

- Plan: `PLAN.md` · Memory: `MEMORY.md` · Design brief: `design/highlights-v1.md`
- PWA: `web/index.html`, `web/wm/*`, `web/appshell.js`, `web/sw.js`
- Worker: `src/index.ts`, `src/wm/*`
- Repo: https://github.com/Wilhofstrasse/world-cup-viewer
