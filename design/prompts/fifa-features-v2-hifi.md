# Prompt for claude.ai/design — WM 2026 Viewer, Stage 2 Hi-Fi

**Paste this whole file into the chat of the `Gabriel · WM 2026 Viewer` project** (projectId `80d66392-b000-4e84-9034-d0914965bde1`).

Promote the eight Stage 1 wireframes under `wireframes/` to Stage 2 hi-fi cards under a new `hifi/` tree. Same structure, same data, same component contract — full visual polish on top.

## What to produce

For each Stage 1 card, output a new card with the same name at the mirrored path:

| Wireframe (read-only) | Hi-Fi (you create) |
|---|---|
| `wireframes/components/header-3tab.html` | `hifi/components/header-3tab.html` |
| `wireframes/screens/mehr-landing.html` | `hifi/screens/mehr-landing.html` |
| `wireframes/screens/torjaegerliste.html` | `hifi/screens/torjaegerliste.html` |
| `wireframes/screens/tabellen.html` | `hifi/screens/tabellen.html` |
| `wireframes/screens/ko-baum.html` | `hifi/screens/ko-baum.html` |
| `wireframes/screens/aufstellungen.html` | `hifi/screens/aufstellungen.html` |
| `wireframes/screens/spielerkarten.html` | `hifi/screens/spielerkarten.html` |
| `hifi/screens/kader.html` (two views in one card — landing + team detail) | `hifi/screens/kader.html` |

Group labels:
- `Hi-Fi — Components` for `hifi/components/*.html`
- `Hi-Fi — Screens` for `hifi/screens/*.html`

First line of every new file MUST be `<!-- @dsCard group="Hi-Fi — …" -->`.

## Locked tokens (from `foundations.html` — do not introduce new ones)

```
--paper      #f4f1ea
--surface    #ffffff
--ink        #1c1c1c
--dim        #8c8c8c
--faint      #b3aea3
--soft       #d8d2c6
--accent     #e6492f
--accent-soft #fbe3dd
--feed2      #0f2748   (Highlights only)
--round      SF Pro Rounded
--mono       Menlo
```

## What "hi-fi" means here

- Full palette in use. Wireframes are grey-dominant; hi-fi puts accent, accent-soft, ink emphasis, and live-state styling where they belong.
- All states drawn, not just the happy path. Per view:
  - **Loading** — skeleton shimmer in `--soft` blocks, same outer dimensions as loaded state.
  - **Empty** — copy from the wireframe brief; never blank.
  - **Error** — single-line `--accent` banner with retry affordance.
  - **Live** — `--accent` border + `--accent-soft` background, same as the existing match-card live state.
- Refined typography: keep the wireframe sizes; tighten line-height and letter-spacing where rounded SF Pro asks for it.
- Real flags as 21 px emoji (already in use). Where a team crest fits the brand better, fall back to crest stub circle on `--surface`.
- Soft elevation: subtle `box-shadow: 0 1px 0 var(--soft), 0 6px 14px rgba(28,28,28,.04)` on cards. No heavy drop shadows.
- Microinteractions visible in the static card: pressed state for primary tab, focus ring on the search input, tap-highlight on first list row.

## Non-negotiables (carry from Stage 1)

- 360 px width tested for every screen. Longest plausible names (Vereinigte Arab. Emirate, Bosnien-Herzegowina, Saudi-Arabien, Curaçao) must fit without truncation.
- Same hierarchy as wireframes — rank is the dominant element in Torjägerliste, pitch is the dominant element in Aufstellungen, the bracket tree shape is the dominant element in K.-o.-Baum.
- One badge vocabulary: `●` qualified (`--accent`), `○` eliminated (`--faint`). No greens, no second red.
- One number style: tabular-nums on every stat; monospace for kickoffs, minutes, version, jersey numbers.
- One photo treatment: circular crop, `--surface` background fill, shirt-number-or-initial fallback when the source is null.
- K.-o.-Baum scope is locked: Viertelfinale · Halbfinale · Finale + Spiel um Platz 3 only. R32 + R16 live under the Spiele tab — not here. Keep Filipe's tree layout (absolute-positioned cards, SVG connector lines, dark ink winner path, Weltmeister crown on Finale, dashed border on Spiel um Platz 3).

## After the cards exist

Don't archive the Stage 1 wireframes yet — Filipe wants to A/B them side by side in the Design System pane before any deletion.

If a hi-fi decision overrides a wireframe choice, leave a one-line note in the new card's HTML head comment, e.g. `<!-- promote: shifted scope tabs from accent to ink ring; wireframe used accent only -->`. This lets Filipe spot intentional drift instantly.
