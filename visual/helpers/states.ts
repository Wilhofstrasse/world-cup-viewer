/**
 * states.ts — settled-state helpers for the 6 visual-diff states.
 *
 * Each function navigates the SPA, awaits the layout to settle, and returns
 * when the page is safe to screenshot. "Settled" is a layered gate per
 * Codex feedback (animations:'disabled' alone is not enough on a double-RAF
 * IntersectionObserver-driven feed):
 *    1. await page.waitForLoadState('networkidle') — first request burst done
 *    2. await the state's signal selector (e.g. #view-spiele:visible)
 *    3. await all <img>.complete + thumbnail background-images loaded
 *    4. await two RAFs back-to-back (drains double-RAF + scheduler flushes)
 *    5. 50ms quiescence to absorb IntersectionObserver callbacks
 */

import type { Page, Locator } from "playwright/test";

const QUIESCE_MS = 50;

/** Two RAFs back-to-back. Drains feed.js / matches.js double-RAF paths. */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Wait until every <img> on the page has finished decoding (or errored). */
async function waitAllImagesComplete(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images);
    return imgs.every((img) => img.complete || img.naturalWidth > 0 || (img as HTMLImageElement).src === "");
  }, undefined, { timeout: 5000 });
}

/** Compound settled gate — call after each navigation/interaction. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 });
  await waitAllImagesComplete(page);
  await settleFrames(page);
  await page.waitForTimeout(QUIESCE_MS);
}

// ---------------------------------------------------------------------------
// State entry points — one function per of the 6 plan states
// ---------------------------------------------------------------------------

/** highlights-empty: boot at /, clips list = []. */
export async function gotoHighlightsEmpty(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#view-highlights .wm-slide.wm-empty", { state: "visible" });
  await settle(page);
  return page.locator("body");
}

/** highlights-loaded: boot at /, clips list = 2-clip fixture with score + markers. */
export async function gotoHighlightsLoaded(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  // First non-empty slide rendered → render() has completed at least once.
  await page.waitForSelector("#view-highlights .wm-slide:not(.wm-empty)", { state: "visible", timeout: 10_000 });
  await settle(page);
  return page.locator("body");
}

/** spiele-default: switch to Spiele tab, fixtures rendered. */
export async function gotoSpiele(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#view-highlights .wm-slide", { state: "visible" });
  await page.click('[data-tab="spiele"]');
  await page.waitForSelector("#view-spiele .wm-match", { state: "visible", timeout: 10_000 });
  await settle(page);
  return page.locator("body");
}

/** drawer-open: from Highlights, click ☰ menu button, wait for transition end. */
export async function openDrawer(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#view-highlights .wm-slide", { state: "visible" });
  await page.click("#wmMenuBtn");
  await page.waitForSelector('.wm-drawer.open[aria-hidden="false"]', { state: "visible", timeout: 5_000 });
  // Drawer slide-in is CSS transform. Even with animations:disabled, wait one
  // transitionend OR a 200ms safety net.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const d = document.getElementById("wmDrawer");
        if (!d) return resolve();
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        d.addEventListener("transitionend", finish, { once: true });
        setTimeout(finish, 200);
      }),
  );
  await settle(page);
  return page.locator("body");
}

/** mehr-landing: switch to Mehr tab, landing list rendered. */
export async function gotoMehr(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#view-highlights .wm-slide", { state: "visible" });
  await page.click('[data-tab="mehr"]');
  await page.waitForSelector("#view-mehr .wm-mehr-item", { state: "visible", timeout: 5_000 });
  await settle(page);
  return page.locator("body");
}

/** mehr-torjaeger: open Mehr → tap Torjägerliste tile → settled list rendered. */
export async function gotoTorjaeger(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#view-highlights .wm-slide", { state: "visible" });
  await page.click('[data-tab="mehr"]');
  await page.waitForSelector('#view-mehr .wm-mehr-item[data-view="topscorers"]', { state: "visible" });
  await page.click('.wm-mehr-item[data-view="topscorers"]');
  // sub-view active → body[data-subview=topscorers] and the rendered list row.
  await page.waitForSelector('body[data-subview="topscorers"] .wm-ts-row', { state: "visible", timeout: 10_000 });
  await settle(page);
  return page.locator("body");
}
