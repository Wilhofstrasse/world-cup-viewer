/**
 * linkstore.js — in-memory bridge between the Highlights feed and the Spiele
 * schedule so each can backlink into the other without round-tripping the API.
 *
 * Two lists kept in sync:
 *   - matches: the Spiele payload (id, teams, score, status, group, round, …)
 *   - clips:   one row per match-reel clip (urn, teams, dateISO, slideIndex)
 *
 * Lookups use the diacritic/alias-tolerant teamsMatch comparator (shared by the
 * feed parser and the API-Football provider). Order-insensitive: a clip lists
 * teams as the clip title reads (A − B), the FIFA schedule reads home/away —
 * both pairings count as the same match.
 */

"use strict";

import { teamsMatch } from "./parse.js";

const store = {
  matches: [],
  clips: [], // {urn, teamA, teamB, dateISO, index}
};

const subs = new Set();
let matchesPrefetched = false;

/** Best-effort eager fetch of the matches blob so Highlights chips can paint
 *  before Spiele opens. Idempotent; no-op once the store has matches. */
export async function prefetchMatches(apiBase = "") {
  if (matchesPrefetched || store.matches.length) return;
  matchesPrefetched = true;
  try {
    const res = await fetch(`${apiBase}/api/wm/matches`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.matches) && data.matches.length) setMatches(data.matches);
  } catch (_e) {/* offline / blocked — chip will simply not appear */}
}

function notify() {
  for (const fn of subs) {
    try { fn(); } catch (_e) {/* never let one subscriber break the rest */}
  }
}

function sameMatches(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].status !== b[i].status || a[i].scoreA !== b[i].scoreA || a[i].scoreB !== b[i].scoreB) return false;
  }
  return true;
}
function sameClips(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].urn !== b[i].urn || a[i].index !== b[i].index) return false;
  }
  return true;
}

export function setMatches(m) {
  const next = Array.isArray(m) ? m.slice() : [];
  if (sameMatches(store.matches, next)) return;
  store.matches = next;
  notify();
}

export function setClips(list) {
  const next = Array.isArray(list) ? list.slice() : [];
  if (sameClips(store.clips, next)) return;
  store.clips = next;
  notify();
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getMatch(id) {
  if (id == null) return null;
  const want = String(id);
  return store.matches.find((m) => String(m.id) === want) || null;
}

/** Match by team-pair, order-insensitive. Returns null when no match found. */
export function findMatchByTeams(a, b) {
  if (!a || !b) return null;
  for (const m of store.matches) {
    if (
      (teamsMatch(a, m.teamA) && teamsMatch(b, m.teamB)) ||
      (teamsMatch(a, m.teamB) && teamsMatch(b, m.teamA))
    ) return m;
  }
  return null;
}

/** Clip by team-pair (returns the slide index — what the feed scrolls to). */
export function findClipByTeams(a, b) {
  if (!a || !b) return null;
  for (const c of store.clips) {
    if (
      (teamsMatch(a, c.teamA) && teamsMatch(b, c.teamB)) ||
      (teamsMatch(a, c.teamB) && teamsMatch(b, c.teamA))
    ) return c;
  }
  return null;
}
