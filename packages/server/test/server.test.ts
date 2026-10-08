import { SseParser } from '@xiaofeiqwq/protocol';
import type { AgentEvent } from '@xiaofeiqwq/protocol';
import {
  Agent,
  ToolResult,
  defineTool,
  suspend,
  type Provider,
  type ProviderChunk,
} from '@xiaofeiqwq/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentServer, type AgentServer } from '../src/index';

function scriptedProvider(script: ProviderChunk[][]): Provider {
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

async function readEvents(response: Response): Promise<AgentEvent[]> {
  const parser = new SseParser();
  const payloads = [...parser.push(await response.text()), ...parser.flush()];
  return payloads.map((payload) => JSON.parse(payload) as AgentEvent);
}

const servers: AgentServer[] = [];

async function start(agent: Agent): Promise<string> {
  const server = createAgentServer({ agent, port: 0, heartbeatMs: 0 });
  servers.push(server);
  const info = await server.listen();
  return info.url;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('Agent HTTP 服务', () => {
  it('run 路由以 SSE 返回事件流', async () => {
    const agent = new Agent({
      provider: scriptedProvider([
        [
          { type: 'text-delta', text: '你' },
          { type: 'text-delta', text: '好' },
          { type: 'finish', reason: 'stop' },
        ],
      ]),
    });
    const url = await start(agent);

    const response = await fetch(`${url}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '打招呼' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = await readEvents(response);
    expect(events[0]).toMatchObject({ type: 'run-start', resumed: false });
    expect(events.at(-1)).toMatchObject({ type: 'run-end', status: 'completed' });
    expect(events.some((event) => event.type === 'text-delta' && event.text === '好')).toBe(true);
  });

  it('工具调用经 HTTP 往返', async () => {
    const echoTool = defineTool({
      name: 'echo',
      description: '回显',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      execute: (args) => new ToolResult(String(args.text ?? ''), { text: args.text }),
    });

    const agent = new Agent({
      provider: scriptedProvider([
        [
          { type: 'tool-call-delta', index: 0, id: 'c1', name: 'echo', argsDelta: '{"text":"hi"}' },
          { type: 'finish', reason: 'tool-calls' },
        ],
        [{ type: 'finish', reason: 'stop' }],
      ]),
      tools: [echoTool],
    });
    const url = await start(agent);

    const events = await readEvents(
      await fetch(`${url}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'echo' }),
      }),
    );

    expect(events.find((event) => event.type === 'tool-call-result')).toMatchObject({
      type: 'tool-call-result',
      status: 'ok',
      result: { text: 'hi' },
    });
  });

  it('挂起后可通过 resume 路由继续', async () => {
    const askTool = defineTool({
      name: 'ask_user',
      description: '提问',
      parameters: { type: 'object', properties: {} },
      execute: () => suspend('user-input', { question: '颜色？' }),
    });

    const agent = new Agent({
      provider: scriptedProvider([
        [
          { type: 'tool-call-delta', index: 0, id: 'a1', name: 'ask_user', argsDelta: '{}' },
          { type: 'finish', reason: 'tool-calls' },
        ],
        [
          { type: 'text-delta', text: '收到蓝色' },
          { type: 'finish', reason: 'stop' },
        ],
      ]),
      tools: [askTool],
    });
    const url = await start(agent);

    const first = await readEvents(
      await fetch(`${url}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: '开始', sessionId: 's1' }),
      }),
    );
    const suspendEvent = first.find((event) => event.type === 'tool-call-suspend');
    expect(suspendEvent).toBeDefined();
    expect(first.at(-1)).toMatchObject({ type: 'run-end', status: 'suspended' });

    const second = await readEvents(
      await fetch(`${url}/agent/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', callId: 'a1', answer: '蓝色' }),
      }),
    );
    expect(second[0]).toMatchObject({ type: 'run-start', resumed: true });
    expect(second.at(-1)).toMatchObject({ type: 'run-end', status: 'completed' });
  });

  it('health 与 404 路由', async () => {
    const agent = new Agent({
      provider: scriptedProvider([[{ type: 'finish', reason: 'stop' }]]),
    });
    const url = await start(agent);

    const health = await fetch(`${url}/agent/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });

    const missing = await fetch(`${url}/agent/nope`);
    expect(missing.status).toBe(404);
  });

  it('缺少 input 时返回 400', async () => {
    const agent = new Agent({
      provider: scriptedProvider([[{ type: 'finish', reason: 'stop' }]]),
    });
    const url = await start(agent);

    const response = await fetch(`${url}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});
