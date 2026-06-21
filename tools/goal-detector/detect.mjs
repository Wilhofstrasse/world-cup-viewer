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

import { parseMatchTitle, teamsMatch } from "../../web/wm/parse.js";

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
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const PRE_ROLL_SEC = 4;
const DEDUP_SEC = 15;          // commentator excitement clusters → merge inside 15 s
const MAX_MARKERS = 8;         // cap per clip — real games rarely have > 6 goals
const SKIP_INTRO_SEC = 3;
const SKIP_OUTRO_SEC = 5;

// Whisper loop-detection thresholds — clip is flagged ONLY when BOTH a low
// unique-density AND a long single-span run are present (per Codex review:
// uniqueDensity alone false-flags legitimately sparse-commentary clips).
const LOOP_MIN_UNIQUE_DENSITY = 0.10;
const LOOP_MAX_RUN_SPAN_RATIO = 0.30;
const LOOP_MIN_CLIP_SEC = 30;  // don't flag short clips — too noisy
const LOOP_RETRY_MIN_UNIQ_GAIN = 0.02; // retry must beat pass1 by ≥ this margin

/**
 * Cue regex. Whisper transcribes a shouted goal as either "Tor!", "Tooor!" or
 * "Treffer!" — match any of those. Word-bounded "Tor" so compounds like
 * "Tordifferenz", "Torwart", "Torschütze" don't slip in. "Goal" / "Goooal"
 * carries from any English-language clip.
 */
const GOAL_RE = /\b(?:tor+e?!?|tre+ffer!?|go+a+l+!?)\b/i;
/** Reject obvious compound contexts even if the word boundary matched. */
const NEGATIVE_CONTEXT = /\b(?:torwart|torhüter|torhueter|torsch(?:ü|u)tze|torsch(?:ü|u)tzin|torchance|torgefahr|tordifferenz|torjäger|torjaeger|torlinie|torpfost|tribuna|tribuene|tribuene|tordistanz|tornetz)\b/i;

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

/** Run whisper.cpp on the WAV. Writes <wav>.srt next to it; returns segments.
 *  Decoder-stability tuning (v1.9.7, 21.06.2026): default whisper.cpp config
 *  produces repetition loops on noisy SRF clips (intro music, crowd-only
 *  stretches) because --max-context defaults to -1 (unlimited) and re-feeds
 *  hallucinated text into the next window as prompt. We disable that
 *  (-mc 0), raise entropy/logprob fallback thresholds so locked-in loops
 *  trigger the temperature ladder, and suppress non-speech tokens.
 *  NEVER add -nf / --no-fallback — that disables the temperature ladder,
 *  which is the mechanism that recovers from a fired threshold. */
async function transcribe(wavPath, opts = {}) {
  const tp = opts.temperature ?? 0.0;
  const et = opts.entropyThold ?? 2.8;
  const lpt = opts.logprobThold ?? -0.5;
  await run(WHISPER, [
    "-m", MODEL,
    "-l", "de",
    "-f", wavPath,
    "-osrt",
    "-of", wavPath, // -of strips the extension automatically
    "-t", String(Math.max(4, Math.min(10, navigatorThreadCount()))),
    "-mc", "0",           // disable prior-text conditioning (kills feedback loops)
    "-et", String(et),    // raise entropy threshold for fallback
    "-lpt", String(lpt),  // raise logprob threshold for fallback
    "-tp", String(tp),    // baseline temperature (ladder kicks in via -tpi 0.2 default)
    "-sns",                // suppress non-speech tokens (music/crowd seeds)
    "-pp",
  ]);
  const srt = await readFile(`${wavPath}.srt`, "utf8");
  return parseSrt(srt);
}

function navigatorThreadCount() {
  return (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 8;
}

/** SRT → [{ tStartSec, tEndSec, text, repeatCount }]. Collapses whisper's
 *  "stuck loop" hallucination (same sentence repeated for many consecutive
 *  segments) so the LLM sees one occurrence per unique utterance instead of
 *  dozens. `repeatCount` is the number of raw blocks that collapsed into the
 *  segment (1 = no collapse). assessTranscriptHealth uses repeatCount > 1
 *  to distinguish a legitimately long single segment (e.g. a 40s silence)
 *  from a collapsed-duplicate loop (Codex finding 2026-06-21). */
function parseSrt(srt) {
  const raw = [];
  const blocks = srt.split(/\r?\n\r?\n/);
  for (const b of blocks) {
    const m = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+([\s\S]+)/.exec(b);
    if (!m) continue;
    const tStartSec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const tEndSec = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    raw.push({ tStartSec, tEndSec, text: m[9].replace(/\s+/g, " ").trim() });
  }
  const out = [];
  for (const seg of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.text === seg.text) {
      prev.tEndSec = seg.tEndSec; // extend the run; same segment.
      prev.repeatCount = (prev.repeatCount || 1) + 1;
    } else {
      out.push({ ...seg, repeatCount: 1 });
    }
  }
  return out;
}

/** Canonicalize a transcript line so near-duplicate loops (whisper varies
 *  punctuation, casing, number formatting between repetitions) collapse to
 *  the same key for health-check purposes. Lower-case, strip punctuation,
 *  normalize "1 zu 1" / "1:1" / "1-1" → "1 1", collapse whitespace. */
function canonicalizeText(t) {
  return (t || "")
    .toLowerCase()
    .replace(/[‐-―\-:.,!?;()"„""''`]/g, " ")
    .replace(/\b(\d+)\s*(?:zu|:|-)\s*(\d+)\b/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Assess transcript health to detect whisper repetition-loop failures.
 *  uniqueDensity = unique canonical segment count / clip seconds.
 *  maxRunSpanRatio = longest deduped (post-canonical) segment span / clip seconds.
 *  Per Codex review: flag is set ONLY when BOTH signals fire — uniqueDensity
 *  alone false-flags legitimately sparse-commentary clips. Span-only flags
 *  on legitimate long silences are protected by the AND. Both heuristics fire
 *  on the Deutschland-Elfenbeinküste case observed 21.06.2026 (55x "Deniz
 *  Undaf trifft zum 1 zu 1" → uniqueDensity ≈ 0.089, maxRunSpanRatio ≈ 0.34). */
function assessTranscriptHealth(segments, clipDurationSec) {
  if (!clipDurationSec || !isFinite(clipDurationSec) || clipDurationSec < LOOP_MIN_CLIP_SEC) {
    return { uniqueDensity: 1, maxRunSpanRatio: 0, looped: false, reason: "too-short" };
  }
  const canon = segments.map((s) => canonicalizeText(s.text)).filter((t) => t.length > 0);
  const uniqueCount = new Set(canon).size;
  const uniqueDensity = uniqueCount / clipDurationSec;
  // Compute longest run-span on canonicalized text so near-duplicates with
  // punctuation/casing drift also count as a single run.
  let maxRunSpan = 0;
  let runStart = null;
  let runKey = null;
  for (const seg of segments) {
    const span = seg.tEndSec - seg.tStartSec;
    if (!isFinite(span) || span < 0) continue; // defensive — bad SRT timestamps
    const key = canonicalizeText(seg.text);
    if (!key) continue;
    if (runKey === key && runStart != null) {
      const runSpan = seg.tEndSec - runStart;
      if (isFinite(runSpan) && runSpan > maxRunSpan) maxRunSpan = runSpan;
    } else {
      runKey = key;
      runStart = seg.tStartSec;
      // Codex finding 2026-06-21: parseSrt collapses exact duplicate runs
      // into ONE segment with extended tEndSec, so the `runKey === key`
      // branch never fires on the original 115× loop. We DO need to count
      // already-collapsed runs (repeatCount > 1) as long-span events here.
      // A first occurrence with repeatCount > 1 came from a real loop —
      // use its own span. repeatCount == 1 means a single legitimate
      // statement (no collapse) and stays out of the run-span signal.
      if ((seg.repeatCount || 1) > 1 && isFinite(span) && span > maxRunSpan) {
        maxRunSpan = span;
      }
    }
  }
  const maxRunSpanRatio = maxRunSpan / clipDurationSec;
  const lowDensity = uniqueDensity < LOOP_MIN_UNIQUE_DENSITY;
  const longRun = maxRunSpanRatio > LOOP_MAX_RUN_SPAN_RATIO;
  const reasons = [];
  if (lowDensity) reasons.push(`unique-density ${uniqueDensity.toFixed(3)} < ${LOOP_MIN_UNIQUE_DENSITY}`);
  if (longRun) reasons.push(`run-span ${maxRunSpanRatio.toFixed(3)} > ${LOOP_MAX_RUN_SPAN_RATIO}`);
  // AND-gate: only flag when both signals fire (Codex #3) — kills false-positives
  // on legitimately sparse clips that just happen to have a long single statement.
  const looped = lowDensity && longRun;
  return { uniqueDensity, maxRunSpanRatio, looped, reason: looped ? reasons.join(" + ") : (reasons.length ? `${reasons.join(" + ")} (single signal — not flagged)` : "healthy") };
}

/**
 * Heuristically pick goal moments: tight regex + DEDUP_SEC merge window + skip
 * intro/outro chrome + cap at MAX_MARKERS so a chatty commentator can't
 * over-tag the clip. Excludes the very last seconds because outro music often
 * triggers false matches.
 */
function findGoals(segments, clipDurationSec) {
  const tail = clipDurationSec ? clipDurationSec - SKIP_OUTRO_SEC : Infinity;
  const hits = [];
  for (const s of segments) {
    if (!GOAL_RE.test(s.text)) continue;
    if (NEGATIVE_CONTEXT.test(s.text)) continue;
    if (s.tStartSec < SKIP_INTRO_SEC || s.tStartSec > tail) continue;
    const shifted = Math.max(0, s.tStartSec - PRE_ROLL_SEC);
    if (!hits.length || shifted - hits[hits.length - 1].tSec > DEDUP_SEC) {
      hits.push({ tSec: Math.round(shifted), label: s.text.slice(0, 80) });
    }
  }
  return hits.slice(0, MAX_MARKERS);
}

/** Pull the FIFA match blob (teams + score + goals[].minute) so we can give the
 *  LLM ground-truth context per clip. Falls back to [] on error. */
async function fetchMatches() {
  try {
    const r = await fetch(`${WORKER_BASE}/api/wm/matches`);
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.matches) ? d.matches : [];
  } catch (_e) {
    return [];
  }
}

/** Match a clip ("Die Live-Highlights bei A - B") to its FIFA fixture using the
 *  same tolerant team comparator the web client uses. Null when teams can't be
 *  resolved (live broadcasts, magazine clips, etc.). */
function findMatchForClip(clip, matches) {
  const parsed = parseMatchTitle(clip.title);
  if (!parsed) return null;
  for (const m of matches) {
    if (
      (teamsMatch(parsed.teamA, m.teamA) && teamsMatch(parsed.teamB, m.teamB)) ||
      (teamsMatch(parsed.teamA, m.teamB) && teamsMatch(parsed.teamB, m.teamA))
    ) {
      return m;
    }
  }
  return null;
}

/**
 * Ask Claude Haiku to identify the goal moments in a whisper transcript.
 * The LLM gets the FIFA ground-truth goal count + scorer/minute list as
 * context so it can match commentary mentions to the right number of events
 * instead of blindly counting "Tor"-substrings (which over-fires on past
 * references, near-misses, and "Torwart"/"Torchance" compounds).
 *
 * Returns markers in the same shape as findGoals() does. Throws on API error
 * (caller falls back to the regex path).
 */
async function findGoalsLLM(segments, match, clipDurationSec) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const total = (match.scoreA || 0) + (match.scoreB || 0);
  if (!total) return []; // 0–0 match: nothing to mark, skip the API call.

  const goalHint = (match.goals || [])
    .map((g) => `${g.minute}' ${g.scorer || "?"} (${g.team === "A" ? match.teamA : match.teamB}${g.type === "penalty" ? ", FE" : g.type === "own" ? ", ET" : ""})`)
    .join("; ");

  const transcript = segments
    .map((s) => `[${s.tStartSec.toFixed(1)}s] ${s.text}`)
    .join("\n");

  const system =
    "You analyze German-language football commentary transcripts of WM 2026 highlight reels. The timestamps in [N.Ns] are RELATIVE to the clip's own playhead, not the match minute. Return exactly the number of goal markers requested, sorted ASCENDING by tSec.";

  const userMsg = `MATCH: ${match.teamA} ${match.scoreA ?? "?"} – ${match.scoreB ?? "?"} ${match.teamB}
FIFA GOAL EVENTS (match minute, scorer, team): ${goalHint || "unknown"}
CLIP DURATION: ${clipDurationSec || "unknown"} seconds

TASK: Identify up to ${total} real goal moments in this clip — fewer if you can't find that many distinct events. A real goal moment is when the commentator reacts to a goal being scored RIGHT NOW in the clip. Cues include:
- A sudden "Tor!", "Treffer!", "Goooal!", shouted scorer's name, or unmistakable celebration
- A score announcement like "trifft zum 1:0", "macht das 2:1", "erzielt den Ausgleich"
- Past tense IS fine when describing the moment that just happened ("Deniz Undaf trifft zum 1 zu 1" IS a real goal report — German commentators routinely narrate goals this way)

Whisper sometimes loops on a phrase — if you see the SAME sentence many times in a row, treat the FIRST occurrence as the goal moment and ignore the duplicates (the parser already de-duplicates consecutive duplicates before you see it).

IGNORE:
- Past-tense references ("seinen dritten Treffer in diesem Turnier") — that names an already-scored goal in past games, not a new one
- Near-misses ("knapp vorbei", "der Schuss aufs Tor", "Latte", "Pfosten")
- Compound words: "Torwart", "Torhüter", "Torchance", "Torgefahr", "Tordifferenz", "Torjäger", "Torlinie", "Torpfost"
- Statistical recaps ("die ersten beiden Tore fielen nach Standardsituationen")
- Substitutions, fouls, cards, VAR reviews

For each goal, set tSec to ~3 seconds BEFORE the celebration burst so the player gets a brief build-up. tSec must be an integer between 0 and ${clipDurationSec || 600}.

RETURN ONLY this JSON array (no prose, no markdown fence):
[{"tSec": <int>, "scorer": "<surname or null>", "label": "<short German caption, max 60 chars>"}]

RULES:
- Return AT LEAST 1 marker if there is ANY plausible goal cue in the transcript and FIFA expects ${total} ≥ 1. Returning [] when the FIFA score is non-zero is almost always a mistake.
- Return AT MOST ${total} markers. If you see more than ${total} candidates, pick the strongest.
- If you genuinely find zero plausible goal cues (silent/music-only clip), return [].

TRANSCRIPT:
${transcript}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = j?.content?.[0]?.text || "";
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr;
  try {
    arr = JSON.parse(m[0]);
  } catch (_e) {
    return [];
  }
  return arr
    .filter((x) => typeof x.tSec === "number" && isFinite(x.tSec))
    .map((x) => ({
      tSec: Math.max(0, Math.round(x.tSec)),
      label: (x.scorer ? `${x.scorer}: ` : "") + (x.label || "Tor"),
    }))
    .sort((a, b) => a.tSec - b.tSec)
    .slice(0, MAX_MARKERS);
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

async function processClip(clip, matches) {
  log("processing", clip.urn, "—", clip.title);
  await mkdir(TMP, { recursive: true });
  const wav = join(TMP, `${clip.urn.replace(/[^a-z0-9]/gi, "_")}.wav`);
  try {
    const hls = await resolveHls(clip.urn);
    await extractAudio(hls, wav);
    let segments = await transcribe(wav);
    // Debug: snapshot pass-1 SRT IMMEDIATELY (BEFORE any retry can clobber
    // <wav>.srt — Codex #6) so we can inspect the original output offline.
    const debugDir = "/tmp/wm-detector-debug";
    const stem = clip.urn.replace(/[^a-z0-9]/gi, "_");
    try {
      await mkdir(debugDir, { recursive: true });
      const txt = await readFile(`${wav}.srt`, "utf8");
      await writeFile(join(debugDir, `${stem}.pass1.srt`), txt);
    } catch (_e) { /* debug-only; never block production */ }
    let health = assessTranscriptHealth(segments, clip.durationSec);
    log(`  health uniqueDensity=${health.uniqueDensity.toFixed(3)} maxRunSpan=${health.maxRunSpanRatio.toFixed(3)} (${health.reason})`);
    let pass = 1;
    if (health.looped) {
      log(`  ! whisper loop detected (${health.reason}) — retrying with -tp 0.4 + tighter thresholds`);
      const retrySegs = await transcribe(wav, { temperature: 0.4, entropyThold: 3.0, logprobThold: -0.3 });
      const retryHealth = assessTranscriptHealth(retrySegs, clip.durationSec);
      log(`  retry health uniqueDensity=${retryHealth.uniqueDensity.toFixed(3)} maxRunSpan=${retryHealth.maxRunSpanRatio.toFixed(3)} (${retryHealth.reason})`);
      try {
        const txt = await readFile(`${wav}.srt`, "utf8");
        await writeFile(join(debugDir, `${stem}.pass2.srt`), txt);
      } catch (_e) { /* debug-only */ }
      // Replacement guard (Codex #5): only swap pass1 → retry if retry beats
      // pass1 by a meaningful uniqueDensity margin AND is not itself flagged
      // as suspicious. A retry that's only marginally better — or still looped
      // — is rejected, preventing pass1 being replaced by hallucinated variety.
      const meaningfullyBetter = retryHealth.uniqueDensity > health.uniqueDensity + LOOP_RETRY_MIN_UNIQ_GAIN;
      const retryNotSuspicious = !retryHealth.looped;
      if (meaningfullyBetter && retryNotSuspicious) {
        segments = retrySegs;
        health = retryHealth;
        pass = 2;
      }
      log(`  → using pass${pass} segments`);
    }
    const match = findMatchForClip(clip, matches);
    let goals = [];
    let usedLLM = false;
    if (match && ANTHROPIC_KEY) {
      try {
        goals = await findGoalsLLM(segments, match, clip.durationSec);
        usedLLM = true;
      } catch (e) {
        log(`  ! LLM failed (${e.message}) — falling back to regex`);
      }
    }
    if (!usedLLM) {
      goals = findGoals(segments, clip.durationSec);
    }
    const expected = match ? (match.scoreA || 0) + (match.scoreB || 0) : null;
    log(`  → ${goals.length} markers${expected != null ? ` (FIFA expects ${expected})` : ""}${usedLLM ? " [LLM" : " [regex"}, pass${pass}, uniqDensity=${health.uniqueDensity.toFixed(3)}]`);
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
  if (!ANTHROPIC_KEY) log("WARN: ANTHROPIC_API_KEY not set — falling back to regex detection only");
  const state = await loadState();
  const [clips, matches] = await Promise.all([listClips(), fetchMatches()]);
  log(`found ${clips.length} match-highlights; ${matches.length} FIFA fixtures; ${Object.keys(state.processed).length} already processed`);
  let processed = 0;
  for (const c of clips) {
    if (state.processed[c.urn]) continue;
    try {
      const n = await processClip(c, matches);
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
