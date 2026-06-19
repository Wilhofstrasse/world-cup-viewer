/**
 * SRF proxy — runs on the Mac at home (CH IP), exposes SRF Integration Layer +
 * Akamai HLS edges to non-CH viewers via a Cloudflare Tunnel.
 *
 * Endpoint: GET /proxy?url=<encoded absolute URL>
 *   - Verifies the host against an allow-list (SRGSSR + Akamai + SRF domains).
 *   - Fetches the target server-side; the Mac's CH IP is what SRF sees.
 *   - For .m3u8 playlists, rewrites every URL (absolute + relative) to point
 *     back through /proxy so the player keeps fetching via us, not direct.
 *   - For .ts / .m4s / .json / images: streams the body through.
 *
 * Listens on 127.0.0.1:8787 by default. Cloudflare Tunnel (cloudflared) maps
 * srf.filipeandrade.com → this port. The browser never talks to it directly.
 */

import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PORT = parseInt(process.env.SRF_PROXY_PORT || "8787", 10);
const PUBLIC_BASE = process.env.SRF_PROXY_PUBLIC_BASE || "https://srf.filipeandrade.com";

// Allow-list — exact hosts the player ever needs to talk to.
const ALLOW_HOST = (host) =>
  /\.srgssr\.ch$/.test(host) ||
  /\.akamaized\.net$/.test(host) ||
  /\.akamai(?:ized)?-cdn\.com$/.test(host) ||
  /\.srf\.ch$/.test(host) ||
  /\.srgssr\.akamaized\.net$/.test(host) ||
  host === "il.srgssr.ch" ||
  host === "input.srgssr.ch";

const log = (...a) => console.log("[srf-proxy]", new Date().toISOString(), ...a);

function rewritePlaylist(body, targetUrl) {
  const base = new URL(targetUrl);
  return body
    .split("\n")
    .map((line) => {
      const t = line.trim();
      // Keep comments + directives untouched, EXCEPT URI=… inside #EXT-X-* tags.
      if (t === "" || t.startsWith("#")) {
        // Rewrite URI="…" attributes inside tags (e.g. #EXT-X-MEDIA URI="…").
        return line.replace(/URI="([^"]+)"/g, (m, u) => {
          try {
            const abs = new URL(u, base).href;
            return `URI="${PUBLIC_BASE}/proxy?url=${encodeURIComponent(abs)}"`;
          } catch {
            return m;
          }
        });
      }
      // Bare URL line (segment or sub-playlist).
      try {
        const abs = new URL(t, base).href;
        return `${PUBLIC_BASE}/proxy?url=${encodeURIComponent(abs)}`;
      } catch {
        return line;
      }
    })
    .join("\n");
}

const server = http.createServer(async (req, res) => {
  // CORS — anyone can fetch (no secrets on the wire; allow-list gates abuse).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://x");
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }
  if (url.pathname !== "/proxy") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const target = url.searchParams.get("url");
  if (!target) {
    res.writeHead(400);
    res.end("Missing url");
    return;
  }
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400);
    res.end("Bad url");
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    res.writeHead(400);
    res.end("Bad protocol");
    return;
  }
  if (!ALLOW_HOST(parsed.hostname)) {
    log("BLOCK", parsed.hostname);
    res.writeHead(403);
    res.end("Forbidden host");
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
        Accept: req.headers.accept || "*/*",
        ...(req.headers.range ? { Range: String(req.headers.range) } : {}),
      },
    });
    res.statusCode = upstream.status;
    const ctype = upstream.headers.get("content-type") || "";
    const isPlaylist = /mpegurl|m3u8/i.test(ctype) || target.split("?")[0].endsWith(".m3u8");
    if (isPlaylist) {
      const body = await upstream.text();
      const rewritten = rewritePlaylist(body, target);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      res.end(rewritten);
      return;
    }
    // Stream the body through. Copy useful headers.
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
    else res.end();
  } catch (e) {
    log("ERROR", target, e?.message);
    res.statusCode = 502;
    res.end("Proxy error: " + (e?.message || "unknown"));
  }
});

server.listen(PORT, "127.0.0.1", () => log(`listening on :${PORT}, public ${PUBLIC_BASE}`));
