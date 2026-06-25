/**
 * parse.js — pure helpers for the WM 2026 SRF highlight clips.
 *
 * ONE source of truth, ESM, no build step: imported by the browser
 * (web/wm/*.js via <script type="module">) AND by vitest (src/test/wm-parse.test.ts).
 * Keep it dependency-free and side-effect-free so both runtimes can load it.
 *
 * Background (verified live 2026-06-17 against the real show feed):
 * SRF's "FIFA WM 2026 Clips" show mixes four kinds of clip titles —
 *   - full match reels :  "Die Live-Highlights bei Österreich - Jordanien"
 *   - match summaries  :  "Österreich müht sich zum Auftaktsieg gegen Jordanien"
 *   - single goals     :  "Schmid bringt Österreich mit einem Sonntagsschuss in Führung"
 *   - magazine pieces  :  "Die Schweiz spielt im teuersten Stadion der Welt"
 * The match reels are the primary, swipeable cards; the rest are classified
 * and filterable. Goal/scorer DATA comes from API-Football, not these titles.
 */

"use strict";

// ---------------------------------------------------------------------------
// Match-title parsing
// ---------------------------------------------------------------------------

/**
 * Splits a "Die Live-Highlights bei {A} - {B}" title into its two teams.
 *
 * Robust to the separators the brief calls out (-, –, —, and runs like "---")
 * by matching a dash run that is surrounded by whitespace. The whitespace
 * requirement is deliberate: it leaves hyphenated country names intact
 * ("Guinea-Bissau", "Bosnien-Herzegowina") because their hyphen has no
 * surrounding spaces.
 *
 * @param {string} title
 * @returns {{teamA: string, teamB: string} | null} null when the title is not
 *          a "Live-Highlights bei …" match reel (caller should log + skip).
 */
export function parseMatchTitle(title) {
  if (typeof title !== "string") return null;
  const m = /^\s*Die Live-Highlights bei\s+(.+)$/i.exec(title.trim());
  if (!m) return null;
  return splitTeams(m[1]);
}

/**
 * Splits a "{A} - {B}" team pair on a whitespace-padded dash run.
 * Exposed separately so it can be reused on calendar-event titles.
 *
 * @param {string} pair
 * @returns {{teamA: string, teamB: string} | null}
 */
export function splitTeams(pair) {
  if (typeof pair !== "string") return null;
  const parts = pair.trim().split(/\s+[-–—]+\s+/);
  if (parts.length !== 2) return null;
  const teamA = parts[0].trim();
  const teamB = parts[1].trim();
  if (!teamA || !teamB) return null;
  return { teamA, teamB };
}

/**
 * Parses an SRF livecenter title into a structured fixture.
 *   "Fussball: FIFA WM 2026, Vorrunde, Gruppe E, Deutschland - Curaçao"
 *   "Fussball: FIFA WM 2026, Achtelfinal, Spanien - Marokko"  (no group)
 * Returns null for non-WM-football items (volleyball, other shows).
 *
 * @param {string} title
 * @returns {{round: string, group: string|null, teamA: string, teamB: string} | null}
 */
export function parseLiveCenterTitle(title) {
  if (typeof title !== "string" || !/FIFA WM 2026/.test(title)) return null;
  const after = title.split(/FIFA WM 2026,\s*/)[1];
  if (!after) return null;
  const segs = after.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return null;
  const teams = splitTeams(segs[segs.length - 1]);
  if (!teams) return null;
  const round = segs[0];
  const groupSeg = segs.slice(1, -1).find((s) => /^Gruppe\b/i.test(s));
  const group = groupSeg ? groupSeg.replace(/^Gruppe\s*/i, "").trim() : null;
  return { round, group, teamA: teams.teamA, teamB: teams.teamB };
}

// ---------------------------------------------------------------------------
// Clip classification
// ---------------------------------------------------------------------------

/** @typedef {"match" | "summary" | "goal" | "feature"} ClipKind */

/**
 * Classifies a clip so the feed can group/filter it.
 *  - "match"   : the full "Die Live-Highlights bei A - B" reel.
 *  - "summary" : a longer recap that names a result ("… siegt", "Auftaktsieg …").
 *  - "goal"    : a short single-moment clip (a goal, a foul, a save).
 *  - "feature" : everything else (magazine / preview pieces).
 *
 * Heuristic, not authoritative — used only for UI grouping. durationSec is the
 * tie-breaker the title alone can't give.
 *
 * @param {{title?: string, durationSec?: number}} clip
 * @returns {ClipKind}
 */
export function classifyClip(clip) {
  const title = (clip && clip.title) || "";
  const dur = (clip && clip.durationSec) || 0;

  if (parseMatchTitle(title)) return "match";

  // Short clips are single moments regardless of wording.
  if (dur > 0 && dur <= 90) return "goal";

  // Longer clips that read like a recap.
  if (/\b(sieg|siegt|gewinnt|Auftaktsieg|schlägt|Remis|unentschieden|Niederlage|müht sich|setzt sich)\b/i.test(title)) {
    return "summary";
  }

  return dur >= 150 ? "summary" : "feature";
}

// ---------------------------------------------------------------------------
// Team normalisation + matching (also used by the calendar write-back later)
// ---------------------------------------------------------------------------

/**
 * Lower-cases, strips diacritics, and collapses punctuation/whitespace so two
 * spellings of the same country compare equal. Umlaut-tolerant by design.
 * @param {string} name
 * @returns {string}
 */
export function normalizeTeam(name) {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks (ö→o, é→e)
    .toLowerCase()
    .replace(/&/g, " und ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Tolerant equality for team names across sources (SRF German names,
 * calendar-event names, API-Football English names). Handles diacritics and
 * the co-host "A & B" wording by checking token containment in both
 * directions. Conservative: requires a non-trivial token overlap.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function teamsMatch(a, b) {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Reduce each side to a set of canonical country tokens, then accept on any
  // overlap. This covers cross-language names (Österreich↔Austria) and co-host
  // "A & B" wording (Schweiz ⊂ {Schweiz, Österreich}) in one rule.
  const ta = canonicalTokens(na);
  const tb = canonicalTokens(nb);
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

/**
 * Maps a normalised team name to its canonical country token(s).
 * Whole-name aliases win (and keep short codes like "usa"); otherwise each
 * word is alias-mapped and filler (<4 chars, e.g. "und") is dropped.
 * @param {string} normalized  output of normalizeTeam()
 * @returns {Set<string>}
 */
function canonicalTokens(normalized) {
  if (TEAM_ALIASES[normalized]) return new Set(TEAM_ALIASES[normalized].split(" "));
  const out = new Set();
  for (const tok of normalized.split(" ")) {
    const mapped = TEAM_ALIASES[tok];
    if (mapped) {
      for (const m of mapped.split(" ")) out.add(m);
    } else if (tok.length >= 4) {
      out.add(tok);
    }
  }
  return out;
}

/**
 * Cross-language aliases keyed by normalizeTeam() output. German (SRF) and
 * English (API-Football) names that differ map to a shared canonical key.
 * Extend as fixtures reveal more. Keep keys normalised (no diacritics).
 */
export const TEAM_ALIASES = {
  // German → canonical
  deutschland: "germany",
  oesterreich: "austria",
  osterreich: "austria",
  schweiz: "switzerland",
  spanien: "spain",
  frankreich: "france",
  italien: "italy",
  england: "england",
  niederlande: "netherlands",
  belgien: "belgium",
  kroatien: "croatia",
  daenemark: "denmark",
  danemark: "denmark",
  polen: "poland",
  marokko: "morocco",
  suedkorea: "south korea",
  sudkorea: "south korea",
  "republik korea": "south korea",
  republikkorea: "south korea",
  "bosnien und herzegowina": "bosnia and herzegovina",
  "bosnien herzegowina": "bosnia and herzegovina",
  "bosnien-herzegowina": "bosnia and herzegovina",
  "ir iran": "iran",
  iran: "iran",
  elfenbeinkueste: "ivory coast",
  elfenbeinkuste: "ivory coast",
  "saudi arabien": "saudi arabia",
  "vereinigte staaten": "usa",
  usa: "usa",
  mexiko: "mexico",
  kanada: "canada",
  brasilien: "brazil",
  argentinien: "argentina",
  kolumbien: "colombia",
  algerien: "algeria",
  norwegen: "norway",
  jordanien: "jordan",
  irak: "iraq",
  japan: "japan",
  australien: "australia",
  senegal: "senegal",
  portugal: "portugal",
  uruguay: "uruguay",
  ecuador: "ecuador",
};

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/**
 * Subdivision flags that have no ISO-3166-1 alpha-2 code (the four UK home
 * nations). Keyed by normalizeTeam() output, German + English.
 */
const SUBDIVISION_FLAGS = {
  england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  schottland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  nordirland: "🇬🇧",
  "northern ireland": "🇬🇧",
};

/**
 * Team name (normalizeTeam output) → ISO-3166-1 alpha-2. German AND English
 * spellings map to the same code so flags resolve from SRF (German) and
 * API-Football (English) alike. The flag emoji is generated from the code, so
 * this stays a small data table rather than a wall of emoji.
 */
const TEAM_ISO = {
  agypten: "eg", egypt: "eg",
  albanien: "al", albania: "al",
  algerien: "dz", algeria: "dz",
  angola: "ao",
  argentinien: "ar", argentina: "ar",
  australien: "au", australia: "au",
  belgien: "be", belgium: "be",
  "bosnien herzegowina": "ba", "bosnia and herzegovina": "ba", bosnien: "ba",
  brasilien: "br", brazil: "br",
  "burkina faso": "bf",
  chile: "cl",
  china: "cn",
  "costa rica": "cr",
  curacao: "cw",
  danemark: "dk", denmark: "dk",
  "dr kongo": "cd", "congo dr": "cd",
  deutschland: "de", germany: "de",
  ecuador: "ec",
  elfenbeinkuste: "ci", "ivory coast": "ci", "cote divoire": "ci",
  finnland: "fi", finland: "fi",
  frankreich: "fr", france: "fr",
  georgien: "ge", georgia: "ge",
  ghana: "gh",
  griechenland: "gr", greece: "gr",
  "guinea bissau": "gw",
  guinea: "gn",
  haiti: "ht",
  honduras: "hn",
  indien: "in", india: "in",
  indonesien: "id", indonesia: "id",
  irak: "iq", iraq: "iq",
  iran: "ir",
  irland: "ie", ireland: "ie",
  island: "is", iceland: "is",
  israel: "il",
  italien: "it", italy: "it",
  jamaika: "jm", jamaica: "jm",
  japan: "jp",
  jordanien: "jo", jordan: "jo",
  kamerun: "cm", cameroon: "cm",
  kanada: "ca", canada: "ca",
  "kap verde": "cv", "cape verde": "cv", "cabo verde": "cv",
  katar: "qa", qatar: "qa",
  kenia: "ke", kenya: "ke",
  kolumbien: "co", colombia: "co",
  kroatien: "hr", croatia: "hr",
  libyen: "ly", libya: "ly",
  mali: "ml",
  marokko: "ma", morocco: "ma",
  mauretanien: "mr", mauritania: "mr",
  mexiko: "mx", mexico: "mx",
  neuseeland: "nz", "new zealand": "nz",
  niederlande: "nl", netherlands: "nl", holland: "nl",
  nigeria: "ng",
  nordmazedonien: "mk", "north macedonia": "mk",
  norwegen: "no", norway: "no",
  oman: "om",
  osterreich: "at", austria: "at",
  panama: "pa",
  paraguay: "py",
  peru: "pe",
  polen: "pl", poland: "pl",
  portugal: "pt",
  rumanien: "ro", romania: "ro",
  "saudi arabien": "sa", "saudi arabia": "sa",
  schweden: "se", sweden: "se",
  schweiz: "ch", switzerland: "ch",
  senegal: "sn",
  serbien: "rs", serbia: "rs",
  simbabwe: "zw", zimbabwe: "zw",
  slowakei: "sk", slovakia: "sk",
  slowenien: "si", slovenia: "si",
  spanien: "es", spain: "es",
  sudafrika: "za", "south africa": "za",
  sudkorea: "kr", "south korea": "kr", korea: "kr",
  tschechien: "cz", "czech republic": "cz", czechia: "cz",
  tunesien: "tn", tunisia: "tn",
  turkei: "tr", turkey: "tr", turkiye: "tr",
  ukraine: "ua",
  ungarn: "hu", hungary: "hu",
  uruguay: "uy",
  usa: "us", "vereinigte staaten": "us", "united states": "us",
  usbekistan: "uz", uzbekistan: "uz",
  venezuela: "ve",
};

/** Build a flag emoji from an ISO-3166-1 alpha-2 code. */
function isoToFlag(cc) {
  return cc
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

/** FIFA ISO-3 → ISO-2 + display name for the WM 48-team set + common neighbours. */
const ISO3_LOOKUP = {
  ARG: { iso2: "ar", name: "Argentinien" }, AUS: { iso2: "au", name: "Australien" },
  AUT: { iso2: "at", name: "Österreich" }, BIH: { iso2: "ba", name: "Bosnien-Herzegowina" },
  BRA: { iso2: "br", name: "Brasilien" }, CAN: { iso2: "ca", name: "Kanada" },
  CHE: { iso2: "ch", name: "Schweiz" }, CIV: { iso2: "ci", name: "Elfenbeinküste" },
  COL: { iso2: "co", name: "Kolumbien" }, CRC: { iso2: "cr", name: "Costa Rica" },
  CRO: { iso2: "hr", name: "Kroatien" }, CUW: { iso2: "cw", name: "Curaçao" },
  CZE: { iso2: "cz", name: "Tschechien" }, DEN: { iso2: "dk", name: "Dänemark" },
  DOM: { iso2: "do", name: "Dominikanische Rep." }, ECU: { iso2: "ec", name: "Ecuador" },
  EGY: { iso2: "eg", name: "Ägypten" }, ENG: { iso2: "gb-eng", name: "England" },
  ESP: { iso2: "es", name: "Spanien" }, FRA: { iso2: "fr", name: "Frankreich" },
  GER: { iso2: "de", name: "Deutschland" }, GHA: { iso2: "gh", name: "Ghana" },
  GUI: { iso2: "gn", name: "Guinea" }, HAI: { iso2: "ht", name: "Haiti" },
  HON: { iso2: "hn", name: "Honduras" }, IRL: { iso2: "ie", name: "Irland" },
  IRN: { iso2: "ir", name: "Iran" }, IRQ: { iso2: "iq", name: "Irak" },
  ITA: { iso2: "it", name: "Italien" }, JAM: { iso2: "jm", name: "Jamaika" },
  JOR: { iso2: "jo", name: "Jordanien" }, JPN: { iso2: "jp", name: "Japan" },
  KOR: { iso2: "kr", name: "Republik Korea" }, KSA: { iso2: "sa", name: "Saudi-Arabien" },
  MAR: { iso2: "ma", name: "Marokko" }, MEX: { iso2: "mx", name: "Mexiko" },
  NED: { iso2: "nl", name: "Niederlande" }, NGA: { iso2: "ng", name: "Nigeria" },
  NOR: { iso2: "no", name: "Norwegen" }, NZL: { iso2: "nz", name: "Neuseeland" },
  PAN: { iso2: "pa", name: "Panama" }, PAR: { iso2: "py", name: "Paraguay" },
  PER: { iso2: "pe", name: "Peru" }, POL: { iso2: "pl", name: "Polen" },
  POR: { iso2: "pt", name: "Portugal" }, RSA: { iso2: "za", name: "Südafrika" },
  SCO: { iso2: "gb-sct", name: "Schottland" }, SEN: { iso2: "sn", name: "Senegal" },
  SRB: { iso2: "rs", name: "Serbien" }, SUI: { iso2: "ch", name: "Schweiz" },
  TUN: { iso2: "tn", name: "Tunesien" }, TUR: { iso2: "tr", name: "Türkei" },
  UAE: { iso2: "ae", name: "Ver. Arab. Emirate" }, UKR: { iso2: "ua", name: "Ukraine" },
  URU: { iso2: "uy", name: "Uruguay" }, USA: { iso2: "us", name: "USA" },
  UZB: { iso2: "uz", name: "Usbekistan" }, VEN: { iso2: "ve", name: "Venezuela" },
  ALG: { iso2: "dz", name: "Algerien" }, BEL: { iso2: "be", name: "Belgien" },
};

/** Country flag emoji from FIFA's 3-letter code (or "⚽"). */
export function flagFromIso3(code) {
  const e = ISO3_LOOKUP[String(code || "").toUpperCase()];
  if (!e) return "⚽";
  if (e.iso2 === "gb-eng") return "🏴󠁧󠁢󠁥󠁮󠁧󠁿";
  if (e.iso2 === "gb-sct") return "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
  return isoToFlag(e.iso2);
}

/** German display name from FIFA's 3-letter code (or "" when unknown). */
export function nameFromIso3(code) {
  const e = ISO3_LOOKUP[String(code || "").toUpperCase()];
  return e ? e.name : "";
}

/**
 * @param {string} teamName  team name in German or English
 * @returns {string} flag emoji, or "⚽" when genuinely unknown
 */
export function flagFor(teamName) {
  const n = normalizeTeam(teamName);
  if (SUBDIVISION_FLAGS[n]) return SUBDIVISION_FLAGS[n];
  const iso = TEAM_ISO[n] || TEAM_ISO[TEAM_ALIASES[n]];
  return iso ? isoToFlag(iso) : "⚽";
}

/**
 * FIFA IdTeam → flag emoji, for the 48 WM-2026 teams. Language-INVARIANT: the
 * id is the same whether the Worker serves "Deutschland", "Germany", or
 * "Alemanha", so flags stay correct in every language without a per-language
 * name table. Built from the German feed via flagFor() (handles England/
 * Scotland subdivision flags too). flagForId(id) ?? flagFor(name) at call sites.
 */
const FIFA_TEAM_FLAG = {
  "43855": "🇪🇬", // Ägypten
  "43843": "🇩🇿", // Algerien
  "43922": "🇦🇷", // Argentinien
  "43976": "🇦🇺", // Australien
  "43935": "🇧🇪", // Belgien
  "44037": "🇧🇦", // Bosnien und Herzegowina
  "43924": "🇧🇷", // Brasilien
  "1895293": "🇨🇼", // Curaçao
  "43948": "🇩🇪", // Deutschland
  "20014": "🇨🇩", // DR Kongo
  "43927": "🇪🇨", // Ecuador
  "43854": "🇨🇮", // Elfenbeinküste
  "43942": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", // England
  "43946": "🇫🇷", // Frankreich
  "43860": "🇬🇭", // Ghana
  "43908": "🇭🇹", // Haiti
  "43817": "🇮🇷", // IR Iran
  "43818": "🇮🇶", // Irak
  "43819": "🇯🇵", // Japan
  "43820": "🇯🇴", // Jordanien
  "43899": "🇨🇦", // Kanada
  "43850": "🇨🇻", // Kap Verde
  "43834": "🇶🇦", // Katar
  "43926": "🇨🇴", // Kolumbien
  "43938": "🇭🇷", // Kroatien
  "43872": "🇲🇦", // Marokko
  "43911": "🇲🇽", // Mexiko
  "43978": "🇳🇿", // Neuseeland
  "43960": "🇳🇱", // Niederlande
  "43961": "🇳🇴", // Norwegen
  "43934": "🇦🇹", // Österreich
  "43914": "🇵🇦", // Panama
  "43928": "🇵🇾", // Paraguay
  "43963": "🇵🇹", // Portugal
  "43822": "🇰🇷", // Republik Korea
  "43835": "🇸🇦", // Saudi-Arabien
  "43967": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", // Schottland
  "43970": "🇸🇪", // Schweden
  "43971": "🇨🇭", // Schweiz
  "43879": "🇸🇳", // Senegal
  "43969": "🇪🇸", // Spanien
  "43883": "🇿🇦", // Südafrika
  "43995": "🇨🇿", // Tschechien
  "43888": "🇹🇳", // Tunesien
  "43972": "🇹🇷", // Türkei
  "43930": "🇺🇾", // Uruguay
  "43921": "🇺🇸", // USA
  "44005": "🇺🇿", // Usbekistan
};

/**
 * @param {string|number} idTeam  FIFA IdTeam
 * @returns {string|null} flag emoji, or null when the id is unknown (caller
 *   should fall back to flagFor(name)).
 */
export function flagForId(idTeam) {
  return FIFA_TEAM_FLAG[String(idTeam || "")] || null;
}

// ---------------------------------------------------------------------------
// Watch-link (SRF Play deep link) — brief format, raw colons (not %3A)
// ---------------------------------------------------------------------------

/**
 * Builds the public SRF Play watch-link for a clip. Used by the feed (optional)
 * and by the calendar write-back later.
 * Format: https://www.srf.ch/play/tv/fifa-wm-2026-clips/video/{slug}?urn=urn:srf:video:{id}
 *
 * @param {string} urn   e.g. "urn:srf:video:f8250d9b-…"
 * @param {string} [slug="video"]  human slug; SRF redirects even when generic
 * @returns {string}
 */
export function watchLink(urn, slug = "video") {
  return `https://www.srf.ch/play/tv/fifa-wm-2026-clips/video/${slug}?urn=${urn}`;
}
