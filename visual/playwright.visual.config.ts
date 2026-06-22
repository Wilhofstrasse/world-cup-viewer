/**
 * playwright.visual.config.ts — config for the WM 2026 visual-diff harness.
 *
 * Three viewport projects (desktop / ipad / iphone) × six SPA states defined in
 * specs/wm-views.spec.ts = 18 baselines.
 *
 * Determinism contract:
 *  - `expect.toHaveScreenshot` clamped to 2% pixel ratio per the plan's risk
 *    table; 0.2 per-pixel YIQ tolerance absorbs antialias without hiding real
 *    change. Animations disabled, caret hidden.
 *  - Service workers blocked at context level → no stale shell on rerun.
 *  - `prefers-reduced-motion: reduce` → CSS keyframes silenced.
 *  - Determinism shims (Date.now, randomUUID, Math.random, sendBeacon) live in
 *    helpers/fixtures.ts and are wired into context.addInitScript per project.
 *
 * Baselines are darwin/arm64 (M5). Cross-platform pixel jitter documented in
 * visual/README.md.
 */

import { defineConfig, devices } from "playwright/test";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "./specs",
  // Fresh page per test → no state leak between the 6 states.
  fullyParallel: false,
  workers: 1,
  // Visual diffs need the same context across all states within a project so
  // the context-level service-worker block + determinism init script apply.
  use: {
    baseURL: BASE_URL,
    serviceWorkers: "block",
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
    viewport: { width: 1280, height: 720 },
    // Reduced motion silences wm.css transitions/animations on every state.
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  // Diff threshold — see Risk #1 in PLAN. Tightened per state via test.use().
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide",
    },
  },
  reporter: [["html", { outputFolder: "./report", open: "never" }], ["list"]],
  outputDir: "./test-results",
  projects: [
    {
      name: "desktop",
      use: {
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      },
    },
    {
      name: "ipad",
      use: {
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: "iphone",
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
