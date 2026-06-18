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
  /** FIFA timeline stage id — server-side enrichment for the goals fetch. */
  stageId?: string;
  /** Display round ("Vorrunde", "Achtelfinale", …) — drives the Spiele grouping. */
  round?: string;
  /** Group letter ("A"…"L") for Vorrunde matches; null otherwise. */
  group?: string | null;
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

// ---------------------------------------------------------------------------
// FIFA public API raw shapes (api.fifa.com/api/v3 — only the fields we read)
// ---------------------------------------------------------------------------

/** A FIFA localized string: array of { Locale, Description }. Take index 0. */
export interface FifaLoc {
  Locale?: string;
  Description?: string;
}

export interface FifaTeam {
  IdTeam?: string;
  /** Goals (regulation + extra time); null until played. */
  Score: number | null;
  TeamName?: FifaLoc[];
}

export interface FifaMatch {
  IdMatch: string;
  IdStage: string;
  IdGroup?: string;
  /** 0 = finished, 1 = upcoming, 3 = live. */
  MatchStatus: number;
  /** "97'" during/after play; null pre-match. */
  MatchTime?: string | null;
  Date: string; // ISO-8601 UTC
  /** null for an unseeded knockout slot. */
  Home: FifaTeam | null;
  Away: FifaTeam | null;
  GroupName?: FifaLoc[];
  StageName?: FifaLoc[];
}

export interface FifaMatchesResponse {
  Results?: FifaMatch[];
}

export interface FifaTimelineEvent {
  /** 0 = goal, 41 = penalty goal, 34 = own goal (others ignored). */
  Type: number;
  MatchMinute?: string | null; // "17'", "45'+5'"
  Period?: number;
  IdTeam?: string;
  IdPlayer?: string;
  /** "MESSI (Argentinien) erzielt ein Tor!" — scorer + team in the text. */
  EventDescription?: FifaLoc[];
}

export interface FifaTimelineResponse {
  Event?: FifaTimelineEvent[];
}
