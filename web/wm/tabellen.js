/**
 * tabellen.js — WM Mehr ▸ Tabellen.
 *
 * Single source: GET /api/wm/tabellen (FIFA official group standings,
 * keyless, ingested server-side). One accordion per group A–L; each opens to a
 * compact table — #, Team (+ qualified/eliminated badge), Sp, Pkt — with a
 * Details toggle revealing S/U/N + Tore (For:Against) + TD.
 *
 * Badge vocabulary matches the rest of the system (● accent = qualified,
 * ○ faint = eliminated, nothing = in-play). Never invents data: empty list →
 * empty state; tournament not started → soft hint.
 */

"use strict";

import { flagFor } from "./parse.js";

const API_BASE = window.WM_API_BASE || "";

let mounted = null;
let lastState = { kind: "loading" };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Group rows by their `group` letter — preserves the server's A→L ordering. */
function groupBy(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.group || "?";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

function badgeHtml(q) {
  if (q === "qualified") return `<span class="wm-tb-badge qual" aria-label="Qualifiziert">●</span>`;
  if (q === "eliminated") return `<span class="wm-tb-badge elim" aria-label="Ausgeschieden">○</span>`;
  return "";
}

function tableHtml(rows) {
  // Compact 4-col table for the default view; the 5/6/7th cols sit in the
  // "Details" panel that the row's accordion toggle reveals.
  const tr = (r) => {
    const qualifyClass = r.qualification === "qualified" ? "is-qual" : "";
    return `
      <tr class="${qualifyClass}">
        <td class="pos">${r.position || ""}</td>
        <td class="tm"><span class="tmw"><span class="f">${flagFor(r.team)}</span><span class="n">${esc(r.team)}</span>${badgeHtml(r.qualification)}</span></td>
        <td class="num">${r.played}</td>
        <td class="num pts">${r.points}</td>
      </tr>
      <tr class="details">
        <td></td>
        <td colspan="3" class="dt">
          <span><b>S</b> ${r.won}</span><span><b>U</b> ${r.drawn}</span><span><b>N</b> ${r.lost}</span>
          <span><b>Tore</b> ${r.goalsFor}:${r.goalsAgainst}</span>
          <span><b>TD</b> ${r.goalsDiff > 0 ? "+" + r.goalsDiff : r.goalsDiff}</span>
        </td>
      </tr>`;
  };
  return `
    <table class="wm-tb-table">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">Sp</th><th class="num">Pkt</th></tr></thead>
      <tbody>${rows.map(tr).join("")}</tbody>
    </table>
    <div class="wm-tb-foot">
      <span class="wm-tb-legend"><span class="dot"></span>qualifiziert · <span class="ring"></span>ausgeschieden</span>
      <button class="wm-tb-toggle" type="button">Details ▾</button>
    </div>`;
}

function renderRows(rows) {
  const groups = groupBy(rows);
  const letters = [...groups.keys()].sort();
  const accs = letters
    .map((g, i) => {
      const list = groups.get(g) || [];
      const open = i === 0; // first accordion open by default (matches Spiele)
      return `<details class="wm-tb-acc"${open ? " open" : ""}>
        <summary class="wm-tb-head">
          <span class="wm-tb-label">Gruppe ${esc(g)}</span>
          <span class="wm-tb-chev" aria-hidden="true">▸</span>
        </summary>
        <div class="wm-tb-body">${tableHtml(list)}</div>
      </details>`;
    })
    .join("");
  return `<div class="wm-tb-sec">Vorrunde</div>${accs}`;
}

function render(state) {
  if (!mounted) return;
  if (state.kind === "loading") {
    mounted.innerHTML = `<div class="wm-tb-sec">Vorrunde</div>${["A", "B", "C"]
      .map(
        (g) =>
          `<div class="wm-tb-acc"><div class="wm-tb-head"><span class="wm-tb-label">Gruppe ${g}</span><span class="wm-tb-chev">▸</span></div></div>`,
      )
      .join("")}`;
    return;
  }
  if (state.kind === "error") {
    mounted.innerHTML = `
      <div class="wm-ts-empty">
        <div class="ic">⚠</div>
        <div class="t">Konnte nicht geladen werden.</div>
        <div class="s">Bitte nochmals versuchen.</div>
      </div>`;
    return;
  }
  if (state.kind === "empty") {
    mounted.innerHTML = `
      <div class="wm-ts-empty">
        <div class="ic">📊</div>
        <div class="t">Tabellen noch nicht verfügbar</div>
        <div class="s">Spielbeginn am 18.06.2026</div>
      </div>`;
    return;
  }
  mounted.innerHTML = renderRows(state.rows);

  // Per-accordion Details toggle. Default: details rows hidden; click → show.
  mounted.querySelectorAll(".wm-tb-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = btn.closest(".wm-tb-body");
      const open = body.classList.toggle("show-details");
      btn.textContent = open ? "Weniger ▴" : "Details ▾";
    });
  });
}

async function load() {
  lastState = { kind: "loading" };
  render(lastState);
  try {
    const res = await fetch(`${API_BASE}/api/wm/tabellen`, { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    lastState = rows.length ? { kind: "ready", rows } : { kind: "empty" };
  } catch (_e) {
    lastState = { kind: "error" };
  }
  render(lastState);
}

export function initTabellen(container) {
  mounted = container;
  load();
}

export function destroyTabellen() {
  mounted = null;
  lastState = { kind: "loading" };
}
