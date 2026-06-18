/**
 * matches.js — WM "Spiele" view: the COMPLETE schedule structured by round +
 * group, with results + goalscorers.
 *
 * Single source: GET /api/wm/matches (FIFA's own data, ingested server-side).
 * It carries every fixture — round, group, teams, kickoff, score, status and
 * goal events (scorer + minute) — so the tab is complete (all 6 matches per
 * group), unlike the old SRF livecenter window which only listed the matches
 * SRF was streaming. Highlight clips still come from SRF (feed.js), separately.
 *
 * Never invents a minute/score: a match with no result shows kickoff only.
 */

"use strict";

import { flagFor } from "./parse.js";

const API_BASE = window.WM_API_BASE || "";

// Display order of rounds (FIFA 48-team format: Round of 32 = Sechzehntelfinale).
const ROUND_ORDER = ["Vorrunde", "Sechzehntelfinale", "Achtelfinale", "Viertelfinale", "Halbfinale", "Spiel um Platz 3", "Final"];
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

function goalLine(g) {
  const min = g.minute == null ? "" : `${g.minute}${g.extra ? "+" + g.extra : ""}'`;
  const tag = g.type === "penalty" ? " (FE)" : g.type === "own" ? " (ET)" : "";
  return `<span class="wm-g"><span class="m">${esc(min)}</span> ${esc(g.scorer)}${tag}</span>`;
}

/**
 * One match card, vertical scoreboard: each team on its own line
 * (flag · name · score) so long names get the full width and never collide with
 * the score, with that team's scorers indented beneath it. Kickoff sits below
 * when the match hasn't been played; a live badge shows when in play.
 */
function fixtureRow(m) {
  const live = m.status === "live";
  const finished = m.status === "finished";
  const showScore = live || finished;

  const teamBlock = (name, score, side) => {
    const gs = showScore ? (m.goals || []).filter((g) => g.team === side) : [];
    const scoreHtml = showScore ? `<span class="wm-tscore">${score}</span>` : "";
    const goalsHtml = gs.length ? `<div class="wm-tgoals">${gs.map(goalLine).join(" · ")}</div>` : "";
    return `<div class="wm-tblock"><div class="wm-tline"><span class="f">${flagFor(name)}</span><span class="n">${esc(name)}</span>${scoreHtml}</div>${goalsHtml}</div>`;
  };

  const when = showScore ? "" : `<div class="wm-match-when">${esc(kickoff(m.dateISO))}</div>`;
  const liveBadge = live ? `<span class="wm-live-badge">● LIVE ${m.minute ? m.minute + "'" : ""}</span>` : "";

  return `
    <article class="wm-match ${live ? "live" : ""}">
      ${teamBlock(m.teamA, m.scoreA, "A")}
      ${teamBlock(m.teamB, m.scoreB, "B")}
      ${when}
      ${liveBadge}
    </article>`;
}

const byKickoff = (a, b) => (a.dateISO || "").localeCompare(b.dateISO || "");

/** Unique team flags across a group's matches, first-seen order — for the head. */
function groupFlags(matches) {
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    for (const t of [m.teamA, m.teamB]) {
      const key = (t || "").toLowerCase();
      if (t && !seen.has(key)) {
        seen.add(key);
        out.push(flagFor(t));
      }
    }
  }
  return out.join(" ");
}

function render(matches) {
  const root = document.getElementById("wmMatches");
  if (!root) return;
  if (!matches.length) {
    root.innerHTML = `<p class="wm-state">Spielplan momentan nicht verfügbar.</p>`;
    return;
  }

  // round → matches
  const byRound = new Map();
  for (const m of matches) {
    const r = m.round || "Vorrunde";
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
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
  const rowsFor = (list) => list.slice().sort(byKickoff).map(fixtureRow).join("");

  let html = "";

  // ── VORRUNDE: one accordion per group ──
  if (vorrunde.length) {
    html += `<div class="wm-sec">Vorrunde</div>`;
    const groups = [...new Set(vorrunde.map((m) => m.group).filter(Boolean))].sort();
    if (groups.length) {
      for (const g of groups) {
        const gm = vorrunde.filter((m) => m.group === g);
        html += acc(`Gruppe ${g}`, rowsFor(gm), groupFlags(gm));
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

  // Paint a visible loading state synchronously, BEFORE any await, so a stalled
  // fetch shows this rather than a blank panel.
  root.innerHTML = `<p class="wm-state">Spielplan wird geladen…</p>`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const matches = await fetch(`${API_BASE}/api/wm/matches`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((d) => (Array.isArray(d.matches) ? d.matches : []))
      .catch(() => []);
    if (!matches.length) {
      root.innerHTML = `<p class="wm-state">Spielplan konnte nicht geladen werden.</p>`;
      return;
    }
    render(matches);
  } catch (_e) {
    root.innerHTML = `<p class="wm-state">Spielplan konnte nicht geladen werden.</p>`;
  } finally {
    clearTimeout(timer);
  }
}
