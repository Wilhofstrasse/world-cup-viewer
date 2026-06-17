/**
 * wm/store.ts — R2 persistence for the served WM blob (wm/matches.json).
 * Fail-soft: when the bucket is unbound or the object is missing/corrupt, an
 * empty WmData is returned so the endpoint + ingest degrade quietly.
 */

import type { Env } from "../types.js";
import type { WmData } from "./types.js";

const KEY = "wm/matches.json";
const EMPTY: WmData = { updatedAt: 0, season: "", matches: [] };

export async function loadWmData(env: Env): Promise<WmData> {
  if (!env.WM_R2) return { ...EMPTY };
  try {
    const obj = await env.WM_R2.get(KEY);
    if (!obj) return { ...EMPTY };
    const data = JSON.parse(await obj.text()) as WmData;
    if (!data || !Array.isArray(data.matches)) return { ...EMPTY };
    return data;
  } catch {
    return { ...EMPTY };
  }
}

export async function saveWmData(env: Env, data: WmData): Promise<void> {
  if (!env.WM_R2) return;
  await env.WM_R2.put(KEY, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}
