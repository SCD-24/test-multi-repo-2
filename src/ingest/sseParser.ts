/**
 * Minimal Server-Sent Events frame parser.
 *
 * Hand-rolled rather than pulled from a dependency because we consume exactly
 * one event type over a link we control, and because a parser we own can be
 * fed byte-for-byte in tests, including split-mid-frame chunks.
 */

/** One decoded SSE event. */
export interface SseEvent {
  /** The `event:` field, or 'message' when the frame omits one, per the spec. */
  event: string;
  /** Concatenated `data:` lines, newline-joined. */
  data: string;
}

export class SseParser {
  private buffer = '';

  /**
   * Feed a chunk of decoded text and return whatever complete events it
   * finished. A trailing partial frame stays buffered until its terminator
   * arrives, so an event split across TCP chunks is never lost or truncated.
   */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
      boundary = this.buffer.indexOf('\n\n');
    }
    return events;
  }

  /** Drop buffered bytes. Called on reconnect so a torn frame cannot bleed. */
  reset(): void {
    this.buffer = '';
  }
}

/** Turn one frame's lines into an event, or null when it carries no data. */
function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line.trim() === '') continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join('\n') };
}
