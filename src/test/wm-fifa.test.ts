/**
 * wm-fifa.test.ts — pure FIFA-provider mappers against captured de-DE fixtures
 * (live calls are keyless but non-deterministic). Asserts status mapping, the
 * minute parser, scorer extraction + title-casing, score-only-when-played, and
 * goal filtering (real Messi hat-trick: Argentinien 3–0 Algerien, 17'/60'/76').
 */

import { describe, it, expect } from "vitest";

import {
  mapFifaStatus,
  parseMatchMinute,
  tidyName,
  scorerFromDescription,
  mapFifaGoalType,
  mapFifaMatchToMatch,
  mapTimelineToGoals,
} from "../wm/fifa.js";
import { getProvider } from "../wm/football.js";
import type { FifaMatch, FifaTimelineEvent } from "../wm/types.js";

import matches from "./fixtures/fifa-matches.json";
import timeline from "./fixtures/fifa-timeline.json";

describe("mapFifaStatus", () => {
  it("maps FIFA MatchStatus codes", () => {
    expect(mapFifaStatus(0)).toBe("finished");
    expect(mapFifaStatus(3)).toBe("live");
    expect(mapFifaStatus(1)).toBe("scheduled");
    expect(mapFifaStatus(12)).toBe("scheduled");
  });
});

describe("parseMatchMinute", () => {
  it("parses minute + stoppage, never invents", () => {
    expect(parseMatchMinute("17'")).toEqual({ minute: 17, extra: null });
    expect(parseMatchMinute("45'+5'")).toEqual({ minute: 45, extra: 5 });
    expect(parseMatchMinute("90'+8'")).toEqual({ minute: 90, extra: 8 });
    expect(parseMatchMinute(null)).toEqual({ minute: null, extra: null });
    expect(parseMatchMinute("")).toEqual({ minute: null, extra: null });
    expect(parseMatchMinute("Pen")).toEqual({ minute: null, extra: null });
  });
});

describe("tidyName / scorerFromDescription", () => {
  it("extracts a clean surname from FIFA's CAPS-surname formats", () => {
    expect(tidyName("MESSI")).toBe("Messi");
    expect(tidyName("Julian QUINONES")).toBe("Quinones");
    expect(tidyName("HWANG Inbeom")).toBe("Hwang");
    expect(tidyName("M.HANY")).toBe("Hany");
    expect(tidyName("VAN DIJK")).toBe("Van Dijk");
    expect(tidyName("RAÚL")).toBe("Raúl");
  });
  it("extracts scorer + team from a goal / penalty description", () => {
    expect(scorerFromDescription("MESSI (Argentinien) erzielt ein Tor!")).toEqual({ scorer: "Messi", team: "Argentinien" });
    expect(scorerFromDescription("EMBOLO (Schweiz) verwandelt den Strafstoss!")).toEqual({ scorer: "Embolo", team: "Schweiz" });
  });
  it("strips the own-goal prefix before extracting the player", () => {
    expect(scorerFromDescription("Eigentor durch M.HANY (Ägypten).")).toEqual({ scorer: "Hany", team: "Ägypten" });
  });
  it("returns null when there is no (Team) marker", () => {
    expect(scorerFromDescription("Anstoss")).toBeNull();
  });
});

describe("mapFifaGoalType", () => {
  it("maps goal-event type codes", () => {
    expect(mapFifaGoalType(0)).toBe("goal");
    expect(mapFifaGoalType(41)).toBe("penalty");
    expect(mapFifaGoalType(34)).toBe("own");
  });
});

describe("mapFifaMatchToMatch", () => {
  const list = (matches as { Results: FifaMatch[] }).Results;

  it("normalizes a finished match with score, Home=A / Away=B", () => {
    const m = mapFifaMatchToMatch(list[0]!)!;
    expect(m.status).toBe("finished");
    expect(m.teamA).toBe("Argentinien");
    expect(m.teamB).toBe("Algerien");
    expect(m.scoreA).toBe(3);
    expect(m.scoreB).toBe(0);
    expect(m.stageId).toBeTruthy();
  });

  it("hides score for a scheduled match", () => {
    const m = mapFifaMatchToMatch(list[1]!)!;
    expect(m.status).toBe("scheduled");
    expect(m.scoreA).toBeNull();
    expect(m.scoreB).toBeNull();
    expect(m.minute).toBeNull();
  });

  it("returns null for an unseeded knockout slot (Home/Away null)", () => {
    const stub = { IdMatch: "1", IdStage: "9", MatchStatus: 1, Date: "", Home: null, Away: null } as FifaMatch;
    expect(mapFifaMatchToMatch(stub)).toBeNull();
  });
});

describe("mapTimelineToGoals", () => {
  const evs = (timeline as { Event: FifaTimelineEvent[] }).Event;
  const goals = mapTimelineToGoals(evs, "Argentinien", "Algerien");

  it("keeps only real goals (drops cards / non-goal events)", () => {
    // Captured fixture: 3 Messi goals + 2 non-goal extras.
    expect(goals).toHaveLength(3);
  });

  it("credits the scoring side and preserves minutes (Messi 17', 60', 76')", () => {
    expect(goals.every((g) => g.team === "A")).toBe(true);
    expect(goals.every((g) => g.scorer === "Messi")).toBe(true);
    expect(goals.map((g) => g.minute)).toEqual([17, 60, 76]);
    expect(goals.every((g) => g.type === "goal")).toBe(true);
  });

  it("flips an own goal to the benefiting side, with a clean scorer", () => {
    const own = mapTimelineToGoals(
      [{ Type: 34, MatchMinute: "40'", EventDescription: [{ Description: "Eigentor durch AGUERD (Algerien)." }] }],
      "Argentinien",
      "Algerien",
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.type).toBe("own");
    expect(own[0]!.scorer).toBe("Aguerd");
    expect(own[0]!.team).toBe("A"); // Algerien player → counts for Argentinien (A)
  });
});

describe("getProvider", () => {
  it("defaults to the keyless FIFA provider", () => {
    const p = getProvider({} as never);
    expect(typeof p.getMatches).toBe("function");
    expect(typeof p.getGoals).toBe("function");
  });
});
