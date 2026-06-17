/**
 * app.js — WM 2026 page bootstrap.
 * Owns sub-tab switching (Highlights / Spiele), lazy-inits each view on first
 * open, and registers the shared service worker so the page installs + works
 * offline (shell only — never video).
 */

"use strict";

import { initFeed } from "./feed.js";
import { initMatches } from "./matches.js";

const inited = { highlights: false, spiele: false };

function activate(tab) {
  document.body.dataset.tab = tab;
  document.querySelectorAll(".wm-tab").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
  );

  if (tab === "highlights" && !inited.highlights) {
    inited.highlights = true;
    initFeed();
  }
  if (tab === "spiele" && !inited.spiele) {
    inited.spiele = true;
    initMatches();
  }
}

document.querySelectorAll(".wm-tab").forEach((btn) =>
  btn.addEventListener("click", () => activate(btn.dataset.tab)),
);

// Default tab (highlights) — init now.
activate(document.body.dataset.tab || "highlights");

// PWA: register the shared service worker (offline shell + push).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {/* non-fatal */});
  });
}
