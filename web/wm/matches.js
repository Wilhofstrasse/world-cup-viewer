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

/**
 * Two columns of scorers, each stacked under its own team — A on the left,
 * B on the right (alignApi already flips g.team to the displayed team order).
 */
function goalsBlock(goals) {
  const col = (side) => goals.filter((g) => g.team === side).map(goalLine).join("");
  return `<div class="wm-goals"><div class="wm-goals-col">${col("A")}</div><div class="wm-goals-col end">${col("B")}</div></div>`;
}

function fixtureRow(fx, api) {
  const live = api && api.status === "live";
  const finished = api && api.status === "finished";
  const showScore = live || finished;

  // Middle column: the score when played, else a slim "–" placeholder — keeps
  // long team names (Elfenbeinküste, Saudi-Arabien) from colliding with the
  // kickoff string, which now sits on its own line below the teams.
  const mid = showScore
    ? `<span class="wm-match-score">${api.scoreA}–${api.scoreB}</span>`
    : `<span class="wm-match-score wm-match-vs">–</span>`;

  const when = showScore ? "" : `<div class="wm-match-when">${esc(kickoff(fx.dateISO))}</div>`;
  const liveBadge = live ? `<span class="wm-live-badge">● LIVE ${api.minute ? api.minute + "'" : ""}</span>` : "";
  const goals = showScore && api.goals && api.goals.length ? goalsBlock(api.goals) : "";

  return `
    <article class="wm-match ${live ? "live" : ""}">
      <div class="wm-match-row">
        <span class="wm-match-team"><span class="f">${flagFor(fx.teamA)}</span>${esc(fx.teamA)}</span>
        ${mid}
        <span class="wm-match-team end"><span class="f">${flagFor(fx.teamB)}</span>${esc(fx.teamB)}</span>
      </div>
      ${when}
      ${liveBadge}
      ${goals}
    </article>`;
}

const byKickoff = (a, b) => (a.dateISO || "").localeCompare(b.dateISO || "");

/** Unique team flags across a group's fixtures, first-seen order — for the head. */
function groupFlags(fixtures) {
  const seen = new Set();
  const out = [];
  for (const fx of fixtures) {
    for (const t of [fx.teamA, fx.teamB]) {
      const key = (t || "").toLowerCase();
      if (t && !seen.has(key)) {
        seen.add(key);
        out.push(flagFor(t));
      }
    }
  }
  return out.join(" ");
}

function render(fixtures, matches) {
  const root = document.getElementById("wmMatches");
  if (!root) return;
  if (!fixtures.length) {
    root.innerHTML = `<p class="wm-state">Spielplan momentan nicht verfügbar.</p>`;
    return;
  }

  // round → fixtures
  const byRound = new Map();
  for (const fx of fixtures) {
    if (!byRound.has(fx.round)) byRound.set(fx.round, []);
    byRound.get(fx.round).push(fx);
  }
  const vorrunde = byRound.get("Vorrunde") || [];
  const koRounds = [...byRound.keys()].filter((r) => r !== "Vorrunde").sort((a, b) => roundRank(a) - roundRank(b));

  // Only the first accordion opens by default; the rest start collapsed.
  let openLeft = 1;
  const acc = (label, rows, flags) => {
    const open = openLeft > 0;
    if (open) openLeft--;
    const flagsHtml = flags ? ` <span class="wm-acc-flags">${flags}</span>` : "";
    return `<details class="wm-acc"${open ? " open" : ""}>
        <summary class="wm-acc-head"><span class="wm-acc-label"><span class="wm-acc-title">${esc(label)}</span>${flagsHtml}</span><span class="wm-acc-chev" aria-hidden="true">▸</span></summary>
        <div class="wm-acc-body">${rows}</div>
      </details>`;
  };
  const rowsFor = (list) => list.slice().sort(byKickoff).map((fx) => fixtureRow(fx, alignApi(fx, matches))).join("");

  const note = matches.length
    ? ""
    : `<p class="wm-state">Resultate &amp; Torschützen erscheinen, sobald die Spieldaten verbunden sind.</p>`;
  let html = note;

  // ── VORRUNDE: one accordion per group ──
  if (vorrunde.length) {
    html += `<div class="wm-sec">Vorrunde</div>`;
    const groups = [...new Set(vorrunde.map((f) => f.group).filter(Boolean))].sort();
    if (groups.length) {
      for (const g of groups) {
        const gfx = vorrunde.filter((f) => f.group === g);
        html += acc(`Gruppe ${g}`, rowsFor(gfx), groupFlags(gfx));
      }
    } else {
      html += acc("Alle Spiele", rowsFor(vorrunde));
    }
  }

  // ── K.-O.-RUNDE: one accordion per round ──
  if (koRounds.length) {
    html += `<div class="wm-sec">K.-o.-Runde</div>`;
    for (const round of koRounds) html += acc(round, rowsFor(byRound.get(round)));
  }

  root.innerHTML = html;
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
