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
  learnStageMap,
  resolveRoundKey,
  normLang,
  fifaLocale,
  mapFifaTopScorer,
  enrichScorerTeams,
  teamNameMap,
  mapQualificationStatus,
  standingGroupLetter,
  mapFifaStanding,
  mapFifaSquadPlayer,
  mapFifaSquad,
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
  it("strips the Portuguese own-goal prefix (pt-BR)", () => {
    expect(scorerFromDescription("Gol contra de AGUERD (Argélia).")).toEqual({ scorer: "Aguerd", team: "Argélia" });
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

  it("emits a language-invariant roundKey + order (de back-compat: byte-identical round)", () => {
    const m = mapFifaMatchToMatch(list[0]!)!; // single-arg call → de path, empty stage map
    expect(m.round).toBe("Vorrunde"); // unchanged display label
    expect(m.roundKey).toBe("group"); // NEW: stable identity from the German bridge
    expect(m.roundOrder).toBe(0);
  });
});

describe("learnStageMap / resolveRoundKey", () => {
  const list = (matches as { Results: FifaMatch[] }).Results;

  it("learns IdStage → RoundKey from the German feed", () => {
    const map = learnStageMap(list);
    const idStage = String(list[0]!.IdStage);
    expect(map[idStage]).toBe("group"); // Argentinien–Algerien is a group match
  });

  it("resolves by learned id first, German bridge second, else null", () => {
    expect(resolveRoundKey("123", null, { "123": "r16" })).toBe("r16"); // learned id wins
    expect(resolveRoundKey("999", "Achtelfinale", {})).toBe("r16"); // German bridge fallback
    expect(resolveRoundKey("999", "First Stage", {})).toBeNull(); // localized text never resolves
    expect(resolveRoundKey("999", null, {})).toBeNull();
  });

  it("localizes the round label off the id, with no foreign fixture needed", () => {
    const map = learnStageMap(list); // learned from de feed
    const en = mapFifaMatchToMatch(list[0]!, map, "en")!;
    expect(en.roundKey).toBe("group"); // same id → same key
    expect(en.round).toBe("Group Stage"); // localized display
    expect(en.roundOrder).toBe(0);
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

  it("resolves the side by IdTeam even when the team text is unrecognizable", () => {
    // Parens team is gibberish (a localized name we have no alias for); IdTeam carries truth.
    const g = mapTimelineToGoals(
      [{ Type: 0, MatchMinute: "10'", IdTeam: "B2", EventDescription: [{ Description: "XYZ (Foobar) marca!" }] }],
      "Argentina",
      "Brasil",
      "A1",
      "B2",
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.team).toBe("B"); // matched on IdTeam, not the unparseable name
  });

  it("flips an own goal credited by IdTeam to the benefiting side", () => {
    const og = mapTimelineToGoals(
      [{ Type: 34, MatchMinute: "55'", IdTeam: "B2", EventDescription: [{ Description: "Gol contra de SILVA (Brasil)." }] }],
      "Argentina",
      "Brasil",
      "A1",
      "B2",
    );
    expect(og).toHaveLength(1);
    expect(og[0]!.team).toBe("A"); // Brasil (B) own goal → benefits Argentina (A)
    expect(og[0]!.scorer).toBe("Silva");
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

describe("normLang / fifaLocale", () => {
  it("normalizes only supported app langs, else defaults to de", () => {
    expect(normLang("de")).toBe("de");
    expect(normLang("en")).toBe("en");
    expect(normLang("pt-BR")).toBe("pt-BR");
    expect(normLang("fr")).toBe("de");
    expect(normLang("")).toBe("de");
    expect(normLang(null)).toBe("de");
    expect(normLang("EN")).toBe("de"); // case-sensitive by design (client sends canonical)
  });
  it("maps app lang → the verified FIFA locale tag", () => {
    expect(fifaLocale("de")).toBe("de-DE");
    expect(fifaLocale("en")).toBe("en-GB"); // en-US falls back at FIFA → pin en-GB
    expect(fifaLocale("pt-BR")).toBe("pt-BR"); // pt-PT falls back → pin pt-BR
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
      idPlayer: null,
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
        { rank: 1, player: "Messi", idPlayer: "1", team: "", idTeam: "43946", goals: 5, assists: 2, matches: 3, photoUrl: null },
        { rank: 2, player: "Mbappé", idPlayer: "2", team: "Frankreich", idTeam: "43948", goals: 4, assists: 1, matches: 3, photoUrl: null },
      ],
      new Map([["43946", "Argentinien"]]),
    );
    expect(out[0]?.team).toBe("Argentinien");
    expect(out[1]?.team).toBe("Frankreich"); // already set → untouched
  });

  it("leaves team blank when the id is unknown", () => {
    const out = enrichScorerTeams(
      [{ rank: 1, player: "X", idPlayer: "9", team: "", idTeam: "999", goals: 1, assists: 0, matches: 1, photoUrl: null }],
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

describe("mapFifaSquadPlayer", () => {
  it("normalizes a typical squad row", () => {
    const p = mapFifaSquadPlayer({
      IdPlayer: "448217",
      PlayerName: [{ Description: "Matt TURNER" }],
      JerseyNum: 1,
      Position: 0,
      PositionLocalized: [{ Description: "Torhüter" }],
      BirthDate: "1994-06-24T00:00:00Z",
      Height: 190,
      PlayerPicture: { PictureUrl: "https://digitalhub.fifa.com/x.png" },
      IdCountry: "USA",
    });
    expect(p).toEqual({
      idPlayer: "448217",
      name: "Matt TURNER",
      jerseyNum: 1,
      position: 0,
      positionLabel: "Torhüter",
      birthDate: "1994-06-24T00:00:00Z",
      height: 190,
      photoUrl: "https://digitalhub.fifa.com/x.png",
      idCountry: "USA",
    });
  });

  it("returns null when IdPlayer is missing", () => {
    expect(mapFifaSquadPlayer({ PlayerName: [{ Description: "X" }] })).toBeNull();
  });

  it("falls back to ShortName when PlayerName is empty", () => {
    const p = mapFifaSquadPlayer({
      IdPlayer: "1",
      ShortName: [{ Description: "TURNER" }],
    });
    expect(p?.name).toBe("TURNER");
  });
});

describe("mapFifaSquad", () => {
  it("sorts players by position then jersey number", () => {
    const sq = mapFifaSquad({
      IdTeam: "T1",
      TeamName: [{ Description: "USA" }],
      Players: [
        { IdPlayer: "p3", PlayerName: [{ Description: "A" }], JerseyNum: 22, Position: 3 },
        { IdPlayer: "p1", PlayerName: [{ Description: "B" }], JerseyNum: 1, Position: 0 },
        { IdPlayer: "p2", PlayerName: [{ Description: "C" }], JerseyNum: 4, Position: 1 },
      ],
    });
    expect(sq?.players.map((p) => p.idPlayer)).toEqual(["p1", "p2", "p3"]);
  });

  it("returns null when TeamName is empty", () => {
    expect(mapFifaSquad({ IdTeam: "T", TeamName: [] })).toBeNull();
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
