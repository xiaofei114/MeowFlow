import { describe, expect, it } from 'vitest';
import { SseParser, decodeSseEvent, encodeSse, encodeSseComment } from '../src/index';
import type { AgentEvent } from '../src/index';

function runStart(seq: number): AgentEvent {
  return {
    v: '1.0',
    type: 'run-start',
    model: 'mock',
    resumed: false,
    runId: 'run_1',
    sessionId: 'session_1',
    seq,
    ts: 1_700_000_000_000,
  };
}

function textDelta(seq: number, text: string): AgentEvent {
  return {
    v: '1.0',
    type: 'text-delta',
    text,
    runId: 'run_1',
    sessionId: 'session_1',
    seq,
    ts: 1_700_000_000_001,
  };
}

describe('SSE 编解码', () => {
  it('编码后可被解析器还原', () => {
    const first = runStart(0);
    const second = textDelta(1, '你好');

    const parser = new SseParser();
    const payloads = parser.push(encodeSse(first) + encodeSse(second));

    expect(payloads).toHaveLength(2);
    expect(decodeSseEvent(payloads[0] ?? '')).toEqual(first);
    expect(decodeSseEvent(payloads[1] ?? '')).toEqual(second);
  });

  it('支持跨块增量解析', () => {
    const event = textDelta(3, '分块传输');
    const frame = encodeSse(event);

    const parser = new SseParser();
    const payloads: string[] = [];
    for (let i = 0; i < frame.length; i += 5) {
      payloads.push(...parser.push(frame.slice(i, i + 5)));
    }
    payloads.push(...parser.flush());

    expect(payloads).toHaveLength(1);
    expect(decodeSseEvent(payloads[0] ?? '')).toEqual(event);
  });

  it('忽略注释帧', () => {
    const parser = new SseParser();
    const payloads = parser.push(encodeSseComment('ping') + encodeSse(textDelta(0, 'x')));

    expect(payloads).toHaveLength(1);
    expect(decodeSseEvent(payloads[0] ?? '')).toMatchObject({ type: 'text-delta', text: 'x' });
  });

  it('flush 处理未以空行结尾的尾块', () => {
    const event = textDelta(0, 'tail');
    const frame = encodeSse(event).trimEnd();

    const parser = new SseParser();
    expect(parser.push(frame)).toHaveLength(0);
    const rest = parser.flush();
    expect(rest).toHaveLength(1);
    expect(decodeSseEvent(rest[0] ?? '')).toEqual(event);
  });
});
