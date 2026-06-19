/**
 * il.js — keyless SRGSSR Integration Layer client for the WM highlight feed.
 *
 * Runs in the browser (the kid's device, in CH) so the `/ch/` geofence on the
 * HLS segments is satisfied and NO SRG key is needed. The IL sends
 * `Access-Control-Allow-Origin: *`, so these cross-origin fetches work from our
 * PWA origin. Endpoints + response shape verified live 2026-06-17 and against
 * SRGSSR's own srgdataprovider / pillarbox-web code.
 *
 * The response→clip and composition→HLS mappers are pure and exported so
 * vitest can cover them against captured fixtures (the data shape is the risk,
 * not the fetch). Network wrappers stay thin.
 */

"use strict";

import { parseLiveCenterTitle } from "./parse.js";

export const IL_BASE = "https://il.srgssr.ch/integrationlayer";

/**
 * Routes SRF + Akamai URLs through the home-Mac proxy when the visitor is
 * outside CH (the proxy gets its base from /api/config — see appshell.js).
 * Returns the URL unchanged when no proxy is set, when the URL is already
 * proxified, or when the host isn't on the SRGSSR/Akamai surface.
 */
function proxify(url) {
  const base = typeof window !== "undefined" ? window.WM_SRF_PROXY : null;
  if (!base || !url) return url;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  if (host === new URL(base).hostname) return url; // already going through us
  const isSrf = /\.srgssr\.ch$/.test(host) || /\.akamaized\.net$/.test(host) || /\.srf\.ch$/.test(host);
  if (!isSrf) return url;
  return `${base.replace(/\/$/, "")}/proxy?url=${encodeURIComponent(url)}`;
}

/** SRF "FIFA WM 2026 Clips" show. */
export const WM_SHOW_URN = "urn:srf:show:tv:c55b9fb8-e108-4994-a1d0-8c288bf8d5bc";

/** SRF Play "vector" tag the IL expects on these list calls. */
const VECTOR = "portalplay";

// ---------------------------------------------------------------------------
// Pure mappers (tested against fixtures)
// ---------------------------------------------------------------------------

/** @typedef {{urn:string, title:string, dateISO:string, durationSec:number, thumbnailUrl:string|null}} Clip */

/**
 * Flattens an episodeComposition/latestByShow payload into clip records.
 * Each episode's first media is the clip itself.
 *
 * @param {any} data  parsed JSON from latestByShow
 * @returns {Clip[]}
 */
export function clipsFromEpisodeComposition(data) {
  const episodes = (data && data.episodeList) || [];
  const out = [];
  for (const ep of episodes) {
    const media = (ep && ep.mediaList && ep.mediaList[0]) || null;
    if (!media || media.mediaType !== "VIDEO" || !media.urn) continue;
    out.push({
      urn: media.urn,
      title: media.title || "",
      dateISO: media.date || ep.publishedDate || "",
      durationSec: media.duration ? Math.round(media.duration / 1000) : 0,
      thumbnailUrl: media.imageUrl || ep.imageUrl || null,
    });
  }
  return out;
}

/**
 * Extracts the best playable HLS source from a mediaComposition payload.
 * Prefers a non-tokenised (`tokenType: "NONE"`) HLS resource — WM clips are
 * served that way (direct akamaized.net). Returns null when no HLS is present.
 *
 * @param {any} data parsed JSON from mediaComposition/byUrn
 * @returns {{url:string, tokenType:string} | null}
 */
export function hlsFromMediaComposition(data) {
  const chapters = (data && data.chapterList) || [];
  /** @type {{url:string, tokenType:string}[]} */
  const hls = [];
  for (const ch of chapters) {
    for (const r of (ch && ch.resourceList) || []) {
      const proto = r && (r.protocol || r.streaming);
      if (proto === "HLS" && r.url) {
        hls.push({ url: r.url, tokenType: r.tokenType || "NONE" });
      }
    }
    if (hls.length) break; // first chapter is the clip itself
  }
  if (!hls.length) return null;
  // Prefer an untokenised stream when offered; else take the first.
  return hls.find((h) => h.tokenType === "NONE") || hls[0];
}

// ---------------------------------------------------------------------------
// Network wrappers (browser fetch)
// ---------------------------------------------------------------------------

/**
 * Lists the latest clips of the WM show, newest first.
 * @param {{pageSize?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<Clip[]>}
 */
export async function fetchClips(opts = {}) {
  const pageSize = opts.pageSize || 100;
  const maxPages = opts.maxPages || 20; // safety ceiling; real stop is next === null
  let url =
    `${IL_BASE}/2.0/episodeComposition/latestByShow/byUrn/${WM_SHOW_URN}` +
    `?vector=${VECTOR}&pageSize=${pageSize}`;
  const all = [];
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(proxify(url), { signal: opts.signal });
    if (!res.ok) {
      if (i === 0) throw new Error(`IL list ${res.status}`);
      break; // a later-page hiccup → return what we have rather than nothing
    }
    const data = await res.json();
    all.push(...clipsFromEpisodeComposition(data));
    // Emit the accumulated list after each page so the UI can fill progressively
    // (the feed paginates over 2–3 pages; without this the list looks "stuck"
    // on the smaller cached set until the last page lands).
    if (typeof opts.onPage === "function") {
      try { opts.onPage(all.slice()); } catch (_e) {/* non-fatal */}
    }
    url = data.next || null; // IL returns a full, CORS-open next URL
  }
  return all;
}

/** @typedef {{round:string, group:string|null, teamA:string, teamB:string, dateISO:string, urn:string}} Fixture */

/**
 * Maps an SRF livecenter payload to WM fixtures (schedule + round/group). This
 * is keyless and CORS-open like the rest of the IL; it carries NO scores —
 * those come from the football provider and are merged in the Spiele view.
 * @param {any} data
 * @returns {Fixture[]}
 */
export function liveCenterFixtures(data) {
  const ml = (data && data.mediaList) || [];
  const out = [];
  for (const m of ml) {
    const p = parseLiveCenterTitle(m.title);
    if (!p) continue;
    out.push({ ...p, dateISO: m.date || "", urn: m.urn || "" });
  }
  return out;
}

/**
 * Fetches the WM fixture window (recent + upcoming) from SRF livecenter.
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<Fixture[]>}
 */
export async function fetchFixtures(opts = {}) {
  const url = `${IL_BASE}/2.0/srf/mediaList/video/scheduledLivestreams/livecenter?pageSize=100&vector=${VECTOR}`;
  const res = await fetch(proxify(url), { signal: opts.signal });
  if (!res.ok) throw new Error(`IL livecenter ${res.status}`);
  return liveCenterFixtures(await res.json());
}

/**
 * Resolves a clip URN to a playable HLS URL.
 * @param {string} urn
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{url:string, tokenType:string}>}
 */
export async function fetchHls(urn, opts = {}) {
  const url =
    `${IL_BASE}/2.1/mediaComposition/byUrn/${urn}?onlyChapters=true&vector=${VECTOR}`;
  const res = await fetch(proxify(url), { signal: opts.signal });
  if (!res.ok) throw new Error(`IL composition ${res.status}`);
  const hls = hlsFromMediaComposition(await res.json());
  if (!hls) throw new Error("no HLS resource");
  // Route the HLS playlist through the proxy too — the proxy rewrites segment
  // URLs inside the playlist so the player never hits Akamai directly.
  return { ...hls, url: proxify(hls.url) };
}
