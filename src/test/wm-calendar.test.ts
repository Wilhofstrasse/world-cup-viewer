/**
 * wm-calendar.test.ts — pure calendar write-back logic: event↔fixture matching,
 * the appended note, and idempotent ICS surgery that must never touch time /
 * free-busy / attendees (the brief's hard rules).
 */

import { describe, it, expect } from "vitest";

import {
  teamsFromEventTitle,
  matchForEvent,
  buildNoteLine,
  enrichEventIcs,
  alreadyEnriched,
  NOTE_MARKER,
} from "../wm/calendar.js";
import type { Match } from "../wm/types.js";

const finished: Match = {
  id: 9001,
  dateISO: "2026-06-17T17:00:00+02:00",
  status: "finished",
  teamA: "Austria",
  teamB: "Jordan",
  scoreA: 2,
  scoreB: 1,
  minute: null,
  goals: [
    { team: "A", minute: 30, extra: null, scorer: "R. Schmid", type: "goal" },
    { team: "A", minute: 45, extra: 2, scorer: "Al-Arab", type: "own" },
    { team: "B", minute: 70, extra: null, scorer: "Olwan", type: "goal" },
  ],
};

const CLIP = "urn:srf:video:f8250d9b-af13-45c8-866a-8e3ee23b01ac";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple//macOS//EN",
  "BEGIN:VEVENT",
  "UID:ABC-123",
  "DTSTAMP:20260617T060000Z",
  "DTSTART:20260617T150000Z",
  "DTEND:20260617T170000Z",
  "SUMMARY:WM 🇦🇹🇯🇴 Österreich - Jordanien",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("teamsFromEventTitle", () => {
  it("strips leading 'WM' + flags and splits the teams", () => {
    expect(teamsFromEventTitle("WM 🇦🇹🇯🇴 Österreich - Jordanien")).toEqual({ teamA: "Österreich", teamB: "Jordanien" });
    expect(teamsFromEventTitle("WM 🏳️🏳️ Schweiz – Brasilien")).toEqual({ teamA: "Schweiz", teamB: "Brasilien" });
    expect(teamsFromEventTitle("WM Irak - Norwegen")).toEqual({ teamA: "Irak", teamB: "Norwegen" });
  });
  it("returns null for non-WM / unsplittable titles", () => {
    expect(teamsFromEventTitle("Zahnarzt Gabriel")).toBeNull();
    expect(teamsFromEventTitle("WM Eröffnung")).toBeNull();
  });
});

describe("matchForEvent", () => {
  it("matches German event names to English fixture names, order-independent", () => {
    expect(matchForEvent("WM 🇦🇹🇯🇴 Österreich - Jordanien", [finished])).toBe(finished);
    expect(matchForEvent("WM Jordanien - Österreich", [finished])).toBe(finished); // swapped
  });
  it("returns null when no fixture matches", () => {
    expect(matchForEvent("WM Brasilien - Spanien", [finished])).toBeNull();
  });
});

describe("buildNoteLine", () => {
  it("includes marker, score, scorers and the highlight link", () => {
    const note = buildNoteLine(finished, CLIP);
    expect(note).toContain(NOTE_MARKER);
    expect(note).toContain("Austria 2:1 Jordan");
    expect(note).toContain("Schmid");
    expect(note).toContain("Al-Arab (ET)");
    expect(note).toContain(`Highlights: https://www.srf.ch/play/tv/fifa-wm-2026-clips/video/video?urn=${CLIP}`);
  });
  it("is empty for a non-finished match (nothing to write yet)", () => {
    expect(buildNoteLine({ ...finished, status: "scheduled", scoreA: null, scoreB: null })).toBe("");
  });
});

describe("enrichEventIcs", () => {
  it("adds URL + DESCRIPTION and leaves time/free-busy/uid untouched", () => {
    const out = enrichEventIcs(ICS, finished, CLIP)!;
    expect(out).toBeTruthy();
    expect(out).toContain(`URL:https://www.srf.ch/play/tv/fifa-wm-2026-clips/video/video?urn=${CLIP}`);
    expect(out).toContain(`DESCRIPTION:${NOTE_MARKER}`);
    // hard rules: these lines must be byte-for-byte preserved
    expect(out).toContain("DTSTART:20260617T150000Z");
    expect(out).toContain("DTEND:20260617T170000Z");
    expect(out).toContain("TRANSP:TRANSPARENT");
    expect(out).toContain("UID:ABC-123");
    // structure intact
    expect(out).toContain("END:VEVENT");
    expect(out.indexOf("URL:")).toBeLessThan(out.indexOf("END:VEVENT"));
  });

  it("is idempotent — a second pass makes no change", () => {
    const once = enrichEventIcs(ICS, finished, CLIP)!;
    expect(alreadyEnriched(once, CLIP)).toBe(true);
    expect(enrichEventIcs(once, finished, CLIP)).toBeNull();
  });

  it("appends to an existing DESCRIPTION rather than replacing it", () => {
    const withDesc = ICS.replace("TRANSP:TRANSPARENT", "DESCRIPTION:Anpfiff 17:00\r\nTRANSP:TRANSPARENT");
    const out = enrichEventIcs(withDesc, finished, CLIP)!;
    expect(out).toContain("Anpfiff 17:00\\n");
    expect(out).toContain(NOTE_MARKER);
  });

  it("returns null for a not-yet-finished match", () => {
    expect(enrichEventIcs(ICS, { ...finished, status: "live", minute: 60 }, CLIP)).toBeNull();
  });

  it("works without a clip (score + scorers only, no URL)", () => {
    const out = enrichEventIcs(ICS, finished)!;
    expect(out).toContain(NOTE_MARKER);
    expect(out).not.toContain("URL:https://www.srf.ch");
  });
});
