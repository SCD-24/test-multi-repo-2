import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GeneratorClient } from '../../src/ingest/generatorClient.js';
import { RingBuffer } from '../../src/store/ringBuffer.js';
import { AnomalyDetector } from '../../src/analytics/anomalyDetector.js';
import type { Reading } from '../../src/domain/reading.js';
import { makeReading, startFakeGenerator, waitFor, type FakeGenerator } from '../helpers/fakeGenerator.js';

describe('GeneratorClient against a live fake generator', () => {
  let generator: FakeGenerator;
  let client: GeneratorClient;
  let received: Reading[];

  beforeEach(async () => {
    generator = await startFakeGenerator();
    received = [];
  });

  afterEach(async () => {
    await client?.stop();
    await generator.close();
  });

  /** Backoff is tiny so reconnect assertions stay well inside the test budget. */
  function connect(onReading: (reading: Reading) => void = (r) => received.push(r)): GeneratorClient {
    client = new GeneratorClient({
      url: generator.url,
      onReading,
      initialBackoffMs: 5,
      maxBackoffMs: 20,
    });
    client.start();
    return client;
  }

  it('connects and reports itself live', async () => {
    connect();
    await waitFor(() => client.isConnected(), 2_000, 'connection');
    expect(client.stats().connected).toBe(true);
  });

  it('parses reading frames into validated Readings', async () => {
    connect();
    await waitFor(() => client.isConnected());
    generator.emit(makeReading({ id: 'r-a', value: 21.5 }));
    generator.emit(makeReading({ id: 'r-b', metric: 'humidity', unit: '%', value: 55 }));
    await waitFor(() => received.length === 2, 2_000, 'two readings');
    expect(received.map((r) => r.id)).toEqual(['r-a', 'r-b']);
    expect(received[1]?.metric).toBe('humidity');
  });

  it('ignores keepalive comments and unknown events', async () => {
    connect();
    await waitFor(() => client.isConnected());
    generator.emitRaw(': keepalive\n\n');
    generator.emitRaw('event: heartbeat\ndata: {}\n\n');
    generator.emit(makeReading({ id: 'r-real' }));
    await waitFor(() => received.length === 1, 2_000, 'the real reading');
    expect(client.stats().framesReceived).toBe(1);
    expect(client.stats().framesRejected).toBe(0);
  });

  it('drops malformed frames without tearing down the feed', async () => {
    connect();
    await waitFor(() => client.isConnected());
    generator.emitRaw('event: reading\ndata: {not json\n\n');
    generator.emitRaw(`event: reading\ndata: ${JSON.stringify({ deviceId: 'dev-01' })}\n\n`);
    generator.emitRaw(
      `event: reading\ndata: ${JSON.stringify({ ...makeReading(), value: 'hot' })}\n\n`,
    );
    await waitFor(() => client.stats().framesRejected === 3, 2_000, 'three rejections');
    expect(received).toHaveLength(0);
    expect(client.isConnected()).toBe(true);

    generator.emit(makeReading({ id: 'r-good' }));
    await waitFor(() => received.length === 1, 2_000, 'recovery');
  });

  it('goes stale when the feed drops and recovers on reconnect', async () => {
    connect();
    await waitFor(() => client.isConnected());
    generator.dropConnections();
    await waitFor(() => !client.isConnected(), 2_000, 'disconnect');
    expect(client.stats().disconnects).toBeGreaterThanOrEqual(1);

    await waitFor(() => client.isConnected(), 3_000, 'reconnect');
    generator.emit(makeReading({ id: 'r-after' }));
    await waitFor(() => received.some((r) => r.id === 'r-after'), 2_000, 'post-reconnect frame');
  });

  it('keeps retrying while the generator refuses connections', async () => {
    generator.failWith(503);
    connect();
    await waitFor(() => generator.requestCount() >= 3, 3_000, 'repeated attempts');
    expect(client.isConnected()).toBe(false);

    generator.failWith(0);
    await waitFor(() => client.isConnected(), 3_000, 'recovery once healthy');
  });

  it('notifies a listener on every state change', async () => {
    const transitions: boolean[] = [];
    client = new GeneratorClient({
      url: generator.url,
      onReading: () => undefined,
      initialBackoffMs: 5,
      maxBackoffMs: 20,
      onStateChange: (connected) => transitions.push(connected),
    });
    client.start();
    await waitFor(() => client.isConnected());
    generator.dropConnections();
    await waitFor(() => transitions.length >= 2, 2_000, 'a down transition');
    expect(transitions[0]).toBe(true);
    expect(transitions[1]).toBe(false);
  });

  it('start() twice does not open a second stream', async () => {
    connect();
    await waitFor(() => client.isConnected());
    client.start();
    expect(generator.connectionCount()).toBe(1);
  });

  it('stop() closes the stream and stays down', async () => {
    connect();
    await waitFor(() => client.isConnected());
    await client.stop();
    expect(client.isConnected()).toBe(false);
    // Deliberately not asserting the server-side connection count here: aborting
    // a fetch hands the socket back to undici's keep-alive pool, so the fake
    // generator would not observe the close for several seconds. What matters is
    // that no further connection attempts are made.
    const attempts = generator.requestCount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(generator.requestCount()).toBe(attempts);
  });

  it('feeds the ring buffer and the detector, and the buffer keeps serving while down', async () => {
    const buffer = new RingBuffer({ windowMs: 3_600_000 });
    const detector = new AnomalyDetector({ minSamples: 3 });
    connect((reading) => {
      buffer.append(reading);
      detector.inspect(reading);
    });
    await waitFor(() => client.isConnected());

    for (let i = 0; i < 6; i += 1) {
      generator.emit(makeReading({ value: i % 2 === 0 ? 19.5 : 20.5 }));
    }
    await waitFor(() => buffer.size() === 6, 2_000, 'six buffered readings');
    generator.emit(makeReading({ value: 300 }));
    await waitFor(() => detector.count() === 1, 2_000, 'the spike');

    generator.dropConnections();
    await waitFor(() => !client.isConnected(), 2_000, 'disconnect');
    expect(buffer.size()).toBe(7);
    expect(buffer.devices()).toHaveLength(1);
  });
});

describe('GeneratorClient without a reachable generator', () => {
  it('never reports connected and surfaces no readings', async () => {
    const client = new GeneratorClient({
      url: 'http://127.0.0.1:1/stream',
      onReading: () => expect.unreachable('no reading should arrive'),
      initialBackoffMs: 5,
      maxBackoffMs: 10,
    });
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(client.isConnected()).toBe(false);
    await client.stop();
  });
});
