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
 * Two ranking dimensions, switched by the Spieler / Länder pill:
 *   - Spieler: the raw per-player Golden Boot list.
 *   - Länder:  goals aggregated by team (sum of goals, distinct scorer count,
 *              sum of assists), ranked by total goals with shared-rank ties.
 * Aggregation is pure client-side over the same scorer rows — no extra fetch.
 *
 * Never invents data: empty list → empty state; missing photo → initial fallback.
 */

"use strict";

import { flagFor } from "./parse.js";

const API_BASE = window.WM_API_BASE || "";

let mounted = null;
let scope = "vorrunde"; // "vorrunde" | "gesamt"
let mode = "spieler"; // "spieler" | "laender"

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

/**
 * Aggregate per-player scorers into a per-country ranking.
 * Scope is the scorers shown in Spieler mode (goals > 0): goals/assists are the
 * combined totals of a country's GOALSCORERS, and `players` = how many of them
 * scored — so the "N Spieler" line stays meaningful (it is not the squad size).
 * Keyed on idTeam (not the display name) so two unresolved teams never merge.
 * Ranks by total goals with standard competition ranking (equal goals share a
 * rank, the next rank skips).
 * @param {Array} scorers  rows with { idTeam, team, goals, assists }
 * @returns {Array} rows with { team, goals, players, assists, rank }
 */
function aggregateByCountry(scorers) {
  const byTeam = new Map();
  for (const s of scorers) {
    const key = s.idTeam || s.team || "?";
    const cur = byTeam.get(key) || { team: "", goals: 0, players: 0, assists: 0 };
    if (!cur.team && s.team) cur.team = s.team;
    cur.goals += s.goals || 0;
    cur.assists += s.assists || 0;
    cur.players += 1;
    byTeam.set(key, cur);
  }
  const rows = Array.from(byTeam.values()).sort(
    (a, b) => b.goals - a.goals || b.assists - a.assists || a.team.localeCompare(b.team),
  );
  let rank = 0;
  let prevGoals = null;
  rows.forEach((r, i) => {
    if (r.goals !== prevGoals) {
      rank = i + 1;
      prevGoals = r.goals;
    }
    r.rank = rank;
  });
  return rows;
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

function countryRowHtml(c, isTied) {
  const players = c.players === 1 ? "1 Spieler" : `${c.players} Spieler`;
  const name = c.team || "Unbekannt";
  return `
    <div class="wm-ts-row ${rankClass(c.rank)}">
      <div class="wm-ts-rank">${rankHtml(c.rank, isTied)}</div>
      <span class="wm-ts-photo is-flag">${flagFor(c.team)}</span>
      <div class="wm-ts-who">
        <div class="wm-ts-name">${esc(name)}</div>
        <div class="wm-ts-team">${players}</div>
      </div>
      <div class="wm-ts-stat">
        <div class="wm-ts-goals"><span class="ic">⚽</span>${c.goals}</div>
        <div class="wm-ts-sub">${c.assists} V</div>
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

function modePillHtml() {
  const opt = (key, label) =>
    `<button class="wm-ts-scope-tab" data-mode="${key}" aria-selected="${String(mode === key)}">${label}</button>`;
  return `
    <div class="wm-ts-mode">
      <div class="wm-ts-scope-pill" role="tablist">
        ${opt("spieler", "Spieler")}
        ${opt("laender", "Länder")}
      </div>
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

function listHtml(state) {
  if (mode === "laender") {
    const rows = aggregateByCountry(state.scorers);
    const counts = new Map();
    rows.forEach((c) => counts.set(c.rank, (counts.get(c.rank) || 0) + 1));
    return `<div class="wm-ts-list">${rows
      .map((c) => countryRowHtml(c, (counts.get(c.rank) || 0) > 1))
      .join("")}</div>`;
  }
  // mark tied ranks so the row prefixes a "=" when sharing a rank.
  const counts = new Map();
  state.scorers.forEach((s) => counts.set(s.rank, (counts.get(s.rank) || 0) + 1));
  return `<div class="wm-ts-list">${state.scorers
    .map((s) => rowHtml(s, (counts.get(s.rank) || 0) > 1))
    .join("")}</div>`;
}

function render(state) {
  if (!mounted) return;
  let body;
  if (state.kind === "loading") body = `<div class="wm-ts-list">${skeletonHtml()}</div>`;
  else if (state.kind === "empty") body = emptyHtml();
  else if (state.kind === "error") body = `<div class="wm-ts-empty"><div class="ic">⚠</div><div class="t">Konnte nicht geladen werden.</div><div class="s">Bitte nochmals versuchen.</div></div>`;
  else body = listHtml(state);
  mounted.innerHTML = `${modePillHtml()}${scopePillHtml()}${body}`;
  mounted.querySelectorAll(".wm-ts-scope-tab[data-mode]").forEach((btn) =>
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      render(lastState);
    }),
  );
  mounted.querySelectorAll(".wm-ts-scope-tab[data-scope]").forEach((btn) =>
    btn.addEventListener("click", () => {
      scope = btn.dataset.scope;
      // FIFA's feed is tournament-to-date today — recompute path is for v1.5.
      // Re-render only to flip the pill's selected state for now.
      render(lastState);
    }),
  );
  // Tap a row → open the Spielerkarten overlay for that player (Spieler mode only).
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
    // FIFA's /topseasonplayerstatistics endpoint ships EVERY registered player
    // (≈1250), most with goals=0. Filter to actual scorers — keeps the DOM small
    // and the screen readable.
    const all = Array.isArray(data.scorers) ? data.scorers : [];
    const scorers = all.filter((s) => (s.goals || 0) > 0);
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
