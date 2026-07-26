/**
 * Anomaly detection — a reading beyond k standard deviations of the rolling
 * window for its own device and metric.
 *
 * Per-device AND per-metric: a 60 C reading is unremarkable for power draw and
 * alarming for temperature, and one hot device must not make a cool one look
 * anomalous. Comparison is always against that device's own recent history.
 */
import { DEFAULT_TUNING } from '../config.js';
import type { Metric, Reading } from '../domain/reading.js';
import type { AnomalyRecord } from '../domain/types.js';
import { mean, stddev } from './stats.js';

export interface AnomalyDetectorOptions {
  /** Standard deviations before a reading is anomalous. Defaults to config's k. */
  k?: number;
  /** Readings retained per device+metric. */
  windowSize?: number;
  /** Samples required before detection is allowed at all. */
  minSamples?: number;
  /** Cap on retained anomaly records. */
  recentLimit?: number;
  /** Injected clock for `detectedTs`. */
  now?: () => number;
}

/** Spread below this is treated as no spread at all (floating-point safety). */
const EPSILON = 1e-9;

export class AnomalyDetector {
  private readonly k: number;
  private readonly windowSize: number;
  private readonly minSamples: number;
  private readonly recentLimit: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, number[]>();
  private recentAnomalies: AnomalyRecord[] = [];
  private totalDetected = 0;

  constructor(options: AnomalyDetectorOptions = {}) {
    this.k = options.k ?? 3;
    this.windowSize = options.windowSize ?? DEFAULT_TUNING.anomalyWindowSize;
    this.minSamples = options.minSamples ?? DEFAULT_TUNING.minSamplesForDetection;
    this.recentLimit = options.recentLimit ?? DEFAULT_TUNING.recentAnomalyLimit;
    this.now = options.now ?? Date.now;
  }

  /**
   * Judge a reading, then fold it into the baseline.
   *
   * The z-score is computed BEFORE the reading joins its window, so a spike is
   * never partly measured against itself. An anomalous reading is then withheld
   * from the baseline entirely: letting spikes in would inflate the standard
   * deviation and blind the detector to the next few.
   */
  inspect(reading: Reading): AnomalyRecord | undefined {
    const window = this.windowFor(reading.deviceId, reading.metric);
    const zScore = this.scoreAgainst(window, reading.value);
    if (zScore !== undefined && Math.abs(zScore) > this.k) {
      return this.record(reading, zScore);
    }
    this.push(window, reading.value);
    return undefined;
  }

  /**
   * The z-score of a value against a window, or undefined when the window
   * cannot support a judgement: too few samples (cold start) or no spread at
   * all, where every deviation would score as infinite.
   */
  private scoreAgainst(window: number[], value: number): number | undefined {
    if (window.length < this.minSamples) return undefined;
    const spread = stddev(window);
    if (spread < EPSILON) return undefined;
    return round((value - mean(window)) / spread);
  }

  /** Append to a rolling window, dropping the oldest sample past the cap. */
  private push(window: number[], value: number): void {
    window.push(value);
    if (window.length > this.windowSize) window.shift();
  }

  private windowFor(deviceId: string, metric: Metric): number[] {
    const key = `${deviceId}|${metric}`;
    const existing = this.windows.get(key);
    if (existing) return existing;
    const created: number[] = [];
    this.windows.set(key, created);
    return created;
  }

  /** Store an anomaly in the bounded ring of recent detections. */
  private record(reading: Reading, zScore: number): AnomalyRecord {
    const anomaly: AnomalyRecord = { reading, zScore, detectedTs: this.now() };
    this.recentAnomalies.push(anomaly);
    if (this.recentAnomalies.length > this.recentLimit) this.recentAnomalies.shift();
    this.totalDetected += 1;
    return anomaly;
  }

  /** Recent anomalies, newest first, optionally filtered. */
  recent(filter: { metric?: Metric; deviceId?: string; limit?: number } = {}): AnomalyRecord[] {
    const matched = this.recentAnomalies
      .filter((a) => filter.metric === undefined || a.reading.metric === filter.metric)
      .filter((a) => filter.deviceId === undefined || a.reading.deviceId === filter.deviceId)
      .reverse();
    return filter.limit === undefined ? matched : matched.slice(0, filter.limit);
  }

  /** How many anomalies are currently retained — the `anomalyCount` KPI. */
  count(): number {
    return this.recentAnomalies.length;
  }

  /** Lifetime detections, including ones aged out of the ring. */
  total(): number {
    return this.totalDetected;
  }

  /** Number of samples held for a device+metric. Exposed for tests and health. */
  windowLength(deviceId: string, metric: Metric): number {
    return this.windows.get(`${deviceId}|${metric}`)?.length ?? 0;
  }

  reset(): void {
    this.windows.clear();
    this.recentAnomalies = [];
    this.totalDetected = 0;
  }
}

/** Round to 4 decimals so floating-point noise never reaches the wire. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
