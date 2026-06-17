/**
 * wm/football.ts — football schedule/score/scorer data layer.
 *
 * One provider interface (getMatches / getGoals) behind which API-Football is
 * the default implementation; football-data.org or Sofascore can be slotted in
 * later without touching callers (draft requirement). The pure mappers
 * (mapFixtureToMatch / mapEventsToGoals / mapStatus) are exported and unit-
 * tested against captured-shape fixtures, since live calls need Filipe's key.
 *
 * Native fetch only, matching chesscom.ts conventions. The API key is read
 * from env and sent server-side — it never reaches the client.
 */

import type { Env } from "../types.js";
import type {
  Match,
  Goal,
  MatchStatus,
  Side,
  GoalType,
  ApiFootballFixture,
  ApiFootballFixturesResponse,
  ApiFootballEvent,
  ApiFootballEventsResponse,
} from "./types.js";

// teamsMatch is the single shared, diacritic/co-host-tolerant comparator
// (also used by the browser feed). esbuild bundles this .js into the Worker.
import { teamsMatch } from "../../web/wm/parse.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class FootballApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "FootballApiError";
  }
}

// ---------------------------------------------------------------------------
// Pure mappers (unit-tested)
// ---------------------------------------------------------------------------

const FINISHED = new Set(["FT", "AET", "PEN"]);
const LIVE = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT", "SUSP"]);

/** Maps an API-Football status.short code to our coarse status. */
export function mapStatus(short: string): MatchStatus {
  if (FINISHED.has(short)) return "finished";
  if (LIVE.has(short)) return "live";
  return "scheduled"; // NS, TBD, PST, CANC, ABD, AWD, WO …
}

/** Maps an event detail string to a goal type. */
export function mapGoalType(detail: string): GoalType {
  if (detail === "Penalty") return "penalty";
  if (detail === "Own Goal") return "own";
  return "goal";
}

/**
 * Normalizes one fixture. teamA is always the home side, teamB the away side.
 * Score is null until the match is live or finished. goals[] is filled
 * separately (only for finished matches, to stay within the request budget).
 */
export function mapFixtureToMatch(raw: ApiFootballFixture): Match {
  const status = mapStatus(raw.fixture.status.short);
  const hasScore = status === "live" || status === "finished";
  return {
    id: raw.fixture.id,
    dateISO: raw.fixture.date,
    status,
    teamA: raw.teams.home.name,
    teamB: raw.teams.away.name,
    scoreA: hasScore ? raw.goals.home ?? 0 : null,
    scoreB: hasScore ? raw.goals.away ?? 0 : null,
    minute: status === "live" ? raw.fixture.status.elapsed : null,
    goals: [],
  };
}

/** Decides which side an event's team is, tolerant of name spelling. */
function sideFor(eventTeam: string, teamA: string, teamB: string): Side | null {
  if (teamsMatch(eventTeam, teamA)) return "A";
  if (teamsMatch(eventTeam, teamB)) return "B";
  return null;
}

/**
 * Maps fixture events to goal records for the given match. Keeps only real
 * goals (drops "Missed Penalty" and non-goal events). A goal whose team can't
 * be resolved is dropped rather than guessed. Minutes are passed through as-is
 * (null when absent) — never invented.
 */
export function mapEventsToGoals(
  events: ApiFootballEvent[],
  teamA: string,
  teamB: string,
): Goal[] {
  const out: Goal[] = [];
  for (const e of events) {
    if (e.type !== "Goal") continue;
    if (e.detail === "Missed Penalty") continue;
    const type = mapGoalType(e.detail);
    let team = sideFor(e.team?.name ?? "", teamA, teamB);
    if (!team) continue;
    // API-Football files an own-goal event under the PLAYER's (conceding) team,
    // but the goal counts for the opponent — credit the benefiting side so the
    // scorer list matches the scoreline. (Score itself comes from goals.home/away,
    // so this is display-only. Convention re-checked on first live data.)
    if (type === "own") team = team === "A" ? "B" : "A";
    out.push({
      team,
      minute: e.time?.elapsed ?? null,
      extra: e.time?.extra ?? null,
      scorer: e.player?.name ?? "?",
      type,
    });
  }
  // Sort by minute (+extra), nulls last, for stable display.
  out.sort((a, b) => {
    const ka = a.minute == null ? Infinity : a.minute + (a.extra ?? 0) / 100;
    const kb = b.minute == null ? Infinity : b.minute + (b.extra ?? 0) / 100;
    return ka - kb;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Provider interface + API-Football implementation
// ---------------------------------------------------------------------------

export interface FootballProvider {
  /** All WC fixtures (schedule + current score/status), goals[] left empty. */
  getMatches(env: Env): Promise<Match[]>;
  /** Goal events for one match, mapped to its A/B sides. */
  getGoals(env: Env, match: Match): Promise<Goal[]>;
}

function apiHost(env: Env): string {
  return env.WM_API_HOST || "v3.football.api-sports.io";
}

async function apiFootballGet<T>(path: string, env: Env): Promise<T> {
  if (!env.APIFOOTBALL_KEY) {
    throw new FootballApiError(0, path, "APIFOOTBALL_KEY not configured");
  }
  const url = `https://${apiHost(env)}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": env.APIFOOTBALL_KEY, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new FootballApiError(res.status, url, `API-Football ${res.status}`);
  }
  return (await res.json()) as T;
}

export const apiFootballProvider: FootballProvider = {
  async getMatches(env: Env): Promise<Match[]> {
    const league = env.WM_LEAGUE_ID || "1"; // FIFA World Cup (verify on first live call)
    const season = env.WM_SEASON || "2026";
    const data = await apiFootballGet<ApiFootballFixturesResponse>(
      `/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`,
      env,
    );
    return (data.response || []).map(mapFixtureToMatch);
  },

  async getGoals(env: Env, match: Match): Promise<Goal[]> {
    const data = await apiFootballGet<ApiFootballEventsResponse>(
      `/fixtures/events?fixture=${encodeURIComponent(String(match.id))}`,
      env,
    );
    return mapEventsToGoals(data.response || [], match.teamA, match.teamB);
  },
};

/** Provider factory — single switch point for swapping data sources. */
export function getProvider(_env: Env): FootballProvider {
  // Future: branch on env.WM_API_PROVIDER for football-data.org / Sofascore.
  return apiFootballProvider;
}
