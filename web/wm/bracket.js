/**
 * bracket.js — WM Mehr ▸ K.-o.-Baum.
 *
 * Finals tree only — Viertelfinale · Halbfinale · Finale + Spiel um Platz 3.
 * Filipe's scope decision (locked 18.06.2026): R32 + R16 live under the Spiele
 * tab as separate sections, not here. The bracket reads from /api/wm/matches
 * (no new endpoint needed) and filters by stageId.
 *
 * Layout: absolute-positioned cards on a 548 × 600 surface inside a
 * horizontally-scrollable wrapper. SVG connector lines join cards; the dark
 * "winner path" follows whichever side actually won. Live cell pulses; Final
 * card gets a Weltmeister crown badge; Spiel um Platz 3 sits dashed beneath it.
 */

"use strict";

import { flagFor } from "./parse.js";

const API_BASE = window.WM_API_BASE || "";

// FIFA stage ids — finals only.
const STAGE_QF = "289289";
const STAGE_SF = "289290";
const STAGE_FINAL = "289292";
const STAGE_THIRD = "289291";

// Display labels.
const LABEL = { [STAGE_QF]: "Viertelfinale", [STAGE_SF]: "Halbfinale", [STAGE_FINAL]: "Finale", [STAGE_THIRD]: "Spiel um Platz 3" };

let mounted = null;
let lastState = { kind: "loading" };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtKickoff(iso) {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
}

/** Returns "win" | "lose" | null. Loser greyed; winner gets bold + ink edge. */
function sideOutcome(m, side) {
  if (m.status !== "finished" || m.scoreA == null || m.scoreB == null) return null;
  if (m.scoreA === m.scoreB) return null; // shoot-out — we don't have penalty scores yet, so no win/lose
  const wonA = m.scoreA > m.scoreB;
  if (side === "A") return wonA ? "win" : "lose";
  return wonA ? "lose" : "win";
}

/** One match cell. Vertical scoreboard, two rows. */
function cellHtml(m, opts = {}) {
  const live = m.status === "live";
  const finished = m.status === "finished";
  const showScore = live || finished;
  const placeholder = !m.teamA || !m.teamB;
  const wA = sideOutcome(m, "A");
  const wB = sideOutcome(m, "B");

  const row = (name, score, outcome) => {
    const cls = ["row"];
    if (outcome === "win") cls.push("win");
    if (outcome === "lose") cls.push("lose");
    if (!name) cls.push("ph");
    const lab = name
      ? `<span class="nm"><span class="f">${flagFor(name)}</span><span class="lab">${esc(name)}</span></span>`
      : `<span class="nm"><span class="lab">${esc(opts.placeholderText || "TBD")}</span></span>`;
    const sc = showScore && score != null ? `<span class="sc">${score}</span>` : `<span class="sc">–</span>`;
    return `<div class="${cls.join(" ")}">${lab}${sc}</div>`;
  };

  const liveMark = live ? `<div class="live-mark">LIVE ${m.minute ? m.minute + "'" : ""}</div>` : "";
  const when = !showScore && m.dateISO ? `<div class="when">${esc(fmtKickoff(m.dateISO))}</div>` : "";

  const cls = ["card"];
  if (live) cls.push("live");
  if (opts.final) cls.push("final");
  if (opts.third) cls.push("third");
  const style = `top:${opts.top}px;left:${opts.left}px`;
  const crown = opts.final ? `<span class="crown">Weltmeister</span>` : "";
  const thirdLbl = opts.third ? `<div class="third-lbl">Spiel um Platz 3</div>` : "";

  return `<div class="${cls.join(" ")}" style="${style}" data-mid="${m.id}">${crown}${thirdLbl}${row(m.teamA, m.scoreA, wA)}${row(m.teamB, m.scoreB, wB)}${liveMark}${when}</div>`;
}

/** Build the SVG connector lines for VF→HF→Final. Ink stroke follows winners. */
function linesSvg(qfPositions, sfPositions, finalPos) {
  // qfPositions / sfPositions: array of {y, winnerSide} per cell.
  // Coordinates correspond to the absolute-positioned card layout below.
  const ink = "#1c1c1c";
  const soft = "#d8d2c6";
  const strokeW = 2.5;

  const path = (d, color, width) => `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`;
  // VF → HF: cards at x=0 (right edge ~158), HF at x=200 (left edge), midline x~180.
  const lines = [];
  for (let i = 0; i < 4; i += 2) {
    const top = qfPositions[i];
    const bot = qfPositions[i + 1];
    if (!top || !bot) continue;
    const sfY = (top.y + bot.y) / 2;
    lines.push(path(`M158 ${top.y} H180 V${sfY} M158 ${bot.y} H180 V${sfY} M180 ${sfY} H200`, soft, strokeW));
    // Ink overlay for whichever VF won, leading into the SF.
    if (top.winnerSide === "win") lines.push(path(`M158 ${top.y} H180 V${sfY} H200`, ink, strokeW + .5));
    if (bot.winnerSide === "win") lines.push(path(`M158 ${bot.y} H180 V${sfY} H200`, ink, strokeW + .5));
  }
  // HF → Final
  if (sfPositions.length === 2 && finalPos) {
    const t = sfPositions[0];
    const b = sfPositions[1];
    const fY = finalPos.y;
    lines.push(path(`M356 ${t.y} H378 V${fY} M356 ${b.y} H378 V${fY} M378 ${fY} H396`, soft, strokeW));
    if (t.winnerSide === "win") lines.push(path(`M356 ${t.y} H378 V${fY} H396`, ink, strokeW + .5));
    if (b.winnerSide === "win") lines.push(path(`M356 ${b.y} H378 V${fY} H396`, ink, strokeW + .5));
  }
  return `<svg class="lines" viewBox="0 0 548 600" width="548" height="600">${lines.join("")}</svg>`;
}

/** Fills 4 QF + 2 SF + 1 Final + 1 ThirdPlace slots, with placeholders. */
function fillSlots(matches) {
  const byStage = new Map();
  for (const m of matches) {
    if (!m.stageId) continue;
    if (!byStage.has(m.stageId)) byStage.set(m.stageId, []);
    byStage.get(m.stageId).push(m);
  }
  const sortKickoff = (a, b) => (a.dateISO || "").localeCompare(b.dateISO || "");
  const qfs = (byStage.get(STAGE_QF) || []).slice().sort(sortKickoff);
  const sfs = (byStage.get(STAGE_SF) || []).slice().sort(sortKickoff);
  const finals = (byStage.get(STAGE_FINAL) || []).slice().sort(sortKickoff);
  const thirds = (byStage.get(STAGE_THIRD) || []).slice().sort(sortKickoff);

  // Pad to fixed slot counts so the tree is always the same shape.
  const blank = (label) => ({ id: "ph-" + label, status: "scheduled", teamA: null, teamB: null, scoreA: null, scoreB: null, dateISO: "", round: label, stageId: "", _placeholder: label });
  while (qfs.length < 4) qfs.push(blank("Viertelfinale"));
  while (sfs.length < 2) sfs.push(blank("Halbfinale"));
  while (finals.length < 1) finals.push(blank("Finale"));
  while (thirds.length < 1) thirds.push(blank("Spiel um Platz 3"));
  return { qfs: qfs.slice(0, 4), sfs: sfs.slice(0, 2), final: finals[0], third: thirds[0] };
}

function renderTree(matches) {
  const { qfs, sfs, final, third } = fillSlots(matches);

  // Vertical positions (centre of each card). Mirror the hi-fi card.
  const qfTops = [80, 220, 360, 500];
  const sfTops = [150, 430];
  const finalTop = 280;
  const thirdTop = 475;
  const cardHalf = 30; // approximate vertical centre offset for line attach

  const qfCells = qfs
    .map((m, i) =>
      cellHtml(m, { top: qfTops[i], left: 0, placeholderText: m._placeholder ? `${m._placeholder} ${i + 1}` : "TBD" }),
    )
    .join("");
  const sfCells = sfs
    .map((m, i) =>
      cellHtml(m, { top: sfTops[i], left: 200, placeholderText: m._placeholder ? `${m._placeholder} ${i + 1}` : "TBD" }),
    )
    .join("");
  const finalCell = cellHtml(final, { top: finalTop, left: 396, final: true, placeholderText: "Finale" });
  const thirdCell = cellHtml(third, { top: thirdTop, left: 396, third: true, placeholderText: "Spiel um Platz 3" });

  const qfPos = qfs.map((m, i) => ({
    y: qfTops[i] + cardHalf,
    winnerSide:
      m.status === "finished" && m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB ? "win" : null,
  }));
  const sfPos = sfs.map((m, i) => ({
    y: sfTops[i] + cardHalf,
    winnerSide:
      m.status === "finished" && m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB ? "win" : null,
  }));
  const finalPos = { y: finalTop + cardHalf };

  const stages = `
    <div class="stage" style="left:0">Viertelfinale</div>
    <div class="stage" style="left:200px">Halbfinale</div>
    <div class="stage" style="left:396px;color:var(--wm-ink)">🏆 Finale</div>`;
  return `
    <div class="wm-kb-hint">Finalrunde — <b>Viertelfinale bis Finale</b>. Sieger fett, dunkle Linie folgt dem Weg ins Finale.<br>Sechzehntel- &amp; Achtelfinale unter Tab «Spiele».</div>
    <div class="wm-kb-scroll"><div class="wm-kb-tree">
      ${stages}
      ${linesSvg(qfPos, sfPos, finalPos)}
      ${qfCells}
      ${sfCells}
      ${finalCell}
      ${thirdCell}
    </div></div>`;
}

function render(state) {
  if (!mounted) return;
  if (state.kind === "loading") {
    mounted.innerHTML = `<div class="wm-kb-hint">Lade Finalrunde…</div>`;
    return;
  }
  if (state.kind === "error") {
    mounted.innerHTML = `<div class="wm-ts-empty"><div class="ic">⚠</div><div class="t">Konnte nicht geladen werden.</div><div class="s">Bitte nochmals versuchen.</div></div>`;
    return;
  }
  mounted.innerHTML = renderTree(state.matches);

  // Auto-scroll the bracket so the Finale column is visible on first paint
  // (548 px tree on a 360-390 px viewport otherwise hides the crown).
  const scroller = mounted.querySelector(".wm-kb-scroll");
  if (scroller && scroller.scrollWidth > scroller.clientWidth) {
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, Math.round((scroller.scrollWidth - scroller.clientWidth) / 2));
    });
  }

  // Tap a cell → deep-link to that match in Spiele (reuses existing helper).
  mounted.querySelectorAll(".card[data-mid]").forEach((card) => {
    const id = card.dataset.mid;
    if (!id || id.startsWith("ph-")) return;
    card.addEventListener("click", () => {
      if (typeof window.jumpToSpieleMatch === "function") window.jumpToSpieleMatch(id);
    });
    card.style.cursor = "pointer";
  });
}

async function load() {
  lastState = { kind: "loading" };
  render(lastState);
  try {
    const res = await fetch(`${API_BASE}/api/wm/matches`, { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const matches = (Array.isArray(data.matches) ? data.matches : []).filter(
      (m) => m.stageId === STAGE_QF || m.stageId === STAGE_SF || m.stageId === STAGE_FINAL || m.stageId === STAGE_THIRD,
    );
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
