#!/usr/bin/env node
/**
 * run.mjs — wrangler-dev + playwright-test orchestrator for the WM 2026
 * visual-diff harness.
 *
 * Contract (one self-contained rig per plan.harnessLocation):
 *   1. Pick a free port via net.createServer().listen(0) → close → reuse.
 *   2. Spawn `wrangler dev --port <port>` with the project root as cwd.
 *   3. Poll http://127.0.0.1:<port>/api/version until 200 (30s timeout).
 *   4. Run `playwright test --config visual/playwright.visual.config.ts` with
 *      BASE_URL pointed at the wrangler instance.
 *   5. SIGTERM the wrangler child + 3s grace + SIGKILL on every exit path.
 *
 * --bless     → passes --update-snapshots to playwright (regenerates baselines).
 * WM_DEV_URL  → skip wrangler spawn, reuse an already-running dev server.
 * Lockfile    → visual/.run.lock prevents concurrent runs racing the same port.
 */

import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const LOCK_FILE = join(__dirname, ".run.lock");
const CONFIG_PATH = "visual/playwright.visual.config.ts";

const bless = process.argv.includes("--bless");
const reuseUrl = process.env.WM_DEV_URL || "";

// ── Lockfile ─────────────────────────────────────────────────────────────
function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    let stale = false;
    try {
      const { pid } = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      try {
        process.kill(pid, 0); // probe; throws if not running
      } catch {
        stale = true;
      }
      if (!stale) {
        console.error(`visual harness already running (pid=${pid}). Remove ${LOCK_FILE} if stale.`);
        process.exit(2);
      }
    } catch {
      stale = true;
    }
    if (stale) {
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        /* ignore */
      }
    }
  }
  mkdirSync(dirname(LOCK_FILE), { recursive: true });
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

// ── Free-port probe ──────────────────────────────────────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// ── Wrangler dev spawn + readiness probe ─────────────────────────────────
async function spawnWrangler(port) {
  const child = spawn(
    "npx",
    ["wrangler", "dev", "--port", String(port), "--log-level", "error"],
    {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );
  const stderrBuf = [];
  child.stdout.on("data", (b) => stderrBuf.push(b.toString()));
  child.stderr.on("data", (b) => stderrBuf.push(b.toString()));
  return { child, stderrBuf };
}

async function waitForReady(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}

// ── Playwright run ───────────────────────────────────────────────────────
function runPlaywright(baseUrl) {
  return new Promise((resolve) => {
    const args = ["playwright", "test", "--config", CONFIG_PATH];
    if (bless) args.push("--update-snapshots");
    const child = spawn("npx", args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: { ...process.env, BASE_URL: baseUrl },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

// ── Kill helper with grace ───────────────────────────────────────────────
async function shutdown(child) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  const start = Date.now();
  while (!child.killed && Date.now() - start < 3_000) {
    await new Promise((res) => setTimeout(res, 100));
  }
  if (!child.killed) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  acquireLock();
  process.on("exit", releaseLock);
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));

  let child = null;
  let stderrBuf = null;
  let baseUrl = reuseUrl;
  let exitCode = 1;

  try {
    if (!reuseUrl) {
      const port = await freePort();
      console.log(`[visual] free port=${port} → spawning wrangler dev …`);
      const spawned = await spawnWrangler(port);
      child = spawned.child;
      stderrBuf = spawned.stderrBuf;
      const ready = await waitForReady(port);
      if (!ready) {
        console.error(`[visual] wrangler never responded on :${port} within 30s — check lsof -i :${port}`);
        if (stderrBuf.length) {
          console.error("\n--- wrangler stderr/stdout dump ---");
          console.error(stderrBuf.join(""));
        }
        return;
      }
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[visual] wrangler ready at ${baseUrl}`);
    } else {
      console.log(`[visual] WM_DEV_URL set → reusing ${reuseUrl}`);
    }

    if (bless) console.log(`[visual] BLESS mode — baselines will be overwritten.`);
    exitCode = await runPlaywright(baseUrl);
  } finally {
    await shutdown(child);
    if (exitCode === 0) {
      console.log(`[visual] PASS`);
    } else {
      const reportPath = join(__dirname, "report", "index.html");
      console.log(
        `[visual] FAIL (exit=${exitCode}). Report: file://${reportPath}`,
      );
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[visual] uncaught:", err);
  process.exit(1);
});
