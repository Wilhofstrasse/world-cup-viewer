/**
 * topscorers.js — WM Mehr ▸ Torjägerliste.
 *
 * Single source: GET /api/wm/topscorers (FIFA's keyless Golden Boot endpoint,
 * ingested server-side). Ranked list with medal accents for the top 3 + tie
 * markers (=4) so a shared rank reads correctly. The Vorrunde / Gesamt scope
 * pill is wired but currently both options show the same FIFA list (FIFA's free
 * feed reports tournament-to-date stats); the toggle stays as the contract for
 * when we plug a phase-scoped recompute in.
 *
 * Never invents data: empty list → empty state; missing photo → initial fallback.
 */

"use strict";

import { flagFor } from "./parse.js";

const API_BASE = window.WM_API_BASE || "";

let mounted = null;
let scope = "vorrunde"; // "vorrunde" | "gesamt"

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initial(player) {
  const t = (player || "").trim();
  if (!t) return "·";
  // Take the last word's first letter as the surname initial; trim ALL-CAPS
  // FIFA artifacts like "L. MESSI" → "M" by preferring an upper-case token.
  const tokens = t.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i].replace(/[.,]/g, "");
    if (tok && /[A-Za-zÀ-ÿ]/.test(tok[0])) return tok[0].toUpperCase() + ".";
  }
  return t[0].toUpperCase() + ".";
}

function rankClass(rank) {
  return rank === 1 ? "rk-1" : rank === 2 ? "rk-2" : rank === 3 ? "rk-3" : "";
}

/** Build the tied-rank prefix ("=" when this rank repeats), then the rank. */
function rankHtml(rank, isTied) {
  return isTied
    ? `<span class="wm-ts-tie">=</span>${rank}`
    : `${rank}`;
}

function rowHtml(s, isTied) {
  const photo = s.photoUrl
    ? `<span class="wm-ts-photo" style="background-image:url('${esc(s.photoUrl)}')"></span>`
    : `<span class="wm-ts-photo">${esc(initial(s.player))}</span>`;
  const dataAttr = s.idPlayer ? ` data-id="${esc(s.idPlayer)}"` : "";
  return `
    <div class="wm-ts-row ${rankClass(s.rank)} ${s.idPlayer ? "is-tappable" : ""}"${dataAttr}>
      <div class="wm-ts-rank">${rankHtml(s.rank, isTied)}</div>
      ${photo}
      <div class="wm-ts-who">
        <div class="wm-ts-name">${esc(s.player)}</div>
        <div class="wm-ts-team"><span class="f">${flagFor(s.team)}</span>${esc(s.team || "—")}</div>
      </div>
      <div class="wm-ts-stat">
        <div class="wm-ts-goals"><span class="ic">⚽</span>${s.goals}</div>
        <div class="wm-ts-sub">${s.assists} V · ${s.matches} Sp</div>
      </div>
    </div>`;
}

function skeletonHtml() {
  const row = `<div class="wm-ts-skel"><div class="bx" style="height:24px;width:26px;border-radius:6px"></div><div class="ci"></div><div><div class="bx w1"></div><div class="bx w2"></div></div><div class="bx" style="width:48px"></div></div>`;
  return row + row + row + row;
}

function emptyHtml() {
  return `
    <div class="wm-ts-empty">
      <div class="ic">⚽</div>
      <div class="t">Noch keine Tore</div>
      <div class="s">Spielbeginn am 18.06.2026</div>
    </div>`;
}

function scopePillHtml() {
  const opt = (key, label) =>
    `<button class="wm-ts-scope-tab" data-scope="${key}" aria-selected="${String(scope === key)}">${label}</button>`;
  return `
    <div class="wm-ts-scope">
      <div class="wm-ts-scope-pill" role="tablist">
        ${opt("vorrunde", "Vorrunde")}
        ${opt("gesamt", "Gesamt")}
      </div>
    </div>`;
}

function render(state) {
  if (!mounted) return;
  let body;
  if (state.kind === "loading") body = `<div class="wm-ts-list">${skeletonHtml()}</div>`;
  else if (state.kind === "empty") body = emptyHtml();
  else if (state.kind === "error") body = `<div class="wm-ts-empty"><div class="ic">⚠</div><div class="t">Konnte nicht geladen werden.</div><div class="s">Bitte nochmals versuchen.</div></div>`;
  else {
    // mark tied ranks so the row prefixes a "=" when sharing a rank.
    const counts = new Map();
    state.scorers.forEach((s) => counts.set(s.rank, (counts.get(s.rank) || 0) + 1));
    body = `<div class="wm-ts-list">${state.scorers
      .map((s) => rowHtml(s, (counts.get(s.rank) || 0) > 1))
      .join("")}</div>`;
  }
  mounted.innerHTML = `${scopePillHtml()}${body}`;
  mounted.querySelectorAll(".wm-ts-scope-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      scope = btn.dataset.scope;
      // FIFA's feed is tournament-to-date today — recompute path is for v1.5.
      // Re-render only to flip the pill's selected state for now.
      render(lastState);
    }),
  );
  // Tap a row → open the Spielerkarten overlay for that player.
  mounted.querySelectorAll(".wm-ts-row.is-tappable").forEach((row) =>
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      if (id && typeof window.openSpielerkarte === "function") window.openSpielerkarte(id);
    }),
  );
}

let lastState = { kind: "loading" };

async function load() {
  lastState = { kind: "loading" };
  render(lastState);
  try {
    const res = await fetch(`${API_BASE}/api/wm/topscorers`, { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const scorers = Array.isArray(data.scorers) ? data.scorers : [];
    lastState = scorers.length ? { kind: "ready", scorers } : { kind: "empty" };
  } catch (_e) {
    lastState = { kind: "error" };
  }
  render(lastState);
}

export function initTopScorers(container) {
  mounted = container;
  load();
}

export function destroyTopScorers() {
  mounted = null;
  lastState = { kind: "loading" };
}
