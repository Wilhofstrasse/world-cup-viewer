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
  FifaLoc,
  FifaMatch,
  FifaMatchesResponse,
  FifaTimelineEvent,
  FifaTimelineResponse,
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
  return {
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
