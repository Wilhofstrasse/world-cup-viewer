---
name: wm-design-sync
description: Sync design cards between local `design/canvas/` and the claude.ai/design project "Gabriel · WM 2026 Viewer" with the design-wins discipline. Pull canvas → diff vs local → adopt Filipe's edits → only then push new cards → ALWAYS register_assets so the pane indexes. Eliminates two recurring bugs - pushed-but-pane-empty (register_assets not called) and code-overwrites-canvas-edit (no diff before push).

TRIGGERS - "/wm-design-sync", "/wm-design", "sync wm design", "push wm cards",
"pull wm canvas", "wm canvas diff", "world cup design sync".

Use when - any change touches `design/canvas/**` in `~/Developer/world-cup-viewer` OR Filipe says he edited cards in claude.ai/design. Use BEFORE authoring new cards (pull-first) and AFTER authoring (push + register).

Do NOT use when - building app code (`web/`, `src/`); changing FIFA data; editing PLAN/MEMORY.
---

# wm-design-sync — World Cup Viewer canvas sync

**Project binding (locked):**
- projectId: `80d66392-b000-4e84-9034-d0914965bde1`
- name: `Gabriel · WM 2026 Viewer`
- localDir: `~/Developer/world-cup-viewer/design/canvas`
- canvas tree paths: `wireframes/components/*.html`, `wireframes/screens/*.html`, `hifi/components/*.html`, `hifi/screens/*.html`, root foundations + existing components/screens

## Rule 1 - Design wins

claude.ai/design canvas is the source of truth for any card that has been edited there. Local `design/canvas/*.html` is a working copy.

- Before any push: **PULL FIRST**. Run `list_files` + `get_file` on every card in scope. Compare to local bytes.
- If a card differs (Filipe edited it in canvas): **OVERWRITE LOCAL** with the canvas version. Never push local-version of an edited card back.
- Only exception: Filipe explicitly says "redo X" or "throw away my canvas changes to X". Then push local.

## Rule 2 - Always register_assets after write_files

The `@dsCard` auto-index is unreliable on first push. Force-register every card via legacy `register_assets`. Pane shows cards immediately, no refresh dance.

Default viewport for screens: `380 × 720`. For components: `380 × 400`. For pitch/bracket cards: `380 × 980`+. Group labels: `Wireframes — Components`, `Wireframes — Screens`, `Hi-Fi — Components`, `Hi-Fi — Screens`, `Foundations`.

## Rule 3 - Stage labels

| Stage | Group label | Local subdir |
|---|---|---|
| Wireframe | `Wireframes — Screens` / `Wireframes — Components` | `wireframes/` |
| Hi-Fi | `Hi-Fi — Screens` / `Hi-Fi — Components` | `hifi/` |
| Locked foundations | `Foundations` / `Components` / `Screens` | root |

Stage 2 hi-fi promotion archives Stage 1 by renaming groups: `Wireframes — …` → `Wireframes — Screens (archived)`.

## Canonical flow

```
1. PULL
   DesignSync.list_files
   DesignSync.get_file for each card in scope
   diff vs local (byte-compare or sha)
   if any differ → Write to local (canvas-version wins) + log which cards adopted

2. AUTHOR (only after pull is clean)
   Write new HTML cards locally under wireframes/ or hifi/
   First line MUST be: <!-- @dsCard group="<Stage — Group>" -->

3. PUSH
   DesignSync.finalize_plan
     writes: list of new/changed paths
     deletes: [] (or explicit removals)
     localDir: ~/Developer/world-cup-viewer/design/canvas
   DesignSync.write_files (read from disk via localPath)
   DesignSync.register_assets (ALWAYS — one per card just written)

4. REPORT
   - which cards pulled (canvas → local) with one-line summary of change
   - which cards pushed (local → canvas)
   - URL: https://claude.ai/design/p/80d66392-b000-4e84-9034-d0914965bde1
```

## Plan API quirks (learned the hard way)

- `finalize_plan` REQUIRES `deletes` field even if empty - pass `[]`.
- `write_files` uses `localPath` (relative to `localDir`) to read disk + upload without contents entering model context. Prefer it over inline `data`.
- `register_assets` paths must be in the plan's writes. Re-finalize a fresh plan if registering separately.

## Diff helper (bash)

```bash
# Compare canvas file vs local
diff <(curl -s "<canvas-get-url>") ~/Developer/world-cup-viewer/design/canvas/<path>
```

In practice: pull via DesignSync.get_file, write to a `/tmp/canvas-<sha>` file, `diff` against local, decide. If many cards, parallelize get_file calls in one message.

## Failure modes + fixes

| Symptom | Cause | Fix |
|---|---|---|
| Pane shows "No cards yet" after push | `@dsCard` self-check didn't run | Run `register_assets` for every card (legacy path). Cards appear on next pane refresh. |
| Local diverges from canvas silently | Code pushed without pull-first | Pull canvas, adopt, ask Filipe before continuing. |
| `finalize_plan` errors `requires: deletes` | Optional field treated as required | Always pass `"deletes": []`. |
| Card renders blank in pane | `@dsCard` marker missing or on wrong line | First line of HTML must be `<!-- @dsCard group="…" -->` (before `<!DOCTYPE>`). |
| Push succeeds but card pinned to wrong group | Group label mismatch between marker + register_assets call | Match exactly; the pane uses register_assets group when present, else `@dsCard`. |

## After-skill checklist

- [ ] All canvas-edited cards adopted into local (no silent overwrite)
- [ ] All locally-changed cards pushed + registered
- [ ] Spec doc `design/prompts/fifa-features-v1.md` updated if a design decision changed scope (e.g., K.-o.-Baum dropped R32/R16 → Spiele tab gains those rounds)
- [ ] Reported card URLs to Filipe
