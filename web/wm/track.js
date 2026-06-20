/**
 * track.js — anonymous client telemetry for the Mehr ▸ Einstellungen map.
 *
 * Sends one POST per event to /api/track via sendBeacon (queues even when the
 * tab is being closed). Payload is small and entirely anonymous:
 *
 *   { event, sessionId, target?, durationMs?, path? }
 *
 * sessionId is a per-tab UUID generated in sessionStorage — wipes when the tab
 * closes, never written to localStorage, never sent back to the user. Country
 * + colo come from Cloudflare's request metadata on the Worker, not the client.
 *
 * Fire-and-forget: errors are swallowed; telemetry must never break the app.
 */

"use strict";

const API = "/api/track";

function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  // RFC4122-ish fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sessionId() {
  try {
    let s = sessionStorage.getItem("wm.sid");
    if (!s) {
      s = uuid();
      sessionStorage.setItem("wm.sid", s);
    }
    return s;
  } catch (_e) {
    return ""; // privacy mode / blocked storage → no session id, still tracks aggregates
  }
}

export function track(event, props = {}) {
  if (!event) return;
  const payload = {
    event,
    sessionId: sessionId(),
    target: props.target || "",
    path: location.pathname + (location.hash || ""),
    ...(typeof props.durationMs === "number" ? { durationMs: Math.round(props.durationMs) } : {}),
    ...(typeof props.durationSec === "number" ? { durationSec: Math.round(props.durationSec) } : {}),
  };
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(API, blob);
      return;
    }
    // Fallback: fire-and-forget fetch with keepalive so it survives the unload.
    fetch(API, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  } catch (_e) {/* never throw — telemetry can't break the app */}
}
