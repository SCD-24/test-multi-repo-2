/**
 * Snapshot assembly — the payload of every `update` frame.
 *
 * A frame carries the WHOLE current picture (KPIs, latest bucket per metric,
 * device health, recent anomalies) rather than a delta, so the Dashboard can
 * render straight from the newest frame and a client that missed frames while
 * backgrounded needs no catch-up protocol.
 *
 * Pure over its inputs: the store, the detector, and the clock are all passed
 * in, so a snapshot can be asserted exactly without standing anything up.
 */
import type { Reading } from '../domain/reading.js';
import type { AnomalyRecord, Snapshot } from '../domain/types.js';
import type { DeviceLastSeen } from '../store/ringBuffer.js';
import { bucketize, latestBucketPerMetric } from './buckets.js';
import { buildDeviceHealth, type DeviceHealthOptions } from './deviceHealth.js';
import { buildKpis } from './kpis.js';

export interface SnapshotInput {
  /** Everything currently retained in the ring buffer. */
  readings: readonly Reading[];
  /** Last-seen record per device, including silent ones. */
  devices: readonly DeviceLastSeen[];
  /** Recent anomalies, newest first. */
  anomalies: readonly AnomalyRecord[];
  /** Retention horizon the readings came from. */
  windowMs: number;
  /**
   * False when the generator feed is down. This is the ONLY input that sets
   * `stale`; a Dashboard losing its own stream is not this service's concern.
   */
  generatorConnected: boolean;
  /** Current time, injected. */
  now: number;
  /** Optional health-threshold overrides. */
  health?: DeviceHealthOptions;
  /** Cap on anomalies carried in a frame, to bound its size. */
  anomalyLimit?: number;
}

const DEFAULT_ANOMALY_LIMIT = 20;

/** The store and detector a live snapshot is read from. */
export interface SnapshotSources {
  readings(): readonly Reading[];
  devices(): readonly DeviceLastSeen[];
  anomalies(): readonly AnomalyRecord[];
  windowMs(): number;
  generatorConnected(): boolean;
  now?: () => number;
  health?: DeviceHealthOptions;
  anomalyLimit?: number;
}

/**
 * Bind live sources into a zero-argument snapshot function.
 *
 * Both the SSE cadence and the REST routes need "the current picture"; giving
 * them one shared provider keeps a frame and a REST response from ever
 * disagreeing about what `stale` means.
 */
export function createSnapshotProvider(sources: SnapshotSources): () => Snapshot {
  const clock = sources.now ?? Date.now;
  return () =>
    buildSnapshot({
      readings: sources.readings(),
      devices: sources.devices(),
      anomalies: sources.anomalies(),
      windowMs: sources.windowMs(),
      generatorConnected: sources.generatorConnected(),
      now: clock(),
      ...(sources.health ? { health: sources.health } : {}),
      ...(sources.anomalyLimit === undefined ? {} : { anomalyLimit: sources.anomalyLimit }),
    });
}

/** Assemble the full picture the Dashboard renders from. */
export function buildSnapshot(input: SnapshotInput): Snapshot {
  const devices = buildDeviceHealth(input.devices, input.now, input.health ?? {});
  const anomalies = input.anomalies.slice(0, input.anomalyLimit ?? DEFAULT_ANOMALY_LIMIT);
  return {
    generatedTs: input.now,
    stale: !input.generatorConnected,
    kpis: buildKpis({
      readings: input.readings,
      devices,
      anomalyCount: input.anomalies.length,
      windowMs: input.windowMs,
    }),
    latestBuckets: latestBucketPerMetric(bucketize(input.readings, { bucket: '10s' })),
    devices,
    anomalies,
  };
}
