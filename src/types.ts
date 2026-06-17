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
}
