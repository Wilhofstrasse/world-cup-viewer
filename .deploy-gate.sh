#!/usr/bin/env bash
# Mechanical pre-deploy gate — blocks `wrangler deploy` unless:
#   1. working tree is clean (no uncommitted changes)
#   2. HEAD equals origin/<branch> (no un-pushed commits)
#
# See [P-140] Project Canon → Deploy-gate invariant.
# Wired 2026-04-20 after router-mcp/doc-renderer deploy-drift incidents.
set -euo pipefail

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "deploy blocked: working tree has uncommitted changes. commit or stash before deploying." >&2
  exit 1
fi

if ! git fetch --quiet; then
  echo "deploy blocked: git fetch failed. fix push auth (SSH key / PAT) before deploying." >&2
  exit 1
fi

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "deploy blocked: HEAD ($LOCAL) differs from upstream ($REMOTE). push or pull before deploying." >&2
  exit 1
fi

echo "deploy gate passed: clean tree, HEAD == upstream"
