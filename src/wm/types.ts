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
  /** FIFA IdTeam for Home — server-side enrichment for cross-feed lookups (topscorers). */
  idTeamA?: string;
  /** FIFA IdTeam for Away — server-side enrichment for cross-feed lookups (topscorers). */
  idTeamB?: string;
}

/** The blob stored in R2 at wm/matches.json and served by /api/wm/matches. */
export interface WmData {
  /** Unix seconds of the last successful ingest write. */
  updatedAt: number;
  season: string;
  matches: Match[];
}

/** One row in the Golden Boot list (Torjägerliste). */
export interface TopScorer {
  rank: number;
  player: string;
  /** FIFA IdPlayer — opens Spielerkarten on tap. null when missing. */
  idPlayer: string | null;
  team: string;
  idTeam: string | null;
  goals: number;
  assists: number;
  matches: number;
  photoUrl: string | null;
}

/** The blob stored in R2 at wm/topscorers.json and served by /api/wm/topscorers. */
export interface WmTopScorers {
  /** Unix seconds of the last successful ingest write. */
  updatedAt: number;
  season: string;
  scorers: TopScorer[];
}

/** One row in a group standings table. Server-derived from FIFA's Standing feed. */
export interface TabellenRow {
  /** Single-letter group key ("A" … "L"); null when not derivable. */
  group: string | null;
  position: number;
  team: string;
  idTeam: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDiff: number;
  points: number;
  /** "qualified" | "eliminated" | null. */
  qualification: "qualified" | "eliminated" | null;
  /** FIFA flag/crest URL template (with {format}/{size}); null when missing. */
  crestUrlTemplate: string | null;
}

/** The blob stored in R2 at wm/tabellen.json and served by /api/wm/tabellen. */
export interface WmTabellen {
  /** Unix seconds of the last successful ingest write. */
  updatedAt: number;
  season: string;
  rows: TabellenRow[];
}

/** One player row inside a Squad. */
export interface SquadPlayer {
  idPlayer: string;
  name: string;
  jerseyNum: number | null;
  /** FIFA position bucket: 0=Tor, 1=Abwehr, 2=Mittelfeld, 3=Angriff (best effort). */
  position: number;
  /** Localized position string ("Torhüter"); empty when unavailable. */
  positionLabel: string;
  /** ISO-8601 birth date; "" when unknown. */
  birthDate: string;
  /** Centimeters; null when unknown. */
  height: number | null;
  /** FIFA-hosted PictureUrl; null when unknown. */
  photoUrl: string | null;
  /** Country code (ISO3) for the player's nationality. */
  idCountry: string | null;
}

export interface Squad {
  idTeam: string;
  teamName: string;
  /** FIFA flag/crest URL (already resolved to {format,size} where possible). */
  crestUrl: string | null;
  players: SquadPlayer[];
}

/** The blob stored in R2 at wm/squads.json and served by /api/wm/squads. */
export interface WmSquads {
  updatedAt: number;
  season: string;
  squads: Squad[];
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

/** A FIFA player picture: take PictureUrl, or null. */
export interface FifaPlayerPicture {
  PictureUrl?: string | null;
}

export interface FifaTopScorerPlayerInfo {
  PlayerName?: FifaLoc[];
  IdTeam?: string;
  IdPlayer?: string;
  PlayerPicture?: FifaPlayerPicture | null;
  TeamName?: FifaLoc[];
}

export interface FifaTopScorerRow {
  Rank: number;
  GoalsScored: number | null;
  Assists?: number | null;
  MatchesPlayed?: number | null;
  PlayerInfo?: FifaTopScorerPlayerInfo;
}

export interface FifaTopScorersResponse {
  PlayerStatsList?: FifaTopScorerRow[];
}

export interface FifaStandingTeam {
  IdTeam?: string;
  Name?: FifaLoc[];
  ShortClubName?: string;
  PictureUrl?: string | null;
}

export interface FifaStandingRow {
  IdGroup?: string;
  Group?: FifaLoc[] | string;
  Position?: number;
  Points?: number;
  Played?: number;
  Won?: number;
  Drawn?: number;
  Lost?: number;
  For?: number;
  Against?: number;
  GoalsDiference?: number;
  /** "Qualified" | "Eliminated" | "Undefined" — pass-through string. */
  QualificationStatus?: string;
  Team?: FifaStandingTeam;
}

export interface FifaStandingResponse {
  Results?: FifaStandingRow[];
}

export interface FifaSquadPlayer {
  IdPlayer?: string;
  PlayerName?: FifaLoc[];
  ShortName?: FifaLoc[];
  JerseyNum?: number | null;
  Position?: number;
  PositionLocalized?: FifaLoc[];
  BirthDate?: string;
  Height?: number | null;
  PictureUrl?: string | null;
  PlayerPicture?: FifaPlayerPicture | null;
  IdCountry?: string | null;
}

export interface FifaSquadTeam {
  IdTeam?: string;
  TeamName?: FifaLoc[];
  PictureUrl?: string | null;
  Players?: FifaSquadPlayer[];
}

export interface FifaSquadsResponse {
  Results?: FifaSquadTeam[];
}
