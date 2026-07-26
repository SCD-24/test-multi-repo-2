/**
 * Environment configuration for the Analytics API.
 *
 * Only the four variables declared on the architecture canvas are read from the
 * environment. Tuning knobs that are NOT declared there (rolling-window size,
 * snapshot cadence, device-health thresholds) live in {@link DEFAULT_TUNING} and
 * are injected at call sites, so the canvas `config` widget stays truthful.
 */

/** The env-backed settings declared on the canvas. */
export interface Config {
  /** SSE endpoint of the Telemetry Generator that feeds the ring buffer. */
  generatorUrl: string;
  /** Retention horizon of the ring buffer, in milliseconds. */
  ringWindowMs: number;
  /** Standard deviations from the rolling mean before a reading is an Anomaly. */
  anomalyK: number;
  /** HTTP port this service listens on. */
  port: number;
  /**
   * Browser origin permitted to call this API. The Dashboard runs on its own
   * origin and talks to this service directly (there is no proxy in front), so
   * without a matching allow-origin every REST read and the SSE stream are
   * blocked before the request is even made.
   */
  corsOrigin: string;
}

/**
 * Tuning knobs deliberately kept OUT of the environment because they are not
 * declared on the architecture canvas. Every consumer takes them as an optional
 * argument, which also makes them trivially overridable in tests.
 */
export const DEFAULT_TUNING = {
  /** Readings retained per device+metric for z-score detection. */
  anomalyWindowSize: 50,
  /** Samples required before the detector is allowed to flag anything. */
  minSamplesForDetection: 10,
  /** Recent anomalies retained for the API and the snapshot. */
  recentAnomalyLimit: 100,
  /** Cadence of `update` frames pushed to Dashboard subscribers. */
  snapshotIntervalMs: 1_000,
  /** A device seen more recently than this is `online`. */
  onlineThresholdMs: 5_000,
  /** A device seen more recently than this is `stale`; beyond it, `offline`. */
  staleThresholdMs: 30_000,
} as const;

export const CONFIG_DEFAULTS = {
  GENERATOR_URL: 'http://localhost:4001/stream',
  RING_WINDOW_MS: 3_600_000,
  ANOMALY_K: 3,
  PORT: 4002,
  CORS_ORIGIN: 'http://localhost:5173',
} as const;

/** Raised when the environment cannot produce a usable {@link Config}. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/**
 * Parse a URL, rejecting anything the SSE client could not actually connect to.
 * A malformed generator URL is a startup-time mistake, not a runtime condition.
 */
function parseUrl(raw: string | undefined, fallback: string, key: string): string {
  const value = raw?.trim() ? raw.trim() : fallback;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${key} must be a valid absolute URL, got "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${key} must use http or https, got "${value}"`);
  }
  return value;
}

/** Parse a strictly positive, finite number. Rejects 0, negatives, and junk. */
function parsePositiveNumber(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive number, got "${raw}"`);
  }
  return value;
}

/** Parse a strictly positive integer. */
function parsePositiveInteger(raw: string | undefined, fallback: number, key: string): number {
  const value = parsePositiveNumber(raw, fallback, key);
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${key} must be an integer, got "${raw}"`);
  }
  return value;
}

/**
 * Parse an allowed browser origin: either the wildcard `*` or a single
 * scheme://host[:port].
 *
 * A value carrying a path or a trailing slash is rejected rather than trimmed,
 * because browsers compare `Access-Control-Allow-Origin` byte for byte — the
 * misconfiguration would otherwise surface only as an unexplained CORS failure
 * in the Dashboard, far from its cause.
 */
function parseOrigin(raw: string | undefined, fallback: string, key: string): string {
  const value = raw?.trim() ? raw.trim() : fallback;
  if (value === '*') return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${key} must be "*" or an absolute origin, got "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${key} must use http or https, got "${value}"`);
  }
  if (value !== parsed.origin) {
    throw new ConfigError(`${key} must have no path or trailing slash, try "${parsed.origin}"`);
  }
  return value;
}

/** Parse a TCP port. Port 0 is rejected: this service must be addressable. */
function parsePort(raw: string | undefined, fallback: number, key: string): number {
  const value = parsePositiveInteger(raw, fallback, key);
  if (value > 65_535) {
    throw new ConfigError(`${key} must be between 1 and 65535, got "${raw}"`);
  }
  return value;
}

/**
 * Build a {@link Config} from an environment map.
 *
 * @throws ConfigError when any declared variable is present but unusable.
 */
export function loadConfig(env: Env = process.env): Config {
  return {
    generatorUrl: parseUrl(env['GENERATOR_URL'], CONFIG_DEFAULTS.GENERATOR_URL, 'GENERATOR_URL'),
    ringWindowMs: parsePositiveInteger(
      env['RING_WINDOW_MS'],
      CONFIG_DEFAULTS.RING_WINDOW_MS,
      'RING_WINDOW_MS',
    ),
    anomalyK: parsePositiveNumber(env['ANOMALY_K'], CONFIG_DEFAULTS.ANOMALY_K, 'ANOMALY_K'),
    port: parsePort(env['PORT'], CONFIG_DEFAULTS.PORT, 'PORT'),
    corsOrigin: parseOrigin(env['CORS_ORIGIN'], CONFIG_DEFAULTS.CORS_ORIGIN, 'CORS_ORIGIN'),
  };
}

/**
 * Load config or terminate. Misconfiguration is unrecoverable, so the process
 * exits non-zero immediately rather than starting in a half-working state.
 */
export function loadConfigOrExit(env: Env = process.env, exit = process.exit): Config {
  try {
    return loadConfig(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[analytics-api] invalid configuration: ${message}`);
    exit(1);
    throw error;
  }
}
