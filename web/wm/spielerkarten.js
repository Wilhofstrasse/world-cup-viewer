/**
 * spielerkarten.js — WM player card overlay.
 *
 * Opens on top of whichever Mehr sub-view is active (Torjäger row, Kader row).
 * Fetches FIFA's keyless /players/{idPlayer} client-side; renders hero + 4-cell
 * stat strip + bio + WM 2026 mini-bilanz. Close button stashes the overlay.
 *
 * Entry point: window.openSpielerkarte(idPlayer). app.js publishes this so any
 * sub-view module can call it without importing.
 */

"use strict";

import { flagFor, flagFromIso3, nameFromIso3 } from "./parse.js";
import { track } from "./track.js";

const FIFA_PLAYER_URL = (id) => `https://api.fifa.com/api/v3/players/${encodeURIComponent(id)}?language=de-DE`;
const FIFA_SEASON = "285023";
const FIFA_COMP = "17";
const TOPSCORERS_URL = "/api/wm/topscorers";
const SQUADS_URL = "/api/wm/squads";

let squadIndex = null; // idPlayer → { photoUrl, name, jerseyNum, teamName, idCountry }

let overlay = null; // singleton DOM node

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "wmPlayerOverlay";
  overlay.className = "wm-pk-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="wm-pk-sheet" role="dialog" aria-modal="true"><button class="wm-pk-close" id="wmPkClose" type="button" aria-label="Schliessen">✕</button><div class="wm-pk-body" id="wmPkBody"></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  overlay.querySelector("#wmPkClose")?.addEventListener("click", close);
  return overlay;
}

function close() {
  if (!overlay) return;
  overlay.hidden = true;
  // .wm-pk-overlay sets display:flex with higher specificity than the UA
  // [hidden] rule, so the element keeps intercepting pointer events even
  // after `hidden = true`. Force display:none here and clear it on open().
  overlay.style.display = "none";
  document.body.classList.remove("wm-pk-open");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loc(arr) {
  return (Array.isArray(arr) && arr[0] && arr[0].Description) || "";
}

function ageFrom(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(+d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function footLabel(code) {
  if (code === 1 || code === "Left" || code === "Links") return "Links";
  if (code === 2 || code === "Right" || code === "Rechts") return "Rechts";
  if (code === 3) return "Beidfüssig";
  return null;
}

function initial(name) {
  const t = (name || "").trim();
  if (!t) return "·";
  const tokens = t.split(/\s+/);
  return (tokens[tokens.length - 1] || tokens[0])[0].toUpperCase() + ".";
}

async function fetchPlayer(idPlayer) {
  const res = await fetch(FIFA_PLAYER_URL(idPlayer), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("status " + res.status);
  return await res.json();
}

/** Load + cache the squads blob as an idPlayer → enrichment lookup. */
async function ensureSquadIndex() {
  if (squadIndex) return squadIndex;
  try {
    const res = await fetch(SQUADS_URL, { cache: "no-store" });
    if (!res.ok) { squadIndex = new Map(); return squadIndex; }
    const data = await res.json();
    const out = new Map();
    for (const team of data.squads || []) {
      for (const p of team.players || []) {
        if (p.idPlayer) out.set(String(p.idPlayer), { photoUrl: p.photoUrl, jerseyNum: p.jerseyNum, teamName: team.teamName, idCountry: p.idCountry });
      }
    }
    squadIndex = out;
  } catch (_e) {
    squadIndex = new Map();
  }
  return squadIndex;
}

/** Try to enrich with WM 2026 statistics from the locally-served topscorers blob. */
async function fetchWmStats(name) {
  try {
    const res = await fetch(TOPSCORERS_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const row = (data.scorers || []).find(
      (s) => (s.player || "").toLowerCase() === (name || "").toLowerCase(),
    );
    return row || null;
  } catch (_e) {
    return null;
  }
}

function render(player, wmStats, squadEntry) {
  const name = loc(player.Name) || loc(player.PlayerName) || "?";
  const countryCode = player.IdCountry || squadEntry?.idCountry || "";
  const countryName = nameFromIso3(countryCode) || countryCode || "";
  const birth = player.BirthDate || "";
  const age = ageFrom(birth);
  const height = player.Height ?? null;
  const caps = player.InternationalCaps ?? player.Caps ?? null;
  const goals = player.Goals ?? null;
  const birthPlace = player.BirthPlace || player.BirthCity || "";
  const foot = footLabel(player.PreferredFoot);
  const positionLabel = loc(player.PositionLocalized) || "";
  const shirt = player.JerseyNum ?? player.ShirtNumber ?? squadEntry?.jerseyNum ?? null;
  const photo =
    (player.PlayerPicture && player.PlayerPicture.PictureUrl) ||
    player.PictureUrl ||
    squadEntry?.photoUrl ||
    null;

  const heroPhoto = photo
    ? `<div class="wm-pk-photo" data-zoomable data-src="${esc(photo)}" role="button" aria-label="Foto vergrössern" style="background-image:url('${esc(photo)}')"></div>`
    : `<div class="wm-pk-photo">${esc(initial(name))}</div>`;

  const stripCell = (lbl, val, sub) => `
    <div class="wm-pk-cell"><div class="lbl">${lbl}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const strip = `
    <div class="wm-pk-strip">
      ${stripCell("Grösse", height != null ? height : "–", height != null ? "cm" : "")}
      ${stripCell("Alter", age != null ? age : "–", birth ? esc(fmtDate(birth)) : "")}
      ${stripCell("Caps", caps != null ? caps : "–", "")}
      ${stripCell("Tore", goals != null ? goals : "–", "")}
    </div>`;

  const bio = `
    <div class="wm-pk-kv">
      ${birthPlace ? `<div class="row"><span class="k">Geburtsort</span><span class="v">${esc(birthPlace)}</span></div>` : ""}
      ${foot ? `<div class="row"><span class="k">Starker Fuss</span><span class="v"><span class="chip">${foot}</span></span></div>` : ""}
    </div>`;

  const wmBlock = wmStats
    ? `
      <div class="wm-pk-sec-lbl">WM 2026 — Bilanz</div>
      <div class="wm-pk-wm">
        <div class="g"><div class="v">${wmStats.goals}</div><div class="l">Tore</div></div>
        <div class="g"><div class="v">${wmStats.assists}</div><div class="l">Vorlagen</div></div>
        <div class="g"><div class="v">${wmStats.matches}</div><div class="l">Spiele</div></div>
        <div class="g"><div class="v">${wmStats.rank}</div><div class="l">Rang</div></div>
      </div>`
    : "";

  const flagEmoji = flagFromIso3(countryCode) || flagFor(countryName) || "⚽";
  return `
    <div class="wm-pk-hero">
      ${heroPhoto}
      <div class="wm-pk-name">${esc(name)}</div>
      <div class="wm-pk-nat"><span class="f">${flagEmoji}</span>${esc(countryName || countryCode)}</div>
      ${shirt != null || positionLabel ? `<div class="wm-pk-shirt-pos">${shirt != null ? "#" + shirt : ""}${shirt != null && positionLabel ? " · " : ""}${esc(positionLabel)}</div>` : ""}
    </div>
    ${strip}
    ${bio}
    ${wmBlock}`;
}

function openLightbox(src) {
  let lb = document.getElementById("wmPkLightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "wmPkLightbox";
    lb.className = "wm-pk-lightbox";
    lb.innerHTML = `<button class="wm-pk-lightbox-close" aria-label="Schliessen">✕</button><img alt="" />`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (ev) => {
      if (ev.target === lb || ev.target.classList.contains("wm-pk-lightbox-close") || ev.target.tagName === "IMG" && ev.target !== ev.currentTarget && false) {
        lb.remove();
      }
    });
    // Plain click anywhere on the backdrop or the close button → close.
    lb.addEventListener("click", () => lb.remove(), { capture: false });
  }
  lb.querySelector("img").src = src;
}

async function open(idPlayer) {
  ensureOverlay();
  const body = overlay.querySelector("#wmPkBody");
  body.innerHTML = `<div class="wm-pk-loading">Lade Spielerkarte…</div>`;
  overlay.hidden = false;
  overlay.style.display = ""; // clear the close()-injected display:none
  document.body.classList.add("wm-pk-open");
  try {
    const [player, idx] = await Promise.all([fetchPlayer(idPlayer), ensureSquadIndex()]);
    const squadEntry = idx.get(String(idPlayer)) || null;
    const name = loc(player.Name) || loc(player.PlayerName) || "";
    const wm = name ? await fetchWmStats(name) : null;
    body.innerHTML = render(player, wm, squadEntry);
    // Wire photo tap → lightbox.
    body.querySelectorAll(".wm-pk-photo[data-zoomable]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const src = el.dataset.src;
        if (src) openLightbox(src);
      });
    });
  } catch (_e) {
    body.innerHTML = `<div class="wm-pk-loading">Spielerkarte konnte nicht geladen werden.</div>`;
  }
}

export function openSpielerkarte(idPlayer) {
  if (idPlayer == null) return;
  track("spielerkarte_open", { target: String(idPlayer) });
  open(String(idPlayer));
}

export function destroySpielerkarte() {
  close();
}
