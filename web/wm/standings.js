/**
 * standings.js — pure group-standings computation from match results.
 *
 * Browser + vitest (no DOM, no window) so it's unit-tested. Win = 3, draw = 1.
 * Ranked by points → goal difference → goals for → name. This is the visible,
 * kid-friendly ordering; FIFA's official tiebreakers add head-to-head, which
 * only rarely changes the displayed order (a later refinement can swap in
 * FIFA's official standings endpoint).
 */

"use strict";

/**
 * @typedef {{teamA:string, teamB:string, status:string, scoreA:number|null, scoreB:number|null}} M
 * @typedef {{team:string, played:number, won:number, drawn:number, lost:number, gf:number, ga:number, gd:number, points:number}} Row
 * @param {M[]} matches  one group's matches (played or not)
 * @returns {Row[]} ranked rows (every team in the group, even with 0 played)
 */
export function computeStandings(matches) {
  const table = new Map();
  const row = (name) => {
    if (!table.has(name)) {
      table.set(name, { team: name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 });
    }
    return table.get(name);
  };

  // Seed every team in the group so a team with no result yet still appears.
  for (const m of matches || []) {
    if (m && m.teamA) row(m.teamA);
    if (m && m.teamB) row(m.teamB);
  }

  for (const m of matches || []) {
    if (!m || m.status !== "finished" || m.scoreA == null || m.scoreB == null) continue;
    const a = row(m.teamA);
    const b = row(m.teamB);
    a.played++; b.played++;
    a.gf += m.scoreA; a.ga += m.scoreB;
    b.gf += m.scoreB; b.ga += m.scoreA;
    if (m.scoreA > m.scoreB) { a.won++; b.lost++; a.points += 3; }
    else if (m.scoreA < m.scoreB) { b.won++; a.lost++; b.points += 3; }
    else { a.drawn++; b.drawn++; a.points++; b.points++; }
  }

  const rows = [...table.values()];
  for (const r of rows) r.gd = r.gf - r.ga;
  rows.sort(
    (x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team, "de"),
  );
  return rows;
}
