/**
 * wm/store.ts — R2 persistence for the served WM blobs (wm/matches.json,
 * wm/topscorers.json). Fail-soft: when the bucket is unbound or an object is
 * missing/corrupt, an empty value is returned so endpoints + ingest degrade
 * quietly.
 */

import type { Env } from "../types.js";
import type { WmData, WmTopScorers, WmTabellen } from "./types.js";

const MATCHES_KEY = "wm/matches.json";
const TOPSCORERS_KEY = "wm/topscorers.json";
const TABELLEN_KEY = "wm/tabellen.json";
const EMPTY_MATCHES: WmData = { updatedAt: 0, season: "", matches: [] };
const EMPTY_TOPSCORERS: WmTopScorers = { updatedAt: 0, season: "", scorers: [] };
const EMPTY_TABELLEN: WmTabellen = { updatedAt: 0, season: "", rows: [] };

export async function loadWmData(env: Env): Promise<WmData> {
  if (!env.WM_R2) return { ...EMPTY_MATCHES };
  try {
    const obj = await env.WM_R2.get(MATCHES_KEY);
    if (!obj) return { ...EMPTY_MATCHES };
    const data = JSON.parse(await obj.text()) as WmData;
    if (!data || !Array.isArray(data.matches)) return { ...EMPTY_MATCHES };
    return data;
  } catch {
    return { ...EMPTY_MATCHES };
  }
}

export async function saveWmData(env: Env, data: WmData): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(MATCHES_KEY, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function loadWmTopScorers(env: Env): Promise<WmTopScorers> {
  if (!env.WM_R2) return { ...EMPTY_TOPSCORERS };
  try {
    const obj = await env.WM_R2.get(TOPSCORERS_KEY);
    if (!obj) return { ...EMPTY_TOPSCORERS };
    const data = JSON.parse(await obj.text()) as WmTopScorers;
    if (!data || !Array.isArray(data.scorers)) return { ...EMPTY_TOPSCORERS };
    return data;
  } catch {
    return { ...EMPTY_TOPSCORERS };
  }
}

export async function saveWmTopScorers(env: Env, data: WmTopScorers): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(TOPSCORERS_KEY, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function loadWmTabellen(env: Env): Promise<WmTabellen> {
  if (!env.WM_R2) return { ...EMPTY_TABELLEN };
  try {
    const obj = await env.WM_R2.get(TABELLEN_KEY);
    if (!obj) return { ...EMPTY_TABELLEN };
    const data = JSON.parse(await obj.text()) as WmTabellen;
    if (!data || !Array.isArray(data.rows)) return { ...EMPTY_TABELLEN };
    return data;
  } catch {
    return { ...EMPTY_TABELLEN };
  }
}

export async function saveWmTabellen(env: Env, data: WmTabellen): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(TABELLEN_KEY, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}
