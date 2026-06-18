/**
 * wm-standings.test.ts — pure group-standings computation (web/wm/standings.js).
 * Covers points (3/1/0), the points→GD→GF ranking, 0-played seeding, and that
 * only finished matches count.
 */

import { describe, it, expect } from "vitest";
import { computeStandings } from "../../web/wm/standings.js";

const M = (teamA: string, teamB: string, scoreA: number | null, scoreB: number | null, status = "finished") => ({
  teamA,
  teamB,
  scoreA,
  scoreB,
  status,
});

describe("computeStandings", () => {
  it("ranks by points, then goal difference, then goals for", () => {
    const rows = computeStandings([
      M("A", "B", 3, 0),
      M("C", "D", 1, 1),
      M("A", "C", 2, 1),
      M("B", "D", 0, 0),
    ]);
    // A=6pts; D=2 (two draws); C=1 (draw+loss); B=1 (loss+draw, worse GD).
    expect(rows.map((r) => r.team)).toEqual(["A", "D", "C", "B"]);
    expect(rows[0]).toMatchObject({ team: "A", played: 2, won: 2, points: 6, gf: 5, ga: 1, gd: 4 });
  });

  it("seeds teams with no played match at zero", () => {
    const rows = computeStandings([M("X", "Y", null, null, "scheduled")]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });

  it("awards a draw one point each and a win three", () => {
    const rows = computeStandings([M("A", "B", 2, 2), M("A", "C", 1, 0)]);
    const a = rows.find((r) => r.team === "A");
    expect(a).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, points: 4 });
  });

  it("ignores matches that are not finished", () => {
    const rows = computeStandings([M("A", "B", 5, 0, "live"), M("A", "B", 1, 0, "finished")]);
    const a = rows.find((r) => r.team === "A")!;
    expect(a.played).toBe(1);
    expect(a.gf).toBe(1);
  });
});
