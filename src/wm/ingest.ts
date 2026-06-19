/**
 * wm/ingest.ts — cron-driven football ingest, budget-aware for API-Football's
 * ~100 req/day free tier.
 *
 * Strategy (per the brief):
 *  - One /fixtures call refreshes the whole schedule + current scores, but only
 *    when it's worth it (a match is live, one is about to start / just finished,
 *    or it's been a while) — see shouldFetch().
 *  - /fixtures/events (goals) is fetched only for matches that are live, or that
 *    have just turned finished and don't yet have goals — never re-fetched for
 *    matches already finished-with-goals.
 *  - A goal minute is never invented (the mappers pass null through).
 *
 * No-ops safely when the key or bucket is missing, or outside the tournament
 * window. Clips are independent (client-side, keyless) and unaffected.
 */

import type { Env } from "../types.js";
import type { Match, WmData, WmTopScorers, WmTabellen, WmSquads } from "./types.js";
import { getProvider } from "./football.js";
import {
  loadWmData,
  loadWmTopScorers,
  loadWmTabellen,
  loadWmSquads,
  saveWmData,
  saveWmTopScorers,
  saveWmTabellen,
  saveWmSquads,
} from "./store.js";
import { fetchTopScorers, enrichScorerTeams, fetchTabellen, fetchSquads } from "./fifa.js";

const TOPSCORERS_MAX_AGE_MS = 30 * 60 * 1000; // refresh every 30 min in-window
const TABELLEN_MAX_AGE_MS = 30 * 60 * 1000;
const SQUADS_MAX_AGE_MS = 6 * 60 * 60 * 1000; // squads change rarely → 6 h

// Tournament window (Europe/Zurich offsets). Outside this, ingest no-ops.
const WM_START_MS = Date.parse("2026-06-11T00:00:00+02:00");
const WM_END_MS = Date.parse("2026-07-20T00:00:00+02:00");

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const PRE_KICKOFF_MS = 15 * 60 * 1000; // start polling 15 min before kickoff
const POST_KICKOFF_MS = 180 * 60 * 1000; // keep polling up to 3 h after kickoff

export function withinWmWindow(nowMs: number): boolean {
  return nowMs >= WM_START_MS && nowMs < WM_END_MS;
}

/**
 * Decides whether this tick should call API-Football at all (budget guard).
 * Always fetches on first run; otherwise only around live/imminent/just-ended
 * matches, or as a periodic 6-hourly refresh.
 */
export function shouldFetch(prev: WmData, nowMs: number): boolean {
  if (!prev.matches.length) return true;
  if (nowMs - prev.updatedAt * 1000 > SIX_HOURS_MS) return true;
  for (const m of prev.matches) {
    if (m.status === "live") return true;
    const ko = Date.parse(m.dateISO);
    if (!isNaN(ko) && nowMs >= ko - PRE_KICKOFF_MS && nowMs <= ko + POST_KICKOFF_MS) {
      return true;
    }
  }
  return false;
}

/** Whether a fresh match needs its goals fetched this tick. */
function needsGoals(fresh: Match, prev: Match | undefined): boolean {
  if (fresh.status === "live") return true; // refresh scorers while in play
  if (fresh.status === "finished") {
    // fetch once on transition to finished, or if we somehow never stored any
    return !(prev && prev.status === "finished" && prev.goals.length > 0);
  }
  return false;
}

/**
 * Refreshes the top-scorers blob from FIFA (keyless), enriching team names from
 * the supplied matches list. Always safe to call repeatedly: budget is one
 * keyless request. matches[] is read-only (never mutated).
 */
/** Build an idPlayer → photoUrl map from the cached squads blob (if any). */
async function loadSquadPhotoMap(env: Env): Promise<Map<string, string>> {
  const sq = await loadWmSquads(env);
  const m = new Map<string, string>();
  for (const team of sq.squads || []) {
    for (const p of team.players || []) {
      if (p.idPlayer && p.photoUrl) m.set(p.idPlayer, p.photoUrl);
    }
  }
  return m;
}

async function refreshTopScorers(env: Env, matches: Match[], nowMs: number): Promise<void> {
  if ((env.WM_API_PROVIDER || "fifa") !== "fifa") return; // only the FIFA path provides this feed
  try {
    const raw = await fetchTopScorers(env);
    const idToTeam = new Map<string, string>();
    for (const m of matches) {
      if (m.idTeamA) idToTeam.set(m.idTeamA, m.teamA);
      if (m.idTeamB) idToTeam.set(m.idTeamB, m.teamB);
    }
    // Cross-join with the squads blob so each scorer carries a real player
    // photo (the topscorers endpoint never ships photoUrl; the squads one does).
    const photoMap = await loadSquadPhotoMap(env);
    const scorers = enrichScorerTeams(raw, idToTeam).map((s) =>
      s.photoUrl || !s.idPlayer ? s : photoMap.has(s.idPlayer) ? { ...s, photoUrl: photoMap.get(s.idPlayer) || null } : s,
    );
    const ts: WmTopScorers = {
      updatedAt: Math.floor(nowMs / 1000),
      season: env.WM_SEASON || "2026",
      scorers,
    };
    await saveWmTopScorers(env, ts);
  } catch {
    // upstream hiccup — keep last good topscorers blob, retry next tick
  }
}

/**
 * Refreshes the all-48-team squads blob from FIFA (keyless, single request).
 * Squads change rarely; the freshness clock is 6 h.
 */
async function refreshSquads(env: Env, nowMs: number): Promise<void> {
  if ((env.WM_API_PROVIDER || "fifa") !== "fifa") return;
  try {
    const squads = await fetchSquads(env);
    const data: WmSquads = {
      updatedAt: Math.floor(nowMs / 1000),
      season: env.WM_SEASON || "2026",
      squads,
    };
    await saveWmSquads(env, data);
  } catch {
    // upstream hiccup — keep last good blob, retry next tick
  }
}

/**
 * Refreshes the group-standings blob from FIFA (keyless, single request) — its
 * own freshness clock, same as top scorers. No budget gate.
 */
async function refreshTabellen(env: Env, nowMs: number): Promise<void> {
  if ((env.WM_API_PROVIDER || "fifa") !== "fifa") return;
  try {
    const rows = await fetchTabellen(env);
    const data: WmTabellen = {
      updatedAt: Math.floor(nowMs / 1000),
      season: env.WM_SEASON || "2026",
      rows,
    };
    await saveWmTabellen(env, data);
  } catch {
    // upstream hiccup — keep last good blob, retry next tick
  }
}

export async function runWmIngest(env: Env): Promise<void> {
  if (!env.WM_R2) return; // no store bound → no-op (default FIFA provider is keyless)
  const nowMs = Date.now();
  if (!withinWmWindow(nowMs)) return;

  const prev = await loadWmData(env);

  // Top scorers + standings ride their OWN freshness clocks (one keyless
  // request each, no API-Football budget concern). This lets the first tick
  // after a deploy populate both even when shouldFetch() declines a matches
  // refresh.
  //
  // Order matters: squads must run BEFORE topscorers so the photo-join inside
  // refreshTopScorers() reads a freshly-populated squads blob. Otherwise the
  // first cron tick after a deploy (or after an empty/stale squads blob) saves
  // a photo-less topscorers blob that gets served for up to TOPSCORERS_MAX_AGE_MS.
  const prevSq = await loadWmSquads(env);
  const sqStale = !prevSq.squads.length || (nowMs - prevSq.updatedAt * 1000 > SQUADS_MAX_AGE_MS);
  if (sqStale) await refreshSquads(env, nowMs);

  const prevTs = await loadWmTopScorers(env);
  const tsStale = !prevTs.scorers.length || (nowMs - prevTs.updatedAt * 1000 > TOPSCORERS_MAX_AGE_MS);
  if (tsStale) await refreshTopScorers(env, prev.matches, nowMs);

  const prevTab = await loadWmTabellen(env);
  const tabStale = !prevTab.rows.length || (nowMs - prevTab.updatedAt * 1000 > TABELLEN_MAX_AGE_MS);
  if (tabStale) await refreshTabellen(env, nowMs);

  if (!shouldFetch(prev, nowMs)) return;

  const provider = getProvider(env);

  let fresh: Match[];
  try {
    fresh = await provider.getMatches(env);
  } catch {
    return; // upstream hiccup — keep last good data, retry next tick
  }
  if (!fresh.length) return;

  const prevById = new Map(prev.matches.map((m) => [m.id, m]));

  // Cap per-tick goal fetches to stay well under the Workers subrequest limit
  // (1 matches call + N timelines). Matches not refreshed this tick keep their
  // prior goals and are picked up later (needsGoals stays true until stored).
  const MAX_GOAL_FETCHES = 40;
  let fetched = 0;

  for (const m of fresh) {
    const prevM = prevById.get(m.id);
    if (prevM?.clipUrn) m.clipUrn = prevM.clipUrn; // carry any clip link

    if (needsGoals(m, prevM) && fetched < MAX_GOAL_FETCHES) {
      try {
        m.goals = await provider.getGoals(env, m);
        fetched++;
      } catch {
        m.goals = prevM?.goals ?? []; // keep prior scorers on failure
      }
    } else if (prevM) {
      m.goals = prevM.goals; // reuse stored goals (no extra request)
    }
  }

  const data: WmData = {
    updatedAt: Math.floor(nowMs / 1000),
    season: env.WM_SEASON || "2026",
    matches: fresh,
  };
  await saveWmData(env, data);

  // After a fresh matches refresh, re-tick top scorers (so the team-name map is
  // current) and the standings (so a kickoff-pivot is reflected). Cheap: two
  // keyless requests on the FIFA path.
  await refreshTopScorers(env, fresh, nowMs);
  await refreshTabellen(env, nowMs);
}
