/**
 * detect.mjs — goal-moment detector for WM highlight reels.
 *
 * Runs on the home Mac (where the SRF proxy already lives). For every new
 * clip in the WM show feed:
 *   1. Resolve the HLS playlist via the SRF Integration Layer.
 *   2. Pipe HLS → 16 kHz mono WAV via ffmpeg.
 *   3. Transcribe with whisper.cpp (medium model, German).
 *   4. Scan transcript segments for goal cues ("Tor", "Tooor", "Treffer",
 *      "Goal", "Trifft"); each match becomes a marker with `tSec` shifted
 *      back by PRE_ROLL_SEC so the player gets ~4 s of build-up before the
 *      actual goal moment.
 *   5. POST markers to the Worker (auth via shared secret).
 *
 * State is kept in .state.json so we never retranscribe a clip twice.
 */

import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SHOW_URN = "urn:srf:show:tv:c55b9fb8-e108-4994-a1d0-8c288bf8d5bc";
const IL_BASE = "https://il.srgssr.ch/integrationlayer";
const VECTOR = "portalplay";

const WHISPER = "/opt/homebrew/bin/whisper-cli";
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const MODEL = join(__dirname, "models", "ggml-medium.bin");
const STATE = join(__dirname, ".state.json");
const TMP = join(__dirname, ".tmp");

const WORKER_BASE = process.env.WORKER_BASE || "https://wm.filipeandrade.com";
const AUTH_TOKEN = process.env.WM_MARKERS_TOKEN || "";

const PRE_ROLL_SEC = 4;
const GOAL_RE = /\b(?:t+o+o*r+|t+o+r+e|trifft|treffer|gleicher|fuhrung|fuehrung|goal|goooal|netz|reinstecken|reingedru?eckt|einnetzt)/i;

const log = (...a) => console.log("[goals]", new Date().toISOString(), ...a);

async function loadState() {
  try {
    const txt = await readFile(STATE, "utf8");
    return JSON.parse(txt);
  } catch (_e) {
    return { processed: {} };
  }
}

async function saveState(state) {
  await writeFile(STATE, JSON.stringify(state, null, 2));
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "wm-goal-detector/1.0" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/** List "Die Live-Highlights bei …" clips with date + title. */
async function listClips() {
  const url = `${IL_BASE}/2.0/episodeComposition/latestByShow/byUrn/${SHOW_URN}?vector=${VECTOR}&pageSize=60`;
  const data = await fetchJson(url);
  const eps = data.episodeList || [];
  const out = [];
  for (const ep of eps) {
    const m = (ep.mediaList || [])[0];
    if (!m || m.mediaType !== "VIDEO" || !m.urn) continue;
    const title = m.title || "";
    if (!/^Die Live-Highlights bei/i.test(title)) continue;
    out.push({ urn: m.urn, title, dateISO: m.date || ep.publishedDate || "", durationSec: Math.round((m.duration || 0) / 1000) });
  }
  return out;
}

/** Resolve the playable HLS URL from a clip URN. */
async function resolveHls(urn) {
  const url = `${IL_BASE}/2.1/mediaComposition/byUrn/${urn}?onlyChapters=true&vector=${VECTOR}`;
  const data = await fetchJson(url);
  const chapter = (data.chapterList || []).find((c) => c.urn === urn) || (data.chapterList || [])[0];
  const res = (chapter && chapter.resourceList) || [];
  // Prefer HLS over DASH.
  const hls = res.find((r) => /HLS/i.test(r.streaming || r.type || ""));
  if (!hls || !hls.url) throw new Error("no HLS");
  return hls.url;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (b) => { stdout += b.toString(); });
    p.stderr.on("data", (b) => { stderr += b.toString(); });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/** Extract audio (16 kHz mono PCM WAV) from an HLS URL into wavPath. */
async function extractAudio(hlsUrl, wavPath) {
  await run(FFMPEG, [
    "-y", "-loglevel", "error",
    "-i", hlsUrl,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    wavPath,
  ]);
}

/** Run whisper.cpp on the WAV. Writes <wav>.srt next to it; returns segments. */
async function transcribe(wavPath) {
  await run(WHISPER, [
    "-m", MODEL,
    "-l", "de",
    "-f", wavPath,
    "-osrt",
    "-of", wavPath, // -of strips the extension automatically
    "-t", String(Math.max(4, Math.min(10, navigatorThreadCount()))),
    "-pp",
  ]);
  const srt = await readFile(`${wavPath}.srt`, "utf8");
  return parseSrt(srt);
}

function navigatorThreadCount() {
  return (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 8;
}

/** SRT → [{ tStartSec, tEndSec, text }]. */
function parseSrt(srt) {
  const out = [];
  const blocks = srt.split(/\r?\n\r?\n/);
  for (const b of blocks) {
    const m = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+([\s\S]+)/.exec(b);
    if (!m) continue;
    const tStartSec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const tEndSec = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    out.push({ tStartSec, tEndSec, text: m[9].replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** Heuristically merge segments that sit < 3 s apart (commentator yells once). */
function findGoals(segments) {
  const hits = [];
  for (const s of segments) {
    if (GOAL_RE.test(s.text)) {
      const shifted = Math.max(0, s.tStartSec - PRE_ROLL_SEC);
      if (!hits.length || shifted - hits[hits.length - 1].tSec > 8) {
        hits.push({ tSec: Math.round(shifted), label: s.text.slice(0, 80) });
      }
    }
  }
  return hits;
}

async function postMarkers(urn, markers) {
  const r = await fetch(`${WORKER_BASE}/api/wm/markers/${encodeURIComponent(urn)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ markers, updatedAt: Math.floor(Date.now() / 1000) }),
  });
  if (!r.ok) throw new Error(`POST markers ${r.status}`);
}

async function processClip(clip) {
  log("processing", clip.urn, "—", clip.title);
  await mkdir(TMP, { recursive: true });
  const wav = join(TMP, `${clip.urn.replace(/[^a-z0-9]/gi, "_")}.wav`);
  try {
    const hls = await resolveHls(clip.urn);
    await extractAudio(hls, wav);
    const segments = await transcribe(wav);
    const goals = findGoals(segments);
    log("  →", goals.length, "goal markers");
    await postMarkers(clip.urn, goals);
    return goals.length;
  } finally {
    for (const f of [wav, `${wav}.srt`]) {
      if (existsSync(f)) await rm(f).catch(() => {});
    }
  }
}

async function main() {
  if (!AUTH_TOKEN) throw new Error("WM_MARKERS_TOKEN env var required");
  if (!existsSync(MODEL)) throw new Error(`whisper model missing at ${MODEL}`);
  const state = await loadState();
  const clips = await listClips();
  log(`found ${clips.length} match-highlights; ${Object.keys(state.processed).length} already processed`);
  let processed = 0;
  for (const c of clips) {
    if (state.processed[c.urn]) continue;
    try {
      const n = await processClip(c);
      state.processed[c.urn] = { ts: Date.now(), goals: n };
      await saveState(state);
      processed++;
    } catch (e) {
      log("  X", c.urn, e.message);
    }
  }
  log(`done. processed ${processed} new clip(s)`);
}

main().catch((e) => {
  console.error("[goals] fatal:", e);
  process.exit(1);
});
