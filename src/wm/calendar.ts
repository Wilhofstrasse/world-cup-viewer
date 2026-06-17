/**
 * wm/calendar.ts — calendar write-back enrichment logic (transport-agnostic).
 *
 * This module is the PURE half of the "write the score + scorers + highlight
 * link into Filipe's 'WM 🏳️🏳️ …' calendar events" feature: given a finished
 * Match (+ optional highlight clip URN) and the existing raw VEVENT (ICS), it
 * decides whether an update is needed and produces the new ICS.
 *
 * Hard safety rules from the brief, enforced here by construction:
 *  - Idempotent: if the watch-link is already present, no update is produced.
 *  - The watch-link goes in the VEVENT URL property; ONE summary line is
 *    appended to DESCRIPTION.
 *  - Time + free/busy + attendees are NEVER touched: DTSTART/DTEND/DURATION/
 *    TRANSP/ATTENDEE/ORGANIZER lines are passed through verbatim. We only
 *    add/replace URL and edit DESCRIPTION, by line-level surgery on the raw ICS
 *    (no full re-serialize that could drop properties).
 *
 * The CalDAV transport (PROPFIND discovery, REPORT, conditional PUT with
 * If-Match) is a separate, credential-gated module added once an iCloud
 * app-specific password is available and reachability is verified.
 */

import type { Match, Goal } from "./types.js";
import { teamsMatch, flagFor, watchLink } from "../../web/wm/parse.js";

/** Marker that tags our appended note so re-runs are idempotent. */
export const NOTE_MARKER = "— WM-Cockpit —";

// ---------------------------------------------------------------------------
// Matching a calendar event to a fixture
// ---------------------------------------------------------------------------

/**
 * Pulls the two team names out of a "WM …" event title. Tolerant of the
 * "WM 🏳️🏳️ {A} - {B}" convention and a plain "WM {A} - {B}": strips a leading
 * "WM" + any flag/emoji, then splits on a spaced dash.
 */
export function teamsFromEventTitle(summary: string): { teamA: string; teamB: string } | null {
  if (typeof summary !== "string") return null;
  // Drop a leading "WM" token and any non-letter lead-in (flags, emoji, spaces).
  const body = summary.replace(/^\s*WM\b/i, "").replace(/^[^\p{L}]+/u, "").trim();
  const parts = body.split(/\s+[-–—]+\s+/);
  if (parts.length !== 2) return null;
  const teamA = parts[0].trim();
  const teamB = parts[1].trim();
  if (!teamA || !teamB) return null;
  return { teamA, teamB };
}

/**
 * Finds the match for a calendar event by tolerant team matching, order-
 * independent (calendar A/B may be swapped vs the fixture's home/away).
 */
export function matchForEvent(summary: string, matches: Match[]): Match | null {
  const ev = teamsFromEventTitle(summary);
  if (!ev) return null;
  for (const m of matches) {
    const sameOrder = teamsMatch(ev.teamA, m.teamA) && teamsMatch(ev.teamB, m.teamB);
    const swapped = teamsMatch(ev.teamA, m.teamB) && teamsMatch(ev.teamB, m.teamA);
    if (sameOrder || swapped) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Building the enrichment text
// ---------------------------------------------------------------------------

/** "23' Schmid" / "45'+2 Al-Arab (ET)" — compact, German-friendly. */
function goalText(g: Goal): string {
  const min = g.minute == null ? "" : `${g.minute}${g.extra ? "+" + g.extra : ""}'`;
  const tag = g.type === "penalty" ? " (FE)" : g.type === "own" ? " (ET)" : "";
  return `${min} ${g.scorer}${tag}`.trim();
}

/**
 * The single DESCRIPTION line we append, e.g.:
 *   "— WM-Cockpit — 🇦🇹 Österreich 2:1 Jordanien 🇯🇴 · ⚽ 30' Schmid, 45'+2 Al-Arab (ET), 70' Olwan · Highlights: https://…"
 * Returns "" when the match isn't finished (nothing to write yet).
 */
export function buildNoteLine(match: Match, clipUrn?: string): string {
  if (match.status !== "finished" || match.scoreA == null || match.scoreB == null) return "";
  const head = `${flagFor(match.teamA)} ${match.teamA} ${match.scoreA}:${match.scoreB} ${match.teamB} ${flagFor(match.teamB)}`;
  const scorers = (match.goals || []).map(goalText).filter(Boolean).join(", ");
  const link = clipUrn ? watchLink(clipUrn) : "";
  const parts = [`${NOTE_MARKER} ${head}`];
  if (scorers) parts.push(`⚽ ${scorers}`);
  if (link) parts.push(`Highlights: ${link}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// ICS line-level surgery (RFC 5545)
// ---------------------------------------------------------------------------

/** Unfolds RFC-5545 folded lines (continuation lines start with space/tab). */
function unfold(ics: string): string[] {
  const raw = ics.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Escapes a value for a TEXT property (DESCRIPTION/URL params per RFC 5545). */
function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Idempotency guard: true when this VEVENT was already enriched. buildNoteLine
 * always prefixes NOTE_MARKER, so its presence (or the exact watch-link) means
 * a prior run already wrote this event — skip it.
 */
export function alreadyEnriched(ics: string, clipUrn?: string): boolean {
  if (ics.includes(NOTE_MARKER)) return true;
  if (clipUrn && ics.includes(watchLink(clipUrn))) return true;
  return false;
}

/**
 * Produces the updated ICS for one event, or null when no change is needed
 * (not finished, already enriched, or nothing to add). Edits ONLY the URL
 * property and the DESCRIPTION; every other line is preserved verbatim.
 */
export function enrichEventIcs(ics: string, match: Match, clipUrn?: string): string | null {
  const note = buildNoteLine(match, clipUrn);
  if (!note) return null;
  if (alreadyEnriched(ics, clipUrn)) return null;

  const lines = unfold(ics);
  const link = clipUrn ? watchLink(clipUrn) : "";

  let touchedUrl = false;
  let touchedDesc = false;
  const out: string[] = [];

  for (const line of lines) {
    const name = line.split(/[:;]/, 1)[0].toUpperCase();

    if (name === "URL" && link) {
      out.push(`URL:${link}`); // replace any existing URL with the watch-link
      touchedUrl = true;
      continue;
    }
    if (name === "DESCRIPTION") {
      // (A pre-enriched event was already skipped by alreadyEnriched() above.)
      const existing = line.slice(line.indexOf(":") + 1);
      const merged = existing ? `${existing}\\n${icsEscape(note)}` : icsEscape(note);
      out.push(`DESCRIPTION:${merged}`);
      touchedDesc = true;
      continue;
    }
    out.push(line);
  }

  // Insert URL / DESCRIPTION before END:VEVENT if they weren't present.
  const endIdx = out.findIndex((l) => l.toUpperCase().startsWith("END:VEVENT"));
  const insertAt = endIdx === -1 ? out.length : endIdx;
  const inserts: string[] = [];
  if (!touchedUrl && link) inserts.push(`URL:${link}`);
  if (!touchedDesc) inserts.push(`DESCRIPTION:${icsEscape(note)}`);
  if (inserts.length) out.splice(insertAt, 0, ...inserts);

  return out.join("\r\n");
}
