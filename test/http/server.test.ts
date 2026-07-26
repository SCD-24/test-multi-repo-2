import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHarness, type Harness } from '../helpers/harness.js';
import { createServer } from '../../src/http/server.js';
import { CONFIG_DEFAULTS } from '../../src/config.js';
import { METRIC_UNITS, type Metric, type Reading } from '../../src/domain/reading.js';

/** Exact 5m/1m/10s boundary, so bucket windows are unambiguous. */
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

describe('REST routes', () => {
  let harness: Harness;

  beforeEach(() => {
    seq = 0;
    harness = createHarness({ startAt: T0 });
  });

  describe('GET /api/kpis', () => {
    it('returns the stale envelope around the KPIs', async () => {
      harness.ingest(reading({ value: 10 }));
      harness.ingest(reading({ value: 20 }));
      const response = await request(harness.app).get('/api/kpis').expect(200);
      expect(response.body.stale).toBe(false);
      expect(response.body.data.totalReadings).toBe(2);
      expect(response.body.data.byMetric).toHaveLength(3);
    });

    it('marks the payload stale when the generator feed is down', async () => {
      harness.ingest(reading());
      harness.setConnected(false);
      const response = await request(harness.app).get('/api/kpis').expect(200);
      expect(response.body.stale).toBe(true);
      expect(response.body.data.totalReadings).toBe(1);
    });
  });

  describe('GET /api/timeseries', () => {
    beforeEach(() => {
      harness.ingest(reading({ ts: T0, value: 10, deviceId: 'dev-01', siteId: 'site-north' }));
      harness.ingest(reading({ ts: T0 + 1_000, value: 20, deviceId: 'dev-02', siteId: 'site-south' }));
      harness.ingest(reading({ ts: T0 + 20_000, value: 30, deviceId: 'dev-01', siteId: 'site-north' }));
      harness.advance(30_000);
    });

    it('buckets the requested metric', async () => {
      const response = await request(harness.app)
        .get('/api/timeseries?metric=temperature&bucket=10s')
        .expect(200);
      expect(response.body.stale).toBe(false);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toMatchObject({ windowStart: T0, avg: 15, count: 2 });
    });

    it('honours a wider bucket', async () => {
      const response = await request(harness.app)
        .get('/api/timeseries?metric=temperature&bucket=1m')
        .expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].count).toBe(3);
    });

    it('groups by device', async () => {
      const response = await request(harness.app)
        .get('/api/timeseries?metric=temperature&bucket=5m&groupBy=device')
        .expect(200);
      expect(response.body.data.map((b: { deviceId: string }) => b.deviceId)).toEqual([
        'dev-01',
        'dev-02',
      ]);
    });

    it('groups by site', async () => {
      const response = await request(harness.app)
        .get('/api/timeseries?metric=temperature&bucket=5m&groupBy=site')
        .expect(200);
      expect(response.body.data.map((b: { siteId: string }) => b.siteId)).toEqual([
        'site-north',
        'site-south',
      ]);
    });

    it('filters by deviceId and siteId', async () => {
      const byDevice = await request(harness.app)
        .get('/api/timeseries?metric=temperature&bucket=5m&deviceId=dev-02')
        .expect(200);
      expect(byDevice.body.data[0].count).toBe(1);

      const bySite = await request(harness.app)
        .get('/api/timeseries?metric=temperature&bucket=5m&siteId=site-north')
        .expect(200);
      expect(bySite.body.data[0].count).toBe(2);
    });

    it('filters by an explicit time range', async () => {
      const response = await request(harness.app)
        .get(`/api/timeseries?metric=temperature&bucket=10s&from=${T0 + 10_000}`)
        .expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].windowStart).toBe(T0 + 20_000);
    });

    it('returns an empty series rather than an error when nothing matches', async () => {
      const response = await request(harness.app)
        .get('/api/timeseries?metric=power_draw&bucket=10s')
        .expect(200);
      expect(response.body.data).toEqual([]);
    });

    it.each([
      ['?bucket=10s', 'metric is required'],
      ['?metric=temperature', 'bucket is required'],
      ['?metric=pressure&bucket=10s', 'metric must be one of'],
      ['?metric=temperature&bucket=2s', 'bucket must be one of'],
      ['?metric=temperature&bucket=10s&groupBy=region', 'groupBy must be one of'],
      ['?metric=temperature&bucket=10s&from=yesterday', 'from must be an epoch timestamp'],
      ['?metric=temperature&bucket=10s&to=-5', 'to must be an epoch timestamp'],
      ['?metric=temperature&bucket=10s&from=200&to=100', 'from must be less than or equal to to'],
      ['?metric=temperature&metric=humidity&bucket=10s', 'metric must be given at most once'],
    ])('rejects %s with a clear 400', async (query, message) => {
      const response = await request(harness.app).get(`/api/timeseries${query}`).expect(400);
      expect(response.body.error).toContain(message);
    });
  });

  describe('GET /api/devices', () => {
    it('reports health per device against the current clock', async () => {
      harness.ingest(reading({ deviceId: 'dev-01', ts: T0 }));
      harness.ingest(reading({ deviceId: 'dev-02', ts: T0, siteId: 'site-south' }));
      harness.advance(10_000);
      const response = await request(harness.app).get('/api/devices').expect(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toMatchObject({
        deviceId: 'dev-01',
        siteId: 'site-north',
        status: 'stale',
        ageMs: 10_000,
      });
    });

    it('still lists a device whose readings have all been evicted', async () => {
      harness.ingest(reading({ deviceId: 'dev-09' }));
      harness.advance(3_600_001);
      const response = await request(harness.app).get('/api/devices').expect(200);
      expect(response.body.data[0]).toMatchObject({ deviceId: 'dev-09', status: 'offline' });
    });
  });

  describe('GET /api/anomalies', () => {
    beforeEach(() => {
      for (let i = 0; i < 6; i += 1) harness.ingest(reading({ value: i % 2 === 0 ? 19.5 : 20.5 }));
      for (let i = 0; i < 6; i += 1) {
        harness.ingest(reading({ value: i % 2 === 0 ? 49.5 : 50.5, metric: 'humidity', unit: '%' }));
      }
      harness.ingest(reading({ id: 'spike-temp', value: 300 }));
      harness.ingest(reading({ id: 'spike-hum', value: 900, metric: 'humidity', unit: '%' }));
    });

    it('returns detected anomalies newest first', async () => {
      const response = await request(harness.app).get('/api/anomalies').expect(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].reading.id).toBe('spike-hum');
      expect(response.body.data[0].zScore).toBeGreaterThan(3);
      expect(response.body.data[0].detectedTs).toBe(T0);
    });

    it('filters by metric', async () => {
      const response = await request(harness.app).get('/api/anomalies?metric=temperature').expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].reading.id).toBe('spike-temp');
    });

    it('filters by deviceId', async () => {
      const response = await request(harness.app).get('/api/anomalies?deviceId=dev-99').expect(200);
      expect(response.body.data).toEqual([]);
    });

    it('applies a limit', async () => {
      const response = await request(harness.app).get('/api/anomalies?limit=1').expect(200);
      expect(response.body.data).toHaveLength(1);
    });

    it.each([
      ['?limit=0', 'limit must be an integer between 1 and 1000'],
      ['?limit=abc', 'limit must be an integer between 1 and 1000'],
      ['?limit=5000', 'limit must be an integer between 1 and 1000'],
      ['?metric=pressure', 'metric must be one of'],
    ])('rejects %s with a clear 400', async (query, message) => {
      const response = await request(harness.app).get(`/api/anomalies${query}`).expect(400);
      expect(response.body.error).toContain(message);
    });
  });

  describe('GET /healthz', () => {
    it('reports liveness and feed state', async () => {
      harness.ingest(reading());
      const response = await request(harness.app).get('/healthz').expect(200);
      expect(response.body).toMatchObject({
        ok: true,
        generatorConnected: true,
        bufferSize: 1,
        subscribers: 0,
      });
      expect(response.body.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it('stays 200 with the generator down, because serving stale data is healthy', async () => {
      harness.setConnected(false);
      const response = await request(harness.app).get('/healthz').expect(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.generatorConnected).toBe(false);
    });
  });

  it('returns 404 for an unknown route', async () => {
    const response = await request(harness.app).get('/api/nope').expect(404);
    expect(response.body.error).toBe('not found');
  });

  it('returns 500 without leaking internals when a handler fails', async () => {
    const app = createServer({
      buffer: harness.buffer,
      detector: harness.detector,
      generator: { isConnected: () => true, stats: () => ({}) },
      hub: harness.hub,
      snapshot: () => {
        throw new Error('snapshot exploded');
      },
      now: harness.now,
    });
    const response = await request(app).get('/api/kpis').expect(500);
    expect(response.body).toEqual({ error: 'internal error' });
  });
});

describe('CORS', () => {
  /**
   * The Dashboard is a browser app on its own origin calling this API directly.
   * Without these headers every route below is unreachable from it, so they are
   * asserted per route rather than once: a middleware registered after a route
   * would still pass a single spot-check.
   */
  const READ_ROUTES = ['/api/kpis', '/api/timeseries', '/api/devices', '/api/anomalies', '/healthz'];

  it.each(READ_ROUTES)('allows the configured origin on %s', async (route) => {
    const harness = createHarness({ startAt: T0, corsOrigin: 'http://localhost:5173' });
    // Status is deliberately not asserted: the header must be present whatever
    // the outcome, or the browser cannot even read a 4xx/5xx body.
    const response = await request(harness.app).get(route);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['vary']).toBe('Origin');
  });

  it('sends the header on an error response too', async () => {
    const harness = createHarness({ startAt: T0, corsOrigin: 'http://localhost:5173' });
    const response = await request(harness.app).get('/api/nope').expect(404);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('answers a preflight with 204 instead of falling through to the 404 handler', async () => {
    const harness = createHarness({ startAt: T0, corsOrigin: 'http://localhost:5173' });
    const response = await request(harness.app).options('/api/kpis').expect(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
  });

  it('honours a non-default origin', async () => {
    const harness = createHarness({ startAt: T0, corsOrigin: 'https://ops.example.com' });
    const response = await request(harness.app).get('/api/kpis').expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://ops.example.com');
  });

  it('falls back to the declared default origin when none is injected', async () => {
    const harness = createHarness({ startAt: T0 });
    const response = await request(harness.app).get('/api/kpis').expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(CONFIG_DEFAULTS.CORS_ORIGIN);
  });
});
