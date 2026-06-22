# visual/ — WM 2026 PWA visual-diff harness

CSS regression harness using Playwright's `expect.toHaveScreenshot`. Three
viewport projects × six SPA states = 18 baselines. Self-contained — uses the
existing `playwright@1.61.0` devDep, no new packages.

## Commands

```bash
npm run visual           # diff against baselines, exits 1 on FAIL
npm run visual:bless     # regenerate baselines (review diffs FIRST)
WM_DEV_URL=http://127.0.0.1:8787 npm run visual
                         # reuse an already-running `npm run dev`
```

## When to run

- Before a `wm.css` refactor PR.
- After any header / drawer / Mehr sub-view layout change.
- NOT in CI / pre-commit / pre-push — `predeploy` stays mechanical per
  [P-140]; visual diffs are a manual gate.

## Bless workflow

1. Make the intentional visual change.
2. `npm run visual` → look at the diff report (`visual/report/index.html`)
   FIRST. Confirm the diff matches the change you intended.
3. `npm run visual:bless` → overwrites the 18 PNGs under
   `visual/specs/wm-views.spec.ts-snapshots/`.
4. `git diff --stat visual/specs/**/*.png` — sanity-check the churn.
5. Commit the new baselines alongside the code change.

## Caveats

- **Baselines are darwin/arm64 (M5).** Cross-platform pixel jitter (font
  hinting, GPU compositor) will likely break a Linux/Intel-Mac run above the
  2% threshold. Playwright auto-suffixes the platform — a Linux CI run would
  produce `*-linux.png` baselines side-by-side.
- **iPhone 390×844 is Chromium's interpretation**, NOT iOS Safari standalone.
  This catches CSS-layer regressions (breakpoints, drawer layout, tab/header
  geometry). It does NOT prove iOS PWA `display-mode: standalone`,
  `env(safe-area-inset-*)`, or `-webkit-fill-available` behavior. Pair with a
  manual iPhone Safari/PWA pass before deploy.
- **Fixtures freeze the SRF + FIFA shapes captured on 2026-06-22.** If the
  upstream feed shape shifts (see `MEMORY.md` Data sources), baselines no
  longer reflect production. Re-capture by re-running this harness.
- **Soft cap: 5 MB of PNGs.** If `visual/specs/**/*.png` totals more than
  that, revisit Git LFS. The bless script prints a warning when crossed.

## Files

| Path | Role |
|---|---|
| `run.mjs` | Spawns `wrangler dev` on a free port, runs Playwright, kills the child. |
| `playwright.visual.config.ts` | 3 viewport projects, expect.toHaveScreenshot threshold. |
| `specs/wm-views.spec.ts` | Single spec, 6 states. |
| `helpers/states.ts` | `gotoHighlightsEmpty / Loaded / gotoSpiele / openDrawer / gotoMehr / gotoTorjaeger` + settled gates. |
| `helpers/fixtures.ts` | `page.route()` stubs for `/api/*` + IL + thumbnail hosts + catch-all 503. |
| `fixtures/*.json` | Deterministic clips / matches / topscorers / config payloads. |
| `specs/wm-views.spec.ts-snapshots/` | Committed baselines (`<title>-<project>-darwin.png`). |
