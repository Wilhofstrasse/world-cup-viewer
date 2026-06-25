/**
 * wm/store.ts — R2 persistence for the served WM blobs (wm/matches.json,
 * wm/topscorers.json, …). Fail-soft: when the bucket is unbound or an object is
 * missing/corrupt, an empty value is returned so endpoints + ingest degrade
 * quietly.
 *
 * i18n: blobs are partitioned by language. German keeps the LEGACY flat keys
 * (wm/matches.json) so the live objects keep serving with zero migration; every
 * other language nests under its tag (wm/en/matches.json, wm/pt-BR/matches.json).
 * The stagemap is language-invariant and shared (wm/stagemap.json). Every loader
 * /saver defaults lang = de, so existing callers compile + behave unchanged.
 */

import type { Env } from "../types.js";
import type { WmData, WmTopScorers, WmTabellen, WmSquads } from "./types.js";
import type { WmHallOfFame } from "./halloffame.js";
import { type AppLang, DEFAULT_LANG, type RoundKey } from "./fifa.js";

/** Legacy (German) flat keys — kept so live R2 objects are never stranded. */
const LEGACY: Record<string, string> = {
  matches: "wm/matches.json",
  topscorers: "wm/topscorers.json",
  tabellen: "wm/tabellen.json",
  squads: "wm/squads.json",
  halloffame: "wm/halloffame.json",
};

/** (blob, lang) → R2 key. de → legacy flat key; other langs nest under the tag. */
function key(blob: keyof typeof LEGACY, lang: AppLang): string {
  return lang === DEFAULT_LANG ? LEGACY[blob]! : `wm/${lang}/${blob}.json`;
}

const STAGEMAP_KEY = "wm/stagemap.json"; // language-invariant IdStage → RoundKey

const EMPTY_MATCHES: WmData = { updatedAt: 0, season: "", matches: [] };
const EMPTY_TOPSCORERS: WmTopScorers = { updatedAt: 0, season: "", scorers: [] };
const EMPTY_TABELLEN: WmTabellen = { updatedAt: 0, season: "", rows: [] };
const EMPTY_SQUADS: WmSquads = { updatedAt: 0, season: "", squads: [] };
const EMPTY_HALLOFFAME: WmHallOfFame = { updatedAt: 0, seasonsIngested: 0, topScorers: [], bestSingleWM: [], mostTourneys: [] };

export async function loadWmData(env: Env, lang: AppLang = DEFAULT_LANG): Promise<WmData> {
  if (!env.WM_R2) return { ...EMPTY_MATCHES };
  try {
    const obj = await env.WM_R2.get(key("matches", lang));
    if (!obj) return { ...EMPTY_MATCHES };
    const data = JSON.parse(await obj.text()) as WmData;
    if (!data || !Array.isArray(data.matches)) return { ...EMPTY_MATCHES };
    return data;
  } catch {
    return { ...EMPTY_MATCHES };
  }
}

export async function saveWmData(env: Env, data: WmData, lang: AppLang = DEFAULT_LANG): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(key("matches", lang), JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function loadWmTopScorers(env: Env, lang: AppLang = DEFAULT_LANG): Promise<WmTopScorers> {
  if (!env.WM_R2) return { ...EMPTY_TOPSCORERS };
  try {
    const obj = await env.WM_R2.get(key("topscorers", lang));
    if (!obj) return { ...EMPTY_TOPSCORERS };
    const data = JSON.parse(await obj.text()) as WmTopScorers;
    if (!data || !Array.isArray(data.scorers)) return { ...EMPTY_TOPSCORERS };
    return data;
  } catch {
    return { ...EMPTY_TOPSCORERS };
  }
}

export async function saveWmTopScorers(env: Env, data: WmTopScorers, lang: AppLang = DEFAULT_LANG): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(key("topscorers", lang), JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function loadWmTabellen(env: Env, lang: AppLang = DEFAULT_LANG): Promise<WmTabellen> {
  if (!env.WM_R2) return { ...EMPTY_TABELLEN };
  try {
    const obj = await env.WM_R2.get(key("tabellen", lang));
    if (!obj) return { ...EMPTY_TABELLEN };
    const data = JSON.parse(await obj.text()) as WmTabellen;
    if (!data || !Array.isArray(data.rows)) return { ...EMPTY_TABELLEN };
    return data;
  } catch {
    return { ...EMPTY_TABELLEN };
  }
}

export async function saveWmTabellen(env: Env, data: WmTabellen, lang: AppLang = DEFAULT_LANG): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(key("tabellen", lang), JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function loadWmSquads(env: Env, lang: AppLang = DEFAULT_LANG): Promise<WmSquads> {
  if (!env.WM_R2) return { ...EMPTY_SQUADS };
  try {
    const obj = await env.WM_R2.get(key("squads", lang));
    if (!obj) return { ...EMPTY_SQUADS };
    const data = JSON.parse(await obj.text()) as WmSquads;
    if (!data || !Array.isArray(data.squads)) return { ...EMPTY_SQUADS };
    return data;
  } catch {
    return { ...EMPTY_SQUADS };
  }
}

export async function saveWmSquads(env: Env, data: WmSquads, lang: AppLang = DEFAULT_LANG): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(key("squads", lang), JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function loadWmHallOfFame(env: Env, lang: AppLang = DEFAULT_LANG): Promise<WmHallOfFame> {
  if (!env.WM_R2) return { ...EMPTY_HALLOFFAME };
  try {
    const obj = await env.WM_R2.get(key("halloffame", lang));
    if (!obj) return { ...EMPTY_HALLOFFAME };
    const data = JSON.parse(await obj.text()) as WmHallOfFame;
    if (!data || !Array.isArray(data.topScorers)) return { ...EMPTY_HALLOFFAME };
    return data;
  } catch {
    return { ...EMPTY_HALLOFFAME };
  }
}

export async function saveWmHallOfFame(env: Env, data: WmHallOfFame, lang: AppLang = DEFAULT_LANG): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(key("halloffame", lang), JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** Language-invariant IdStage → RoundKey map. Empty object when absent/corrupt. */
export async function loadStageMap(env: Env): Promise<Record<string, RoundKey>> {
  if (!env.WM_R2) return {};
  try {
    const obj = await env.WM_R2.get(STAGEMAP_KEY);
    if (!obj) return {};
    const data = JSON.parse(await obj.text()) as Record<string, RoundKey>;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export async function saveStageMap(env: Env, map: Record<string, RoundKey>): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(STAGEMAP_KEY, JSON.stringify(map), {
    httpMetadata: { contentType: "application/json" },
  });
}
