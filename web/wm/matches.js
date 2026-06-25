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

import { flagFor, flagForId } from "./parse.js";
import { computeStandings } from "./standings.js";
import { setMatches, findClipByTeams, subscribe, getMatch } from "./linkstore.js";
import { t, apiLang, fmtKickoff } from "./i18n.js";

const API_BASE = window.WM_API_BASE || "";

let lastMatches = []; // last list passed to render — needed by jumpToSpieleMatch

// roundKey → dictionary suffix for spiele.round.* labels (language-invariant key
// from the Worker → localized label). Older cached matches without a roundKey
// fall back to "group".
const ROUND_KEY_TO_DICT = { group: "vorrunde", r32: "r32", r16: "r16", qf: "qf", sf: "sf", third: "thirdPlace", final: "final" };
const ROUND_RANK = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, third: 5, final: 6 };
const roundKeyOf = (m) => m.roundKey || "group";
const roundLabel = (key) => t("spiele.round." + (ROUND_KEY_TO_DICT[key] || "vorrunde"));

/** Flag for a team, language-independent: FIFA id first, name fallback. */
const teamFlag = (name, idTeam) => flagForId(idTeam) || flagFor(name);

function kickoff(iso) {
  const d = new Date(iso);
  return isNaN(+d) ? "" : fmtKickoff(d);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function goalLine(g) {
  const min = g.minute == null ? "" : `${g.minute}${g.extra ? "+" + g.extra : ""}'`;
  const tag = g.type === "penalty" ? t("spiele.goal.penalty") : g.type === "own" ? t("spiele.goal.ownGoal") : "";
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

  const teamBlock = (name, score, side, idTeam) => {
    const gs = showScore ? (m.goals || []).filter((g) => g.team === side) : [];
    const scoreHtml = showScore ? `<span class="wm-tscore">${score}</span>` : "";
    const goalsHtml = gs.length ? `<div class="wm-tgoals">${gs.map(goalLine).join(" · ")}</div>` : "";
    return `<div class="wm-tblock"><div class="wm-tline"><span class="f">${teamFlag(name, idTeam)}</span><span class="n">${esc(name)}</span>${scoreHtml}</div>${goalsHtml}</div>`;
  };

  const when = showScore ? "" : `<div class="wm-match-when">${esc(kickoff(m.dateISO))}</div>`;
  const liveBadge = live ? `<span class="wm-live-badge">${esc(t("spiele.liveBadge", { minute: m.minute || "" }))}</span>` : "";

  // Backlink to the matching Highlights clip when one exists. Renders on
  // finished/live matches with a clip; placeholder until linkstore has clips.
  const clip = findClipByTeams(m.teamA, m.teamB);
  const clipLink = clip
    ? `<button class="wm-match-link" data-urn="${esc(clip.urn)}" type="button">${t("spiele.watchHighlights")}</button>`
    : "";

  return `
    <article class="wm-match ${live ? "live" : ""}" data-mid="${m.id}">
      ${teamBlock(m.teamA, m.scoreA, "A", m.idTeamA)}
      ${teamBlock(m.teamB, m.scoreB, "B", m.idTeamB)}
      ${when}
      ${liveBadge}
      ${clipLink}
    </article>`;
}

const byKickoff = (a, b) => (a.dateISO || "").localeCompare(b.dateISO || "");

/** Unique team flags across a group's matches, first-seen order — for the head. */
function groupFlags(matches) {
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    for (const [name, id] of [[m.teamA, m.idTeamA], [m.teamB, m.idTeamB]]) {
      const key = (name || "").toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        out.push(teamFlag(name, id));
      }
    }
  }
  return out.join(" ");
}

/** Compact group table: rank · flag+team · Spiele · Tordifferenz · Punkte. */
function standingsTable(rows, idByName) {
  if (rows.length < 2) return "";
  const flag = (name) => teamFlag(name, idByName && idByName.get(name));
  const tr = (s, i) =>
    `<tr><td class="r">${i + 1}</td>` +
    `<td class="tm"><span class="tmw"><span class="f">${flag(s.team)}</span><span class="n">${esc(s.team)}</span></span></td>` +
    `<td>${s.played}</td><td>${s.gd > 0 ? "+" + s.gd : s.gd}</td><td class="pts">${s.points}</td></tr>`;
  return (
    `<table class="wm-standings"><thead><tr><th class="r">#</th><th>${t("spiele.standings.team")}</th><th>${t("spiele.standings.played")}</th><th>${t("spiele.standings.goalDiff")}</th><th>${t("spiele.standings.points")}</th></tr></thead>` +
    `<tbody>${rows.map(tr).join("")}</tbody></table>`
  );
}

/** Name → idTeam map for a group's matches (group-table flags are id-keyed). */
function idMapFor(matches) {
  const m = new Map();
  for (const x of matches) {
    if (x.teamA) m.set(x.teamA, x.idTeamA);
    if (x.teamB) m.set(x.teamB, x.idTeamB);
  }
  return m;
}

function render(matches) {
  const root = document.getElementById("wmMatches");
  if (!root) return;
  if (!matches.length) {
    root.innerHTML = `<p class="wm-state">${t("spiele.emptyState")}</p>`;
    return;
  }

  // roundKey → matches (language-invariant grouping; labels come from t()).
  const byKey = new Map();
  for (const m of matches) {
    const k = roundKeyOf(m);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(m);
  }
  const group = byKey.get("group") || [];
  const koKeys = [...byKey.keys()].filter((k) => k !== "group").sort((a, b) => (ROUND_RANK[a] ?? 98) - (ROUND_RANK[b] ?? 98));

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
  if (group.length) {
    html += `<div class="wm-sec">${t("spiele.section.vorrunde")}</div>`;
    const groups = [...new Set(group.map((m) => m.group).filter(Boolean))].sort();
    if (groups.length) {
      for (const g of groups) {
        const gm = group.filter((m) => m.group === g);
        html += acc(t("spiele.groupTitle", { g }), standingsTable(computeStandings(gm), idMapFor(gm)) + rowsFor(gm), groupFlags(gm));
      }
    } else {
      html += acc(t("spiele.allMatches"), rowsFor(group));
    }
  }

  // ── SECHZEHNTELFINALE (R32): own section ──
  const r32 = byKey.get("r32");
  if (r32 && r32.length) {
    html += `<div class="wm-sec">${t("spiele.section.r32")}</div>`;
    html += acc(roundLabel("r32"), rowsFor(r32), groupFlags(r32));
  }

  // ── ACHTELFINALE (R16): own section ──
  const r16 = byKey.get("r16");
  if (r16 && r16.length) {
    html += `<div class="wm-sec">${t("spiele.section.r16")}</div>`;
    html += acc(roundLabel("r16"), rowsFor(r16), groupFlags(r16));
  }

  // ── K.-O.-RUNDE: QF and later — one accordion per round ──
  const laterKeys = koKeys.filter((k) => k !== "r32" && k !== "r16");
  if (laterKeys.length) {
    html += `<div class="wm-sec">${t("spiele.section.knockout")}</div>`;
    for (const k of laterKeys) html += acc(roundLabel(k), rowsFor(byKey.get(k)), groupFlags(byKey.get(k)));
  }

  root.innerHTML = html;

  // Wire the "▶ Highlights ansehen" backlink. urn → feed slide index via
  // the link store; jumpToHighlightsClip lives on window (app.js exposes it).
  root.querySelectorAll(".wm-match-link").forEach((b) =>
    b.addEventListener("click", () => {
      const urn = b.dataset.urn;
      if (urn && typeof window.jumpToHighlightsClip === "function") window.jumpToHighlightsClip(urn);
    }),
  );
}

/**
 * Open a match by id: switch to Spiele if needed, open its accordion, scroll
 * the card into view, briefly flash it so the eye lands. Safe to call before
 * the matches list has arrived — retries via a one-shot linkstore subscription.
 */
export function jumpToSpieleMatch(matchId) {
  // Make sure we're on Spiele.
  if (document.body.dataset.tab !== "spiele") {
    document.querySelector('.wm-tab[data-tab="spiele"]')?.click();
  }

  const reveal = () => {
    const root = document.getElementById("wmMatches");
    if (!root) return false;
    const article = root.querySelector(`.wm-match[data-mid="${CSS.escape(String(matchId))}"]`);
    if (!article) return false;
    // Open every ancestor <details> accordion so the article isn't display:none.
    let el = article.parentElement;
    while (el) {
      if (el.tagName === "DETAILS" && !el.open) el.open = true;
      el = el.parentElement;
    }
    // Two RAFs so the accordion has laid out before we scroll.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        article.scrollIntoView({ behavior: "smooth", block: "center" });
        article.classList.add("wm-flash");
        setTimeout(() => article.classList.remove("wm-flash"), 1600);
      }),
    );
    return true;
  };

  if (reveal()) return;
  // Card not yet rendered (Spiele just opened) — try once on render.
  const tries = { left: 8 };
  const tick = () => {
    if (reveal() || --tries.left <= 0) return;
    setTimeout(tick, 120);
  };
  setTimeout(tick, 120);
}

/** Public entry point — called by app.js when the Spiele tab opens. */
export async function initMatches() {
  const root = document.getElementById("wmMatches");
  if (!root) return;

  // Paint a visible loading state synchronously, BEFORE any await, so a stalled
  // fetch shows this rather than a blank panel.
  root.innerHTML = `<p class="wm-state">${t("spiele.loading")}</p>`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const matches = await fetch(`${API_BASE}/api/wm/matches?lang=${apiLang()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((d) => (Array.isArray(d.matches) ? d.matches : []))
      .catch(() => []);
    if (!matches.length) {
      root.innerHTML = `<p class="wm-state">${t("common.loadError")}</p>`;
      return;
    }
    lastMatches = matches;
    setMatches(matches); // publish for the Highlights chip + drawer info button
    render(matches);
    // Re-render once the Highlights clips arrive so the "Highlights ansehen"
    // link can show on cards whose clip wasn't yet known.
    subscribe(() => {
      if (lastMatches.length) render(lastMatches);
    });
  } catch (_e) {
    root.innerHTML = `<p class="wm-state">${t("common.loadError")}</p>`;
  } finally {
    clearTimeout(timer);
  }
}
