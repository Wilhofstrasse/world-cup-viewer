/**
 * app.js — WM 2026 page bootstrap.
 * Owns top-tab switching (Highlights / Spiele / Mehr) and Mehr's sub-view router
 * (landing → Torjäger / Tabellen / K.-o.-Baum / …). Lazy-inits each view on first
 * open, and registers the shared service worker so the page installs + works
 * offline (shell only — never video).
 */

"use strict";

import { initFeed } from "./feed.js";
import { initMatches } from "./matches.js";
import { initMehr, openMehrSubview, closeMehrSubview } from "./mehr.js";

const inited = { highlights: false, spiele: false, mehr: false };

function activate(tab) {
  document.body.dataset.tab = tab;
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

// PWA: register the shared service worker (offline shell + push).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {/* non-fatal */});
  });
}

// Expose sub-view navigation for inline handlers / other modules.
window.openMehrSubview = openMehrSubview;
window.closeMehrSubview = closeMehrSubview;
