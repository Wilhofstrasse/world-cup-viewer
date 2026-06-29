/**
 * sw.js — service worker for the Gabriel app.
 *
 * Two responsibilities, deliberately separate:
 *
 *  1. PUSH (chess): receive Web Push + render notifications. On iOS this only
 *     works once installed to the Home Screen. (Unchanged.)
 *
 *  2. WM 2026 OFFLINE SHELL: cache the WM page shell + clip thumbnails + the
 *     clip/match indexes so the highlights section opens offline. VIDEO IS
 *     NEVER CACHED.
 *
 * The fetch handler is SCOPED to WM paths only. Chess HTML / CSS / JS and all
 * chess /api/* requests are intentionally NOT intercepted — the chess cockpit
 * must always show live data (its original push-only design), so those go
 * straight to the network as before.
 */

"use strict";

const SHELL_CACHE = "wm-shell-v44";
const DATA_CACHE = "wm-data-v2";
const THUMB_CACHE = "wm-thumbs-v2";
const THUMB_MAX = 120; // cap stored thumbnails
// One-shot marker so the kill-switch (below) evicts the frozen v1.0.0 worker
// exactly once, then lets the re-registered worker persist (Codex P1). This name
// is VERSION-INDEPENDENT on purpose — it must NOT track SHELL_CACHE, or a normal
// version bump would re-trigger the eviction on already-healthy devices.
const KILL_DONE = "wm-killswitch-v10-done";

// Sub-resources only — NOT the page documents. Navigations are never served by
// the SW (see fetch handler), so precaching the HTML would be both pointless
// and dangerous (/wm.html 307-redirects to /wm; a cached redirect response
// makes Safari refuse the navigation).
const WM_SHELL = [
  "/wm/app.js",
  "/wm/i18n.js",
  "/wm/feed.js",
  "/wm/matches.js",
  "/wm/standings.js",
  "/wm/mehr.js",
  "/wm/topscorers.js",
  "/wm/tabellen.js",
  "/wm/bracket.js",
  "/wm/kader.js",
  "/wm/spielerkarten.js",
  "/wm/aufstellungen.js",
  "/wm/halloffame.js",
  "/wm/settings.js",
  "/wm/track.js",
  "/wm/linkstore.js",
  "/wm/il.js",
  "/wm/parse.js",
  "/wm/wm.css",
  "/vendor/hls.light.min.js",
];

// Activate immediately so a freshly-registered worker can receive pushes
// without waiting for all tabs to close.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Add individually so a single 404 can't fail the whole install.
      await Promise.allSettled(WM_SHELL.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // ONE-SHOT recovery: a stale v1.0.0 worker froze wm-shell-v9 and kept
      // serving the pre-fix wm.css/app.js (Spiele blank). The first time this
      // byte-changed worker activates, wipe ALL caches (drop every stale asset),
      // drop a sentinel, claim, and self-unregister so the device reloads
      // worker-less against fresh files. app.js re-registers on the next load;
      // that worker sees the sentinel and just claims — so it PERSISTS (no
      // thrash, offline/push return). Codex P1.
      if (!names.includes(KILL_DONE)) {
        await Promise.all(names.map((n) => caches.delete(n)));
        await caches.open(KILL_DONE);
        await self.clients.claim();
        try { await self.registration.unregister(); } catch (_e) {}
        return;
      }
      // Already de-frozen: normal version-bump cleanup — drop superseded wm-
      // caches (e.g. an old wm-shell-vN) but keep the current set + the sentinel.
      const keep = new Set([SHELL_CACHE, DATA_CACHE, THUMB_CACHE, KILL_DONE]);
      await Promise.all(
        names.filter((n) => n.startsWith("wm-") && !keep.has(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// ── Incoming push → show a notification. (chess) ──
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "Gabriel's Chess", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Gabriel's Chess";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/icon-192.png",
    tag: data.tag || "gabriel-chess",
    renotify: true,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Tap a notification → focus an existing window or open the app. ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) {
          try {
            await client.navigate(target);
          } catch (_e) {
            /* navigation may be blocked cross-origin — focus anyway */
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })(),
  );
});

// ---------------------------------------------------------------------------
// WM-only fetch handling
// ---------------------------------------------------------------------------

/** WM page shell on our own origin (cache-first, refreshed in the background). */
function isWmShell(url, sameOrigin) {
  if (!sameOrigin) return false;
  return (
    url.pathname === "/wm" ||
    url.pathname === "/wm.html" ||
    url.pathname.startsWith("/wm/") ||
    url.pathname.startsWith("/vendor/")
  );
}

/** Clip/match indexes (network-first, fall back to cache when offline). */
function isWmData(url, sameOrigin) {
  if (sameOrigin && url.pathname === "/api/wm/matches") return true;
  if (sameOrigin && url.pathname === "/api/wm/topscorers") return true;
  if (sameOrigin && url.pathname === "/api/wm/tabellen") return true;
  if (sameOrigin && url.pathname === "/api/wm/squads") return true;
  return url.hostname === "il.srgssr.ch" && url.pathname.includes("/episodeComposition/");
}

/** Clip thumbnails (cache-first, capped). */
function isWmThumb(url) {
  return (
    url.hostname === "download-media.srf.ch" ||
    (url.hostname === "il.srgssr.ch" && url.pathname.includes("/image"))
  );
}

/**
 * VIDEO — never cached. mediaComposition resolution + HLS playlists/segments
 * pass straight through (no respondWith) so nothing is stored or rehosted.
 */
function isVideo(url) {
  return (
    url.hostname.endsWith("akamaized.net") ||
    url.pathname.endsWith(".m3u8") ||
    url.pathname.endsWith(".ts") ||
    url.pathname.endsWith(".m4s") ||
    url.pathname.includes("/mediaComposition/")
  );
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fetching = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await fetching) || fetch(request);
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw e;
  }
}

async function cacheThumb(request) {
  const cache = await caches.open(THUMB_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    await cache.put(request, res.clone());
    // Trim oldest entries past the cap (FIFO by insertion order).
    const keys = await cache.keys();
    if (keys.length > THUMB_MAX) {
      await Promise.all(keys.slice(0, keys.length - THUMB_MAX).map((k) => cache.delete(k)));
    }
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch non-GET

  let url;
  try {
    url = new URL(req.url);
  } catch (_e) {
    return;
  }

  // Navigations ALWAYS go to the network — never served from the SW. Returning
  // a redirected response (e.g. /wm.html → /wm) to a navigation makes Safari
  // throw "Response served by service worker has redirections" and brick the
  // installed PWA. The browser handles navigation redirects natively.
  if (req.mode === "navigate") return;

  if (isVideo(url)) return; // pass through — never cache video

  const sameOrigin = url.origin === self.location.origin;

  if (isWmShell(url, sameOrigin)) {
    // Network-first: always load the latest module/CSS when online (a deploy
    // lands immediately); fall back to cache only when offline. Cache-first
    // here was serving stale JS after deploys.
    event.respondWith(networkFirst(SHELL_CACHE, req));
    return;
  }
  if (isWmData(url, sameOrigin)) {
    event.respondWith(networkFirst(DATA_CACHE, req));
    return;
  }
  if (isWmThumb(url)) {
    event.respondWith(cacheThumb(req));
    return;
  }
  // Everything else (chess shell + chess /api/*) — not intercepted; goes to
  // the network exactly as before.
});
