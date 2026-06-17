/**
 * wm-football.test.ts — covers the pure API-Football mappers against
 * captured-shape fixtures (live calls need Filipe's key). Asserts the tricky
 * bits: status mapping, score-only-when-played, own-goal side flip, and
 * non-goal event filtering.
 */

import { describe, it, expect } from "vitest";

import {
  mapStatus,
  mapGoalType,
  mapFixtureToMatch,
  mapEventsToGoals,
  getProvider,
} from "../wm/football.js";
import type { ApiFootballFixture, ApiFootballEvent } from "../wm/types.js";

import fixtures from "./fixtures/apifootball-fixtures.json";
import events from "./fixtures/apifootball-events.json";

describe("mapStatus", () => {
  it("buckets API-Football status codes", () => {
    expect(mapStatus("FT")).toBe("finished");
    expect(mapStatus("AET")).toBe("finished");
    expect(mapStatus("PEN")).toBe("finished");
    expect(mapStatus("2H")).toBe("live");
    expect(mapStatus("HT")).toBe("live");
    expect(mapStatus("NS")).toBe("scheduled");
    expect(mapStatus("PST")).toBe("scheduled");
  });
});

describe("mapGoalType", () => {
  it("maps detail strings", () => {
    expect(mapGoalType("Normal Goal")).toBe("goal");
    expect(mapGoalType("Penalty")).toBe("penalty");
    expect(mapGoalType("Own Goal")).toBe("own");
  });
});

describe("mapFixtureToMatch", () => {
  const list = (fixtures as { response: ApiFootballFixture[] }).response;

  it("normalizes a finished fixture with score, home=A / away=B", () => {
    const m = mapFixtureToMatch(list[0]!);
    expect(m).toMatchObject({
      id: 9001,
      status: "finished",
      teamA: "Austria",
      teamB: "Jordan",
      scoreA: 2,
      scoreB: 1,
      minute: null,
      goals: [],
    });
  });

  it("exposes the live minute for an in-play match", () => {
    const m = mapFixtureToMatch(list[1]!);
    expect(m.status).toBe("live");
    expect(m.minute).toBe(67);
    expect(m.scoreA).toBe(1);
  });

  it("hides score for a scheduled match", () => {
    const m = mapFixtureToMatch(list[2]!);
    expect(m.status).toBe("scheduled");
    expect(m.scoreA).toBeNull();
    expect(m.scoreB).toBeNull();
    expect(m.minute).toBeNull();
  });
});

describe("mapEventsToGoals", () => {
  const evs = (events as { response: ApiFootballEvent[] }).response;
  const goals = mapEventsToGoals(evs, "Austria", "Jordan");

  it("keeps only real goals (drops cards + missed penalties)", () => {
    expect(goals).toHaveLength(3);
    expect(goals.some((g) => g.scorer === "Gregoritsch")).toBe(false); // missed penalty
  });

  it("credits an own goal to the benefiting side, not the player's team", () => {
    const own = goals.find((g) => g.type === "own");
    expect(own).toBeTruthy();
    expect(own!.scorer).toBe("Al-Arab"); // a Jordan player …
    expect(own!.team).toBe("A"); // … but it counts for Austria (side A)
  });

  it("assigns normal goals to the scoring side and preserves minute+extra", () => {
    const schmid = goals.find((g) => g.scorer === "R. Schmid")!;
    expect(schmid.team).toBe("A");
    expect(schmid.minute).toBe(30);
    const olwan = goals.find((g) => g.scorer === "Olwan")!;
    expect(olwan.team).toBe("B");
  });

  it("sorts goals chronologically", () => {
    const mins = goals.map((g) => g.minute);
    expect(mins).toEqual([30, 45, 70]);
  });

  it("never invents a minute", () => {
    const noMin = mapEventsToGoals(
      [{ time: { elapsed: null, extra: null }, team: { id: 775, name: "Austria" }, player: { id: 9, name: "X" }, type: "Goal", detail: "Normal Goal" }],
      "Austria",
      "Jordan",
    );
    expect(noMin[0]!.minute).toBeNull();
  });
});

describe("getProvider", () => {
  it("returns a provider exposing getMatches + getGoals", () => {
    const p = getProvider({} as never);
    expect(typeof p.getMatches).toBe("function");
    expect(typeof p.getGoals).toBe("function");
  });
});
