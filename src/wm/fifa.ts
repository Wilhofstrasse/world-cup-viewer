/**
 * wm/fifa.ts — FIFA public data API provider (KEYLESS, CORS-open, free).
 *
 * api.fifa.com/api/v3 is FIFA's own tournament data: no key, no quota, Akamai
 * edge-cached (s-maxage=15). It is the live source of truth for WM 2026 scores
 * + goal timelines — API-Football's free tier is paywalled to 2022–2024.
 *
 * Verified recipe (2026-06-18): idCompetition=17, idSeason=285023.
 *   GET /calendar/matches?idCompetition=17&idSeason=285023&count=500&language=de-DE
 *       → fixtures + score + status. de-DE so team names align with the SRF
 *         schedule the client merges against (teamsMatch handles the rest).
 *   GET /timelines/17/285023/{IdStage}/{IdMatch}?language=de-DE
 *       → goal events; Type ∈ {0 open-play, 41 penalty, 34 own-goal}.
 *
 * Pure mappers are exported + unit-tested against captured de-DE fixtures.
 * A goal minute is never invented (events without a clock minute are dropped —
 * this also excludes shoot-out penalties, which carry no match minute).
 */

import type { Env } from "../types.js";
import type {
  Match,
  Goal,
  MatchStatus,
  Side,
  GoalType,
  TopScorer,
  TabellenRow,
  Squad,
  SquadPlayer,
  FifaLoc,
  FifaMatch,
  FifaMatchesResponse,
  FifaTimelineEvent,
  FifaTimelineResponse,
  FifaTopScorerRow,
  FifaTopScorersResponse,
  FifaStandingRow,
  FifaStandingResponse,
  FifaSquadPlayer,
  FifaSquadTeam,
  FifaSquadsResponse,
} from "./types.js";
import type { FootballProvider } from "./football.js"; // type-only → no runtime cycle

// teamsMatch is the shared diacritic/alias-tolerant comparator (also used by the
// browser feed + the API-Football provider). esbuild bundles this .js.
import { teamsMatch } from "../../web/wm/parse.js";

const FIFA_BASE = "https://api.fifa.com/api/v3";
const GOAL_TYPES = new Set<number>([0, 41, 34]); // open-play, penalty, own-goal

// FIFA de-DE StageName → our display round label (drives ordering + the
// Vorrunde / K.-o.-Runde split on the client). 48-team format: Round of 32.
const STAGE_TO_ROUND: Record<string, string> = {
  "Erste Phase": "Vorrunde",
  Sechzehntelfinale: "Sechzehntelfinale",
  Achtelfinale: "Achtelfinale",
  Viertelfinale: "Viertelfinale",
  Halbfinale: "Halbfinale",
  "Spiel um Platz drei": "Spiel um Platz 3",
  Finale: "Final",
};

/** "Gruppe E" → "E" (FIFA uses a non-breaking space); blank → null. */
export function groupLetter(groupName: string): string | null {
  const g = (groupName || "").replace(/ /g, " ").replace(/^Gruppe\s*/i, "").trim();
  return g || null;
}

/** FIFA StageName → display round ("Erste Phase" → "Vorrunde"); unknown passes through. */
export function roundLabel(stageName: string): string {
  return STAGE_TO_ROUND[stageName] || stageName || "";
}

// ---------------------------------------------------------------------------
// Pure mappers (unit-tested)
// ---------------------------------------------------------------------------

/** FIFA MatchStatus: 0 = finished, 3 = live, everything else (1 …) scheduled. */
export function mapFifaStatus(matchStatus: number): MatchStatus {
  if (matchStatus === 0) return "finished";
  if (matchStatus === 3) return "live";
  return "scheduled";
}

/** First Description from a FIFA localized-string array. */
function loc(arr: FifaLoc[] | undefined): string {
  return (arr && arr[0] && arr[0].Description) || "";
}

/** "45'+5'" → {45,5}; "9'" → {9,null}; missing/odd → {null,null}. Never invents. */
export function parseMatchMinute(s: string | null | undefined): { minute: number | null; extra: number | null } {
  if (!s) return { minute: null, extra: null };
  const m = /^(\d+)'(?:\+(\d+)')?/.exec(s.trim());
  if (!m) return { minute: null, extra: null };
  return { minute: parseInt(m[1]!, 10), extra: m[2] ? parseInt(m[2], 10) : null };
}

/** Lower-cases all but the first letter of one word, preserving accents. */
function titleWord(w: string): string {
  return w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w;
}

/** ALL-CAPS token test (FIFA caps the surname): "QUINONES", "M.HANY", "RAÚL". */
function isUpperToken(t: string): boolean {
  return /[A-Za-zÀ-ÿ]/.test(t) && t === t.toUpperCase() && t !== t.toLowerCase();
}

/**
 * Reduces a FIFA scorer string to a clean TV-style surname. FIFA writes the
 * surname in CAPS — single ("RAÚL", "EMBOLO"), given+surname ("Julian QUINONES",
 * "Miro MUHEIM"), compound ("VAN DIJK"), or initial+surname ("M.HANY"). Take the
 * longest consecutive caps run, drop a leading initial, title-case (accents kept).
 */
export function tidyName(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return raw.trim();
  let best: string[] = [];
  let cur: string[] = [];
  for (const t of tokens) {
    if (isUpperToken(t)) {
      cur.push(t);
      if (cur.length > best.length) best = cur;
    } else {
      cur = [];
    }
  }
  const parts = (best.length ? best : [tokens[tokens.length - 1]!]).map((p) =>
    p.includes(".") ? p.split(".").pop() || p : p,
  );
  return parts.map(titleWord).join(" ");
}

/**
 * Extracts scorer + team from an EventDescription. Goals/penalties read
 * "MESSI (Argentinien) erzielt …"; own goals read "Eigentor durch X (Team).",
 * so strip that prefix first. Returns the team in the parens (the player's side;
 * own-goal crediting is handled by the caller).
 */
export function scorerFromDescription(desc: string): { scorer: string; team: string } | null {
  const s = (desc || "")
    .trim()
    .replace(/^Eigentor\s+(?:durch|von)\s+/i, "")
    .replace(/^Own goal by\s+/i, "");
  const m = /^(.+?)\s*\(([^)]+)\)/.exec(s);
  if (!m) return null;
  return { scorer: tidyName(m[1]!), team: m[2]!.trim() };
}

export function mapFifaGoalType(type: number): GoalType {
  if (type === 41) return "penalty";
  if (type === 34) return "own";
  return "goal";
}

/**
 * Normalizes one FIFA match. teamA = Home, teamB = Away. Returns null for an
 * unseeded knockout slot (Home/Away null) — those carry no team to merge on.
 * Score is null until the match is live/finished. goals[] is filled separately.
 */
export function mapFifaMatchToMatch(raw: FifaMatch): Match | null {
  if (!raw.Home || !raw.Away) return null;
  const status = mapFifaStatus(raw.MatchStatus);
  const hasScore = status === "live" || status === "finished";
  const out: Match = {
    id: parseInt(String(raw.IdMatch), 10),
    dateISO: raw.Date || "",
    status,
    teamA: loc(raw.Home.TeamName),
    teamB: loc(raw.Away.TeamName),
    scoreA: hasScore ? raw.Home.Score ?? 0 : null,
    scoreB: hasScore ? raw.Away.Score ?? 0 : null,
    minute: status === "live" ? parseMatchMinute(raw.MatchTime).minute : null,
    goals: [],
    stageId: String(raw.IdStage),
    round: roundLabel(loc(raw.StageName)),
    group: groupLetter(loc(raw.GroupName)),
  };
  if (raw.Home.IdTeam) out.idTeamA = raw.Home.IdTeam;
  if (raw.Away.IdTeam) out.idTeamB = raw.Away.IdTeam;
  return out;
}

/**
 * Maps a match's timeline events to goal records. Keeps Type ∈ {0,41,34} with a
 * real clock minute; resolves scorer + side from EventDescription. An own goal
 * is credited to the BENEFITING side (opponent of the player's team), so the
 * scorer list matches the scoreline. Sorted chronologically.
 */
export function mapTimelineToGoals(events: FifaTimelineEvent[], teamA: string, teamB: string): Goal[] {
  const out: Goal[] = [];
  for (const e of events) {
    if (!GOAL_TYPES.has(e.Type)) continue;
    const { minute, extra } = parseMatchMinute(e.MatchMinute);
    if (minute == null) continue; // no clock → shoot-out / invalid; never invent
    const parsed = scorerFromDescription(loc(e.EventDescription));
    if (!parsed) continue;
    let team: Side | null = teamsMatch(parsed.team, teamA) ? "A" : teamsMatch(parsed.team, teamB) ? "B" : null;
    if (!team) continue;
    const type = mapFifaGoalType(e.Type);
    if (type === "own") team = team === "A" ? "B" : "A";
    out.push({ team, minute, extra, scorer: parsed.scorer, type });
  }
  out.sort((a, b) => {
    const ka = a.minute == null ? Infinity : a.minute + (a.extra ?? 0) / 100;
    const kb = b.minute == null ? Infinity : b.minute + (b.extra ?? 0) / 100;
    return ka - kb;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Network wrappers + provider
// ---------------------------------------------------------------------------

async function fifaGet<T>(path: string): Promise<T> {
  const url = `${FIFA_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`FIFA ${res.status} ${url}`);
  return (await res.json()) as T;
}

function comp(env: Env): string {
  return env.WM_FIFA_COMPETITION || "17";
}
function season(env: Env): string {
  return env.WM_FIFA_SEASON || "285023";
}

/**
 * Maps one FIFA top-scorer row to our TopScorer shape. team may be "" when the
 * FIFA response carries only IdTeam — the caller resolves it from a matches
 * lookup. assists / matches default to 0 (FIFA returns null in early rounds).
 */
export function mapFifaTopScorer(raw: FifaTopScorerRow): TopScorer | null {
  const info = raw.PlayerInfo;
  if (!info) return null;
  const player = loc(info.PlayerName);
  if (!player) return null;
  return {
    rank: raw.Rank,
    player,
    idPlayer: info.IdPlayer || null,
    team: loc(info.TeamName) || "",
    idTeam: info.IdTeam || null,
    goals: raw.GoalsScored ?? 0,
    assists: raw.Assists ?? 0,
    matches: raw.MatchesPlayed ?? 0,
    photoUrl: (info.PlayerPicture && info.PlayerPicture.PictureUrl) || null,
  };
}

/**
 * Resolves a missing team display name from a matches-derived idTeam → name map.
 * FIFA's top-scorers endpoint sometimes ships only IdTeam (no TeamName); the
 * matches feed always carries IdTeam + Home/Away.TeamName, so we fill from there.
 */
export function enrichScorerTeams(
  scorers: TopScorer[],
  teamNameById: Map<string, string>,
): TopScorer[] {
  return scorers.map((s) => {
    if (s.team || !s.idTeam) return s;
    const name = teamNameById.get(s.idTeam);
    return name ? { ...s, team: name } : s;
  });
}

/** Build the idTeam → display-name map from raw FIFA matches (keyed by IdTeam). */
export function teamNameMap(rawMatches: FifaMatch[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rawMatches) {
    if (r.Home?.IdTeam) m.set(r.Home.IdTeam, loc(r.Home.TeamName));
    if (r.Away?.IdTeam) m.set(r.Away.IdTeam, loc(r.Away.TeamName));
  }
  return m;
}

export const fifaProvider: FootballProvider = {
  async getMatches(env: Env): Promise<Match[]> {
    const data = await fifaGet<FifaMatchesResponse>(
      `/calendar/matches?idCompetition=${comp(env)}&idSeason=${season(env)}&count=500&language=de-DE`,
    );
    const out: Match[] = [];
    for (const r of data.Results || []) {
      const m = mapFifaMatchToMatch(r);
      if (m) out.push(m);
    }
    return out;
  },

  async getGoals(env: Env, match: Match): Promise<Goal[]> {
    if (!match.stageId) return match.goals || [];
    const data = await fifaGet<FifaTimelineResponse>(
      `/timelines/${comp(env)}/${season(env)}/${match.stageId}/${match.id}?language=de-DE`,
    );
    return mapTimelineToGoals(data.Event || [], match.teamA, match.teamB);
  },
};

/**
 * Fetches the Golden Boot list from FIFA's keyless endpoint and returns it in
 * our normalized shape. Team names are filled where the response carries them;
 * the caller may enrich the rest from the matches feed (enrichScorerTeams).
 */
export async function fetchTopScorers(env: Env): Promise<TopScorer[]> {
  const data = await fifaGet<FifaTopScorersResponse>(
    `/topseasonplayerstatistics/season/${season(env)}/topscorers?language=de-DE`,
  );
  const out: TopScorer[] = [];
  for (const row of data.PlayerStatsList || []) {
    const s = mapFifaTopScorer(row);
    if (s) out.push(s);
  }
  return out;
}

/** Raw FIFA matches list — exposed so the ingest can derive teamNameMap from it. */
export async function fetchRawFifaMatches(env: Env): Promise<FifaMatch[]> {
  const data = await fifaGet<FifaMatchesResponse>(
    `/calendar/matches?idCompetition=${comp(env)}&idSeason=${season(env)}&count=500&language=de-DE`,
  );
  return data.Results || [];
}

/**
 * Maps the FIFA Group string ("Gruppe A", FIFA uses an NBSP) to a single letter.
 * Accepts either the legacy plain-string Group field or a localized array.
 */
export function standingGroupLetter(raw: FifaStandingRow): string | null {
  let g: string;
  if (typeof raw.Group === "string") g = raw.Group;
  else if (Array.isArray(raw.Group) && raw.Group[0]) g = raw.Group[0].Description || "";
  else g = "";
  return groupLetter(g);
}

/** Maps QualificationStatus pass-through string to our 3-state shape. */
export function mapQualificationStatus(s: string | undefined): "qualified" | "eliminated" | null {
  const t = (s || "").toLowerCase();
  if (t === "qualified") return "qualified";
  if (t === "eliminated") return "eliminated";
  return null;
}

/** Normalizes one FIFA Standing row → TabellenRow. */
export function mapFifaStanding(raw: FifaStandingRow): TabellenRow | null {
  if (!raw.Team || !raw.Team.IdTeam) return null;
  const team = loc(raw.Team.Name) || raw.Team.ShortClubName || "";
  if (!team) return null;
  return {
    group: standingGroupLetter(raw),
    position: raw.Position ?? 0,
    team,
    idTeam: raw.Team.IdTeam,
    played: raw.Played ?? 0,
    won: raw.Won ?? 0,
    drawn: raw.Drawn ?? 0,
    lost: raw.Lost ?? 0,
    goalsFor: raw.For ?? 0,
    goalsAgainst: raw.Against ?? 0,
    goalsDiff: raw.GoalsDiference ?? 0,
    points: raw.Points ?? 0,
    qualification: mapQualificationStatus(raw.QualificationStatus),
    crestUrlTemplate: raw.Team.PictureUrl ?? null,
  };
}

/** Normalizes a FIFA squad player → SquadPlayer. */
export function mapFifaSquadPlayer(raw: FifaSquadPlayer): SquadPlayer | null {
  if (!raw.IdPlayer) return null;
  const name = loc(raw.PlayerName) || loc(raw.ShortName) || "";
  if (!name) return null;
  return {
    idPlayer: raw.IdPlayer,
    name,
    jerseyNum: raw.JerseyNum ?? null,
    position: typeof raw.Position === "number" ? raw.Position : 0,
    positionLabel: loc(raw.PositionLocalized) || "",
    birthDate: raw.BirthDate || "",
    height: raw.Height ?? null,
    photoUrl: (raw.PlayerPicture && raw.PlayerPicture.PictureUrl) || raw.PictureUrl || null,
    idCountry: raw.IdCountry || null,
  };
}

/** Normalizes one squad team → Squad, sorting players by jersey number. */
export function mapFifaSquad(raw: FifaSquadTeam): Squad | null {
  if (!raw.IdTeam) return null;
  const teamName = loc(raw.TeamName) || "";
  if (!teamName) return null;
  const players: SquadPlayer[] = [];
  for (const p of raw.Players || []) {
    const sp = mapFifaSquadPlayer(p);
    if (sp) players.push(sp);
  }
  players.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    const ja = a.jerseyNum ?? 999;
    const jb = b.jerseyNum ?? 999;
    return ja - jb;
  });
  return {
    idTeam: raw.IdTeam,
    teamName,
    crestUrl: raw.PictureUrl || null,
    players,
  };
}

/** All 48 team squads. Server-sorted by teamName for a stable list. */
export async function fetchSquads(env: Env): Promise<Squad[]> {
  const data = await fifaGet<FifaSquadsResponse>(
    `/teams/squads/all/${comp(env)}/${season(env)}?language=de-DE`,
  );
  const out: Squad[] = [];
  for (const t of data.Results || []) {
    const sq = mapFifaSquad(t);
    if (sq) out.push(sq);
  }
  out.sort((a, b) => a.teamName.localeCompare(b.teamName));
  return out;
}

/**
 * Group-stage standings for all 12 groups. Sorted server-side by group letter
 * (A → L), then Position ascending so the client can render straight through.
 */
export async function fetchTabellen(env: Env): Promise<TabellenRow[]> {
  const data = await fifaGet<FifaStandingResponse>(
    `/calendar/${comp(env)}/${season(env)}/289273/Standing?language=de-DE`,
  );
  const out: TabellenRow[] = [];
  for (const r of data.Results || []) {
    const row = mapFifaStanding(r);
    if (row) out.push(row);
  }
  out.sort((a, b) => {
    const ga = a.group || "ZZ";
    const gb = b.group || "ZZ";
    return ga === gb ? a.position - b.position : ga.localeCompare(gb);
  });
  return out;
}
