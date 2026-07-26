/**
 * The one inbound dependency: an SSE consumer for the Telemetry Generator.
 *
 * This connection's health is the SOLE source of the service's `stale` flag.
 * When it is down the API keeps answering from the Ring Buffer and marks the
 * data stale; it never returns 5xx and never empties. That is deliberately
 * distinct from the Dashboard losing ITS stream to us, which is the Dashboard's
 * own state and has nothing to do with this flag.
 */
import { isReading, type Reading } from '../domain/reading.js';
import { SseParser } from './sseParser.js';

/** The event name the generator emits for each Reading. */
const READING_EVENT = 'reading';

export interface GeneratorClientOptions {
  /** SSE endpoint, i.e. config.generatorUrl. */
  url: string;
  /** Called for every frame that survives validation. */
  onReading: (reading: Reading) => void;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** First reconnect delay; doubles up to maxBackoffMs. */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Notified whenever the connection flips, so callers can log transitions. */
  onStateChange?: (connected: boolean) => void;
}

/** Counters exposed for /healthz and for tests. */
export interface GeneratorStats {
  connected: boolean;
  framesReceived: number;
  framesRejected: number;
  connects: number;
  disconnects: number;
  lastFrameTs: number | null;
}

export class GeneratorClient {
  private readonly url: string;
  private readonly onReading: (reading: Reading) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly onStateChange: ((connected: boolean) => void) | undefined;
  private readonly parser = new SseParser();

  private controller: AbortController | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private wakeRetry: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  private stopped = true;
  private connected = false;
  private backoffMs: number;
  private framesReceived = 0;
  private framesRejected = 0;
  private connects = 0;
  private disconnects = 0;
  private lastFrameTs: number | null = null;

  constructor(options: GeneratorClientOptions) {
    this.url = options.url;
    this.onReading = options.onReading;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.initialBackoffMs = options.initialBackoffMs ?? 250;
    this.maxBackoffMs = options.maxBackoffMs ?? 5_000;
    this.onStateChange = options.onStateChange;
    this.backoffMs = this.initialBackoffMs;
  }

  /** Begin consuming. Idempotent: a second call while running is a no-op. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.run();
  }

  /** Stop consuming and wait for the read loop to unwind. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
    this.cancelRetryWait();
    await this.loop?.catch(() => undefined);
    this.loop = null;
    this.setConnected(false);
  }

  /** False whenever the feed is down — this is what makes responses stale. */
  isConnected(): boolean {
    return this.connected;
  }

  stats(): GeneratorStats {
    return {
      connected: this.connected,
      framesReceived: this.framesReceived,
      framesRejected: this.framesRejected,
      connects: this.connects,
      disconnects: this.disconnects,
      lastFrameTs: this.lastFrameTs,
    };
  }

  /** Reconnect forever until stopped, backing off between attempts. */
  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.readStream();
      } catch {
        // Any failure — refused, dropped mid-stream, non-2xx — is the same
        // condition: the feed is gone. Back off and try again.
      }
      this.setConnected(false);
      if (this.stopped) return;
      await this.waitBeforeRetry();
    }
  }

  /** Open the stream and pump it until it ends or is aborted. */
  private async readStream(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.parser.reset();
    const response = await this.fetchImpl(this.url, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`generator responded ${response.status}`);
    }
    this.onConnected();
    await this.consume(response.body);
  }

  /** Decode the body stream and hand each complete frame to the handler. */
  private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      for (const event of this.parser.push(decoder.decode(chunk, { stream: true }))) {
        this.handleEvent(event.event, event.data);
      }
    }
  }

  /**
   * Accept only well-formed `reading` frames. Anything else — a keepalive, an
   * unknown event, malformed JSON, a payload missing fields — is counted and
   * dropped, never thrown: one bad frame must not tear down a healthy feed.
   */
  private handleEvent(event: string, data: string): void {
    if (event !== READING_EVENT) return;
    this.framesReceived += 1;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      this.framesRejected += 1;
      return;
    }
    if (!isReading(payload)) {
      this.framesRejected += 1;
      return;
    }
    this.lastFrameTs = Date.now();
    this.onReading(payload);
  }

  private onConnected(): void {
    this.backoffMs = this.initialBackoffMs;
    this.connects += 1;
    this.setConnected(true);
  }

  private setConnected(next: boolean): void {
    if (this.connected === next) return;
    if (!next) this.disconnects += 1;
    this.connected = next;
    this.onStateChange?.(next);
  }

  /** Sleep for the current backoff, interruptible by {@link stop}. */
  private waitBeforeRetry(): Promise<void> {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    return new Promise<void>((resolve) => {
      this.wakeRetry = resolve;
      this.retryTimer = setTimeout(() => {
        this.cancelRetryWait();
        resolve();
      }, delay);
    });
  }

  private cancelRetryWait(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const wake = this.wakeRetry;
    this.wakeRetry = null;
    wake?.();
  }
}
