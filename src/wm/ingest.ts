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
import type { Match, WmData } from "./types.js";
import { getProvider } from "./football.js";
import { loadWmData, saveWmData } from "./store.js";

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

export async function runWmIngest(env: Env): Promise<void> {
  if (!env.WM_R2) return; // no store bound → no-op (default FIFA provider is keyless)
  const nowMs = Date.now();
  if (!withinWmWindow(nowMs)) return;

  const prev = await loadWmData(env);
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
}
