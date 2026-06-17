/**
 * wm-parse.test.ts — covers the pure WM helpers against the REAL captured
 * SRF feed (src/test/fixtures/*.json, fetched live 2026-06-17). These shapes
 * are the integration risk, so we assert on actual data, not invented samples.
 *
 * The helpers live in web/wm/*.js as ESM so the browser and vitest share one
 * source of truth (no build step). vitest imports the .js directly.
 */

import { describe, it, expect } from "vitest";

import {
  parseMatchTitle,
  parseLiveCenterTitle,
  splitTeams,
  classifyClip,
  normalizeTeam,
  teamsMatch,
  flagFor,
  watchLink,
} from "../../web/wm/parse.js";

import {
  clipsFromEpisodeComposition,
  hlsFromMediaComposition,
} from "../../web/wm/il.js";

import clipsFixture from "./fixtures/wm-clips-il.json";
import compositionFixture from "./fixtures/wm-mediacomposition-il.json";

describe("parseMatchTitle", () => {
  it("splits real 'Die Live-Highlights bei A - B' titles", () => {
    expect(parseMatchTitle("Die Live-Highlights bei Österreich - Jordanien")).toEqual({
      teamA: "Österreich",
      teamB: "Jordanien",
    });
    expect(parseMatchTitle("Die Live-Highlights bei Argentinien - Algerien")).toEqual({
      teamA: "Argentinien",
      teamB: "Algerien",
    });
    expect(parseMatchTitle("Die Live-Highlights bei Irak - Norwegen")).toEqual({
      teamA: "Irak",
      teamB: "Norwegen",
    });
  });

  it("returns null for non-match titles (goals, summaries, magazine)", () => {
    expect(parseMatchTitle("Schmid bringt Österreich mit einem Sonntagsschuss in Führung")).toBeNull();
    expect(parseMatchTitle("Die Schweiz spielt im teuersten Stadion der Welt")).toBeNull();
    expect(parseMatchTitle("")).toBeNull();
    // @ts-expect-error wrong type tolerated
    expect(parseMatchTitle(undefined)).toBeNull();
  });
});

describe("parseLiveCenterTitle", () => {
  it("parses a group-stage fixture", () => {
    expect(parseLiveCenterTitle("Fussball: FIFA WM 2026, Vorrunde, Gruppe E, Deutschland - Curaçao")).toEqual({
      round: "Vorrunde",
      group: "E",
      teamA: "Deutschland",
      teamB: "Curaçao",
    });
  });
  it("parses a knockout fixture (no group)", () => {
    expect(parseLiveCenterTitle("Fussball: FIFA WM 2026, Achtelfinal, Spanien - Marokko")).toEqual({
      round: "Achtelfinal",
      group: null,
      teamA: "Spanien",
      teamB: "Marokko",
    });
  });
  it("ignores non-WM / non-football livecenter items", () => {
    expect(parseLiveCenterTitle("Volleyball: European League, Männer, Schweiz - Ungarn")).toBeNull();
    expect(parseLiveCenterTitle("")).toBeNull();
  });
});

describe("splitTeams — separator + hyphenated-country robustness", () => {
  it("handles hyphen, en-dash, em-dash and dash runs", () => {
    expect(splitTeams("Schweiz - Brasilien")).toEqual({ teamA: "Schweiz", teamB: "Brasilien" });
    expect(splitTeams("Schweiz – Brasilien")).toEqual({ teamA: "Schweiz", teamB: "Brasilien" });
    expect(splitTeams("Schweiz — Brasilien")).toEqual({ teamA: "Schweiz", teamB: "Brasilien" });
    expect(splitTeams("Schweiz --- Brasilien")).toEqual({ teamA: "Schweiz", teamB: "Brasilien" });
  });

  it("does NOT split hyphenated country names (no surrounding spaces)", () => {
    expect(splitTeams("Guinea-Bissau - Schweiz")).toEqual({
      teamA: "Guinea-Bissau",
      teamB: "Schweiz",
    });
    expect(splitTeams("Bosnien-Herzegowina - Italien")).toEqual({
      teamA: "Bosnien-Herzegowina",
      teamB: "Italien",
    });
  });

  it("returns null when there is no clean two-team split", () => {
    expect(splitTeams("Schweiz")).toBeNull();
    expect(splitTeams("A - B - C")).toBeNull();
  });
});

describe("classifyClip", () => {
  it("classifies the full reel as a match", () => {
    expect(classifyClip({ title: "Die Live-Highlights bei Irak - Norwegen", durationSec: 424 })).toBe("match");
  });
  it("classifies short clips as goals regardless of wording", () => {
    expect(classifyClip({ title: "Messi bringt Argentinien früh in Front", durationSec: 52 })).toBe("goal");
    expect(classifyClip({ title: "Das Foulspiel von Messi gegen Algerien", durationSec: 36 })).toBe("goal");
  });
  it("classifies result recaps as summaries", () => {
    expect(classifyClip({ title: "Österreich müht sich zum Auftaktsieg gegen Jordanien", durationSec: 298 })).toBe("summary");
    expect(classifyClip({ title: "Messi egalisiert mit Hattrick WM-Rekord – Argentinien siegt", durationSec: 302 })).toBe("summary");
  });
});

describe("normalizeTeam + teamsMatch + flagFor", () => {
  it("strips umlauts/diacritics", () => {
    expect(normalizeTeam("Österreich")).toBe("osterreich");
    expect(normalizeTeam("  Süd-Korea ")).toBe("sud korea");
  });
  it("matches German and English names of the same country", () => {
    expect(teamsMatch("Österreich", "Austria")).toBe(true);
    expect(teamsMatch("Schweiz", "Switzerland")).toBe(true);
    expect(teamsMatch("Deutschland", "Germany")).toBe(true);
    expect(teamsMatch("Argentinien", "Brasilien")).toBe(false);
  });
  it("tolerates co-host '&' wording", () => {
    expect(teamsMatch("Schweiz", "Schweiz & Österreich")).toBe(true);
  });
  it("maps known flags and falls back for unknown teams", () => {
    expect(flagFor("Schweiz")).toBe("🇨🇭");
    expect(flagFor("Austria")).toBe("🇦🇹");
    expect(flagFor("Atlantis")).toBe("⚽");
  });
});

describe("watchLink", () => {
  it("uses raw colons in the urn (not %3A)", () => {
    const link = watchLink("urn:srf:video:abc123");
    expect(link).toContain("?urn=urn:srf:video:abc123");
    expect(link).not.toContain("%3A");
  });
});

describe("il.js mappers against the live fixture", () => {
  it("flattens the episodeComposition payload into clips", () => {
    const clips = clipsFromEpisodeComposition(clipsFixture);
    expect(clips.length).toBeGreaterThan(10);
    for (const c of clips) {
      expect(typeof c.urn).toBe("string");
      expect(c.urn.startsWith("urn:srf:video:")).toBe(true);
      expect(typeof c.durationSec).toBe("number");
    }
    const reel = clips.find((c) => c.title === "Die Live-Highlights bei Österreich - Jordanien");
    expect(reel).toBeTruthy();
    expect(reel!.durationSec).toBeGreaterThan(300);
    expect(reel!.thumbnailUrl).toContain("http");
  });

  it("extracts a playable, untokenised HLS url from the composition", () => {
    const hls = hlsFromMediaComposition(compositionFixture);
    expect(hls).toBeTruthy();
    expect(hls!.url).toMatch(/\.m3u8|akamaized\.net/);
    expect(hls!.tokenType).toBe("NONE");
  });

  it("returns null when no HLS present", () => {
    expect(hlsFromMediaComposition({ chapterList: [{ resourceList: [] }] })).toBeNull();
    expect(hlsFromMediaComposition({})).toBeNull();
  });
});
