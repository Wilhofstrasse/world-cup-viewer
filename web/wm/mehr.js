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
import { initAufstellungen, destroyAufstellungen } from "./aufstellungen.js";
import { initHallOfFame, destroyHallOfFame } from "./halloffame.js";
import { initSettings, destroySettings } from "./settings.js";
import { track } from "./track.js";
import { t } from "./i18n.js";

const SUBVIEWS = [
  { key: "topscorers", label: t("mehr.topscorers.label"), title: t("mehr.topscorers.title"), icon: "⚽", sub: t("mehr.topscorers.sub"), section: t("mehr.section.statistiken"), ready: true, primary: true },
  { key: "tabellen", label: t("mehr.tabellen.label"), title: t("mehr.tabellen.title"), icon: "📊", sub: t("mehr.tabellen.sub"), section: t("mehr.section.statistiken"), ready: true },
  { key: "halloffame", label: t("mehr.halloffame.label"), title: t("mehr.halloffame.title"), icon: "🏅", sub: t("mehr.halloffame.sub"), section: t("mehr.section.statistiken"), ready: true },
  { key: "bracket", label: t("mehr.bracket.label"), title: t("mehr.bracket.title"), icon: "🏆", sub: t("mehr.bracket.sub"), section: t("mehr.section.spielplan"), ready: true },
  { key: "lineups", label: t("mehr.lineups.label"), title: t("mehr.lineups.title"), icon: "🎽", sub: t("mehr.lineups.sub"), section: t("mehr.section.spielplan"), ready: true },
  { key: "squads", label: t("mehr.squads.label"), title: t("mehr.squads.title"), icon: "👥", sub: t("mehr.squads.sub"), section: t("mehr.section.spielerMannschaften"), ready: true },
  { key: "settings", label: t("mehr.settings.label"), title: t("mehr.settings.title"), icon: "⚙️", sub: t("mehr.settings.sub"), section: t("mehr.section.app"), ready: true },
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
    const chev = v.ready ? `<span class="wm-mehr-chev">▸</span>` : `<span class="wm-mehr-soon">${t("mehr.soonBadge")}</span>`;
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
  track("mehr_sub_open", { target: key });
  if (key === "topscorers") initTopScorers(el);
  else if (key === "tabellen") initTabellen(el);
  else if (key === "halloffame") initHallOfFame(el);
  else if (key === "bracket") initBracket(el);
  else if (key === "lineups") initAufstellungen(el);
  else if (key === "squads") initKader(el);
  else if (key === "settings") initSettings(el);
}

export function closeMehrSubview() {
  if (!currentView) return;
  if (currentView === "topscorers") destroyTopScorers();
  else if (currentView === "tabellen") destroyTabellen();
  else if (currentView === "halloffame") destroyHallOfFame();
  else if (currentView === "bracket") destroyBracket();
  else if (currentView === "lineups") destroyAufstellungen();
  else if (currentView === "squads") destroyKader();
  else if (currentView === "settings") destroySettings();
  currentView = null;
  delete document.body.dataset.subview;
  const subtitle = document.getElementById("wmSubtitle");
  if (subtitle) subtitle.textContent = "";
  renderLanding();
}

export function initMehr() {
  // Defensive cleanup: a previously-open Spielerkarten overlay can leave the
  // body-level scroll-lock class behind if the user tapped the system back
  // gesture or any non-✕ dismiss path. Mehr is the safest place to reset it.
  document.body.classList.remove("wm-pk-open");
  const overlay = document.getElementById("wmPlayerOverlay");
  if (overlay && !overlay.hidden) {
    overlay.hidden = true;
    overlay.style.display = "none";
  }
  renderLanding();
}
