/**
 * app.js — WM 2026 page bootstrap.
 * Owns top-tab switching (Highlights / Spiele / Mehr) and Mehr's sub-view router
 * (landing → Torjäger / Tabellen / K.-o.-Baum / …). Lazy-inits each view on first
 * open, and registers the shared service worker so the page installs + works
 * offline (shell only — never video).
 */

"use strict";

import { initFeed } from "./feed.js";
import { initMatches, jumpToSpieleMatch } from "./matches.js";
import { initMehr, openMehrSubview, closeMehrSubview } from "./mehr.js";
import { findClipByTeams, getMatch } from "./linkstore.js";
import { openSpielerkarte } from "./spielerkarten.js";
import { track } from "./track.js";
import { getLang, t } from "./i18n.js";

// i18n boot — runs before any view mounts. Expose t() + the active language to
// non-module call sites (appshell.js, inline handlers), set <html lang>, and
// paint the static index.html chrome (tab labels, header, drawer) in the active
// language. A language CHANGE is a full reload (see settings.js), so painting
// once at boot is sufficient.
window.WM_LANG = getLang();
window.t = t;
try { document.documentElement.lang = getLang() === "ptBR" ? "pt-BR" : getLang(); } catch (_e) {}

function paintStaticChrome() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label"))));
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder"))));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => el.setAttribute("title", t(el.getAttribute("data-i18n-title"))));
}
paintStaticChrome();

const inited = { highlights: false, spiele: false, mehr: false };

function activate(tab) {
  const prev = document.body.dataset.tab;
  document.body.dataset.tab = tab;
  // Every tab switch wipes the Spielerkarten scroll-lock — defensive cleanup
  // so a stuck overlay class can't trap the page in `overflow: hidden`.
  document.body.classList.remove("wm-pk-open");
  if (prev !== tab) track("tab_switch", { target: tab });
  document.querySelectorAll(".wm-tab").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
  );

  // Visibility is driven by the `hidden` attribute on each <main>/<section>
  // view, NOT by CSS alone. Keeping `hidden` in lockstep with the active tab
  // — same fix that unbroke Spiele back in v1.0.2 — for the new Mehr panel too.
  const highlights = document.getElementById("view-highlights");
  const spiele = document.getElementById("view-spiele");
  const mehr = document.getElementById("view-mehr");
  if (highlights) highlights.hidden = tab !== "highlights";
  if (spiele) spiele.hidden = tab !== "spiele";
  if (mehr) mehr.hidden = tab !== "mehr";

  // Leaving Mehr exits any open sub-view so re-entering Mehr always starts at
  // the landing list (matches Highlights/Spiele's "back to top" instinct).
  if (tab !== "mehr") closeMehrSubview();

  if (tab === "highlights" && !inited.highlights) {
    inited.highlights = true;
    initFeed();
  }
  if (tab === "spiele" && !inited.spiele) {
    inited.spiele = true;
    initMatches();
  }
  if (tab === "mehr" && !inited.mehr) {
    inited.mehr = true;
    initMehr();
  }
}

document.querySelectorAll(".wm-tab").forEach((btn) =>
  btn.addEventListener("click", () => activate(btn.dataset.tab)),
);

// Sub-view back button (top-left when a Mehr sub-view is active). Visibility is
// CSS-driven via body[data-subview]; mehr.js owns that attribute.
const backBtn = document.getElementById("wmBackBtn");
if (backBtn) backBtn.addEventListener("click", () => closeMehrSubview());

// Default tab (highlights) — init now. If the appshell SW-recovery reload
// stashed a tab (so the user isn't bounced back to Highlights mid-load),
// restore it and clear the key. sessionStorage only; falls back to the
// body's data-tab, then highlights.
let bootTab = document.body.dataset.tab || "highlights";
try {
  const restored = sessionStorage.getItem("wm.tab");
  if (restored === "highlights" || restored === "spiele" || restored === "mehr") bootTab = restored;
  sessionStorage.removeItem("wm.tab");
} catch (_e) {/* storage may be unavailable; non-fatal */}

// Runtime config (SRF proxy base for non-CH viewers) — fire-and-forget so it
// never blocks the initial render. CH visitors don't need the proxy at all; the
// rare non-CH visitor sees the first clip without the proxy and any subsequent
// fetch (HLS, drawer refresh) reads window.WM_SRF_PROXY after this resolves.
//
// Re-readable, not boot-once: /api/config keys srfProxy off the visitor's geo
// (CF cf.country). If the user toggles a Swiss-exit VPN AFTER boot, a one-shot
// pin would keep routing HLS through the geoblocked DE proxy → black at 0:00.
// We re-pin on tab refocus (a natural moment after flipping a VPN) so the next
// clip fetches direct under CH. Fire-and-forget; errors leave the prior value.
async function refreshConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    const cfg = r.ok ? await r.json() : {};
    window.WM_SRF_PROXY = (cfg && cfg.srfProxy) || "";
  } catch (_e) {/* keep the previously pinned value */}
}
refreshConfig();
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshConfig(); });

// The ☰ drawer lives in the header and is a GLOBAL control backed by the
// Highlights clip list, so initialise the feed at boot REGARDLESS of the active
// tab. This wires ☰ (and gives the drawer its clips) even when we boot straight
// into Spiele — e.g. after a SW-recovery reload restored wm.tab=spiele. Without
// it, ☰ is dead on Spiele because wireDrawer() only runs inside initFeed().
if (!inited.highlights) {
  inited.highlights = true;
  initFeed();
}
activate(bootTab);
track("page_load", { target: bootTab });

// PWA: register the shared service worker (offline shell + push).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {/* non-fatal */});
  });
}

// Expose sub-view navigation for inline handlers / other modules.
window.openMehrSubview = openMehrSubview;
window.closeMehrSubview = closeMehrSubview;
window.openSpielerkarte = openSpielerkarte;

// ── Cross-tab deep-linking ──────────────────────────────────────────────────
//
//   #spiele/<matchId>  → switch to Spiele + scroll to that match.
//   #clip/<urn>        → switch to Highlights + scroll to that clip.
//
// Set the hash before calling activate() so a back/forward gesture reproduces
// the deep-link. The "set hash silently" guard avoids triggering hashchange
// when WE just wrote it (would re-enter the handler and double-scroll).
let _quietHash = "";
function setHash(h) {
  _quietHash = h;
  if (location.hash !== h) location.hash = h;
}

/** Spiele backlink — wired to feed chips, drawer info buttons, hash routing. */
window.jumpToSpieleMatch = function (matchId) {
  setHash("#spiele/" + matchId);
  jumpToSpieleMatch(matchId);
};

/** Highlights backlink — wired to match-card "▶ Highlights ansehen". */
window.jumpToHighlightsClip = function (urn) {
  setHash("#clip/" + encodeURIComponent(urn));
  if (document.body.dataset.tab !== "highlights") {
    activate("highlights");
  }
  // Two RAFs so a just-shown feed has laid out.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const feed = document.getElementById("wmFeed");
      if (!feed) return;
      const slide = [...feed.querySelectorAll(".wm-slide")].find((el) => el._clip && el._clip.urn === urn);
      if (slide) slide.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  );
};

function applyHash() {
  const h = location.hash;
  if (!h || h === _quietHash) { _quietHash = ""; return; }
  _quietHash = "";
  const sp = /^#spiele\/(.+)$/.exec(h);
  const cp = /^#clip\/(.+)$/.exec(h);
  if (sp) {
    activate("spiele");
    jumpToSpieleMatch(decodeURIComponent(sp[1]));
  } else if (cp) {
    window.jumpToHighlightsClip(decodeURIComponent(cp[1]));
  }
}

window.addEventListener("hashchange", applyHash);
// Apply once at boot so a shared URL deep-links correctly.
setTimeout(applyHash, 0);
