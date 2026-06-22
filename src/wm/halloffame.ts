/**
 * wm/halloffame.ts — aggregate WM Hall-of-Fame stats across every World Cup
 * season FIFA exposes (1930–2026 inclusive). Pulls the per-season top-scorers
 * blob for each tournament, dedupes player names with a tolerant normalizer,
 * and computes three ranked lists:
 *
 *   - topScorers     all-time WM goal totals
 *   - bestSingleWM   most goals scored in a single tournament
 *   - mostTourneys   most tournaments the player appeared in the top-scorer list
 *
 * NOTE: the top-scorer endpoint only lists players who scored at least once.
 * Goalkeepers and pure defenders are therefore absent — a "most appearances"
 * list keyed on the squads endpoint is a future addition (one extra fetch
 * per season). For now we ship the three lists this single endpoint covers.
 */

import type { FifaTopScorerRow } from "./types.js";

/** A WM season ID + display label as FIFA returns it (`/seasons?idCompetition=17`). */
export interface WmSeasonRef {
  idSeason: string;
  label: string;
}

export interface HallOfFamePlayer {
  name: string;
  /** ISO country / team name where the player most recently appeared. */
  team?: string | undefined;
  /** Optional photo URL — only set when at least one season carried it. */
  photoUrl?: string | null | undefined;
}

export interface HallOfFameTopScorerRow extends HallOfFamePlayer {
  totalGoals: number;
  tournaments: number;
  /** [{seasonLabel, goals}] ordered most recent first. */
  perSeason: Array<{ season: string; goals: number }>;
}

export interface HallOfFameBestSingleRow extends HallOfFamePlayer {
  goals: number;
  season: string;
}

export interface HallOfFameMostTourneysRow extends HallOfFamePlayer {
  tournaments: number;
  seasons: string[];
}

export interface WmHallOfFame {
  updatedAt: number;
  /** How many WM seasons contributed to the aggregate (sanity check). */
  seasonsIngested: number;
  topScorers: HallOfFameTopScorerRow[];
  bestSingleWM: HallOfFameBestSingleRow[];
  mostTourneys: HallOfFameMostTourneysRow[];
}

const FIFA_BASE = "https://api.fifa.com/api/v3";
const COMPETITION_ID = "17"; // FIFA World Cup (men's)

interface FifaLocLite {
  Description?: string;
}
interface FifaSeasonRow {
  IdSeason: string;
  Name?: FifaLocLite[];
}
interface FifaSeasonsResponse {
  Results?: FifaSeasonRow[];
}
interface FifaTopScorersLite {
  PlayerStatsList?: FifaTopScorerRow[];
}

async function fifaGetJson<T>(path: string): Promise<T> {
  const r = await fetch(`${FIFA_BASE}${path}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`FIFA ${path} ${r.status}`);
  return (await r.json()) as T;
}

/** Pull every WM season FIFA exposes — used to fan out the per-season scrape. */
export async function fetchWmSeasons(): Promise<WmSeasonRef[]> {
  const data = await fifaGetJson<FifaSeasonsResponse>(
    `/seasons?idCompetition=${COMPETITION_ID}&count=50`,
  );
  const out: WmSeasonRef[] = [];
  for (const r of data.Results || []) {
    if (!r.IdSeason) continue;
    const label = (r.Name && r.Name[0] && r.Name[0].Description) || r.IdSeason;
    out.push({ idSeason: String(r.IdSeason), label: String(label) });
  }
  return out;
}

/** Fetch per-season top scorers list (raw FIFA rows, mapped lightly). */
async function fetchSeasonTopScorers(idSeason: string): Promise<FifaTopScorerRow[]> {
  const data = await fifaGetJson<FifaTopScorersLite>(
    `/topseasonplayerstatistics/season/${idSeason}/topscorers?language=de-DE`,
  );
  return data.PlayerStatsList || [];
}

/** Localised array → single string with safe fallbacks. */
function loc(v: FifaLocLite[] | string | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return (v[0] && v[0].Description) || "";
}

/**
 * Normalize a player's name to a stable key for cross-season dedup.
 * FIFA mixes casing ("Kylian MBAPPE" / "MESSI" / "Edson Arantes do Nascimento")
 * and stylised glyphs across decades. We upper-case, strip diacritics, drop
 * non-letter characters, and collapse whitespace.
 */
export function normalizeName(raw: string): string {
  return (raw || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

interface PerPlayerAcc {
  display: string;
  team: string;
  photoUrl: string | null;
  perSeason: Map<string, number>; // seasonLabel → goals
}

/**
 * Iterate every WM season, fetch top-scorer list, aggregate.
 * Network calls are fanned out via Promise.allSettled so a single failed
 * season doesn't abort the ingest — we just skip it and continue.
 */
export async function ingestHallOfFame(): Promise<WmHallOfFame> {
  const seasons = await fetchWmSeasons();
  // Newest → oldest so `perSeason` reads chronologically when reversed in the UI.
  seasons.sort((a, b) => Number(b.idSeason) - Number(a.idSeason));

  const acc = new Map<string, PerPlayerAcc>();

  const settled = await Promise.allSettled(
    seasons.map(async (s) => {
      const rows = await fetchSeasonTopScorers(s.idSeason);
      for (const row of rows) {
        const info = row.PlayerInfo;
        if (!info) continue;
        const display = loc(info.PlayerName).trim();
        if (!display) continue;
        const goals = row.GoalsScored ?? 0;
        if (!goals) continue; // a "0-goal" top-scorer row is uninteresting noise.
        const key = normalizeName(display);
        let entry = acc.get(key);
        if (!entry) {
          entry = {
            display: prettifyName(display),
            team: loc(info.TeamName) || "",
            photoUrl: (info.PlayerPicture && info.PlayerPicture.PictureUrl) || null,
            perSeason: new Map<string, number>(),
          };
          acc.set(key, entry);
        }
        // Keep best display + photo across seasons (older seasons sometimes
        // ship richer ASCII spelling; newer ones ship a photo).
        if (
          entry.display === entry.display.toUpperCase() &&
          display !== display.toUpperCase()
        ) {
          entry.display = prettifyName(display);
        }
        if (!entry.photoUrl && info.PlayerPicture && info.PlayerPicture.PictureUrl) {
          entry.photoUrl = info.PlayerPicture.PictureUrl;
        }
        if (!entry.team && info.TeamName) entry.team = loc(info.TeamName);
        // Sum across multiple rows in same season (shouldn't happen, but defensive).
        entry.perSeason.set(s.label, (entry.perSeason.get(s.label) ?? 0) + goals);
      }
      return s.idSeason;
    }),
  );
  const seasonsIngested = settled.filter((r) => r.status === "fulfilled").length;

  const players = Array.from(acc.values());

  const topScorers: HallOfFameTopScorerRow[] = players
    .map((p) => {
      let total = 0;
      const perSeason: Array<{ season: string; goals: number }> = [];
      for (const [season, goals] of p.perSeason) {
        total += goals;
        perSeason.push({ season, goals });
      }
      return {
        name: p.display,
        team: p.team || undefined,
        photoUrl: p.photoUrl,
        totalGoals: total,
        tournaments: p.perSeason.size,
        perSeason,
      };
    })
    .sort((a, b) => b.totalGoals - a.totalGoals || b.tournaments - a.tournaments)
    .slice(0, 20);

  const bestSingleWM: HallOfFameBestSingleRow[] = players
    .flatMap((p) => {
      let best = 0;
      let bestSeason = "";
      for (const [season, goals] of p.perSeason) {
        if (goals > best) {
          best = goals;
          bestSeason = season;
        }
      }
      if (!best) return [];
      return [{
        name: p.display,
        team: p.team || undefined,
        photoUrl: p.photoUrl,
        goals: best,
        season: bestSeason,
      }];
    })
    .sort((a, b) => b.goals - a.goals)
    .slice(0, 15);

  const mostTourneys: HallOfFameMostTourneysRow[] = players
    .map((p) => ({
      name: p.display,
      team: p.team || undefined,
      photoUrl: p.photoUrl,
      tournaments: p.perSeason.size,
      seasons: Array.from(p.perSeason.keys()),
    }))
    .filter((p) => p.tournaments >= 3)
    .sort((a, b) => b.tournaments - a.tournaments || b.seasons.length - a.seasons.length)
    .slice(0, 15);

  return {
    updatedAt: Math.floor(Date.now() / 1000),
    seasonsIngested,
    topScorers,
    bestSingleWM,
    mostTourneys,
  };
}

/** "KYLIAN MBAPPE" → "Kylian Mbappe"; leaves capitalised proper-case names alone. */
export function prettifyName(raw: string): string {
  if (!raw) return raw;
  // If the string already has mixed case (e.g. "Olivier Giroud"), keep as is.
  if (raw !== raw.toUpperCase() && raw !== raw.toLowerCase()) return raw;
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
