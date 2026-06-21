/**
 * feed.js — the WM "Highlights" vertical swipe feed (Reels-style).
 *
 * Lists SRF WM clips from the keyless Integration Layer, renders one
 * full-screen card per clip (flags + title + thumbnail), and plays the clip
 * inline on tap via native HLS (iOS Safari) or a lazily-loaded vendored hls.js.
 *
 * No video is ever cached; only the clip index + thumbnails (handled by the
 * service worker). No external links, no comments — locked to WM clips.
 */

"use strict";

import { fetchClips, fetchHls } from "./il.js";
import { parseMatchTitle, classifyClip, flagFor } from "./parse.js";
import { findMatchByTeams, findClipByTeams, getAllMatches, setClips, subscribe, prefetchMatches } from "./linkstore.js";
import { track } from "./track.js";

const CACHE_KEY = "wm.clips.v1";
const KIND_LABEL = { match: "Spielzusammenfassung", summary: "Zusammenfassung", goal: "Szene", feature: "Magazin" };

let clips = [];
let hlsLoading = null;
let clipsLoading = false; // true while fetchClips paginates → drawer shows a "loading more" hint

/** Format seconds as "M:SS". */
function fmtDuration(sec) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "vor 2 Std." / "Heute" style German relative day. */
function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return "Heute";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Decorate a raw clip with derived presentation fields. */
function decorate(clip) {
  const match = parseMatchTitle(clip.title);
  const kind = classifyClip({ title: clip.title, durationSec: clip.durationSec });
  return { ...clip, match, kind };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Big inline score line — shown between the teams line and the title. */
function scoreLineMarkup(clip) {
  if (!clip.match) return "";
  const m = findMatchByTeams(clip.match.teamA, clip.match.teamB);
  if (!m) return "";
  if (m.status === "live") {
    const minute = m.minute ? `${m.minute}'` : "";
    return `<div class="wm-score is-live"><span class="wm-score-val">${m.scoreA ?? 0} – ${m.scoreB ?? 0}</span><span class="wm-score-live">● LIVE ${minute}</span></div>`;
  }
  if (m.status === "finished" && m.scoreA != null && m.scoreB != null) {
    return `<div class="wm-score"><span class="wm-score-val">${m.scoreA} – ${m.scoreB}</span><span class="wm-score-tag">Endstand</span></div>`;
  }
  return "";
}

/** Backlink chip — opens Spiele on this match. */
function infoChipMarkup(clip) {
  if (!clip.match) return "";
  const m = findMatchByTeams(clip.match.teamA, clip.match.teamB);
  if (!m) return "";
  return `<button class="wm-info-chip" type="button" data-mid="${m.id}">→ Spielinfo</button>`;
}

function slideMarkup(clip, i) {
  const flags = clip.match
    ? `<span class="wm-flags">${flagFor(clip.match.teamA)} ${flagFor(clip.match.teamB)}</span>`
    : `<span class="wm-flags">🎬</span>`;
  const teams = clip.match
    ? `<span class="wm-teams">${esc(clip.match.teamA)} <span class="wm-vs">–</span> ${esc(clip.match.teamB)}</span>`
    : "";
  const thumb = clip.thumbnailUrl ? ` style="background-image:url('${encodeURI(clip.thumbnailUrl)}')"` : "";
  return `
    <section class="wm-slide" data-i="${i}" aria-roledescription="Clip">
      <div class="wm-thumb"${thumb} aria-hidden="true"></div>
      <div class="wm-scrim" aria-hidden="true"></div>
      <button class="wm-playbtn" type="button" aria-label="Abspielen">▶</button>
      <div class="wm-meta">
        ${flags}
        ${teams}
        ${scoreLineMarkup(clip)}
        <h2 class="wm-title">${esc(clip.title)}</h2>
        <div class="wm-sub">
          <span class="wm-kind">${KIND_LABEL[clip.kind] || ""}</span>
          <span class="wm-dot">·</span>
          <span>${fmtWhen(clip.dateISO)}</span>
          ${clip.durationSec ? `<span class="wm-dot">·</span><span>${fmtDuration(clip.durationSec)}</span>` : ""}
        </div>
        ${infoChipMarkup(clip)}
      </div>
    </section>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function render() {
  const feed = document.getElementById("wmFeed");
  // Only the one ~6-min match summary per game ("Die Live-Highlights bei
  // A - B") — drop goal clips, editorial recaps and magazine pieces.
  const visible = clips.filter((c) => c.kind === "match");
  buildDrawer(visible);
  // Publish to the link store so Spiele can backlink ("▶ Highlights" on a card).
  setClips(
    visible
      .map((c, i) => (c.match ? { urn: c.urn, teamA: c.match.teamA, teamB: c.match.teamB, dateISO: c.dateISO, index: i } : null))
      .filter(Boolean),
  );
  if (!visible.length) {
    feed.innerHTML = `<section class="wm-slide wm-empty"><p>Noch keine Clips.<br>Schau später nochmal vorbei.</p></section>`;
    return;
  }
  feed.innerHTML = visible.map(slideMarkup).join("");
  // Map data-i back to the filtered list for playback.
  feed.querySelectorAll(".wm-slide").forEach((el, idx) => {
    el.dataset.i = String(idx);
    el._clip = visible[idx];
    el.querySelector(".wm-playbtn")?.addEventListener("click", () => playSlide(el));
    el.querySelector(".wm-thumb")?.addEventListener("click", () => playSlide(el));
    el.querySelector(".wm-info-chip")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const mid = ev.currentTarget.dataset.mid;
      if (mid && typeof window.jumpToSpieleMatch === "function") window.jumpToSpieleMatch(mid);
    });
  });
  observePauses(feed);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

// Landscape-driven fullscreen. Portrait stays inline (playsInline); rotating to
// landscape promotes the playing clip to fullscreen, rotating back exits.
// iOS Safari only honours the video-specific webkitEnterFullscreen(), and only
// once metadata has loaded — the generic Element.requestFullscreen() is a no-op
// on iPhone. Android/desktop use the standard path as a fallback.
const landscapeMq = window.matchMedia("(orientation: landscape)");
// Auto-fullscreen on rotation only makes sense on touch devices (phone in
// hand → rotate to watch). On a desktop browser the window is permanently
// landscape, so auto-fullscreen fires immediately and hides our custom marker
// rail overlay. Restrict to touch surfaces; desktop users tap the video to go
// fullscreen explicitly.
const isTouchSurface = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;

function enterFullscreen(video) {
  try {
    if (typeof video.webkitEnterFullscreen === "function") {
      // iOS: only valid once metadata is ready (readyState ≥ HAVE_METADATA).
      if (video.readyState >= 1) video.webkitEnterFullscreen();
    } else if (typeof video.requestFullscreen === "function") {
      video.requestFullscreen().catch(() => {/* user-gesture/permission — ignore */});
    }
  } catch (_e) {/* fullscreen rejected — stay inline */}
}

function exitFullscreen(video) {
  try {
    if (typeof video.webkitExitFullscreen === "function" && video.webkitDisplayingFullscreen) {
      video.webkitExitFullscreen();
    } else if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      document.exitFullscreen().catch(() => {});
    }
  } catch (_e) {/* ignore */}
}

/** Load the vendored hls.js once, on demand. Resolves to window.Hls or null. */
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLoading) return hlsLoading;
  hlsLoading = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "vendor/hls.light.min.js";
    s.onload = () => resolve(window.Hls || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return hlsLoading;
}

async function fetchMarkers(urn) {
  try {
    const r = await fetch(`/api/wm/markers/${encodeURIComponent(urn)}`, { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.markers) ? d.markers : [];
  } catch (_e) {
    return [];
  }
}

function renderMarkers(slideEl, markers, durationSec) {
  let rail = slideEl.querySelector(".wm-marker-rail");
  if (!rail) {
    rail = document.createElement("div");
    rail.className = "wm-marker-rail";
    slideEl.appendChild(rail);
  }
  rail.innerHTML = "";
  const total = durationSec || slideEl._clip?.durationSec || 0;
  if (!total || !markers.length) {
    rail.hidden = true;
    return;
  }
  rail.hidden = false;
  for (const m of markers) {
    const pct = Math.max(0, Math.min(1, (m.tSec || 0) / total));
    const dot = document.createElement("button");
    dot.className = "wm-marker-dot";
    dot.type = "button";
    dot.style.left = `${(pct * 100).toFixed(2)}%`;
    dot.title = m.label || "Tor";
    dot.setAttribute("aria-label", "Springe zu " + (m.label || "Tor"));
    dot.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const v = slideEl.querySelector(".wm-video");
      if (v) {
        try {
          v.currentTime = m.tSec;
          v.play().catch(() => {});
        } catch (_e) {}
      }
    });
    rail.appendChild(dot);
  }
}

async function playSlide(slideEl) {
  const clip = slideEl._clip;
  if (!clip || slideEl.classList.contains("playing")) return;
  slideEl.classList.add("loading");
  slideEl._playStartMs = Date.now();
  track("clip_play_start", { target: clip.urn });
  fetchMarkers(clip.urn).then((markers) => {
    if (slideEl.classList.contains("playing") || slideEl.classList.contains("loading")) {
      renderMarkers(slideEl, markers, clip.durationSec);
    }
  });

  let src;
  try {
    src = (await fetchHls(clip.urn)).url;
  } catch (e) {
    slideEl.classList.remove("loading");
    slideEl.classList.add("wm-error");
    return;
  }

  // Tear down any other playing video first (one at a time).
  document.querySelectorAll(".wm-slide.playing").forEach(stopSlide);

  const video = document.createElement("video");
  video.className = "wm-video";
  video.playsInline = true;
  video.controls = true;
  video.autoplay = true;
  video.preload = "none";

  const native = video.canPlayType("application/vnd.apple.mpegurl");
  if (native) {
    video.src = src;
  } else {
    const Hls = await loadHls();
    if (Hls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      video._hls = hls;
    } else {
      video.src = src; // last-ditch
    }
  }

  slideEl.classList.remove("loading");
  slideEl.classList.add("playing");
  slideEl.appendChild(video);
  video.play().catch(() => {/* gesture already happened; ignore */});

  // Landscape → fullscreen, portrait → inline. The orientation-change attempt is
  // best-effort (iOS may reject fullscreen outside a user gesture); a TAP on the
  // video in landscape is the reliable path. Every handler is stored on the video
  // and removed in stopSlide, and guarded by ready() so nothing fires on a
  // torn-down/scrolled-away clip (Codex P2).
  const ready = () => video.isConnected && slideEl.classList.contains("playing") && landscapeMq.matches;
  const tryEnter = () => {
    if (!ready()) return;
    if (video.readyState >= 1) {
      enterFullscreen(video);
    } else if (!video._metaHandler) {
      video._metaHandler = () => { video._metaHandler = null; if (ready()) enterFullscreen(video); };
      video.addEventListener("loadedmetadata", video._metaHandler, { once: true });
    }
  };
  const onOrientation = () => { if (isTouchSurface && landscapeMq.matches) tryEnter(); else exitFullscreen(video); };
  const onTap = () => { if (landscapeMq.matches) enterFullscreen(video); }; // user gesture → reliable on iOS + desktop
  video._onOrientation = onOrientation;
  video._onTap = onTap;
  video.addEventListener("click", onTap);
  if (typeof landscapeMq.addEventListener === "function") landscapeMq.addEventListener("change", onOrientation);
  else if (typeof landscapeMq.addListener === "function") landscapeMq.addListener(onOrientation);
  if (isTouchSurface && landscapeMq.matches) onOrientation(); // touch-only auto-promote
}

function stopSlide(slideEl) {
  const video = slideEl.querySelector(".wm-video");
  if (slideEl._playStartMs) {
    const durationMs = Date.now() - slideEl._playStartMs;
    slideEl._playStartMs = 0;
    const clip = slideEl._clip;
    if (clip && durationMs > 500) track("clip_play_stop", { target: clip.urn, durationMs });
  }
  if (video) {
    if (video._onOrientation) {
      if (typeof landscapeMq.removeEventListener === "function") landscapeMq.removeEventListener("change", video._onOrientation);
      else if (typeof landscapeMq.removeListener === "function") landscapeMq.removeListener(video._onOrientation);
      video._onOrientation = null;
    }
    if (video._metaHandler) { video.removeEventListener("loadedmetadata", video._metaHandler); video._metaHandler = null; }
    if (video._onTap) { video.removeEventListener("click", video._onTap); video._onTap = null; }
    exitFullscreen(video);
    try { video.pause(); } catch (_e) {}
    if (video._hls) { try { video._hls.destroy(); } catch (_e) {} }
    video.remove();
  }
  slideEl.classList.remove("playing");
}

/** Pause + tear down a clip when it scrolls out of view. */
let pauseObserver = null;
function observePauses(feed) {
  if (pauseObserver) pauseObserver.disconnect();
  pauseObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting && e.target.classList.contains("playing")) stopSlide(e.target);
      }
    },
    { threshold: 0.5 },
  );
  feed.querySelectorAll(".wm-slide").forEach((el) => pauseObserver.observe(el));
}

// ---------------------------------------------------------------------------
// Drawer — "Zu einem Spiel springen": search + jump to a clip
// ---------------------------------------------------------------------------

let drawerClips = [];

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(+d) && d.toDateString() === new Date().toDateString();
}

/** Text a clip is matched against by the search box (team names, else title). */
function clipSearchText(c) {
  return (c.match ? `${c.match.teamA} ${c.match.teamB}` : c.title || "").toLowerCase();
}

/** Search text for any drawer row (clip OR upcoming fixture). */
function itemSearchText(it) {
  if (it.upcoming && it.match) return `${it.match.teamA} ${it.match.teamB}`.toLowerCase();
  return clipSearchText(it.c);
}

/** Index of the clip currently snapped in the feed (full-height scroll-snap). */
function currentSlideIndex() {
  const feed = document.getElementById("wmFeed");
  if (!feed || !feed.clientHeight) return -1;
  return Math.round(feed.scrollTop / feed.clientHeight);
}

/** Store the clip list (called when the feed (re)renders) and paint the drawer. */
function buildDrawer(visible) {
  drawerClips = visible;
  const search = document.getElementById("wmSearch");
  renderDrawerList(search ? search.value : "");
}

/** Day key (YYYY-MM-DD) for grouping; "" when ISO is bad. */
function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Day label ("Morgen" / "Heute" / "Gestern" / "Mi. 18.06.2026") for a clip's local day. */
function dayLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Heute";
  const tom = new Date(today);
  tom.setDate(today.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return "Morgen";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Kickoff time HH:MM, mono, for the timeline rail. */
function dayTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
}

/** (Re)render the drawer as a vertical timeline grouped by day. */
function renderDrawerList(q) {
  const list = document.getElementById("wmDrawerList");
  if (!list) return;
  const ql = q.trim().toLowerCase();
  const cur = currentSlideIndex();

  // Keep each clip's ORIGINAL feed index so a tap scrolls to the right slide.
  const clipItems = drawerClips.map((c, i) => {
    const match = c.match ? findMatchByTeams(c.match.teamA, c.match.teamB) : null;
    return { c, i, match, kickoffISO: match?.dateISO || c.dateISO };
  });

  // Upcoming fixtures (today + tomorrow) without a clip yet — rendered as
  // greyed-out rows. Tap → opens the Spiele card; no slide jump.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(startOfToday); endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
  const upcomingItems = getAllMatches()
    .filter((m) => {
      if (m.status === "finished") return false;
      if (!m.dateISO) return false;
      const d = new Date(m.dateISO);
      if (isNaN(+d)) return false;
      if (d < startOfToday || d >= endOfTomorrow) return false;
      return !findClipByTeams(m.teamA, m.teamB);
    })
    .map((m) => ({ c: null, i: -1, match: m, kickoffISO: m.dateISO, upcoming: true }));

  const items = [...clipItems, ...upcomingItems].filter((it) => !ql || itemSearchText(it).includes(ql));

  if (!items.length) {
    const msg = ql ? "Kein Spiel gefunden." : clipsLoading ? "Spiele werden geladen…" : "Noch keine Spiele.";
    list.innerHTML = `<p class="wm-drawer-empty">${msg}</p>`;
    return;
  }

  function itemMarkup({ c, i, match, kickoffISO, upcoming }) {
    const teamA = upcoming ? match.teamA : (c.match ? c.match.teamA : null);
    const teamB = upcoming ? match.teamB : (c.match ? c.match.teamB : null);
    const flagA = teamA ? flagFor(teamA) : "🎬";
    const flagB = teamB ? flagFor(teamB) : "";
    const nameA = teamA ? esc(teamA) : esc(c.title);
    const nameB = teamB ? esc(teamB) : "";
    const isCur = !upcoming && i === cur;
    const cls = upcoming ? "wm-drawer-item is-upcoming" : (isCur ? "wm-drawer-item is-current" : "wm-drawer-item");
    const rowCls = upcoming ? "wm-drawer-row is-upcoming" : (isCur ? "wm-drawer-row is-current" : "wm-drawer-row");
    const rightSlot = match
      ? `<button class="wm-drawer-info" data-mid="${match.id}" type="button" aria-label="Spielinfo öffnen" title="Spielinfo">ⓘ</button>`
      : `<span class="wm-drawer-info-spacer" aria-hidden="true"></span>`;
    const time = dayTime(kickoffISO);
    const dataAttrs = upcoming
      ? `data-upcoming="1" data-mid="${match.id}"`
      : `data-i="${i}"`;
    return `<div class="${rowCls}">
        <button class="${cls}" ${dataAttrs} type="button">
          <span class="wm-drawer-time">${esc(time)}</span>
          <span class="wm-drawer-teams">
            <span class="wm-drawer-team"><span class="f">${flagA}</span><span class="nm">${nameA}</span></span>
            ${nameB ? `<span class="wm-drawer-team"><span class="f">${flagB}</span><span class="nm">${nameB}</span></span>` : ""}
          </span>
        </button>
        ${rightSlot}
      </div>`;
  }

  function dayGroup(label, arr) {
    return `<div class="wm-drawer-day"><div class="wm-drawer-day-head">${esc(label)}</div><div class="wm-drawer-day-list">${arr.map(itemMarkup).join("")}</div></div>`;
  }

  const loadingHint = clipsLoading && !ql ? `<p class="wm-drawer-loading">Weitere Spiele werden geladen…</p>` : "";
  if (ql) {
    list.innerHTML = `<div class="wm-drawer-search-list">${items.map(itemMarkup).join("")}</div>`;
  } else {
    // Group by day, newest day first; within day keep the original (newest-first) order.
    const groups = new Map();
    for (const it of items) {
      const key = dayKey(it.kickoffISO);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => b.localeCompare(a));
    list.innerHTML = sortedKeys.map((k) => {
      const arr = groups.get(k);
      const label = dayLabel(arr[0].kickoffISO) || "—";
      return dayGroup(label, arr);
    }).join("") + loadingHint;
  }

  list.querySelectorAll(".wm-drawer-item").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.upcoming === "1") {
        const mid = b.dataset.mid;
        closeDrawer();
        if (mid && typeof window.jumpToSpieleMatch === "function") window.jumpToSpieleMatch(mid);
      } else {
        jumpToClip(parseInt(b.dataset.i, 10));
      }
    }),
  );
  list.querySelectorAll(".wm-drawer-info").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const mid = b.dataset.mid;
      closeDrawer();
      if (mid && typeof window.jumpToSpieleMatch === "function") window.jumpToSpieleMatch(mid);
    }),
  );
}

/** Jump to a clip — switch to Highlights first (drawer can open from Spiele). */
function jumpToClip(i) {
  if (document.body.dataset.tab !== "highlights") {
    document.querySelector('.wm-tab[data-tab="highlights"]')?.click();
  }
  // Give a just-shown feed a couple of frames to lay out before scrolling.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const slide = document.querySelectorAll("#wmFeed .wm-slide")[i];
      if (slide) slide.scrollIntoView({ behavior: "smooth" });
    }),
  );
  closeDrawer();
}

function openDrawer() {
  const d = document.getElementById("wmDrawer");
  d?.classList.add("open");
  d?.setAttribute("aria-hidden", "false");
  const scrim = document.getElementById("wmDrawerScrim");
  if (scrim) scrim.hidden = false;
  document.getElementById("wmMenuBtn")?.setAttribute("aria-expanded", "true");
  // Refresh so the "current" highlight tracks wherever the feed is now.
  const search = document.getElementById("wmSearch");
  renderDrawerList(search ? search.value : "");
}
function closeDrawer() {
  document.getElementById("wmDrawer")?.classList.remove("open");
  document.getElementById("wmDrawer")?.setAttribute("aria-hidden", "true");
  const scrim = document.getElementById("wmDrawerScrim");
  if (scrim) scrim.hidden = true;
  document.getElementById("wmMenuBtn")?.setAttribute("aria-expanded", "false");
}
function wireDrawer() {
  document.getElementById("wmMenuBtn")?.addEventListener("click", () => {
    const open = document.getElementById("wmDrawer")?.classList.contains("open");
    if (open) closeDrawer();
    else openDrawer();
  });
  document.getElementById("wmDrawerScrim")?.addEventListener("click", closeDrawer);
  document.getElementById("wmDrawerClose")?.addEventListener("click", closeDrawer);
  const search = document.getElementById("wmSearch");
  if (search) search.addEventListener("input", () => renderDrawerList(search.value));
}

/** Public entry point — called by wm/app.js when the Highlights tab opens. */
export async function initFeed() {
  wireDrawer();

  // Eagerly fetch the schedule so the "→ Spielinfo · score" chip + drawer info
  // button can paint before the user ever opens Spiele.
  prefetchMatches();

  // When the schedule arrives (eager fetch above OR matches.js publishing on
  // its own init), re-render the feed so the chip + drawer info button appear
  // without a user reload. Skip while a clip is playing so we don't tear it down.
  subscribe(() => {
    if (clips.length && !document.querySelector(".wm-slide.playing")) render();
  });

  // Offline shell: paint cached clips immediately, then refresh from network.
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    if (Array.isArray(cached) && cached.length) {
      clips = cached.map(decorate);
      render();
    }
  } catch (_e) {/* ignore */}

  clipsLoading = true;
  try {
    const fresh = await fetchClips({
      // Paint each page as it arrives so the feed + drawer fill progressively
      // (don't disrupt a clip the user already started playing).
      onPage: (partial) => {
        clips = partial.map(decorate);
        if (!document.querySelector(".wm-slide.playing")) render();
      },
    });
    clips = fresh.map(decorate);
    localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
  } catch (e) {
    if (!clips.length) {
      document.getElementById("wmFeed").innerHTML =
        `<section class="wm-slide wm-empty"><p>Keine Verbindung.<br>Highlights konnten nicht geladen werden.</p></section>`;
    }
  } finally {
    clipsLoading = false;
    if (clips.length && !document.querySelector(".wm-slide.playing")) render(); // drop the loading hint
  }
}
