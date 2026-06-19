/**
 * kader.js — WM Mehr ▸ Kader.
 *
 * Two views in one module:
 *   - Landing: all 48 teams as a flat alphabetical list with a search box.
 *   - Detail: a single team's roster, grouped by position (Tor / Abwehr /
 *     Mittelfeld / Angriff). Tap a row → opens Spielerkarten for that player.
 *
 * Data: GET /api/wm/squads (FIFA's keyless squad endpoint, ingested with a
 * 6 h freshness clock — squads change rarely).
 */

"use strict";

import { flagFor } from "./parse.js";

const API_BASE = window.WM_API_BASE || "";

const POSITION_LABEL = ["Tor", "Abwehr", "Mittelfeld", "Angriff"];

let mounted = null;
let squads = []; // last fetched list
let detailIdTeam = null; // null = landing; otherwise a team id
let searchTerm = "";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtBirthdate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function landingHtml() {
  const list = (searchTerm
    ? squads.filter((s) => s.teamName.toLowerCase().includes(searchTerm))
    : squads
  ).slice();
  if (!list.length) {
    return `
      <div class="wm-kad-search"><span>🔎</span><input id="wmKadSearch" placeholder="Team suchen…" value="${esc(searchTerm)}" autocomplete="off" /></div>
      <div class="wm-ts-empty"><div class="ic">👥</div><div class="t">Kein Team gefunden.</div></div>`;
  }
  const rows = list
    .map(
      (s) =>
        `<button class="wm-kad-team-row" data-id="${esc(s.idTeam)}" type="button"><span class="f">${flagFor(s.teamName)}</span><span class="t">${esc(s.teamName)}</span><span class="ct">${s.players.length}</span><span class="chev">▸</span></button>`,
    )
    .join("");
  return `
    <div class="wm-kad-search"><span>🔎</span><input id="wmKadSearch" placeholder="Team suchen…" value="${esc(searchTerm)}" autocomplete="off" /></div>
    <div class="wm-kad-list">${rows}</div>`;
}

function detailHtml(idTeam) {
  const sq = squads.find((s) => s.idTeam === idTeam);
  if (!sq) return `<div class="wm-ts-empty"><div class="ic">⚠</div><div class="t">Team nicht gefunden.</div></div>`;
  const buckets = [[], [], [], []];
  for (const p of sq.players) {
    const i = Math.max(0, Math.min(3, p.position || 0));
    buckets[i].push(p);
  }
  const sections = buckets
    .map((arr, i) => {
      if (!arr.length) return "";
      const rows = arr
        .map(
          (p) =>
            `<button class="wm-kad-player" data-id="${esc(p.idPlayer)}" type="button"><span class="n">${p.jerseyNum ?? "–"}</span><span class="nm">${esc(p.name)}</span><span class="bd">${esc(fmtBirthdate(p.birthDate))}</span></button>`,
        )
        .join("");
      return `<h4 class="wm-kad-pos-lbl">${POSITION_LABEL[i]}</h4><div class="wm-kad-roster">${rows}</div>`;
    })
    .join("");
  return `
    <button class="wm-kad-back" id="wmKadBack" type="button">‹ Zurück zur Übersicht</button>
    <div class="wm-kad-hero"><span class="flag">${flagFor(sq.teamName)}</span><div class="who"><div class="tn">${esc(sq.teamName)}</div><div class="meta">${sq.players.length} Spieler</div></div></div>
    ${sections || `<div class="wm-ts-empty"><div class="ic">👥</div><div class="t">Keine Spieler in diesem Kader.</div></div>`}`;
}

function render() {
  if (!mounted) return;
  mounted.innerHTML = detailIdTeam ? detailHtml(detailIdTeam) : landingHtml();

  // Wire landing
  const search = mounted.querySelector("#wmKadSearch");
  if (search) {
    search.addEventListener("input", (ev) => {
      searchTerm = (ev.target.value || "").toLowerCase().trim();
      render();
    });
  }
  mounted.querySelectorAll(".wm-kad-team-row").forEach((b) =>
    b.addEventListener("click", () => {
      detailIdTeam = b.dataset.id;
      render();
    }),
  );

  // Wire detail
  mounted.querySelector("#wmKadBack")?.addEventListener("click", () => {
    detailIdTeam = null;
    render();
  });
  mounted.querySelectorAll(".wm-kad-player").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      if (id && typeof window.openSpielerkarte === "function") window.openSpielerkarte(id);
    }),
  );
}

async function load() {
  if (!mounted) return;
  mounted.innerHTML = `<div class="wm-ts-empty"><div class="ic">…</div><div class="t">Kader werden geladen…</div></div>`;
  try {
    const res = await fetch(`${API_BASE}/api/wm/squads`, { cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    squads = Array.isArray(data.squads) ? data.squads : [];
    if (!squads.length) {
      mounted.innerHTML = `
        <div class="wm-ts-empty"><div class="ic">👥</div><div class="t">Kader noch nicht verfügbar</div><div class="s">Wird vor dem ersten Spiel veröffentlicht.</div></div>`;
      return;
    }
  } catch (_e) {
    mounted.innerHTML = `<div class="wm-ts-empty"><div class="ic">⚠</div><div class="t">Konnte nicht geladen werden.</div></div>`;
    return;
  }
  render();
}

export function initKader(container) {
  mounted = container;
  detailIdTeam = null;
  searchTerm = "";
  load();
}

export function destroyKader() {
  mounted = null;
  squads = [];
  detailIdTeam = null;
  searchTerm = "";
}
