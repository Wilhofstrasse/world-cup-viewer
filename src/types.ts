/**
 * types.ts — Worker environment bindings for world-cup-viewer.
 *
 * Standalone WM 2026 app: clips are resolved client-side from the keyless SRF
 * Integration Layer; this Worker only hides the football API key, caches match
 * data in R2, and serves the version string. The WM domain types (Match, Goal,
 * …) live in src/wm/types.ts.
 */

export interface Env {
  /** Deployed app version, surfaced via GET /api/version (set in [vars]). */
  APP_VERSION?: string;

  /** R2 bucket holding the served match blob at key `wm/matches.json`. */
  WM_R2?: R2Bucket;

  /**
   * API-Football key — secret. Sent as the `x-apisports-key` header.
   * Set via `wrangler secret put APIFOOTBALL_KEY`. Absent → ingest no-ops.
   */
  APIFOOTBALL_KEY?: string;
  /** API-Football host. Defaults to "v3.football.api-sports.io". */
  WM_API_HOST?: string;
  /** FIFA World Cup league id in API-Football. Defaults to "1". */
  WM_LEAGUE_ID?: string;
  /** Season the WC is filed under. Defaults to "2026". */
  WM_SEASON?: string;

  /** Data provider: "fifa" (default, keyless) or "apifootball". */
  WM_API_PROVIDER?: string;
  /** FIFA idCompetition (FIFA World Cup = "17"). */
  WM_FIFA_COMPETITION?: string;
  /** FIFA idSeason (WM 2026 = "285023"). */
  WM_FIFA_SEASON?: string;

  /** SRF proxy base URL (home Mac via Cloudflare Tunnel). Empty = no proxy. */
  SRF_PROXY_BASE?: string;

  /** Cloudflare Analytics Engine dataset binding for client telemetry. */
  WM_EVENTS?: AnalyticsEngineDataset;

  /** Cloudflare account id (for /api/stats SQL queries). Set via `wrangler secret put`. */
  CF_ACCOUNT_ID?: string;
  /** API token with Analytics:Read scope (for /api/stats SQL queries). Secret. */
  CF_AE_TOKEN?: string;

  /** Shared bearer for POST /api/wm/markers from the home-Mac goal detector. */
  WM_MARKERS_TOKEN?: string;
}
