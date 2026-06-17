# WM 2026 Viewer — Design Brief v1

## Audience

A kid (8) swiping match highlights on an iPhone (also iPad). Non-reader-friendly: big flags, clear scores, minimal text. German UI. Filipe shares the link with family/friends — must look clean + trustworthy.

## Design system

- Dark, feed-first (football navy `#0a1d3b`, SRF red accent `#e63329`, white text). Own DNA (not the chess cockpit's light theme).
- Two surfaces: a full-screen Reels-style **Highlights** swipe feed, and a structured **Spiele** schedule (group → round → match cards with score + goalscorers).
- Components today: top bar (WM brand + tab switch), ☰ sidebar (jump to a match), pull-to-refresh pill, version stamp.

## Screens

- **Highlights** — vertical swipe; per slide: flags + teams + title + thumbnail; tap to play (hls.js / native iOS HLS).
- **Spiele** — Vorrunde → Gruppe A–L (then knockouts); each match: flags + teams + score (or kickoff) + goalscorers with minutes.
- **Feedback** — `feedback.html` (GitHub issue / e-mail).

## Out of scope

- No login/accounts. No comments. No external links beyond SRF playback + feedback. Never cache video.

## Two-stage delivery

- Stage 1: low-fi wireframe (structure + flow).
- Stage 2: hi-fi (visual polish), after Stage 1 sign-off.

## Done criteria

A kid can install it, swipe match highlights, and check who scored when — beautiful enough to share.
