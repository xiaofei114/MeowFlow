import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@xiaofeiqwq/protocol';
import {
  Agent,
  MemorySessionStore,
  SUMMARY_MARKER,
  ToolResult,
  createSessionState,
  defineTool,
  suspend,
  type Provider,
  type ProviderChunk,
} from '../src/index';

/** 按脚本顺序逐轮返回预设 chunk 的假 Provider。 */
function mockProvider(script: ProviderChunk[][]): Provider {
  let round = 0;
  return {
    name: 'mock',
    model: 'mock-1',
    async *chat() {
      const chunks = script[round] ?? [{ type: 'finish', reason: 'stop' }];
      round += 1;
      for (const chunk of chunks) yield chunk;
    },
  };
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const echoTool = defineTool({
  name: 'echo',
  description: '回显输入',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  execute: (args) => new ToolResult(String(args.text ?? ''), { text: args.text }),
});

const askTool = defineTool({
  name: 'ask_user',
  description: '向用户提问',
  parameters: { type: 'object', properties: { question: { type: 'string' } } },
  execute: () => suspend('user-input', { question: '你最喜欢的颜色？' }),
});

describe('Agent 主循环', () => {
  it('完成一次纯文本回复', async () => {
    const agent = new Agent({
      provider: mockProvider([
        [
          { type: 'text-delta', text: '你' },
          { type: 'text-delta', text: '好' },
          { type: 'finish', reason: 'stop' },
        ],
      ]),
    });

    const events = await collect(agent.run({ input: '打招呼' }));
    const end = events.at(-1);

    expect(end).toMatchObject({ type: 'run-end', status: 'completed' });
    const messageEnd = events.find((event) => event.type === 'message-end');
    expect(messageEnd).toMatchObject({ message: { role: 'assistant', content: '你好' } });
  });

  it('执行工具调用并带着结果继续', async () => {
    const agent = new Agent({
      provider: mockProvider([
        [
          { type: 'tool-call-delta', index: 0, id: 'c1', name: 'echo', argsDelta: '{"text":' },
          { type: 'tool-call-delta', index: 0, argsDelta: '"hi"}' },
          { type: 'finish', reason: 'tool-calls' },
        ],
        [
          { type: 'text-delta', text: '完成' },
          { type: 'finish', reason: 'stop' },
        ],
      ]),
      tools: [echoTool],
    });

    const events = await collect(agent.run({ input: '调用 echo' }));
    const result = events.find((event) => event.type === 'tool-call-result');

    expect(result).toMatchObject({
      type: 'tool-call-result',
      status: 'ok',
      result: { text: 'hi' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'run-end', status: 'completed' });
    const messageEnds = events.filter((event) => event.type === 'message-end');
    expect(messageEnds.at(-1)).toMatchObject({ message: { content: '完成' } });
  });

  it('工具挂起后可通过 resume 继续', async () => {
    const agent = new Agent({
      provider: mockProvider([
        [
          { type: 'tool-call-delta', index: 0, id: 'a1', name: 'ask_user', argsDelta: '{}' },
          { type: 'finish', reason: 'tool-calls' },
        ],
        [
          { type: 'text-delta', text: '好的，蓝色' },
          { type: 'finish', reason: 'stop' },
        ],
      ]),
      tools: [askTool],
    });

    const firstRun = await collect(agent.run({ input: '开始', sessionId: 'session_x' }));
    expect(firstRun.at(-1)).toMatchObject({
      type: 'run-end',
      status: 'suspended',
      suspendCallId: 'a1',
    });

    const pending = await agent.getSession('session_x');
    expect(pending?.pending).toBeDefined();

    const secondRun = await collect(
      agent.resume({ sessionId: 'session_x', callId: 'a1', answer: '蓝色' }),
    );
    expect(secondRun.at(-1)).toMatchObject({ type: 'run-end', status: 'completed' });
    const messageEnds = secondRun.filter((event) => event.type === 'message-end');
    expect(messageEnds.at(-1)).toMatchObject({ message: { content: '好的，蓝色' } });

    const finalState = await agent.getSession('session_x');
    expect(finalState?.pending).toBeUndefined();
  });

  it('单进程模式下通过 onSuspend 自动回答', async () => {
    const agent = new Agent({
      provider: mockProvider([
        [
          { type: 'tool-call-delta', index: 0, id: 'a1', name: 'ask_user', argsDelta: '{}' },
          { type: 'finish', reason: 'tool-calls' },
        ],
        [
          { type: 'text-delta', text: '已收到：绿色' },
          { type: 'finish', reason: 'stop' },
        ],
      ]),
      tools: [askTool],
      onSuspend: () => '绿色',
    });

    const events = await collect(agent.run({ input: '开始' }));
    expect(events.at(-1)).toMatchObject({ type: 'run-end', status: 'completed' });
    expect(events.some((event) => event.type === 'tool-call-suspend')).toBe(false);
    const messageEnds = events.filter((event) => event.type === 'message-end');
    expect(messageEnds.at(-1)).toMatchObject({ message: { content: '已收到：绿色' } });
  });

  it('重建系统提示词时保留上一次的压缩摘要', async () => {
    const store = new MemorySessionStore();
    const agent = new Agent({
      provider: mockProvider([
        [
          { type: 'text-delta', text: '好的' },
          { type: 'finish', reason: 'stop' },
        ],
      ]),
      session: store,
      systemPrompt: '你是助手',
      // 阈值调高，确保本次运行不触发压缩，专测 applySystemPrompt 的重建行为
      context: { maxTokens: 1_000_000 },
    });

    await store.set({
      ...createSessionState('s1', undefined),
      messages: [
        { role: 'system', content: `你是助手\n\n${SUMMARY_MARKER}\n早前聊到了天气` },
        { role: 'user', content: '继续' },
      ],
    });

    await collect(agent.run({ input: '继续', sessionId: 's1' }));

    const state = await agent.getSession('s1');
    const system = state?.messages[0];
    expect(system?.role).toBe('system');
    expect(system?.content).toContain(SUMMARY_MARKER);
    expect(system?.content).toContain('早前聊到了天气');
  });
});
