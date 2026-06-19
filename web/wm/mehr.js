/**
 * mehr.js — WM "Mehr" tab: landing list of six sub-views + a thin router that
 * mounts the chosen sub-view into the same container.
 *
 * Only Torjägerliste is wired today (FIFA top-scorers endpoint, keyless). The
 * other five render a "Bald verfügbar" placeholder so the structure ships and
 * gets visited; they light up as each feature lands.
 *
 * Header chrome: when a sub-view is active we set body[data-subview=<key>]; the
 * CSS in wm.css hides ☰ / brand / tabs and shows the ‹ back button + sub-view
 * title that already live in the header. app.js wires the back button to
 * closeMehrSubview().
 */

"use strict";

import { initTopScorers, destroyTopScorers } from "./topscorers.js";
import { initTabellen, destroyTabellen } from "./tabellen.js";
import { initBracket, destroyBracket } from "./bracket.js";
import { initKader, destroyKader } from "./kader.js";

const SUBVIEWS = [
  { key: "topscorers", label: "Torjägerliste", title: "Torjägerliste", icon: "⚽", sub: "Goldener Schuh · Tore, Vorlagen, Spiele", section: "Statistiken", ready: true, primary: true },
  { key: "tabellen", label: "Tabellen", title: "Tabellen", icon: "📊", sub: "Offizielle Gruppen mit Qualifikationsstatus", section: "Statistiken", ready: true },
  { key: "bracket", label: "K.-o.-Baum", title: "K.-o.-Baum", icon: "🏆", sub: "Viertelfinal bis Finale · der Weg zum Pokal", section: "Spielplan", ready: true },
  { key: "lineups", label: "Aufstellungen", title: "Aufstellungen", icon: "🎽", sub: "Formationen, Startelf, Auswechslungen", section: "Spielplan", ready: false },
  { key: "squads", label: "Kader", title: "Kader", icon: "👥", sub: "Alle 48 Teams · Tippe auf einen Spieler für die Karte", section: "Spieler & Mannschaften", ready: true },
];

let currentView = null;

function root() {
  return document.getElementById("wmMehr");
}

function renderLanding() {
  const el = root();
  if (!el) return;

  // Group by section; preserve declared order.
  const sections = [];
  const byName = new Map();
  for (const v of SUBVIEWS) {
    if (!byName.has(v.section)) {
      byName.set(v.section, { name: v.section, items: [] });
      sections.push(byName.get(v.section));
    }
    byName.get(v.section).items.push(v);
  }

  const itemHtml = (v) => {
    const chev = v.ready ? `<span class="wm-mehr-chev">▸</span>` : `<span class="wm-mehr-soon">bald</span>`;
    return `
      <button class="wm-mehr-item ${v.primary ? "is-primary" : ""}" data-view="${v.key}" ${v.ready ? "" : "disabled aria-disabled=\"true\""}>
        <span class="wm-mehr-ico" aria-hidden="true">${v.icon}</span>
        <span class="wm-mehr-text">
          <span class="wm-mehr-t">${v.label}</span>
          <span class="wm-mehr-s">${v.sub}</span>
        </span>
        ${chev}
      </button>`;
  };

  el.innerHTML = sections
    .map(
      (sec) => `
      <h2 class="wm-mehr-sec">${sec.name}</h2>
      <div class="wm-mehr-list">${sec.items.map(itemHtml).join("")}</div>`,
    )
    .join("");

  el.querySelectorAll(".wm-mehr-item:not([disabled])").forEach((btn) =>
    btn.addEventListener("click", () => openMehrSubview(btn.dataset.view)),
  );
}

export function openMehrSubview(key) {
  const v = SUBVIEWS.find((x) => x.key === key);
  if (!v || !v.ready) return;
  const el = root();
  if (!el) return;

  currentView = key;
  document.body.dataset.subview = key;
  const subtitle = document.getElementById("wmSubtitle");
  if (subtitle) subtitle.textContent = v.title;

  el.innerHTML = "";
  if (key === "topscorers") initTopScorers(el);
  else if (key === "tabellen") initTabellen(el);
  else if (key === "bracket") initBracket(el);
  else if (key === "squads") initKader(el);
  // future: lineups
}

export function closeMehrSubview() {
  if (!currentView) return;
  if (currentView === "topscorers") destroyTopScorers();
  else if (currentView === "tabellen") destroyTabellen();
  else if (currentView === "bracket") destroyBracket();
  else if (currentView === "squads") destroyKader();
  currentView = null;
  delete document.body.dataset.subview;
  const subtitle = document.getElementById("wmSubtitle");
  if (subtitle) subtitle.textContent = "";
  renderLanding();
}

export function initMehr() {
  renderLanding();
}
