/**
 * Wiring helper for HTTP tests: the same composition the entrypoint performs,
 * but with an injected clock and a stubbed generator so tests control both
 * time and staleness.
 */
import type { Express } from 'express';
import { AnomalyDetector } from '../../src/analytics/anomalyDetector.js';
import { createSnapshotProvider } from '../../src/analytics/snapshot.js';
import { RingBuffer } from '../../src/store/ringBuffer.js';
import { SseHub } from '../../src/http/sseHub.js';
import { createServer } from '../../src/http/server.js';
import type { Reading } from '../../src/domain/reading.js';

export interface Harness {
  app: Express;
  buffer: RingBuffer;
  detector: AnomalyDetector;
  hub: SseHub;
  /** Flip the upstream feed, which is what drives the `stale` flag. */
  setConnected(connected: boolean): void;
  /** Advance the injected clock. */
  advance(ms: number): void;
  now(): number;
  ingest(reading: Reading): void;
}

export interface HarnessOptions {
  startAt: number;
  windowMs?: number;
  connected?: boolean;
  intervalMs?: number;
  minSamples?: number;
  /** Browser origin the API should allow; omitted means the declared default. */
  corsOrigin?: string;
}

export function createHarness(options: HarnessOptions): Harness {
  let clock = options.startAt;
  let connected = options.connected ?? true;
  const now = (): number => clock;

  const buffer = new RingBuffer({ windowMs: options.windowMs ?? 3_600_000, now });
  const detector = new AnomalyDetector({ minSamples: options.minSamples ?? 3, now });
  const generator = {
    isConnected: () => connected,
    stats: () => ({ connected, framesReceived: 0 }),
  };
  const snapshot = createSnapshotProvider({
    readings: () => buffer.all(),
    devices: () => buffer.devices(),
    anomalies: () => detector.recent(),
    windowMs: () => buffer.windowSizeMs(),
    generatorConnected: () => connected,
    now,
  });
  const hub = new SseHub({
    snapshot,
    intervalMs: options.intervalMs ?? 20,
    keepaliveMs: 10_000,
    corsOrigin: options.corsOrigin,
  });
  const app = createServer({
    buffer,
    detector,
    generator,
    hub,
    snapshot,
    now,
    corsOrigin: options.corsOrigin,
  });

  return {
    app,
    buffer,
    detector,
    hub,
    setConnected: (next) => {
      connected = next;
    },
    advance: (ms) => {
      clock += ms;
    },
    now,
    ingest: (reading) => {
      buffer.append(reading);
      detector.inspect(reading);
    },
  };
}
