/**
 * matches.js — WM "Spiele" view: schedule structured by round + group, with
 * results + goalscorers when available.
 *
 * Two sources, merged:
 *  - SRF livecenter (keyless, via il.js) → the fixture list with round + group
 *    + teams + kickoff. Always available; this is what de-zombies the tab.
 *  - /api/wm/matches (API-Football, server-side key) → score + status +
 *    goalscorers (with minutes). Empty until the key is configured; when
 *    present it's merged onto the matching fixture (tolerant team match,
 *    order-independent).
 *
 * Never invents a minute/score: a fixture with no result shows kickoff only.
 */

"use strict";

import { flagFor, teamsMatch } from "./parse.js";
import { fetchFixtures } from "./il.js";

const API_BASE = window.WM_API_BASE || "";

const ROUND_ORDER = ["Vorrunde", "Achtelfinal", "Viertelfinal", "Halbfinal", "Spiel um Platz 3", "Final"];
const roundRank = (r) => {
  const i = ROUND_ORDER.indexOf(r);
  return i === -1 ? 98 : i;
};

function kickoff(iso) {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Aligns an API-Football match onto a fixture's team order (handles swap). */
function alignApi(fx, matches) {
  for (const m of matches) {
    const same = teamsMatch(fx.teamA, m.teamA) && teamsMatch(fx.teamB, m.teamB);
    const swap = teamsMatch(fx.teamA, m.teamB) && teamsMatch(fx.teamB, m.teamA);
    if (!same && !swap) continue;
    const flip = swap;
    return {
      status: m.status,
      minute: m.minute,
      scoreA: flip ? m.scoreB : m.scoreA,
      scoreB: flip ? m.scoreA : m.scoreB,
      goals: (m.goals || []).map((g) => ({ ...g, team: flip ? (g.team === "A" ? "B" : "A") : g.team })),
    };
  }
  return null;
}

function goalLine(g) {
  const min = g.minute == null ? "" : `${g.minute}${g.extra ? "+" + g.extra : ""}'`;
  const tag = g.type === "penalty" ? " (FE)" : g.type === "own" ? " (ET)" : "";
  return `<span class="wm-g"><span class="m">${esc(min)}</span> ${esc(g.scorer)}${tag}</span>`;
}

function fixtureRow(fx, api) {
  const live = api && api.status === "live";
  const finished = api && api.status === "finished";
  const showScore = live || finished;

  const mid = showScore
    ? `<span class="wm-match-score">${api.scoreA}–${api.scoreB}</span>`
    : `<span class="wm-match-when">${esc(kickoff(fx.dateISO))}</span>`;

  const liveBadge = live ? `<span class="wm-live-badge">● LIVE ${api.minute ? api.minute + "'" : ""}</span>` : "";
  const goals = showScore && api.goals && api.goals.length
    ? `<div class="wm-goals">⚽ ${api.goals.map(goalLine).join(" · ")}</div>`
    : "";

  return `
    <article class="wm-match ${live ? "live" : ""}">
      <div class="wm-match-row">
        <span class="wm-match-team"><span class="f">${flagFor(fx.teamA)}</span>${esc(fx.teamA)}</span>
        ${mid}
        <span class="wm-match-team end"><span class="f">${flagFor(fx.teamB)}</span>${esc(fx.teamB)}</span>
      </div>
      ${liveBadge}
      ${goals}
    </article>`;
}

function render(fixtures, matches) {
  const root = document.getElementById("wmMatches");
  if (!root) return;
  if (!fixtures.length) {
    root.innerHTML = `<p class="wm-state">Spielplan momentan nicht verfügbar.</p>`;
    return;
  }

  // Group: round → (group letter for Vorrunde) → fixtures by kickoff.
  const byRound = new Map();
  for (const fx of fixtures) {
    if (!byRound.has(fx.round)) byRound.set(fx.round, []);
    byRound.get(fx.round).push(fx);
  }
  const rounds = [...byRound.keys()].sort((a, b) => roundRank(a) - roundRank(b));

  let html = "";
  for (const round of rounds) {
    html += `<h2 class="wm-round-head">${esc(round)}</h2>`;
    const list = byRound.get(round);
    const groups = [...new Set(list.map((f) => f.group).filter(Boolean))].sort();
    if (groups.length) {
      for (const g of groups) {
        html += `<h3 class="wm-group-head">Gruppe ${esc(g)}</h3>`;
        for (const fx of list.filter((f) => f.group === g).sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""))) {
          html += fixtureRow(fx, alignApi(fx, matches));
        }
      }
    } else {
      for (const fx of list.sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""))) {
        html += fixtureRow(fx, alignApi(fx, matches));
      }
    }
  }

  const note = matches.length
    ? ""
    : `<p class="wm-state">Resultate &amp; Torschützen erscheinen, sobald die Spieldaten verbunden sind.</p>`;
  root.innerHTML = note + html;
}

/** Public entry point — called by app.js when the Spiele tab opens. */
export async function initMatches() {
  const root = document.getElementById("wmMatches");
  if (!root) return;

  // Paint a visible loading state synchronously, BEFORE any await. If the SRF
  // livecenter fetch stalls (geofence / network), the panel shows this rather
  // than a blank screen.
  root.innerHTML = `<p class="wm-state">Spielplan wird geladen…</p>`;

  // Abort a stalled fetch after 8s so we always resolve to a visible state.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const [fixtures, matches] = await Promise.all([
      fetchFixtures({ signal: ctrl.signal }).catch(() => []),
      fetch(`${API_BASE}/api/wm/matches`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { matches: [] }))
        .then((d) => (Array.isArray(d.matches) ? d.matches : []))
        .catch(() => []),
    ]);
    if (!fixtures.length && !matches.length) {
      root.innerHTML = `<p class="wm-state">Spielplan konnte nicht geladen werden.</p>`;
      return;
    }
    render(fixtures, matches);
  } catch (_e) {
    // Any unexpected throw (incl. the abort) → a visible error, never blank.
    root.innerHTML = `<p class="wm-state">Spielplan konnte nicht geladen werden.</p>`;
  } finally {
    clearTimeout(timer);
  }
}
