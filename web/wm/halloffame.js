/**
 * halloffame.js — WM Mehr ▸ Ruhmeshalle.
 *
 * Three ranked lists aggregated across every WM season FIFA exposes
 * (1930 → 2026 inclusive). Single fetch from GET /api/wm/halloffame.
 *
 * Three tabs:
 *   - Tore aller Zeiten (all-time WM goal totals)
 *   - Tore in einem WM (most goals in a single tournament)
 *   - Meiste Teilnahmen (≥3 WM-Torschützenliste-Auftritte)
 *
 * Never invents data: empty list → empty state; missing photo → initial
 * fallback rendered from the player's surname.
 */

"use strict";

const API_BASE = window.WM_API_BASE || "";

let mounted = null;
let tab = "topScorers"; // topScorers | bestSingleWM | mostTourneys
let cached = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initial(player) {
  const t = (player || "").trim();
  if (!t) return "·";
  const parts = t.split(/\s+/);
  const last = parts[parts.length - 1] || "";
  return (last[0] || "·").toUpperCase();
}

function renderShell(container) {
  container.innerHTML = `
    <div class="wm-hof">
      <div class="wm-hof-tabs" role="tablist">
        <button class="wm-hof-tab" data-tab="topScorers" role="tab">Tore aller Zeiten</button>
        <button class="wm-hof-tab" data-tab="bestSingleWM" role="tab">Tore in einem WM</button>
        <button class="wm-hof-tab" data-tab="mostTourneys" role="tab">Meiste Teilnahmen</button>
      </div>
      <div class="wm-hof-list" id="wmHofList"></div>
      <div class="wm-hof-foot" id="wmHofFoot"></div>
    </div>`;
  container.querySelectorAll(".wm-hof-tab").forEach((b) =>
    b.addEventListener("click", () => {
      tab = b.dataset.tab;
      paintActiveTab(container);
      renderList();
    }),
  );
  paintActiveTab(container);
}

function paintActiveTab(container) {
  container.querySelectorAll(".wm-hof-tab").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tab === tab);
    b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
  });
}

function row(rank, name, valueLabel, value, sub, photoUrl) {
  const photo = photoUrl
    ? `<img class="wm-hof-photo" src="${esc(photoUrl)}" alt="" loading="lazy" />`
    : `<span class="wm-hof-photo wm-hof-photo-fallback" aria-hidden="true">${esc(initial(name))}</span>`;
  const medal = rank <= 3 ? `wm-hof-rank-${rank}` : "";
  return `
    <div class="wm-hof-row">
      <div class="wm-hof-rank ${medal}">${rank}</div>
      ${photo}
      <div class="wm-hof-name">
        <div class="wm-hof-n">${esc(name)}</div>
        ${sub ? `<div class="wm-hof-s">${esc(sub)}</div>` : ""}
      </div>
      <div class="wm-hof-val">
        <span class="wm-hof-v">${esc(String(value))}</span>
        <span class="wm-hof-vl">${esc(valueLabel)}</span>
      </div>
    </div>`;
}

function renderList() {
  const list = document.getElementById("wmHofList");
  if (!list) return;
  if (!cached) {
    list.innerHTML = `<p class="wm-state">Wird geladen…</p>`;
    return;
  }
  if (tab === "topScorers") {
    const rows = cached.topScorers || [];
    if (!rows.length) { list.innerHTML = `<p class="wm-state">Noch keine Daten.</p>`; return; }
    list.innerHTML = rows.map((p, i) =>
      row(i + 1, p.name, "Tore", p.totalGoals, p.tournaments ? `${p.tournaments} ${p.tournaments === 1 ? "WM" : "WM-Turniere"}` : "", p.photoUrl),
    ).join("");
  } else if (tab === "bestSingleWM") {
    const rows = cached.bestSingleWM || [];
    if (!rows.length) { list.innerHTML = `<p class="wm-state">Noch keine Daten.</p>`; return; }
    list.innerHTML = rows.map((p, i) =>
      row(i + 1, p.name, "Tore", p.goals, p.season ? p.season.replace(/™/g, "").trim() : "", p.photoUrl),
    ).join("");
  } else {
    const rows = cached.mostTourneys || [];
    if (!rows.length) { list.innerHTML = `<p class="wm-state">Noch keine Daten.</p>`; return; }
    list.innerHTML = rows.map((p, i) =>
      row(i + 1, p.name, p.tournaments === 1 ? "WM" : "WMs", p.tournaments, p.seasons ? p.seasons.map((s) => s.replace(/FIFA |™| World Cup/g, "").trim()).join(", ") : "", p.photoUrl),
    ).join("");
  }
}

function renderFooter() {
  const foot = document.getElementById("wmHofFoot");
  if (!foot || !cached) return;
  const dt = cached.updatedAt ? new Date(cached.updatedAt * 1000) : null;
  const stamp = dt ? dt.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  foot.innerHTML = `<span>Stand ${esc(stamp)} · ${cached.seasonsIngested || "?"} WM-Turniere · Quelle: FIFA</span>`;
}

async function load() {
  try {
    const res = await fetch(`${API_BASE}/api/wm/halloffame`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    cached = await res.json();
  } catch {
    cached = { updatedAt: 0, seasonsIngested: 0, topScorers: [], bestSingleWM: [], mostTourneys: [] };
  }
  renderList();
  renderFooter();
}

export function initHallOfFame(container) {
  mounted = container;
  cached = null;
  renderShell(container);
  load();
}

export function destroyHallOfFame() {
  mounted = null;
  cached = null;
}
