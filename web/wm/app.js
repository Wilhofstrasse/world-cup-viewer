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

  // Visibility is driven by the `hidden` attribute on each <main>/<section>
  // view, NOT by CSS alone. #view-spiele ships with `hidden` in the static
  // HTML (so the Spiele panel never flashes on load); the CSS data-tab rule
  // only ever *hides* a view, it never clears that attribute. If we don't
  // toggle `hidden` here, switching to Spiele leaves #view-spiele at
  // display:none — the panel renders 0×0 (blank) even though #wmMatches is
  // fully populated. Keep the attribute in lockstep with the active tab.
  const spiele = document.getElementById("view-spiele");
  const highlights = document.getElementById("view-highlights");
  if (highlights) highlights.hidden = tab !== "highlights";
  if (spiele) spiele.hidden = tab !== "spiele";

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

// Default tab (highlights) — init now. If the appshell SW-recovery reload
// stashed a tab (so the user isn't bounced back to Highlights mid-load),
// restore it and clear the key. sessionStorage only; falls back to the
// body's data-tab, then highlights.
let bootTab = document.body.dataset.tab || "highlights";
try {
  const restored = sessionStorage.getItem("wm.tab");
  if (restored === "highlights" || restored === "spiele") bootTab = restored;
  sessionStorage.removeItem("wm.tab");
} catch (_e) {/* storage may be unavailable; non-fatal */}
activate(bootTab);

// PWA: register the shared service worker (offline shell + push).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {/* non-fatal */});
  });
}
