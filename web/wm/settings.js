/**
 * settings.js — Mehr ▸ Einstellungen.
 *
 * Two parts:
 *   1. Visitor map — anonymous aggregates from /api/stats (Cloudflare Analytics
 *      Engine). Leaflet world map with one circle per country sized by event
 *      count; top events list; daily timeline.
 *   2. Feedback + meta — replaces the drawer "Feedback senden" footer link.
 *      Shows app version, GitHub link, mailto.
 *
 * Leaflet is loaded on demand from a CDN the first time Settings opens, so the
 * cost is only paid by visitors who actually look.
 */

"use strict";

const STATS_URL = "/api/stats";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

// ISO-3166-1 alpha-2 → { name, lat, lon }. Covers the 48 WM countries + the
// usual visitor origins for Filipe's friends/family.
const COUNTRY = {
  AR: { name: "Argentinien", lat: -38.4, lon: -63.6 },
  AT: { name: "Österreich", lat: 47.5, lon: 14.6 },
  AU: { name: "Australien", lat: -25.3, lon: 133.8 },
  BA: { name: "Bosnien-Herzegowina", lat: 43.9, lon: 17.7 },
  BE: { name: "Belgien", lat: 50.5, lon: 4.5 },
  BR: { name: "Brasilien", lat: -14.2, lon: -51.9 },
  CA: { name: "Kanada", lat: 56.1, lon: -106.3 },
  CH: { name: "Schweiz", lat: 46.8, lon: 8.2 },
  CI: { name: "Elfenbeinküste", lat: 7.5, lon: -5.5 },
  CL: { name: "Chile", lat: -35.7, lon: -71.5 },
  CN: { name: "China", lat: 35.9, lon: 104.2 },
  CO: { name: "Kolumbien", lat: 4.6, lon: -74.3 },
  CR: { name: "Costa Rica", lat: 9.7, lon: -83.8 },
  CW: { name: "Curaçao", lat: 12.2, lon: -68.9 },
  CZ: { name: "Tschechien", lat: 49.8, lon: 15.5 },
  DE: { name: "Deutschland", lat: 51.2, lon: 10.4 },
  DK: { name: "Dänemark", lat: 56.3, lon: 9.5 },
  DZ: { name: "Algerien", lat: 28.0, lon: 1.7 },
  EC: { name: "Ecuador", lat: -1.8, lon: -78.2 },
  EG: { name: "Ägypten", lat: 26.8, lon: 30.8 },
  ES: { name: "Spanien", lat: 40.5, lon: -3.7 },
  FR: { name: "Frankreich", lat: 46.6, lon: 1.9 },
  GB: { name: "Grossbritannien", lat: 55.4, lon: -3.4 },
  GH: { name: "Ghana", lat: 7.9, lon: -1.0 },
  HR: { name: "Kroatien", lat: 45.1, lon: 15.2 },
  IE: { name: "Irland", lat: 53.4, lon: -8.2 },
  IN: { name: "Indien", lat: 20.6, lon: 78.9 },
  IR: { name: "Iran", lat: 32.4, lon: 53.7 },
  IQ: { name: "Irak", lat: 33.2, lon: 43.7 },
  IT: { name: "Italien", lat: 41.9, lon: 12.6 },
  JM: { name: "Jamaika", lat: 18.1, lon: -77.3 },
  JP: { name: "Japan", lat: 36.2, lon: 138.3 },
  JO: { name: "Jordanien", lat: 30.6, lon: 36.2 },
  KR: { name: "Republik Korea", lat: 35.9, lon: 127.8 },
  MA: { name: "Marokko", lat: 31.8, lon: -7.1 },
  MX: { name: "Mexiko", lat: 23.6, lon: -102.6 },
  NG: { name: "Nigeria", lat: 9.1, lon: 8.7 },
  NL: { name: "Niederlande", lat: 52.1, lon: 5.3 },
  NO: { name: "Norwegen", lat: 60.5, lon: 8.5 },
  NZ: { name: "Neuseeland", lat: -40.9, lon: 174.9 },
  PA: { name: "Panama", lat: 8.5, lon: -80.8 },
  PE: { name: "Peru", lat: -9.2, lon: -75.0 },
  PL: { name: "Polen", lat: 51.9, lon: 19.1 },
  PT: { name: "Portugal", lat: 39.4, lon: -8.2 },
  QA: { name: "Katar", lat: 25.4, lon: 51.2 },
  RS: { name: "Serbien", lat: 44.0, lon: 21.0 },
  RU: { name: "Russland", lat: 61.5, lon: 105.3 },
  SA: { name: "Saudi-Arabien", lat: 23.9, lon: 45.1 },
  SE: { name: "Schweden", lat: 60.1, lon: 18.6 },
  SN: { name: "Senegal", lat: 14.5, lon: -14.5 },
  TH: { name: "Thailand", lat: 15.9, lon: 100.9 },
  TN: { name: "Tunesien", lat: 33.9, lon: 9.5 },
  TR: { name: "Türkei", lat: 38.9, lon: 35.2 },
  UA: { name: "Ukraine", lat: 48.4, lon: 31.2 },
  UY: { name: "Uruguay", lat: -32.5, lon: -55.8 },
  US: { name: "USA", lat: 37.1, lon: -95.7 },
  UZ: { name: "Usbekistan", lat: 41.4, lon: 64.6 },
  VE: { name: "Venezuela", lat: 6.4, lon: -66.6 },
  ZA: { name: "Südafrika", lat: -30.6, lon: 22.9 },
};

const EVENT_LABEL = {
  page_load: "Seite geladen",
  tab_switch: "Tab gewechselt",
  clip_play_start: "Clip gestartet",
  clip_play_stop: "Clip beendet",
  mehr_sub_open: "Mehr-Ansicht geöffnet",
  spielerkarte_open: "Spielerkarte geöffnet",
  drawer_open: "Spielmenü geöffnet",
  spielinfo_open: "Spielinfo geöffnet",
  highlights_link_open: "Highlights-Link geöffnet",
};

let mounted = null;
let leafletLoaded = null;
let map = null;
let markersLayer = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoaded) return leafletLoaded;
  leafletLoaded = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error("leaflet load failed"));
    document.head.appendChild(s);
  });
  return leafletLoaded;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderShell(container) {
  container.innerHTML = `
    <div class="wm-sett">
      <div class="wm-sett-totals" id="wmSettTotals">
        <div class="wm-sett-cell"><div class="lbl">Ereignisse</div><div class="val">–</div></div>
        <div class="wm-sett-cell"><div class="lbl">Sitzungen</div><div class="val">–</div></div>
        <div class="wm-sett-cell"><div class="lbl">Länder</div><div class="val">–</div></div>
      </div>

      <h3 class="wm-sett-sec">Besucherkarte (30 Tage)</h3>
      <div id="wmSettMap" class="wm-sett-map"></div>

      <h3 class="wm-sett-sec">Top-Länder</h3>
      <div id="wmSettCountries" class="wm-sett-list"></div>

      <h3 class="wm-sett-sec">Aktivitäten</h3>
      <div id="wmSettEvents" class="wm-sett-list"></div>

      <h3 class="wm-sett-sec">App auf Startbildschirm</h3>
      <div class="wm-sett-install" id="wmSettInstall">
        <div class="wm-sett-install-row">
          <span class="wm-sett-install-status" id="wmSettInstallStatus">…</span>
          <button id="wmSettInstallBtn" class="wm-sett-install-btn" type="button">Anleitung anzeigen</button>
        </div>
        <p class="wm-sett-install-note">Auf iPhone: Browser-Menü ⬆ → «Zum Home-Bildschirm». Auf Android: Browser-Menü → «App installieren».</p>
      </div>

      <h3 class="wm-sett-sec">Über</h3>
      <div class="wm-sett-meta">
        <a href="feedback.html" class="wm-sett-link">✉ Feedback senden</a>
        <a href="https://github.com/Wilhofstrasse/world-cup-viewer" class="wm-sett-link" target="_blank" rel="noopener">↗ Quellcode auf GitHub</a>
        <div class="wm-sett-version">App-Version <span id="wmSettVer">…</span></div>
      </div>
    </div>`;
  wireInstallRow();
}

function wireInstallRow() {
  const statusEl = document.getElementById("wmSettInstallStatus");
  const btn = document.getElementById("wmSettInstallBtn");
  if (!statusEl || !btn) return;
  const status = typeof window.wmInstallStatus === "function" ? window.wmInstallStatus() : "unsupported";
  const labels = {
    installed: { text: "✓ App ist installiert", btn: null },
    installable: { text: "Installation verfügbar", btn: "Jetzt installieren" },
    "ios-instructions": { text: "iPhone-Anleitung verfügbar", btn: "Anleitung anzeigen" },
    unsupported: { text: "Im Browser ohne Installations-Schnittstelle geöffnet", btn: "Anleitung anzeigen" },
  };
  const label = labels[status] || labels.unsupported;
  statusEl.textContent = label.text;
  if (!label.btn) {
    btn.hidden = true;
    return;
  }
  btn.textContent = label.btn;
  btn.addEventListener("click", () => {
    if (typeof window.wmShowInstallPrompt === "function") window.wmShowInstallPrompt();
  });
}

function renderTotals(t) {
  const el = document.getElementById("wmSettTotals");
  if (!el) return;
  const cells = el.querySelectorAll(".wm-sett-cell .val");
  cells[0].textContent = t.events || 0;
  cells[1].textContent = t.sessions || 0;
}

function renderCountryList(rows) {
  const list = document.getElementById("wmSettCountries");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="wm-sett-empty">Noch keine Daten — sobald jemand die App öffnet, taucht der Eintrag hier auf.</div>`;
    return;
  }
  list.innerHTML = rows
    .slice(0, 12)
    .map((r) => {
      const code = String(r.country || "").toUpperCase();
      const info = COUNTRY[code];
      const label = info ? info.name : code || "—";
      return `<div class="wm-sett-row"><span class="t">${esc(label)}</span><span class="n">${r.n || 0}</span></div>`;
    })
    .join("");
}

function renderEventList(rows) {
  const list = document.getElementById("wmSettEvents");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="wm-sett-empty">Noch keine Aktivitäten.</div>`;
    return;
  }
  list.innerHTML = rows
    .map((r) => {
      const label = EVENT_LABEL[r.event] || r.event || "—";
      return `<div class="wm-sett-row"><span class="t">${esc(label)}</span><span class="n">${r.n || 0}</span></div>`;
    })
    .join("");
}

async function renderMap(byCountry) {
  const el = document.getElementById("wmSettMap");
  if (!el) return;
  try {
    const L = await loadLeaflet();
    if (!map) {
      map = L.map(el, { zoomControl: true, attributionControl: false }).setView([30, 10], 1);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 6,
        minZoom: 1,
      }).addTo(map);
    }
    if (markersLayer) markersLayer.remove();
    markersLayer = L.layerGroup().addTo(map);
    const maxCount = byCountry.reduce((m, r) => Math.max(m, r.n || 0), 1);
    let countries = 0;
    for (const r of byCountry) {
      const code = String(r.country || "").toUpperCase();
      const info = COUNTRY[code];
      if (!info) continue;
      const n = r.n || 0;
      if (!n) continue;
      countries++;
      const radius = 6 + Math.round((n / maxCount) * 20);
      const marker = L.circleMarker([info.lat, info.lon], {
        radius,
        color: "#c73b21",
        fillColor: "#c73b21",
        fillOpacity: 0.55,
        weight: 2,
      });
      marker.bindTooltip(`${info.name}: ${n}`, { direction: "top" });
      marker.addTo(markersLayer);
    }
    const totalsCells = document.querySelectorAll("#wmSettTotals .wm-sett-cell .val");
    if (totalsCells[2]) totalsCells[2].textContent = countries;
  } catch (_e) {
    el.innerHTML = `<div class="wm-sett-empty">Karte konnte nicht geladen werden.</div>`;
  }
}

async function load() {
  try {
    const res = await fetch(STATS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("stats " + res.status);
    const data = await res.json();
    renderTotals(data.totals || {});
    renderCountryList(data.byCountry || []);
    renderEventList(data.byEvent || []);
    renderMap(data.byCountry || []);
  } catch (_e) {
    // Stats endpoint may be unconfigured (no CF_AE_TOKEN yet) — show shell only.
    renderCountryList([]);
    renderEventList([]);
    renderMap([]);
  }
}

function showVersion() {
  fetch("/api/version", { cache: "no-store" })
    .then((r) => r.json())
    .then((d) => {
      const el = document.getElementById("wmSettVer");
      if (el) el.textContent = "v" + (d.version || "?");
    })
    .catch(() => {});
}

export function initSettings(container) {
  mounted = container;
  renderShell(container);
  showVersion();
  load();
}

export function destroySettings() {
  mounted = null;
  if (map) {
    try {
      map.remove();
    } catch (_e) {}
    map = null;
    markersLayer = null;
  }
}
