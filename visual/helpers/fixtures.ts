/**
 * fixtures.ts — page.route() stubs for every external surface the WM PWA
 * touches at boot/render time. Covers what Codex flagged YELLOW:
 *  - /api/* (worker)            : deterministic JSON, no live cron
 *  - il.srgssr.ch               : SRF Integration Layer (clips + composition)
 *  - download-media.srf.ch      : thumbnail JPEGs used as CSS background-image
 *  - any other external host    : 503 catch-all → fails the test loudly with
 *                                 the URL, never silently renders broken
 *
 * Same-origin static assets (CSS, JS modules, the page itself) are ALLOWED to
 * fall through to the wrangler dev server — this rig is a CSS regression
 * harness, not a static-asset mock.
 *
 * Determinism contract (also covers Codex's "fresh context per state" ask):
 *  - Math.random + crypto.randomUUID stubbed before app code runs
 *  - Date.now frozen to a fixed instant (only NEW Dates; existing-instance
 *    methods unaffected)
 *  - prefers-reduced-motion emulated → CSS keyframes disabled
 *  - localStorage / sessionStorage / hash cleared between states
 *  - service workers blocked at context level (set in playwright.visual.config)
 */

import type { Page, BrowserContext, Route } from "playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

/** A 1x1 transparent PNG, base64-decoded. Stand-in for every thumbnail. */
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/** Empty cron-warmed worker JSON shapes (for endpoints not exercised by states). */
const EMPTY_JSON = JSON.stringify({ tabellen: [], rows: [], squads: [] });

/** Per-state clip list selection. */
export type ClipsFixture = "empty" | "loaded";

/**
 * Installs ALL route stubs on the page. Order matters — Playwright matches
 * the LAST-registered route first, so we register the catch-all 503 FIRST
 * (lowest priority) and the specific stubs AFTER (higher priority).
 *
 * Same-origin host (wrangler dev) is allowed through by the catch-all so
 * assets, the index document, and same-origin module imports load from dev.
 */
export async function installFixtures(
  page: Page,
  opts: { clips: ClipsFixture; sameOriginHost: string },
): Promise<void> {
  const clipsBody =
    opts.clips === "loaded" ? readFixture("il-clips-loaded.json") : readFixture("il-clips-empty.json");

  // ── 1. Catch-all (LOWEST priority — registered FIRST) ──
  // Any external host we didn't explicitly stub → 503, fail loud with the URL.
  // Same-origin (wrangler dev) + data:/blob: fall through to the dev server.
  const sameOrigin = opts.sameOriginHost;
  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.host === sameOrigin) return route.fallback();
    if (url.protocol === "data:" || url.protocol === "blob:") return route.fallback();
    // Anything else that escaped the explicit routes below → fail loud.
    return route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: `unstubbed external request: ${route.request().method()} ${route.request().url()}`,
    });
  });

  // ── 2. SRF thumbnail/poster image hosts (CSS background-image) ──
  // Anything from download-media.srf.ch or the IL image service → 1x1 PNG.
  await page.route(/download-media\.srf\.ch\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: ONE_PX_PNG }),
  );
  await page.route(/il\.srgssr\.ch\/image-service\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: ONE_PX_PNG }),
  );

  // ── 3. SRF Integration Layer (browser-direct, keyless, CORS *) ──
  // mediaComposition/byUrn/<urn> — needed only if a clip is actually played, but
  // stub a minimal "no HLS" payload so a stray call doesn't 503.
  await page.route(/il\.srgssr\.ch\/integrationlayer\/.*mediaComposition.*/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chapterList: [] }),
    }),
  );
  // List call: episodeComposition/latestByShow/byUrn/<showUrn>
  await page.route(/il\.srgssr\.ch\/integrationlayer\/.*episodeComposition.*/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: clipsBody }),
  );

  // ── 4. Worker /api/* — deterministic JSON in place of R2-backed routes ──
  await page.route("**/api/wm/matches", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: readFixture("wm-matches.json") }),
  );
  await page.route("**/api/wm/topscorers", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: readFixture("wm-topscorers.json") }),
  );
  await page.route("**/api/wm/tabellen", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: EMPTY_JSON }),
  );
  await page.route("**/api/wm/squads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: EMPTY_JSON }),
  );
  await page.route("**/api/wm/markers/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ urn: "", markers: [], updatedAt: 0 }) }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: readFixture("wm-config.json") }),
  );
  await page.route("**/api/version", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: readFixture("wm-version.json") }),
  );
  await page.route("**/api/stats", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ byCountry: [], byEvent: [], byDay: [], totals: { events: 0, sessions: 0 } }) }),
  );
  // Telemetry beacon — silent 204. /api/track is sendBeacon's destination.
  await page.route("**/api/track", (route) => route.fulfill({ status: 204 }));
}

/**
 * Install determinism shims via context.addInitScript (runs in EVERY page in
 * the context, BEFORE any page script). Used by the playwright config so this
 * runs once per browser context.
 */
export async function installDeterminism(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // Freeze Date.now() (and `new Date()` with no args) to 2026-06-22T12:00:00Z.
    // Existing Date instances and explicit `new Date(iso)` still work.
    const FROZEN = 1750593600000; // 2026-06-22T12:00:00Z
    const RealDate = Date;
    // @ts-expect-error overriding Date constructor for determinism
    class FrozenDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          super(FROZEN);
        } else {
          // @ts-expect-error rest spread to Date constructor
          super(...args);
        }
      }
      static now(): number {
        return FROZEN;
      }
    }
    // Preserve prototype chain so `instanceof Date` keeps working.
    FrozenDate.prototype = RealDate.prototype;
    // @ts-expect-error overriding global
    globalThis.Date = FrozenDate;

    // Deterministic UUIDs (track.js sessionId).
    let uuidCounter = 0;
    const fixedUuid = (): string => {
      uuidCounter += 1;
      const hex = uuidCounter.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${hex}`;
    };
    if (typeof crypto !== "undefined") {
      try {
        Object.defineProperty(crypto, "randomUUID", { configurable: true, value: fixedUuid });
      } catch {
        // older browsers — fall through, track.js Math.random fallback covered next
      }
    }

    // Deterministic Math.random (uuid fallback in track.js, anywhere else).
    let randCounter = 0;
    Math.random = (): number => {
      randCounter += 1;
      return ((randCounter * 9301 + 49297) % 233280) / 233280;
    };

    // Silence sendBeacon — we already stub /api/track but this kills the
    // post-state cleanup hop too.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon = (): boolean => true;
    }
  });
}

/**
 * Per-state reset: clear app state inside the page so two states in the same
 * context don't leak (feed.js cache, hash route, sessionStorage telemetry id).
 * Called BEFORE page.goto for each state.
 */
export async function resetAppState(page: Page): Promise<void> {
  // Clearing storage requires a page on the same origin first. The caller
  // navigates to about:blank → calls this → then navigates to the real URL.
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // about:blank denies storage — that's fine, the navigation reset it.
    }
  });
}
