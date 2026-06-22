/**
 * wm-views.spec.ts — visual-diff coverage for the 6 SPA states × 3 viewports.
 *
 * Each test:
 *  1. Boots a clean context with reduced-motion + determinism shims.
 *  2. Installs route stubs (per Codex feedback: covers /api/*, SRF IL direct,
 *     SRF thumbnails, plus catch-all 503 for any unstubbed external host).
 *  3. Navigates via helpers/states.ts (each helper is its own settled gate).
 *  4. Captures a full-page screenshot vs the committed baseline.
 *
 * Baselines live at specs/wm-views.spec.ts-snapshots/<title>-<project>-darwin.png.
 */

import { test, expect } from "playwright/test";
import { installDeterminism, installFixtures } from "../helpers/fixtures";
import {
  gotoHighlightsEmpty,
  gotoHighlightsLoaded,
  gotoSpiele,
  openDrawer,
  gotoMehr,
  gotoTorjaeger,
} from "../helpers/states";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8787";
const SAME_ORIGIN_HOST = new URL(BASE_URL).host;

test.beforeEach(async ({ context, page }) => {
  // Reduced-motion is set in playwright.visual.config.ts `use.reducedMotion`
  // so it applies to EVERY context (covers wm.css keyframes).
  await installDeterminism(context);
  await installFixtures(page, { clips: "loaded", sameOriginHost: SAME_ORIGIN_HOST });
});

test("highlights-empty", async ({ page }) => {
  // Override clips to empty for this single test.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installFixtures(page, { clips: "empty", sameOriginHost: SAME_ORIGIN_HOST });
  await gotoHighlightsEmpty(page, BASE_URL);
  await expect(page).toHaveScreenshot("highlights-empty.png", { fullPage: true });
});

test("highlights-loaded", async ({ page }) => {
  await gotoHighlightsLoaded(page, BASE_URL);
  // Poster decode noise on this state is highest — Risk #5 in PLAN.
  await expect(page).toHaveScreenshot("highlights-loaded.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.035,
  });
});

test("spiele-default", async ({ page }) => {
  await gotoSpiele(page, BASE_URL);
  await expect(page).toHaveScreenshot("spiele-default.png", { fullPage: true });
});

test("drawer-open", async ({ page }) => {
  await openDrawer(page, BASE_URL);
  await expect(page).toHaveScreenshot("drawer-open.png", { fullPage: true });
});

test("mehr-landing", async ({ page }) => {
  await gotoMehr(page, BASE_URL);
  await expect(page).toHaveScreenshot("mehr-landing.png", { fullPage: true });
});

test("mehr-torjaeger", async ({ page }) => {
  await gotoTorjaeger(page, BASE_URL);
  await expect(page).toHaveScreenshot("mehr-torjaeger.png", { fullPage: true });
});
