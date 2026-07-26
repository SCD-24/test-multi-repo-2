import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http, { type ClientRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { createHarness, type Harness } from '../helpers/harness.js';
import { SseReader } from '../helpers/sseReader.js';
import { METRIC_UNITS, type Metric, type Reading } from '../../src/domain/reading.js';
import type { Snapshot } from '../../src/domain/types.js';

const T0 = 1_700_000_100_000;

let seq = 0;

function reading(overrides: Partial<Reading> = {}): Reading {
  const metric: Metric = overrides.metric ?? 'temperature';
  return {
    id: `r-${++seq}`,
    deviceId: 'dev-01',
    siteId: 'site-north',
    metric,
    value: 20,
    unit: METRIC_UNITS[metric],
    ts: T0,
    ...overrides,
  };
}

/** Open a raw HTTP stream whose socket a test can destroy outright. */
function httpGet(url: string): ClientRequest {
  const request = http.get(url, () => undefined);
  request.on('error', () => undefined);
  return request;
}

/** Poll until a condition holds, so tests never sleep for a fixed duration. */
async function waitUntil(condition: () => boolean, label: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function listen(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('GET /api/stream', () => {
  let harness: Harness;
  let server: Server;
  let baseUrl: string;
  const readers: SseReader[] = [];

  beforeEach(async () => {
    seq = 0;
    harness = createHarness({ startAt: T0, intervalMs: 20 });
    harness.hub.start();
    server = await listen(harness.app);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await Promise.all(readers.splice(0).map((reader) => reader.close()));
    harness.hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function open(): Promise<SseReader> {
    const reader = await SseReader.open(`${baseUrl}/api/stream`);
    readers.push(reader);
    return reader;
  }

  it('responds as an event stream', async () => {
    const reader = await open();
    expect(reader.header('content-type')).toContain('text/event-stream');
    expect(reader.header('cache-control')).toContain('no-cache');
  });

  it('sends a first update immediately rather than at the next tick', async () => {
    harness.ingest(reading({ value: 21 }));
    const reader = await open();
    const frames = await reader.waitForEvents('update', 1);
    const snapshot = JSON.parse(frames[0]?.data ?? '{}') as Snapshot;
    expect(snapshot.kpis.totalReadings).toBe(1);
    expect(snapshot.generatedTs).toBe(T0);
  });

  it('carries every declared section in a frame', async () => {
    harness.ingest(reading());
    const reader = await open();
    await reader.waitForEvents('update', 1);
    const snapshot = reader.latestData<Snapshot>('update');
    expect(Object.keys(snapshot).sort()).toEqual([
      'anomalies',
      'devices',
      'generatedTs',
      'kpis',
      'latestBuckets',
      'stale',
    ]);
    expect(snapshot.devices[0]?.deviceId).toBe('dev-01');
    expect(snapshot.latestBuckets[0]?.metric).toBe('temperature');
  });

  it('keeps pushing frames on the cadence', async () => {
    const reader = await open();
    const frames = await reader.waitForEvents('update', 3);
    expect(frames.length).toBeGreaterThanOrEqual(3);
  });

  it('reflects newly ingested readings in later frames', async () => {
    const reader = await open();
    await reader.waitForEvents('update', 1);
    harness.ingest(reading({ value: 30 }));
    harness.ingest(reading({ value: 40 }));
    await reader.waitForEvents('update', 3);
    expect(reader.latestData<Snapshot>('update').kpis.totalReadings).toBe(2);
  });

  it('flips stale in the stream when the generator feed drops', async () => {
    const reader = await open();
    await reader.waitForEvents('update', 1);
    expect(reader.latestData<Snapshot>('update').stale).toBe(false);

    harness.setConnected(false);
    const before = reader.named('update').length;
    await reader.waitForEvents('update', before + 2);
    expect(reader.latestData<Snapshot>('update').stale).toBe(true);
  });

  it('serves several subscribers from one snapshot per tick', async () => {
    const first = await open();
    const second = await open();
    await Promise.all([first.waitForEvents('update', 2), second.waitForEvents('update', 2)]);
    expect(harness.hub.size()).toBe(2);
    expect(first.latestData<Snapshot>('update').kpis.totalReadings).toBe(
      second.latestData<Snapshot>('update').kpis.totalReadings,
    );
  });

  it('unregisters a subscriber that goes away', async () => {
    // A raw request is used rather than fetch: aborting a fetch returns the
    // socket to undici's keep-alive pool, so the server would not observe the
    // disconnect for several seconds. destroy() closes the TCP connection at
    // once, which is what a real dashboard tab closing looks like.
    const request = httpGet(`${baseUrl}/api/stream`);
    await waitUntil(() => harness.hub.size() === 1, 'the subscriber to attach');
    request.destroy();
    await waitUntil(() => harness.hub.size() === 0, 'the subscriber to be dropped');
    expect(harness.hub.size()).toBe(0);
  });

  it('reports subscriber count on /healthz', async () => {
    await open();
    const response = await fetch(`${baseUrl}/healthz`);
    expect(((await response.json()) as { subscribers: number }).subscribers).toBe(1);
  });

  it('close() ends every stream so shutdown does not strand clients', async () => {
    const reader = await open();
    await reader.waitForEvents('update', 1);
    harness.hub.close();
    expect(harness.hub.size()).toBe(0);
  });
});
