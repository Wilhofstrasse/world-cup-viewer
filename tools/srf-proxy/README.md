# SRF proxy — Cloudflare Tunnel from home Mac

Lets non-CH viewers (Germany, Brazil) watch SRF WM highlight reels through
your Mac in Zollikerberg. Free: Cloudflare Tunnel + Node + `filipeandrade.com`
DNS you already own.

## How it works

```
Friend in Berlin → wm.filipeandrade.com (PWA) → fetches HLS via
srf.filipeandrade.com → CF tunnel → your Mac (CH IP) → SRF Integration Layer +
Akamai → CH-OK response → back through tunnel → friend's player
```

The proxy is path-keyed: every request goes to `/proxy?url=<encoded SRF URL>`.
An allow-list (SRGSSR + Akamai + SRF domains) keeps the proxy from becoming
an open relay. HLS playlists (`.m3u8`) get URL-rewritten on the fly so the
player keeps fetching segments through us, not direct to Akamai.

> **⚠ The proxy host must be in Switzerland.** SRF geoblocks by the egress IP
> of whoever fetches the stream, and that is the proxy host (it makes the
> outbound SRF requests on the viewer's behalf — both the playlist AND every
> rewritten segment). Run it on a CH VPS or a Mac physically in CH. If the
> proxy runs from abroad (e.g. a laptop in Germany) SRF geoblocks the proxy
> just like a direct hit, and non-CH viewers get a black 0:00 player even
> though `/health` and the tunnel are green. This is the most common
> "everything looks up but videos won't play abroad" failure.

> **⚠ `cloudflared-config.yml` is reference, not the live config.** The running
> tunnel is token/dashboard-managed (`cloudflared --token <jwt>`), so its
> ingress comes from the Cloudflare Zero Trust dashboard, not this repo file.
> Change ingress in the dashboard; edit the file only if you switch back to a
> `--config … run` tunnel.

## Files

| File | Role |
|---|---|
| `server.mjs` | Node proxy on `127.0.0.1:8787`. Allow-list, playlist rewrite, byte-range support. |
| `cloudflared-config.yml` | Tunnel ingress → `srf.filipeandrade.com` → `:8787`. Paste your tunnel UUID. |
| `com.filipeandrade.srf-proxy.plist` | LaunchAgent — runs the Node proxy at login + restarts on crash. |
| `com.filipeandrade.cloudflared.plist` | LaunchAgent — runs `cloudflared tunnel run`. |

## One-time setup

```bash
# 1. Cloudflare auth (browser pops to dash.cloudflare.com, pick the filipeandrade.com zone)
cloudflared tunnel login

# 2. Create the tunnel — copy the UUID it prints
cloudflared tunnel create wm-srf-proxy

# 3. Edit cloudflared-config.yml — replace REPLACE_WITH_TUNNEL_UUID twice with the UUID

# 4. DNS — points srf.filipeandrade.com to the tunnel
cloudflared tunnel route dns wm-srf-proxy srf.filipeandrade.com

# 5. Quick test (foreground)
node tools/srf-proxy/server.mjs &
cloudflared tunnel --config tools/srf-proxy/cloudflared-config.yml run &
curl -s https://srf.filipeandrade.com/health
# {"ok":true,"ts":…}

# 6. Persistence — install both LaunchAgents
cp tools/srf-proxy/com.filipeandrade.srf-proxy.plist  ~/Library/LaunchAgents/
cp tools/srf-proxy/com.filipeandrade.cloudflared.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.filipeandrade.srf-proxy.plist
launchctl load ~/Library/LaunchAgents/com.filipeandrade.cloudflared.plist

# 7. Wire the Worker — set the env var so the PWA rewrites SRF URLs through the tunnel.
cd ~/Developer/world-cup-viewer
echo 'SRF_PROXY_BASE = "https://srf.filipeandrade.com"' >> wrangler.toml.tmp
# (open wrangler.toml, add SRF_PROXY_BASE under [vars])
npm run deploy
```

## Daily life

| What | How |
|---|---|
| Check it's up | `curl -s https://srf.filipeandrade.com/health` |
| Tail Node logs | `tail -f ~/Library/Logs/srf-proxy.log` |
| Tail tunnel logs | `tail -f ~/Library/Logs/cloudflared.log` |
| Restart Node proxy | `launchctl kickstart -k gui/$(id -u)/com.filipeandrade.srf-proxy` |
| Restart tunnel | `launchctl kickstart -k gui/$(id -u)/com.filipeandrade.cloudflared` |
| Stop both | `launchctl unload ~/Library/LaunchAgents/com.filipeandrade.{srf-proxy,cloudflared}.plist` |

## Failure modes

- **Mac asleep / home WiFi down** — clips stop loading. Spiele / Tabellen / Mehr
  continue working (FIFA endpoints are CORS-open, no proxy).
- **Cloudflare auth expired** — `cloudflared tunnel login` again.
- **SRF blocks the residential IP** — unlikely (SRF doesn't flag CH home IPs).
  If they ever do, you'd see 403s from `il.srgssr.ch`. Switch to Tailscale exit
  via your phone or upgrade to a CH VPS (~CHF 4/mo).
