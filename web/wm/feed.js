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

const CACHE_KEY = "wm.clips.v1";
const KIND_LABEL = { match: "Spielzusammenfassung", summary: "Zusammenfassung", goal: "Szene", feature: "Magazin" };

let clips = [];
let hlsLoading = null;

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
        <h2 class="wm-title">${esc(clip.title)}</h2>
        <div class="wm-sub">
          <span class="wm-kind">${KIND_LABEL[clip.kind] || ""}</span>
          <span class="wm-dot">·</span>
          <span>${fmtWhen(clip.dateISO)}</span>
          ${clip.durationSec ? `<span class="wm-dot">·</span><span>${fmtDuration(clip.durationSec)}</span>` : ""}
        </div>
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

async function playSlide(slideEl) {
  const clip = slideEl._clip;
  if (!clip || slideEl.classList.contains("playing")) return;
  slideEl.classList.add("loading");

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
  const onOrientation = () => { if (landscapeMq.matches) tryEnter(); else exitFullscreen(video); };
  const onTap = () => { if (landscapeMq.matches) enterFullscreen(video); }; // user gesture → reliable on iOS
  video._onOrientation = onOrientation;
  video._onTap = onTap;
  video.addEventListener("click", onTap);
  if (typeof landscapeMq.addEventListener === "function") landscapeMq.addEventListener("change", onOrientation);
  else if (typeof landscapeMq.addListener === "function") landscapeMq.addListener(onOrientation);
  if (landscapeMq.matches) onOrientation(); // best-effort promote if already landscape
}

function stopSlide(slideEl) {
  const video = slideEl.querySelector(".wm-video");
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
// Filter chips + boot
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sidebar (pick a match → jump to its clip)
// ---------------------------------------------------------------------------

function buildDrawer(visible) {
  const list = document.getElementById("wmDrawerList");
  if (!list) return;
  list.innerHTML = visible
    .map((c, i) => {
      const flags = c.match ? `${flagFor(c.match.teamA)} ${flagFor(c.match.teamB)}` : "🎬";
      const teams = c.match ? `${esc(c.match.teamA)} – ${esc(c.match.teamB)}` : esc(c.title);
      return `<button class="wm-drawer-item" data-i="${i}" type="button"><span class="f">${flags}</span><span class="t">${teams}</span><span class="d">${fmtWhen(c.dateISO)}</span></button>`;
    })
    .join("");
  list.querySelectorAll(".wm-drawer-item").forEach((b) => {
    b.addEventListener("click", () => {
      const i = parseInt(b.dataset.i, 10);
      const slide = document.querySelectorAll("#wmFeed .wm-slide")[i];
      if (slide) slide.scrollIntoView({ behavior: "smooth" });
      closeDrawer();
    });
  });
}

function openDrawer() {
  document.getElementById("wmDrawer")?.classList.add("open");
  document.getElementById("wmDrawer")?.setAttribute("aria-hidden", "false");
  const scrim = document.getElementById("wmDrawerScrim");
  if (scrim) scrim.hidden = false;
  document.getElementById("wmMenuBtn")?.setAttribute("aria-expanded", "true");
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
}

/** Public entry point — called by wm/app.js when the Highlights tab opens. */
export async function initFeed() {
  wireDrawer();

  // Offline shell: paint cached clips immediately, then refresh from network.
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    if (Array.isArray(cached) && cached.length) {
      clips = cached.map(decorate);
      render();
    }
  } catch (_e) {/* ignore */}

  try {
    const fresh = await fetchClips(); // paginates through all match days
    clips = fresh.map(decorate);
    localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
    render();
  } catch (e) {
    if (!clips.length) {
      document.getElementById("wmFeed").innerHTML =
        `<section class="wm-slide wm-empty"><p>Keine Verbindung.<br>Highlights konnten nicht geladen werden.</p></section>`;
    }
  }
}
