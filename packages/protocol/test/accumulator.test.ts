import { describe, expect, it } from 'vitest';
import { AgentEventAccumulator } from '../src/index';
import type { AgentEvent } from '../src/index';

function event<T extends AgentEvent['type']>(
  type: T,
  body: Omit<Extract<AgentEvent, { type: T }>, 'v' | 'runId' | 'sessionId' | 'seq' | 'ts' | 'type'>,
  seq: number,
): AgentEvent {
  const meta = { v: '1.0' as const, runId: 'run_1', sessionId: 'session_1', seq, ts: seq };
  return { ...meta, type, ...body } as unknown as AgentEvent;
}

describe('AgentEventAccumulator', () => {
  it('还原文本流与助手消息', () => {
    const accumulator = new AgentEventAccumulator();
    accumulator.addUserMessage('你好');
    accumulator.applyAll([
      event('run-start', { model: 'mock', resumed: false }, 0),
      event('message-start', { role: 'assistant' }, 1),
      event('text-delta', { text: '你' }, 2),
      event('text-delta', { text: '好' }, 3),
      event('message-end', { message: { role: 'assistant', content: '你好' } }, 4),
      event('run-end', { status: 'completed' }, 5),
    ]);

    expect(accumulator.state.messages).toHaveLength(2);
    expect(accumulator.state.messages[0]).toMatchObject({ role: 'user', content: '你好' });
    expect(accumulator.state.messages[1]).toMatchObject({
      role: 'assistant',
      content: '你好',
      streaming: false,
    });
    expect(accumulator.state.status).toBe('idle');
  });

  it('跟踪工具调用状态与结果', () => {
    const accumulator = new AgentEventAccumulator();
    accumulator.applyAll([
      event('run-start', { model: 'mock', resumed: false }, 0),
      event('message-start', { role: 'assistant' }, 1),
      event('tool-call-start', { callId: 'c1', name: 'echo' }, 2),
      event('tool-call-args-delta', { callId: 'c1', delta: '{"text":' }, 3),
      event('tool-call-args-delta', { callId: 'c1', delta: '"hi"}' }, 4),
      event('tool-call-end', { callId: 'c1', name: 'echo', args: { text: 'hi' } }, 5),
      event(
        'tool-call-result',
        { callId: 'c1', name: 'echo', status: 'ok', result: 'hi', durationMs: 1 },
        6,
      ),
      event('run-end', { status: 'completed' }, 7),
    ]);

    const call = accumulator.state.messages[0]?.toolCalls[0];
    expect(call).toMatchObject({ callId: 'c1', name: 'echo', status: 'ok', result: 'hi' });
    expect(call?.args).toEqual({ text: 'hi' });
  });

  it('记录挂起状态', () => {
    const accumulator = new AgentEventAccumulator();
    accumulator.applyAll([
      event('run-start', { model: 'mock', resumed: false }, 0),
      event('message-start', { role: 'assistant' }, 1),
      event('tool-call-start', { callId: 'a1', name: 'ask_user' }, 2),
      event('tool-call-end', { callId: 'a1', name: 'ask_user', args: {} }, 3),
      event(
        'tool-call-suspend',
        { callId: 'a1', name: 'ask_user', reason: 'user-input', payload: { question: '颜色？' } },
        4,
      ),
      event('run-end', { status: 'suspended', suspendCallId: 'a1' }, 5),
    ]);

    expect(accumulator.state.status).toBe('suspended');
    expect(accumulator.state.suspendCallId).toBe('a1');
    expect(accumulator.state.messages[0]?.toolCalls[0]?.status).toBe('suspended');
  });

  it('错误事件写入错误状态', () => {
    const accumulator = new AgentEventAccumulator();
    accumulator.applyAll([event('error', { code: 'internal_error', message: 'boom' }, 0)]);

    expect(accumulator.state.status).toBe('error');
    expect(accumulator.state.error).toEqual({ code: 'internal_error', message: 'boom' });
  });
});
