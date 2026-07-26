import { describe, expect, it } from 'vitest';
import { SseParser } from '../../src/ingest/sseParser.js';

describe('SseParser', () => {
  it('parses a complete frame', () => {
    const parser = new SseParser();
    expect(parser.push('event: reading\ndata: {"a":1}\n\n')).toEqual([
      { event: 'reading', data: '{"a":1}' },
    ]);
  });

  it('returns nothing until the frame terminator arrives', () => {
    const parser = new SseParser();
    expect(parser.push('event: reading\ndata: {"a":1}')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ event: 'reading', data: '{"a":1}' }]);
  });

  it('reassembles a frame split mid-field across chunks', () => {
    const parser = new SseParser();
    parser.push('event: rea');
    parser.push('ding\ndat');
    expect(parser.push('a: hello\n\n')).toEqual([{ event: 'reading', data: 'hello' }]);
  });

  it('returns several frames from one chunk', () => {
    const parser = new SseParser();
    const events = parser.push('event: reading\ndata: 1\n\nevent: reading\ndata: 2\n\n');
    expect(events.map((e) => e.data)).toEqual(['1', '2']);
  });

  it('normalises CRLF line endings', () => {
    const parser = new SseParser();
    expect(parser.push('event: reading\r\ndata: x\r\n\r\n')).toEqual([
      { event: 'reading', data: 'x' },
    ]);
  });

  it('defaults the event name to message when the frame omits one', () => {
    const parser = new SseParser();
    expect(parser.push('data: bare\n\n')).toEqual([{ event: 'message', data: 'bare' }]);
  });

  it('joins multiple data lines with a newline', () => {
    const parser = new SseParser();
    expect(parser.push('event: reading\ndata: one\ndata: two\n\n')[0]?.data).toBe('one\ntwo');
  });

  it('ignores keepalive comments entirely', () => {
    const parser = new SseParser();
    expect(parser.push(': keepalive\n\n')).toEqual([]);
  });

  it('ignores a frame that carries no data field', () => {
    const parser = new SseParser();
    expect(parser.push('event: reading\nid: 7\n\n')).toEqual([]);
  });

  it('tolerates a field with no value', () => {
    const parser = new SseParser();
    expect(parser.push('event\ndata: x\n\n')).toEqual([{ event: '', data: 'x' }]);
  });

  it('strips only the single optional space after the colon', () => {
    const parser = new SseParser();
    expect(parser.push('data:  padded\n\n')[0]?.data).toBe(' padded');
  });

  it('reset() discards a partial frame so it cannot bleed into the next stream', () => {
    const parser = new SseParser();
    parser.push('event: reading\ndata: half');
    parser.reset();
    expect(parser.push('data: whole\n\n')).toEqual([{ event: 'message', data: 'whole' }]);
  });
});
