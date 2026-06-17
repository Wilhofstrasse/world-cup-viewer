/**
 * wm/types.ts — WM 2026 football domain types.
 *
 * Two layers:
 *  - the normalized shapes the PWA + calendar consume (Match, Goal, WmData)
 *  - the minimal slices of the API-Football v3 responses we actually read.
 *
 * The normalized Match contract is mirrored in web/wm/matches.js — keep them
 * in sync. A goal minute is never invented: it is null when the source omits it.
 */

// ---------------------------------------------------------------------------
// Normalized domain (server → client)
// ---------------------------------------------------------------------------

export type MatchStatus = "scheduled" | "live" | "finished";
export type GoalType = "goal" | "penalty" | "own";

/** Which side scored, relative to the Match.teamA / teamB fields. */
export type Side = "A" | "B";

export interface Goal {
  team: Side;
  /** Regulation minute (time.elapsed). null when the source omits it. */
  minute: number | null;
  /** Stoppage-time add-on (time.extra), if any. */
  extra: number | null;
  scorer: string;
  type: GoalType;
}

export interface Match {
  /** Provider fixture id (stable key). */
  id: number;
  /** Kickoff, ISO-8601 with offset (rendered in Europe/Zurich on the client). */
  dateISO: string;
  status: MatchStatus;
  teamA: string;
  teamB: string;
  /** null until the match has a score (live or finished). */
  scoreA: number | null;
  scoreB: number | null;
  /** Live elapsed minute, when status === "live". */
  minute: number | null;
  goals: Goal[];
  /** Matched SRF highlight reel URN, when found (optional enrichment). */
  clipUrn?: string;
}

/** The blob stored in R2 at wm/matches.json and served by /api/wm/matches. */
export interface WmData {
  /** Unix seconds of the last successful ingest write. */
  updatedAt: number;
  season: string;
  matches: Match[];
}

// ---------------------------------------------------------------------------
// API-Football v3 raw shapes (only the fields we read)
// ---------------------------------------------------------------------------

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string; // ISO-8601 with offset
    status: { short: string; elapsed: number | null };
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

export interface ApiFootballFixturesResponse {
  errors?: unknown;
  results?: number;
  response: ApiFootballFixture[];
}

export interface ApiFootballEvent {
  time: { elapsed: number | null; extra: number | null };
  team: { id: number; name: string };
  player: { id: number | null; name: string | null };
  type: string; // "Goal" | "Card" | "subst" | "Var"
  detail: string; // "Normal Goal" | "Penalty" | "Own Goal" | "Missed Penalty" | ...
}

export interface ApiFootballEventsResponse {
  errors?: unknown;
  response: ApiFootballEvent[];
}
