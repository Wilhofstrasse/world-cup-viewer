# Prompt for claude.ai/design — WM 2026 Viewer, FIFA Features v1

**Paste this whole file into the `Gabriel · WM 2026 Viewer` project (projectId `80d66392-b000-4e84-9034-d0914965bde1`).**

Design six new FIFA-data features as one aligned system on top of the existing component library in this project. **Re-use, don't replace.** Reuse `foundations`, `header`, `match-card`, `group-accordion`, `drawer-search`. Extend the tokens; introduce no new colours or fonts. Deliverable for every new screen and component: a single self-contained `<!DOCTYPE html>…</html>` card with `<!-- @dsCard group="…" -->` at the top, same pattern as the existing canvas files. **Mobile-first 360 px wide** (iPhone), iPad widens; all type, hit targets, and spacing tested at 360.

---

## Audience & brand context

- User: Gabriel, 8 years old. Reads a little German, scans a lot of pictures, swipes on iPhone. Filipe shares the link with family — must look adult-trustworthy too, not toy-cartoonish.
- Theme: light "paper" (cream `#f4f1ea`), tomato-red accent `#e6492f`, SF Pro Rounded, vertical-scoreboard pattern (flag · name · score, scorers indented). German UI. Swiss dates `DD.MM.YYYY`, kickoffs `Do. 18.06., 17:30` (mono).
- Non-negotiables:
  - **Full team names — never truncate, never overlap.** Brazilian/South Korean/Saudi-Arabian-length names must fit at 360 px.
  - **No AI-slop fluff.** No emoji clutter, no fake stadium photos, no purely decorative chrome. Every pixel earns its place.
  - **Kid-readable hierarchy.** Big numbers (rank, score, goals), small support (assists, minutes, position), big photos when used.

## Locked tokens (from `foundations` — do not introduce new ones)

```
--paper      #f4f1ea   page bg
--surface    #ffffff   card bg
--ink        #1c1c1c   primary text / borders on emphasis
--dim        #8c8c8c   secondary text
--faint      #b3aea3   tertiary / placeholder dashes
--soft       #d8d2c6   default card border
--accent     #e6492f   live, active tab, section labels
--accent-soft #fbe3dd  live-card bg
--feed2      #0f2748   dark Highlights feed only (do NOT use elsewhere)
--round      SF Pro Rounded
--mono       Menlo (for kickoffs, minutes, version)
```

## Reused components (link to existing cards — do not redraw)

- `Foundations` — tokens reference.
- `Header` — top bar with `☰` menu + brand + version + segmented pill (Highlights | Spiele). **Extend the pill to three tabs** when needed: Highlights | Spiele | Mehr — see "Navigation extension" below.
- `Match Card` — bevorstehend / live / beendet states with goal list.
- `Group Accordion` — Vorrunde + K.-o.-Runde sections, Gruppe A–L heads.
- `Drawer Search` — `☰` jump-to-match drawer; keep its filter pattern when adding people/team search.

## Navigation extension (new component card — `Components` group)

Three-tab segmented pill replacing the existing two-tab: **Highlights · Spiele · Mehr**.

`Mehr` is the entry for the six new features (deep enough to deserve a tab, shallow enough not to scatter the top bar). Inside `Mehr`, a vertical list of cards routes to the six sub-views:

```
Mehr
 ├─ Torjägerliste     (top scorers / Golden Boot)
 ├─ Tabellen          (official group tables)
 ├─ K.-o.-Baum        (knockout bracket)
 ├─ Aufstellungen     (lineups + formations)
 ├─ Spielerkarten     (player cards)
 └─ Kader             (squads, 48 teams)
```

Each list-card: title (19/800), one-line subtitle (12/dim), small accent chevron `▸`. Tap → full-screen sub-view with a back arrow `‹` in the header (replaces the `☰` while in a sub-view).

---

## New view briefs — six features, one aligned system

> For each: produce **Stage 1 wireframe** (structure, hierarchy, real data shape) and **Stage 2 hi-fi** (final visual). Sign-off after Stage 1.

### 1. `Torjägerliste` — Top Scorers (Golden Boot)

**Data shape** (FIFA `/topseasonplayerstatistics/season/285023/topscorers`):
`Rank · PlayerName · IdTeam (→ flag + team) · GoalsScored · Assists · MatchesPlayed · PlayerPicture` (often null in group stage; design must work without photo).

**Brief:**
- Section header pill: `Vorrunde` / `Gesamt` toggle (small two-tab pill, same shape as the main nav but half-size).
- Ranked vertical list. Each row card (similar visual weight to a match-card but list-oriented):
  - Left: large rank number `1` `2` `3` (tabular-nums, 22/800). Top 3 in `--accent`; rest in `--ink`.
  - Center column: player name (15/700) on top line, country flag + team short name (12/dim) on second line.
  - Right column: big goal count (`⚽ 7`, 19/800, tabular-nums); below it `2 V · 4 Sp` (assists / matches played, 11/dim, mono).
  - Optional 36 px circular photo at far left when `PlayerPicture` exists; fall back to silhouette initial (e.g. `M.` in a soft circle) when null. **Layout identical with or without photo** — photo is opt-in detail, not structural.
- Tie indication: tied ranks share the same accent number with a tiny `=` prefix (`=4`, `=4`).
- Empty state: "Noch keine Tore — Spielbeginn am 18.06.2026."

### 2. `Tabellen` — Official Group Tables

**Data shape** (FIFA `/calendar/17/285023/289273/Standing`):
For each group: `Results[].Position .Points .Won .Drawn .Lost .Played .For .Against .GoalsDiference .QualificationStatus .Team.{ShortClubName, PictureUrl}`.

**Brief:**
- One `group-accordion` card per group A–L (reuse the existing accordion exactly — same border, same chevron, same heading style).
- Body of each open accordion: standings table (4 columns visible at 360 px wide).
  - Columns: `#` (1ch) · `Team` (flex) · `Sp` (matches, 2ch, mono) · `Pkt` (points, 3ch, mono, bold).
  - Hidden behind a subtle "Details" toggle at the bottom of each table: `S` (wins) · `U` (draws) · `N` (losses) · `Tore` (`14:3`) · `TD` (`+11`). Keep first-glance simple, allow drill-in for stat-heads.
- **`QualificationStatus` badges** (right of team name):
  - `Qualified` → small filled dot `●` in `--accent` + tooltip "Qualifiziert".
  - `Eliminated` → muted ring `○` in `--faint`.
  - In-play (no status yet) → nothing. **No green/red colour war** — accent + grey only, matches the rest of the system.
- Flag/crest: 21 px emoji flag (same as match-card), or 24 px crest if `PictureUrl` resolves. Pick one and apply consistently — don't mix per row.
- Sort: `Position` ascending. Tie-broken upstream by FIFA — trust the API.
- Head-to-head note (bottom of group, tiny): "Tiebreaker: direkter Vergleich (FIFA)." Only show when a tie exists.

### 3. `K.-o.-Baum` — Finals Tree (VF · HF · Finale only)

**Scope decision (locked 18.06.2026 by Filipe via canvas edit):** K.-o.-Baum in `Mehr` shows the **finals tree only — Viertelfinale, Halbfinale, Finale + Spiel um Platz 3**. R32 (Sechzehntelfinale, `289287`) and R16 (Achtelfinale, `289288`) move to the `Spiele` tab as new sections (existing Spiele tab gains "Sechzehntelfinale" + "Achtelfinale" accordion groups after Vorrunde).

**Data shape** (stage IDs from `docs/fifa-api.md`):
- Bracket view here: `289289` QF · `289290` SF · `289292` Final · `289291` Spiel um Platz 3.
- Spiele tab (separate work): `289287` + `289288`.
Each match: `Home/Away` (null until decided) + score + status.

**Brief:**
- Tree layout (NOT horizontal-column scroll): absolute-positioned cards with SVG connector lines, 3 columns left→right (VF · HF · Finale). Total tree width ~548 px → horizontal scroll on mobile.
- Match-cell: compact 2-row scoreboard (flag · team · score per row). No id chip — position in the tree communicates which match.
- Win highlight: winning team's name bold; losing row greyed (`--dim` text, `--faint` score).
- Winner path: dark `--ink` SVG line follows the winner forward through the tree. Soft `--soft` line for undecided segments.
- Live cell: `--accent` border + bg `--accent-soft` (same pattern as live match-card).
- Finale: 2 px `--ink` border + small **`Weltmeister`** crown pill on top edge (`--ink` bg, `--paper` text).
- Spiel um Platz 3: dashed border below Finale, with `Spiel um Platz 3` micro-label inside.
- Placeholders for undecided matches: italic `--faint` "Sieger VF 2" / "Verlierer HF 1" etc.
- Header hint: "Finalrunde — Viertelfinale bis Finale. Sieger fett, dunkle Linie folgt dem Weg ins Finale. Sechzehntel- &amp; Achtelfinale unter Tab «Spiele»."
- Empty state (pre-QF): "Finalrunde startet am DD.MM.2026."

**Side effect on Spiele tab (Stage 2 + build):** add R32 + R16 accordions to Spiele's group-accordion after Vorrunde. Source: same `/calendar/matches?...` payload, filter by `IdStage`.

### 4. `Aufstellungen` — Lineups + Formations + Photos

**Data shape** (FIFA `/live/football/17/285023/{idStage}/{idMatch}`):
`HomeTeam.Tactics` ("4-3-3") + `.Players[].{ShirtNumber, Position, PlayerName, PlayerPicture.PictureUrl}` + `.Substitutions[]` + `.Bookings[]`.

**Brief:**
- Match picker at top: small match-card (reused, compact) — tap to switch fixture.
- Below: **pitch diagram** rendered as SVG.
  - Pitch: `--paper` ground with thin `--soft` lines (centre circle, halfway line, boxes). No fake-grass texture. Vertical orientation; home team bottom, away team top.
  - Players placed by formation (parse `Tactics` like `4-3-3` → row counts from goal upward): GK row · DEF row · MID row · FWD row.
  - Player marker: 28 px circular photo when available; fallback `--surface` circle with shirt number (15/800, `--ink`). Surname (12/700) below.
  - Yellow/red bookings: tiny coloured rectangle `▮` next to surname (yellow `#e6a800`, red `--accent`). Substitutions: arrow `⇅` icon.
- Below pitch: bench list (subs), 2 columns of compact rows: `#NN  Name  Pos`.
- Tabs at top of the view (mini pill): `Heim` · `Auswärts` to switch teams.
- Empty state (pre-kickoff): "Aufstellung ca. 60 Minuten vor Anstoss."

### 5. `Spielerkarten` — Player Cards

**Data shape** (FIFA `/players/{idPlayer}`):
`BirthDate · Height · Weight · BirthPlace · InternationalCaps · Goals · PreferredFoot · PlayerPicture`. Entry points: tap any player name in Top Scorers, Lineups, or Squads.

**Brief:**
- Full-screen modal-ish view (slides up from below; back `‹` returns to caller).
- Hero block (top 40% of viewport):
  - Background: solid `--paper` (no fake gradient).
  - Centred: 96 px circular photo or shirt-number fallback.
  - Below photo: name (22/800), nationality (flag + country, 13/dim), position + shirt number on one line (12/mono, `--accent`).
- Stat strip (4 cells, horizontal row):
  - `Größe` (height in cm) · `Geburtstag` (DD.MM.YYYY, age in years parens) · `Länderspiele` (caps) · `Tore` (career goals).
  - Each cell: small label (11/dim/uppercase letter-spacing), big number/value (17/800 tabular-nums).
- Body:
  - `Geburtsort` (one row, italic value).
  - `Starker Fuss` chip (`Links` / `Rechts` / `Beidfüssig`).
- Footer: "WM 2026 Statistik" mini section repeating GoalsScored + MatchesPlayed for this tournament (sourced from top-scorers or lineups feed). Empty until first match.
- All fields null-tolerant — when missing, omit the row, never show `—`.

### 6. `Kader` — Squads (48 teams)

**Data shape** (FIFA `/teams/squads/all/17/285023`):
`Results[].{TeamName, Players[].{PlayerName, JerseyNum, Position}}`.

**Brief:**
- Landing: vertical list of all 48 teams as compact rows (flag + name + small chevron). Group by group letter via `Group Accordion` heads (`Gruppe A` through `Gruppe L`) so they map 1:1 with `Spiele` and `Tabellen` — same visual rhythm.
- Tap a team → squad screen:
  - Hero: flag (32 px) + team name (22/800) + small "Trainer: <name>" (13/dim, optional).
  - Roster grouped by position: `Tor` · `Abwehr` · `Mittelfeld` · `Angriff` (use German order; map `Position` codes upstream).
  - Each row: shirt number (tabular-nums, 15/800, `--accent`) · name (15/700) · birthdate (11/mono/dim, far right). 56 px row height; tap → opens `Spielerkarten` for that player.
- Search bar at top of squad screen (reuse `drawer-search` filter input) — filter by name.
- Empty state (squad not yet released): "Kader wird vor Turnierstart veröffentlicht."

---

## Cross-view consistency rules (the "aligned" part)

- **One badge vocabulary.** Live = `--accent` border + `--accent-soft` bg. Qualified = small `●` accent dot. Eliminated = `○` faint ring. Done = no badge. No greens. No reds beyond `--accent`.
- **One number style.** All numerical stats use tabular-nums (mono variant where listed) so rankings/columns align vertically.
- **One photo treatment.** Circular crop, `--surface` background fill behind transparent PNGs. Fallback always a circle (shirt-number or initial) — never a missing-image broken icon, never a stretched rectangle.
- **One header rule per sub-view.** When inside a `Mehr` sub-view: back arrow `‹` replaces `☰`; title text replaces the brand; pill nav hidden. Maintains the 2.5 px ink bottom border so the system rhythm holds.
- **No layout shift.** Loading and empty states have the same outer dimensions as the loaded card. Skeleton shimmers use `--soft` blocks, no spinners.
- **All text fits at 360 px.** Test the longest plausible name (Saudi-Arabien, Vereinigte Arab. Emirate, Curaçao, Bosnien-Herzegowina). If a name overflows, do not truncate — wrap to two lines and shrink the line-height instead.

## Two-stage delivery

- **Stage 1 — wireframe** (one card per view, `group="Views (wireframe)"`). Real data, real strings, real hierarchy. Greys only — token colours allowed for accent positions, no decorative colour.
- **Stage 2 — hi-fi** (one card per view, `group="Views (hi-fi)"`). Final visual polish, full token palette, all states (loading, empty, error, live). Bumps Stage 1 cards' `group` to `Views (wireframe — archived)`.

Sign-off gate between stages: Filipe reviews wireframes in the canvas, comments per card, hi-fi only starts after he approves.

## Out of scope

- Login, comments, profiles, settings.
- Animated match-event tickers (the rest of the app is calm; don't break that).
- 3D bracket renderings, "predict the winner" widgets, social-share screens.
- Anything requiring a paid data feed (no aggregate match stats; FIFA returns null — `docs/fifa-api.md` is the source of truth).

## Done criteria

A user can: tap `Mehr` → drill into any of the six new views → see real WM 2026 data presented in the same visual language as `Highlights` and `Spiele`. Gabriel can read the rank in `Torjägerliste` and the score in `K.-o.-Baum` without help. Filipe sees standings + scorers + lineups + bracket in one app and never opens the FIFA site again.
