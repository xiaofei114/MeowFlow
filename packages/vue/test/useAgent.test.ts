import type { AgentEvent } from '@xiaofeiqwq/protocol';
import { effectScope, nextTick, watchEffect } from 'vue';
import { describe, expect, it } from 'vitest';
import { useAgent } from '../src/index';

function ev<T extends AgentEvent['type']>(
  type: T,
  body: Omit<Extract<AgentEvent, { type: T }>, 'v' | 'runId' | 'sessionId' | 'seq' | 'ts' | 'type'>,
  seq: number,
): AgentEvent {
  return {
    v: '1.0',
    runId: 'run_1',
    sessionId: 'session_1',
    seq,
    ts: seq,
    type,
    ...body,
  } as unknown as AgentEvent;
}

/** 把事件数组包装成一个静态的 SSE Response。 */
function sseResponse(events: AgentEvent[], status = 200): Response {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 永远不主动结束的 SSE Response：收到 abort 信号时才让读取失败，用于验证中断行为。 */
function pendingResponse(signal: AbortSignal | null | undefined): Response {
  const start: AgentEvent = ev('run-start', { model: 'mock', resumed: false }, 0);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(start)}\n\n`));
      signal?.addEventListener(
        'abort',
        () => controller.error(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 轮询等待某个条件成立，避免依赖固定次数的微任务。 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('等待条件成立超时');
}

const runEvents: AgentEvent[] = [
  ev('run-start', { model: 'mock', resumed: false }, 0),
  ev('message-start', { role: 'assistant' }, 1),
  ev('text-delta', { text: '你' }, 2),
  ev('text-delta', { text: '好' }, 3),
  ev('message-end', { message: { role: 'assistant', content: '你好' } }, 4),
  ev('run-end', { status: 'completed' }, 5),
];

const suspendEvents: AgentEvent[] = [
  ev('run-start', { model: 'mock', resumed: false }, 0),
  ev('message-start', { role: 'assistant' }, 1),
  ev('tool-call-start', { callId: 'a1', name: 'ask_user' }, 2),
  ev('tool-call-end', { callId: 'a1', name: 'ask_user', args: {} }, 3),
  ev(
    'tool-call-suspend',
    { callId: 'a1', name: 'ask_user', reason: 'user-input', payload: { question: '颜色？' } },
    4,
  ),
  ev('run-end', { status: 'suspended', suspendCallId: 'a1' }, 5),
];

const resumeEvents: AgentEvent[] = [
  ev('run-start', { model: 'mock', resumed: true }, 0),
  ev('message-start', { role: 'assistant' }, 1),
  ev('text-delta', { text: '收到蓝色' }, 2),
  ev('message-end', { message: { role: 'assistant', content: '收到蓝色' } }, 3),
  ev('run-end', { status: 'completed' }, 4),
];

describe('useAgent', () => {
  it('发送消息并归约流式事件', async () => {
    const scope = effectScope();
    const controller = scope.run(() => useAgent({ fetch: async () => sseResponse(runEvents) }));
    if (!controller) throw new Error('创建控制器失败');

    await controller.send('打招呼');

    expect(controller.messages.value).toHaveLength(2);
    expect(controller.messages.value[0]).toMatchObject({ role: 'user', content: '打招呼' });
    expect(controller.messages.value[1]).toMatchObject({ role: 'assistant', content: '你好' });
    expect(controller.status.value).toBe('idle');
    expect(controller.sessionId.value).toBe('session_1');
    scope.stop();
  });

  it('挂起后可读取待处理调用并 resume', async () => {
    const scope = effectScope();
    const controller = scope.run(() =>
      useAgent({
        fetch: async (input) =>
          String(input).includes('/resume')
            ? sseResponse(resumeEvents)
            : sseResponse(suspendEvents),
      }),
    );
    if (!controller) throw new Error('创建控制器失败');

    await controller.send('开始');
    expect(controller.status.value).toBe('suspended');
    expect(controller.pendingSuspend.value).toMatchObject({ name: 'ask_user' });

    await controller.resume('蓝色');
    expect(controller.status.value).toBe('idle');
    expect(controller.messages.value.at(-1)).toMatchObject({ content: '收到蓝色' });
    scope.stop();
  });

  it('流式事件能驱动响应式更新', async () => {
    const scope = effectScope();
    const snapshots: string[] = [];
    const controller = scope.run(() => {
      const instance = useAgent({ fetch: async () => sseResponse(runEvents) });
      watchEffect(
        () => {
          const last = instance.messages.value.at(-1);
          snapshots.push(last && last.role === 'assistant' ? last.content : '');
        },
        { flush: 'sync' },
      );
      return instance;
    });
    if (!controller) throw new Error('创建控制器失败');

    await controller.send('打招呼');
    await nextTick();

    // 必须能观察到中间态（只收到部分文本时已触发更新），证明是实时流式而非结束后一次性渲染
    expect(snapshots).toContain('你');
    expect(snapshots.at(-1)).toBe('你好');
    scope.stop();
  });

  it('HTTP 错误转为 onError 回调', async () => {
    const scope = effectScope();
    const errors: string[] = [];
    const controller = scope.run(() =>
      useAgent({
        fetch: async () =>
          new Response(JSON.stringify({ ok: false, error: { code: 'x', message: '爆炸' } }), {
            status: 500,
          }),
        onError: (error) => errors.push(error.message),
      }),
    );
    if (!controller) throw new Error('创建控制器失败');

    await controller.send('hi');
    expect(errors).toContain('爆炸');
    scope.stop();
  });

  it('abort 后状态收敛为 idle 并停止流式', async () => {
    const scope = effectScope();
    const controller = scope.run(() =>
      useAgent({
        fetch: async (input, init) =>
          String(input).includes('/abort')
            ? new Response('{}', { status: 200 })
            : pendingResponse(init?.signal),
      }),
    );
    if (!controller) throw new Error('创建控制器失败');

    const running = controller.send('你好');
    await waitFor(() => controller.status.value === 'streaming');

    await controller.abort();
    await running;

    expect(controller.status.value).toBe('idle');
    expect(controller.messages.value.every((message) => !message.streaming)).toBe(true);
    scope.stop();
  });

  it('流式进行中再次发送会被拒绝', async () => {
    const scope = effectScope();
    const controller = scope.run(() =>
      useAgent({
        fetch: async (input, init) =>
          String(input).includes('/abort')
            ? new Response('{}', { status: 200 })
            : pendingResponse(init?.signal),
      }),
    );
    if (!controller) throw new Error('创建控制器失败');

    const running = controller.send('第一次');
    await waitFor(() => controller.status.value === 'streaming');

    await expect(controller.send('第二次')).rejects.toThrow(/已有正在进行的请求/);

    await controller.abort();
    await running;
    scope.stop();
  });
});
