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
  groupLetter,
  roundLabel,
  mapFifaTopScorer,
  enrichScorerTeams,
  teamNameMap,
  mapQualificationStatus,
  standingGroupLetter,
  mapFifaStanding,
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
    expect(m.round).toBe("Vorrunde");
    expect(m.group).toBe("J");
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

describe("groupLetter / roundLabel", () => {
  it("extracts the group letter (FIFA uses a non-breaking space)", () => {
    expect(groupLetter("Gruppe E")).toBe("E");
    expect(groupLetter("Gruppe A")).toBe("A");
    expect(groupLetter("")).toBeNull();
  });
  it("maps FIFA stage names to display rounds", () => {
    expect(roundLabel("Erste Phase")).toBe("Vorrunde");
    expect(roundLabel("Achtelfinale")).toBe("Achtelfinale");
    expect(roundLabel("Finale")).toBe("Final");
  });
});

describe("getProvider", () => {
  it("defaults to the keyless FIFA provider", () => {
    const p = getProvider({} as never);
    expect(typeof p.getMatches).toBe("function");
    expect(typeof p.getGoals).toBe("function");
  });
});

describe("mapFifaTopScorer", () => {
  it("normalizes a complete row", () => {
    const s = mapFifaTopScorer({
      Rank: 1,
      GoalsScored: 5,
      Assists: 2,
      MatchesPlayed: 3,
      PlayerInfo: {
        PlayerName: [{ Description: "L. Messi" }],
        IdTeam: "43946",
        TeamName: [{ Description: "Argentinien" }],
        PlayerPicture: { PictureUrl: "https://img.fifa.com/m.png" },
      },
    });
    expect(s).toEqual({
      rank: 1,
      player: "L. Messi",
      team: "Argentinien",
      idTeam: "43946",
      goals: 5,
      assists: 2,
      matches: 3,
      photoUrl: "https://img.fifa.com/m.png",
    });
  });

  it("zero-fills assists/matches when FIFA omits them", () => {
    const s = mapFifaTopScorer({
      Rank: 7,
      GoalsScored: 1,
      PlayerInfo: {
        PlayerName: [{ Description: "Haaland" }],
        IdTeam: "x",
      },
    });
    expect(s?.assists).toBe(0);
    expect(s?.matches).toBe(0);
    expect(s?.photoUrl).toBeNull();
    expect(s?.team).toBe("");
  });

  it("returns null when PlayerName is empty", () => {
    expect(mapFifaTopScorer({ Rank: 1, GoalsScored: 1, PlayerInfo: { IdTeam: "x" } })).toBeNull();
  });
});

describe("enrichScorerTeams", () => {
  it("fills the team display name from idTeam → name map", () => {
    const out = enrichScorerTeams(
      [
        { rank: 1, player: "Messi", team: "", idTeam: "43946", goals: 5, assists: 2, matches: 3, photoUrl: null },
        { rank: 2, player: "Mbappé", team: "Frankreich", idTeam: "43948", goals: 4, assists: 1, matches: 3, photoUrl: null },
      ],
      new Map([["43946", "Argentinien"]]),
    );
    expect(out[0]?.team).toBe("Argentinien");
    expect(out[1]?.team).toBe("Frankreich"); // already set → untouched
  });

  it("leaves team blank when the id is unknown", () => {
    const out = enrichScorerTeams(
      [{ rank: 1, player: "X", team: "", idTeam: "999", goals: 1, assists: 0, matches: 1, photoUrl: null }],
      new Map(),
    );
    expect(out[0]?.team).toBe("");
  });
});

describe("mapQualificationStatus", () => {
  it("maps the three FIFA pass-through values", () => {
    expect(mapQualificationStatus("Qualified")).toBe("qualified");
    expect(mapQualificationStatus("Eliminated")).toBe("eliminated");
    expect(mapQualificationStatus("Undefined")).toBeNull();
    expect(mapQualificationStatus(undefined)).toBeNull();
  });
});

describe("standingGroupLetter", () => {
  it("extracts the letter from a plain Group string with FIFA's NBSP", () => {
    expect(standingGroupLetter({ Group: "Gruppe A" })).toBe("A");
  });
  it("falls back to the localized array when Group is FifaLoc[]", () => {
    expect(standingGroupLetter({ Group: [{ Description: "Gruppe E" }] })).toBe("E");
  });
  it("returns null when there is no group info", () => {
    expect(standingGroupLetter({})).toBeNull();
  });
});

describe("mapFifaStanding", () => {
  it("normalizes a complete row", () => {
    const r = mapFifaStanding({
      IdGroup: "289273-A",
      Group: "Gruppe A",
      Position: 1,
      Points: 7,
      Played: 3,
      Won: 2, Drawn: 1, Lost: 0,
      For: 5, Against: 1, GoalsDiference: 4,
      QualificationStatus: "Qualified",
      Team: {
        IdTeam: "43922",
        Name: [{ Description: "Argentinien" }],
        ShortClubName: "Argentina",
        PictureUrl: "https://api.fifa.com/api/v3/picture/flags-{format}-{size}/ARG",
      },
    });
    expect(r).toEqual({
      group: "A",
      position: 1,
      team: "Argentinien",
      idTeam: "43922",
      played: 3,
      won: 2, drawn: 1, lost: 0,
      goalsFor: 5, goalsAgainst: 1, goalsDiff: 4,
      points: 7,
      qualification: "qualified",
      crestUrlTemplate: "https://api.fifa.com/api/v3/picture/flags-{format}-{size}/ARG",
    });
  });

  it("falls back to ShortClubName when localized Name is empty", () => {
    const r = mapFifaStanding({
      Position: 2, Points: 5, Played: 3, Won: 1, Drawn: 2, Lost: 0,
      For: 3, Against: 1, GoalsDiference: 2,
      Team: { IdTeam: "x", ShortClubName: "Czechia" },
    });
    expect(r?.team).toBe("Czechia");
  });

  it("returns null when neither Name nor ShortClubName are present", () => {
    const r = mapFifaStanding({ Position: 1, Team: { IdTeam: "x" } });
    expect(r).toBeNull();
  });
});

describe("teamNameMap", () => {
  it("collects IdTeam → display name pairs from a raw matches list", () => {
    const m = teamNameMap([
      {
        IdMatch: "1", IdStage: "289273", MatchStatus: 1, Date: "",
        Home: { IdTeam: "1", Score: null, TeamName: [{ Description: "Argentinien" }] },
        Away: { IdTeam: "2", Score: null, TeamName: [{ Description: "Brasilien" }] },
      },
      {
        IdMatch: "2", IdStage: "289273", MatchStatus: 1, Date: "",
        Home: { IdTeam: "1", Score: null, TeamName: [{ Description: "Argentinien" }] }, // duplicate id
        Away: null,
      },
    ]);
    expect(m.size).toBe(2);
    expect(m.get("1")).toBe("Argentinien");
    expect(m.get("2")).toBe("Brasilien");
  });
});
