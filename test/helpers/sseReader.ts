/**
 * A tiny SSE client for tests — the Dashboard's EventSource, minus the browser.
 *
 * It pumps the response body in the background and records every event, so a
 * test can assert on frames as they arrive instead of racing the cadence.
 */
import { SseParser, type SseEvent } from '../../src/ingest/sseParser.js';

export class SseReader {
  readonly events: SseEvent[] = [];
  private pump: Promise<void> | null = null;

  private constructor(
    private readonly response: Response,
    private readonly controller: AbortController,
  ) {}

  /** Open a stream and begin recording in the background. */
  static async open(url: string): Promise<SseReader> {
    const controller = new AbortController();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    const reader = new SseReader(response, controller);
    reader.start();
    return reader;
  }

  /** Response header, so tests can assert the SSE content type. */
  header(name: string): string | null {
    return this.response.headers.get(name);
  }

  /** Every recorded frame with this event name. */
  named(event: string): SseEvent[] {
    return this.events.filter((candidate) => candidate.event === event);
  }

  /** Wait until at least `count` frames named `event` have arrived. */
  async waitForEvents(event: string, count = 1, timeoutMs = 3_000): Promise<SseEvent[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const matched = this.named(event);
      if (matched.length >= count) return matched;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${count} "${event}" frame(s)`);
  }

  /** Parse the data of the most recent frame with this event name. */
  latestData<T>(event: string): T {
    const matched = this.named(event);
    const last = matched[matched.length - 1];
    if (!last) throw new Error(`no "${event}" frame received`);
    return JSON.parse(last.data) as T;
  }

  /** Abort the stream and wait for the pump to unwind. */
  async close(): Promise<void> {
    this.controller.abort();
    await this.pump?.catch(() => undefined);
    this.pump = null;
  }

  private start(): void {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const body = this.response.body;
    if (!body) throw new Error('stream response had no body');
    this.pump = (async () => {
      try {
        for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
          this.events.push(...parser.push(decoder.decode(chunk, { stream: true })));
        }
      } catch {
        // Aborting is the normal way a test ends the stream.
      }
    })();
  }
}
