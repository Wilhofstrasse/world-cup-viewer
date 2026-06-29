/**
 * bracket.js — WM Mehr ▸ K.-o.-Baum.
 *
 * Full radial knockout bracket inspired by the 32-team poster layout: flags
 * around the rim, match nodes on the branches, and the trophy in the centre.
 * The view reads from /api/wm/matches, prefers the Worker's language-invariant
 * roundKey values, and falls back to known FIFA stage ids for cached payloads.
 */

"use strict";

import { flagFor, flagForId } from "./parse.js";
import { t, apiLang, fmtKickoff as fmtKick } from "./i18n.js";

const API_BASE = window.WM_API_BASE || "";

const STAGE_TO_ROUND = {
  "289287": "r32",
  "289288": "r16",
  "289289": "qf",
  "289290": "sf",
  "289291": "third",
  "289292": "final",
};

const ROUND_LABEL_KEY = {
  r32: "spiele.round.r32",
  r16: "spiele.round.r16",
  qf: "spiele.round.qf",
  sf: "spiele.round.sf",
  third: "spiele.round.thirdPlace",
  final: "spiele.round.final",
};

const ROUND_SIZE = { r32: 16, r16: 8, qf: 4, sf: 2, final: 1, third: 1 };
const ORDER = { r32: 1, r16: 2, qf: 3, sf: 4, third: 5, final: 6 };

const BOARD = { w: 720, h: 760, cx: 360, cy: 415 };
const RADIUS = { leaf: 310, leafLine: 274, r32: 236, r16: 178, qf: 124, sf: 74, center: 52 };
const LEAF_COUNT = 32;
const LEAF_STEP = 360 / LEAF_COUNT;

let mounted = null;
let lastState = { kind: "loading" };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtKickoff(iso) {
  const d = new Date(iso);
  return isNaN(+d) ? "" : fmtKick(d);
}

function roundKeyOf(m) {
  return m && (m.roundKey || STAGE_TO_ROUND[String(m.stageId || "")]) || null;
}

function roundLabel(key) {
  return t(ROUND_LABEL_KEY[key] || "spiele.section.knockout");
}

function byKickoff(a, b) {
  return (a.dateISO || "").localeCompare(b.dateISO || "") || String(a.id || "").localeCompare(String(b.id || ""));
}

function blank(roundKey, idx) {
  return {
    id: `ph-${roundKey}-${idx}`,
    status: "scheduled",
    teamA: null,
    teamB: null,
    scoreA: null,
    scoreB: null,
    minute: null,
    dateISO: "",
    roundKey,
    round: roundLabel(roundKey),
    _placeholder: true,
  };
}

function teamFlag(name, idTeam) {
  return flagForId(idTeam) || flagFor(name) || "";
}

function sideOutcome(m, side) {
  if (!m || m.status !== "finished" || m.scoreA == null || m.scoreB == null || m.scoreA === m.scoreB) return null;
  const wonA = m.scoreA > m.scoreB;
  return side === "A" ? (wonA ? "win" : "lose") : (wonA ? "lose" : "win");
}

function matchWinner(m) {
  if (!m || m.status !== "finished" || m.scoreA == null || m.scoreB == null || m.scoreA === m.scoreB) return null;
  return m.scoreA > m.scoreB ? "A" : "B";
}

function sideData(m, side, fallback) {
  const isA = side === "A";
  const name = isA ? m.teamA : m.teamB;
  const idTeam = isA ? m.idTeamA : m.idTeamB;
  return {
    name: name || "",
    idTeam: idTeam || "",
    flag: name ? teamFlag(name, idTeam) : "",
    matchId: m && !String(m.id || "").startsWith("ph-") ? String(m.id) : "",
    side,
    fallback,
    outcome: sideOutcome(m, side),
    live: m && m.status === "live",
  };
}

function collectRounds(matches) {
  const out = {};
  for (const key of Object.keys(ROUND_SIZE)) {
    const rows = matches.filter((m) => roundKeyOf(m) === key).slice().sort(byKickoff);
    while (rows.length < ROUND_SIZE[key]) rows.push(blank(key, rows.length + 1));
    out[key] = rows.slice(0, ROUND_SIZE[key]);
  }
  return out;
}

function fallbackLeafTeams(matches) {
  const seen = new Set();
  const out = [];
  for (const m of matches.slice().sort((a, b) => (ORDER[roundKeyOf(a)] || 0) - (ORDER[roundKeyOf(b)] || 0) || byKickoff(a, b))) {
    for (const side of ["A", "B"]) {
      const name = side === "A" ? m.teamA : m.teamB;
      const idTeam = side === "A" ? m.idTeamA : m.idTeamB;
      const key = idTeam ? `id:${idTeam}` : `name:${String(name || "").toLowerCase()}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, idTeam: idTeam || "", flag: teamFlag(name, idTeam), matchId: "", side, fallback: "", outcome: null, live: false });
      if (out.length === LEAF_COUNT) return out;
    }
  }
  return out;
}

function buildLeaves(r32, allMatches) {
  const leaves = [];
  for (let i = 0; i < r32.length; i += 1) {
    leaves.push(sideData(r32[i], "A", `${roundLabel("r32")} ${i + 1}A`));
    leaves.push(sideData(r32[i], "B", `${roundLabel("r32")} ${i + 1}B`));
  }

  const known = leaves.filter((x) => x.name).length;
  if (known === 0) {
    const preview = fallbackLeafTeams(allMatches);
    for (let i = 0; i < Math.min(preview.length, leaves.length); i += 1) leaves[i] = preview[i];
  }

  while (leaves.length < LEAF_COUNT) {
    leaves.push({ name: "", idTeam: "", flag: "", matchId: "", side: "", fallback: `${roundLabel("r32")} ${leaves.length + 1}`, outcome: null, live: false });
  }
  return leaves.slice(0, LEAF_COUNT);
}

function leafAngle(i) {
  return -90 + i * LEAF_STEP;
}

function groupAngle(groupSize, i) {
  return leafAngle(i * groupSize + (groupSize - 1) / 2);
}

function pt(angle, radius) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: BOARD.cx + Math.cos(rad) * radius,
    y: BOARD.cy + Math.sin(rad) * radius,
  };
}

function pct(n, total) {
  return `${((n / total) * 100).toFixed(3)}%`;
}

function pointStyle(p) {
  return `--x:${pct(p.x, BOARD.w)};--y:${pct(p.y, BOARD.h)}`;
}

function pathFor(childAngle, childRadius, parentAngle, parentRadius) {
  const a = pt(childAngle, childRadius);
  const b = pt(childAngle, (childRadius + parentRadius) / 2);
  const c = pt(parentAngle, parentRadius);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)} L${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
}

function centerPath(childAngle, childRadius) {
  const a = pt(childAngle, childRadius);
  const b = pt(childAngle, RADIUS.center + 18);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function matchLabel(m, key, idx) {
  const label = roundLabel(key);
  if (!m || m._placeholder) return `${label} ${idx + 1}: ${t("mehr.bracket.tbd")}`;
  const teams = `${m.teamA || t("mehr.bracket.tbd")} - ${m.teamB || t("mehr.bracket.tbd")}`;
  const score =
    (m.status === "finished" || m.status === "live") && m.scoreA != null && m.scoreB != null
      ? ` ${m.scoreA}:${m.scoreB}`
      : "";
  const when = !score && m.dateISO ? `, ${fmtKickoff(m.dateISO)}` : "";
  return `${label} ${idx + 1}: ${teams}${score}${when}`;
}

function lineClassFor(m) {
  const cls = ["wm-kb-line"];
  if (m && m.status === "live") cls.push("is-live");
  if (!matchWinner(m)) cls.push("is-pending");
  return cls.join(" ");
}

function linesSvg(rounds) {
  const paths = [];
  const dots = [];
  const addPath = (d, cls, key, idx) => paths.push(`<path class="${cls}" d="${d}" data-r="${key}" data-i="${idx}"/>`);
  const addDot = (angle, radius, m, key, idx) => {
    const p = pt(angle, radius);
    const cls = ["wm-kb-dot"];
    if (m && m.status === "live") cls.push("is-live");
    if (m && m.status === "finished") cls.push("is-finished");
    if (!m || m._placeholder) cls.push("is-placeholder");
    dots.push(`<circle class="${cls.join(" ")}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5.4" data-r="${key}" data-i="${idx}"/>`);
  };

  const r32Angles = Array.from({ length: 16 }, (_, i) => groupAngle(2, i));
  const r16Angles = Array.from({ length: 8 }, (_, i) => groupAngle(4, i));
  const qfAngles = Array.from({ length: 4 }, (_, i) => groupAngle(8, i));
  const sfAngles = Array.from({ length: 2 }, (_, i) => groupAngle(16, i));

  for (let i = 0; i < LEAF_COUNT; i += 1) {
    const match = rounds.r32[Math.floor(i / 2)];
    addPath(pathFor(leafAngle(i), RADIUS.leafLine, r32Angles[Math.floor(i / 2)], RADIUS.r32), lineClassFor(match), "r32", Math.floor(i / 2));
  }
  for (let i = 0; i < r32Angles.length; i += 1) {
    const parent = Math.floor(i / 2);
    addPath(pathFor(r32Angles[i], RADIUS.r32, r16Angles[parent], RADIUS.r16), lineClassFor(rounds.r32[i]), "r16", parent);
  }
  for (let i = 0; i < r16Angles.length; i += 1) {
    const parent = Math.floor(i / 2);
    addPath(pathFor(r16Angles[i], RADIUS.r16, qfAngles[parent], RADIUS.qf), lineClassFor(rounds.r16[i]), "qf", parent);
  }
  for (let i = 0; i < qfAngles.length; i += 1) {
    const parent = Math.floor(i / 2);
    addPath(pathFor(qfAngles[i], RADIUS.qf, sfAngles[parent], RADIUS.sf), lineClassFor(rounds.qf[i]), "sf", parent);
  }
  for (let i = 0; i < sfAngles.length; i += 1) {
    addPath(centerPath(sfAngles[i], RADIUS.sf), lineClassFor(rounds.sf[i]), "final", 0);
  }

  r32Angles.forEach((a, i) => addDot(a, RADIUS.r32, rounds.r32[i], "r32", i));
  r16Angles.forEach((a, i) => addDot(a, RADIUS.r16, rounds.r16[i], "r16", i));
  qfAngles.forEach((a, i) => addDot(a, RADIUS.qf, rounds.qf[i], "qf", i));
  sfAngles.forEach((a, i) => addDot(a, RADIUS.sf, rounds.sf[i], "sf", i));

  return `
    <svg class="wm-kb-svg" viewBox="0 0 ${BOARD.w} ${BOARD.h}" role="img" aria-label="${esc(t("mehr.bracket.title"))}" preserveAspectRatio="xMidYMid meet">
      <g class="wm-kb-lines">${paths.join("")}</g>
      <circle class="wm-kb-center-ring" cx="${BOARD.cx}" cy="${BOARD.cy}" r="${RADIUS.center}"/>
      <g class="wm-kb-dots">${dots.join("")}</g>
    </svg>`;
}

function teamBadgeHtml(team, i) {
  const p = pt(leafAngle(i), RADIUS.leaf);
  const label = team.name || team.fallback || t("mehr.bracket.tbd");
  const cls = ["wm-kb-team"];
  if (!team.name) cls.push("is-placeholder");
  if (team.outcome === "win") cls.push("is-winner");
  if (team.outcome === "lose") cls.push("is-out");
  if (team.live) cls.push("is-live");
  const body = `<span class="wm-kb-flag" aria-hidden="true">${team.flag || "?"}</span><span class="wm-kb-sr">${esc(label)}</span>`;
  const attrs = `class="${cls.join(" ")}" style="${pointStyle(p)}" title="${esc(label)}" aria-label="${esc(label)}"`;
  if (team.matchId) return `<button ${attrs} type="button" data-mid="${esc(team.matchId)}">${body}</button>`;
  return `<span ${attrs}>${body}</span>`;
}

function hitTargetsHtml(rounds) {
  const specs = [
    { key: "r32", count: 16, group: 2, radius: RADIUS.r32 },
    { key: "r16", count: 8, group: 4, radius: RADIUS.r16 },
    { key: "qf", count: 4, group: 8, radius: RADIUS.qf },
    { key: "sf", count: 2, group: 16, radius: RADIUS.sf },
  ];
  const html = [];
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i += 1) {
      const m = rounds[spec.key][i];
      if (!m || m._placeholder) continue;
      const p = pt(groupAngle(spec.group, i), spec.radius);
      html.push(`<button class="wm-kb-hit" type="button" data-mid="${esc(m.id)}" style="${pointStyle(p)}" aria-label="${esc(matchLabel(m, spec.key, i))}" title="${esc(matchLabel(m, spec.key, i))}"></button>`);
    }
  }
  return html.join("");
}

function trophySvg() {
  return `
    <svg class="wm-kb-trophy" viewBox="0 0 64 92" aria-hidden="true" focusable="false">
      <path d="M20 8h24v14c0 13-5 23-12 27-7-4-12-14-12-27V8Z"/>
      <path d="M20 14H9c0 14 5 24 16 28M44 14h11c0 14-5 24-16 28"/>
      <path d="M32 49v18M23 67h18M18 78h28M14 86h36"/>
      <path d="M27 18c5 2 9 2 13 0M26 26c4 3 9 3 14 0"/>
    </svg>`;
}

function centerHtml(finalMatch) {
  const p = { x: BOARD.cx, y: BOARD.cy };
  const label = matchLabel(finalMatch, "final", 0);
  const cls = ["wm-kb-center"];
  if (finalMatch.status === "live") cls.push("is-live");
  if (finalMatch.status === "finished") cls.push("is-finished");
  const body = `${trophySvg()}<span class="wm-kb-sr">${esc(label)}</span>`;
  const attrs = `class="${cls.join(" ")}" style="${pointStyle(p)}" aria-label="${esc(label)}" title="${esc(label)}"`;
  if (finalMatch && !finalMatch._placeholder) return `<button ${attrs} type="button" data-mid="${esc(finalMatch.id)}">${body}</button>`;
  return `<span ${attrs}>${body}</span>`;
}

function thirdPlaceHtml(third) {
  if (!third || third._placeholder) return "";
  const teams = [sideData(third, "A", ""), sideData(third, "B", "")].filter((x) => x.name);
  if (!teams.length) return "";
  const label = matchLabel(third, "third", 0);
  const flags = teams.map((x) => x.flag).join("");
  const p = { x: BOARD.cx, y: BOARD.cy + RADIUS.leaf - 6 };
  return `<button class="wm-kb-third" type="button" data-mid="${esc(third.id)}" style="${pointStyle(p)}" aria-label="${esc(label)}" title="${esc(label)}"><span class="wm-kb-third-label">${esc(roundLabel("third"))}</span><span class="wm-kb-third-flags" aria-hidden="true">${flags}</span></button>`;
}

function renderTree(matches) {
  const rounds = collectRounds(matches);
  const leaves = buildLeaves(rounds.r32, matches);

  return `
    <div class="wm-kb-radial">
      <div class="wm-kb-board">
        <div class="wm-kb-title">${esc(t("mehr.bracket.posterTitle"))}</div>
        ${linesSvg(rounds)}
        ${leaves.map(teamBadgeHtml).join("")}
        ${hitTargetsHtml(rounds)}
        ${centerHtml(rounds.final[0])}
        ${thirdPlaceHtml(rounds.third[0])}
      </div>
    </div>`;
}

function wireLinks() {
  mounted.querySelectorAll("[data-mid]").forEach((el) => {
    const id = el.dataset.mid;
    if (!id || id.startsWith("ph-")) return;
    el.addEventListener("click", () => {
      if (typeof window.jumpToSpieleMatch === "function") window.jumpToSpieleMatch(id);
    });
  });
}

function render(state) {
  if (!mounted) return;
  if (state.kind === "loading") {
    mounted.innerHTML = `<div class="wm-kb-hint">${t("mehr.bracket.loading")}</div>`;
    return;
  }
  if (state.kind === "error") {
    mounted.innerHTML = `<div class="wm-ts-empty"><div class="ic">⚠</div><div class="t">${t("common.loadError")}</div><div class="s">${t("common.loadErrorRetry")}</div></div>`;
    return;
  }
  mounted.innerHTML = renderTree(state.matches);
  wireLinks();
}

async function load() {
  lastState = { kind: "loading" };
  render(lastState);
  try {
    const res = await fetch(`${API_BASE}/api/wm/matches?lang=${apiLang()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];
    lastState = { kind: "ready", matches };
  } catch (_e) {
    lastState = { kind: "error" };
  }
  render(lastState);
}

export function initBracket(container) {
  mounted = container;
  load();
}

export function destroyBracket() {
  mounted = null;
  lastState = { kind: "loading" };
}
