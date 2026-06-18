# FIFA public API — WM 2026 capability map

What `api.fifa.com/api/v3` offers for the World Cup viewer. **Keyless, CORS-open**
(the Worker fetches it server-side; the browser can too). Verified live 18.06.2026.

- `idCompetition=17` (FIFA World Cup) · `idSeason=285023` (2026) · group stage `idStage=289273`
- Headers: `User-Agent: Mozilla/5.0`, `Accept: application/json` · `language=de-DE` (German names align with SRF)
- Localized fields are arrays → take `[0].Description`. Null-guard `Home`/`Away` (unseeded KO).

## Stage IDs (knockout bracket)
`289273` Erste Phase (Gruppen) · `289287` Sechzehntelfinale (R32) · `289288` Achtelfinale ·
`289289` Viertelfinale · `289290` Halbfinale · `289291` Spiel um Platz 3 · `289292` Finale

## In use today
| Data | Endpoint |
|---|---|
| Fixtures + score + status | `/calendar/matches?idCompetition=17&idSeason=285023&count=500&language=de-DE` |
| Goal events (scorer + minute) | `/timelines/17/285023/{idStage}/{idMatch}?language=de-DE` (`Event[]`, Type 0/41/34) |
| Highlight clips | SRF Integration Layer (separate, keyless) |

## Available, not yet used (all verified ✅)
| Capability | Endpoint | Key fields |
|---|---|---|
| **Official group standings** | `/calendar/17/285023/289273/Standing?language=de-DE` (`&idGroup=` optional) | `Results[].Position/.Points/.Won/.Drawn/.Lost/.Played/.For/.Against/.GoalsDiference/.QualificationStatus/.IdGroup`, `.Team.{IdTeam,ShortClubName,PictureUrl}` — one call, all groups; **has qualification status + official tiebreakers** |
| **Top scorers (Golden Boot)** | `/topseasonplayerstatistics/season/285023/topscorers?language=de-DE` | `PlayerStatsList[].{Rank,GoalsScored,Assists,MatchesPlayed,PlayerInfo.{PlayerName,IdTeam}}` |
| **Lineups / formation / XI + subs** | `/live/football/17/285023/{idStage}/{idMatch}?language=de-DE` | `HomeTeam.Tactics` ("4-3-3"), `.Players[].{ShirtNumber,Position,PlayerName,PlayerPicture.PictureUrl}`, `.Substitutions[]`, `.Bookings[]` |
| **Live now (in play)** | `/live/football/now?language=de-DE` | live-match objects; `[]` when nothing live |
| **Player bio** | `/players/{idPlayer}?language=de-DE` | `BirthDate, Height, Weight, BirthPlace, InternationalCaps, Goals, PreferredFoot` |
| **Squad rosters (48 teams)** | `/teams/squads/all/17/285023?language=de-DE` | `Results[].{TeamName,Players[].{PlayerName,JerseyNum,Position}}` |
| **Stages / bracket** | `/stages?idSeason=285023&idCompetition=17` | `Results[].{IdStage,Name}` |
| **Flags / crests / photos** | `/picture/flags-{format}-{size}/{ABBREV}` | image URL, no hosting needed |

## NOT available (FIFA returns `null` for 2026 — don't build against)
- **Aggregate match stats**: possession, shots, shots on target, corners, fouls, offsides (`/statistics/...` → null). *Goals + cards are derivable* from `timelines` / live `Bookings[]`.
- **Stadium** capacity / GPS / build year (fields null; name + city OK).
- Season-level aggregate team/player stat sheets (`/seasonstatistics/...` → null).

## Notes
- Current standings (`web/wm/standings.js`) are COMPUTED from results (points→GD→GF). To get
  official head-to-head tiebreakers + qualified/eliminated badges, swap to the `Standing` endpoint
  (ingest into R2 alongside matches, or fetch client-side — it's CORS-open).
- `/api/v1` and `/api/v3` resolve identically.
