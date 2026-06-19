/**
 * aufstellungen.js — WM Mehr ▸ Aufstellungen.
 *
 * Per-match lineups with formation, X-I, bench, and yellow/red cards. Two
 * keyless sources:
 *   - /api/wm/matches  → match picker (FIFA payload via the Worker).
 *   - https://api.fifa.com/api/v3/live/football/17/285023/{stage}/{match}
 *     → lineups, fetched directly from the browser (CORS-open).
 *
 * FIFA places each Player at a normalized (LineupX, LineupY) pair so we draw
 * the SVG pitch from real coordinates instead of parsing the Tactics string.
 * Substitutes go in the bench grid; bookings render a coloured rectangle next
 * to the surname.
 */

"use strict";

import { flagFor } from "./parse.js";

const API_BASE = window.WM_API_BASE || "";
const FIFA_LIVE = (stage, match) =>
  `https://api.fifa.com/api/v3/live/football/17/285023/${encodeURIComponent(stage)}/${encodeURIComponent(match)}?language=de-DE`;

let mounted = null;
let matches = []; // /api/wm/matches list (only finished + live + imminent)
let currentMatchId = null;
let currentSide = "home"; // "home" | "away"
let lineup = null; // last successful FIFA response

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loc(arr) {
  return (Array.isArray(arr) && arr[0] && arr[0].Description) || "";
}

function fmtKickoff(iso) {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
}

function selectableMatches(all) {
  const now = Date.now();
  return all.filter((m) => {
    if (m.status === "live" || m.status === "finished") return true;
    const ko = Date.parse(m.dateISO);
    return !isNaN(ko) && ko - now < 90 * 60 * 1000; // pre-kickoff window
  });
}

function defaultMatchId(list) {
  const live = list.find((m) => m.status === "live");
  if (live) return live.id;
  const finished = list.filter((m) => m.status === "finished").sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  if (finished.length) return finished[0].id;
  return list[0]?.id ?? null;
}

function pickerHtml() {
  if (!matches.length) return `<div class="wm-au-empty">Keine Spiele mit Aufstellungen verfügbar.</div>`;
  const cur = matches.find((m) => String(m.id) === String(currentMatchId)) || matches[0];
  const rows = matches.slice(0, 24).map((m) => {
    const cls = String(m.id) === String(cur?.id) ? "wm-au-pick-row is-active" : "wm-au-pick-row";
    const sc = m.status === "finished" || m.status === "live" ? `${m.scoreA}:${m.scoreB}` : fmtKickoff(m.dateISO);
    return `<button class="${cls}" data-id="${esc(m.id)}" type="button"><span class="ta">${flagFor(m.teamA)} ${esc(m.teamA)}</span><span class="sc">${esc(sc)}</span><span class="tb">${esc(m.teamB)} ${flagFor(m.teamB)}</span></button>`;
  }).join("");
  return `
    <details class="wm-au-picker">
      <summary class="wm-au-picker-head">
        <span class="wm-au-cur">${cur ? `${flagFor(cur.teamA)} ${esc(cur.teamA)} <span class="vs">–</span> ${esc(cur.teamB)} ${flagFor(cur.teamB)}` : "Spiel wählen"}</span>
        <span class="wm-au-edit">Wechseln ▾</span>
      </summary>
      <div class="wm-au-picker-list">${rows}</div>
    </details>`;
}

function sidePillHtml() {
  return `
    <div class="wm-au-side">
      <div class="wm-au-side-pill" role="tablist">
        <button class="wm-au-side-tab ${currentSide === "home" ? "on" : ""}" data-side="home" type="button">Heim</button>
        <button class="wm-au-side-tab ${currentSide === "away" ? "on" : ""}" data-side="away" type="button">Auswärts</button>
      </div>
    </div>`;
}

function pitchSvg(team) {
  if (!team) return "";
  const players = team.Players || [];
  const bookings = team.Bookings || [];
  const yellowSet = new Set();
  const redSet = new Set();
  for (const b of bookings) {
    const id = b.IdPlayer;
    if (!id) continue;
    if (b.Card === 1 || b.CardType === 1) yellowSet.add(id);
    if (b.Card === 2 || b.CardType === 2 || b.Card === 3) redSet.add(id);
  }
  // Starters: FieldStatus === 1 or Status === 0 — FIFA's enum is inconsistent
  // across feeds; the LineupX/Y pair is the only definitive starter signal.
  const starters = players.filter((p) => typeof p.LineupX === "number" && typeof p.LineupY === "number");
  // FIFA's coordinates: 0..100 with HomeTeam attacking upward. SVG y grows down
  // so we mirror Y. Pad inside the pitch frame.
  const W = 340;
  const H = 460;
  const PAD = 18;
  const xy = (lx, ly) => ({
    x: PAD + (lx / 100) * (W - 2 * PAD),
    y: PAD + ((100 - ly) / 100) * (H - 2 * PAD),
  });
  const surname = (name) => {
    const t = (name || "").trim();
    const tokens = t.split(/\s+/);
    return tokens.length > 1 ? tokens[tokens.length - 1] : t;
  };
  const playerMarkers = starters
    .map((p) => {
      const name = loc(p.PlayerName) || loc(p.ShortName) || "";
      const sn = surname(name);
      const num = p.ShirtNumber ?? "–";
      const { x, y } = xy(p.LineupX, p.LineupY);
      const photo = p.PlayerPicture && p.PlayerPicture.PictureUrl;
      const isGK = p.Position === 0;
      const stroke = isGK ? "#e6492f" : "#1c1c1c";
      const yellow = yellowSet.has(p.IdPlayer);
      const red = redSet.has(p.IdPlayer);
      const cardRect = red
        ? `<rect x="${x + 12}" y="${y - 22}" width="7" height="9" rx="1.5" fill="#e6492f"/>`
        : yellow
        ? `<rect x="${x + 12}" y="${y - 22}" width="7" height="9" rx="1.5" fill="#e6a800"/>`
        : "";
      return `
        <g class="player" data-id="${esc(p.IdPlayer || "")}">
          ${photo ? `<defs><pattern id="p${p.IdPlayer}" patternUnits="objectBoundingBox" width="1" height="1"><image href="${esc(photo)}" x="0" y="0" width="40" height="40"/></pattern></defs><circle cx="${x}" cy="${y}" r="20" fill="url(#p${p.IdPlayer})" stroke="${stroke}" stroke-width="${isGK ? 2 : 1.5}"/>` : `<circle cx="${x}" cy="${y}" r="20" fill="#fff" stroke="${stroke}" stroke-width="${isGK ? 2 : 1.5}"/><text x="${x}" y="${y}" class="shirt">${num}</text>`}
          <text x="${x}" y="${y + 34}" class="sname">${esc(sn)}</text>
          ${cardRect}
        </g>`;
    })
    .join("");
  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="Spielfeld">
      <defs>
        <linearGradient id="pitchg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fbf8f1"/>
          <stop offset="1" stop-color="#f0ece2"/>
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="12" fill="url(#pitchg)" stroke="rgba(28,28,28,.15)" stroke-width="1.5"/>
      <line x1="4" y1="${H / 2}" x2="${W - 4}" y2="${H / 2}" stroke="rgba(28,28,28,.15)" stroke-width="1"/>
      <circle cx="${W / 2}" cy="${H / 2}" r="40" fill="none" stroke="rgba(28,28,28,.15)" stroke-width="1"/>
      <circle cx="${W / 2}" cy="${H / 2}" r="2" fill="rgba(28,28,28,.15)"/>
      <rect x="${W / 2 - 90}" y="4" width="180" height="58" fill="none" stroke="rgba(28,28,28,.15)" stroke-width="1"/>
      <rect x="${W / 2 - 90}" y="${H - 62}" width="180" height="58" fill="none" stroke="rgba(28,28,28,.15)" stroke-width="1"/>
      ${playerMarkers}
    </svg>`;
}

function benchHtml(team) {
  const players = team?.Players || [];
  const subs = players.filter((p) => !(typeof p.LineupX === "number" && typeof p.LineupY === "number"));
  if (!subs.length) return "";
  const rows = subs
    .slice(0, 12)
    .map((p) => {
      const name = loc(p.PlayerName) || loc(p.ShortName) || "";
      const num = p.ShirtNumber ?? "–";
      const posLabel = loc(p.PositionLocalized) || "";
      const psShort = posLabel.startsWith("Tor")
        ? "TW"
        : posLabel.startsWith("Abw")
        ? "AB"
        : posLabel.startsWith("Mit")
        ? "MF"
        : posLabel.startsWith("Ang")
        ? "ST"
        : "—";
      return `<button class="wm-au-b-row" data-id="${esc(p.IdPlayer || "")}" type="button"><span class="n">${num}</span><span class="nm">${esc(name)}</span><span class="ps">${psShort}</span></button>`;
    })
    .join("");
  return `<h4 class="wm-au-bench-lbl">Ersatzbank</h4><div class="wm-au-bench">${rows}</div>`;
}

function lineupHtml() {
  if (!lineup) return `<div class="wm-au-empty">Aufstellung wird geladen…</div>`;
  const team = currentSide === "home" ? lineup.HomeTeam : lineup.AwayTeam;
  if (!team) return `<div class="wm-au-empty">Keine Aufstellung verfügbar.</div>`;
  const teamName = loc(team.TeamName) || "";
  const tactics = team.Tactics || "—";
  const coaches = team.Coaches || [];
  const coachName = coaches[0] && (loc(coaches[0].Name) || coaches[0].Name) || "";
  return `
    <div class="wm-au-pitch-wrap">
      <div class="wm-au-tactics"><span>${esc(teamName)} — <b>${esc(tactics)}</b></span>${coachName ? `<span>Trainer: ${esc(coachName)}</span>` : ""}</div>
      ${pitchSvg(team)}
      <div class="wm-au-legend"><span><span class="sw y"></span>Gelb</span><span><span class="sw r"></span>Rot</span><span>${esc(tactics)}</span></div>
    </div>
    ${benchHtml(team)}`;
}

function render() {
  if (!mounted) return;
  mounted.innerHTML = `${pickerHtml()}${sidePillHtml()}<div class="wm-au-content" id="wmAuContent">${lineupHtml()}</div>`;
  mounted.querySelectorAll(".wm-au-pick-row").forEach((b) =>
    b.addEventListener("click", () => {
      currentMatchId = b.dataset.id;
      const picker = mounted.querySelector(".wm-au-picker");
      if (picker) picker.open = false;
      loadLineup();
    }),
  );
  mounted.querySelectorAll(".wm-au-side-tab").forEach((b) =>
    b.addEventListener("click", () => {
      currentSide = b.dataset.side;
      const c = mounted.querySelector("#wmAuContent");
      if (c) c.innerHTML = lineupHtml();
      wirePlayerTaps();
      mounted.querySelectorAll(".wm-au-side-tab").forEach((t) => t.classList.toggle("on", t.dataset.side === currentSide));
    }),
  );
  wirePlayerTaps();
}

function wirePlayerTaps() {
  mounted?.querySelectorAll("svg .player, .wm-au-b-row").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      if (id && typeof window.openSpielerkarte === "function") window.openSpielerkarte(id);
    });
  });
}

async function loadLineup() {
  if (!currentMatchId) return;
  const m = matches.find((x) => String(x.id) === String(currentMatchId));
  if (!m || !m.stageId) {
    lineup = null;
    render();
    return;
  }
  const c = mounted?.querySelector("#wmAuContent");
  if (c) c.innerHTML = `<div class="wm-au-empty">Aufstellung wird geladen…</div>`;
  try {
    const res = await fetch(FIFA_LIVE(m.stageId, m.id), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("status " + res.status);
    lineup = await res.json();
  } catch (_e) {
    lineup = null;
  }
  render();
}

async function load() {
  if (!mounted) return;
  mounted.innerHTML = `<div class="wm-au-empty">Spiele werden geladen…</div>`;
  try {
    const res = await fetch(`${API_BASE}/api/wm/matches`, { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const all = Array.isArray(data.matches) ? data.matches : [];
    matches = selectableMatches(all).sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || ""));
    if (!matches.length) {
      mounted.innerHTML = `<div class="wm-au-empty">Aufstellungen erscheinen ca. 60 Minuten vor Anstoss.</div>`;
      return;
    }
    currentMatchId = defaultMatchId(matches);
  } catch (_e) {
    mounted.innerHTML = `<div class="wm-au-empty">Konnte nicht geladen werden.</div>`;
    return;
  }
  await loadLineup();
}

export function initAufstellungen(container) {
  mounted = container;
  matches = [];
  currentMatchId = null;
  currentSide = "home";
  lineup = null;
  load();
}

export function destroyAufstellungen() {
  mounted = null;
  matches = [];
  currentMatchId = null;
  lineup = null;
}
