import {
  AgentEventAccumulator,
  DEFAULT_ROUTES,
  SseParser,
  createAccumulatedState,
  type AccumulatedMessage,
  type AccumulatedState,
  type AccumulatedToolCall,
  type AgentEvent,
  type AgentRunStatus,
  type ResumeRequest,
  type RunRequest,
  type Usage,
} from '@xiaofeiqwq/protocol';
import { computed, onScopeDispose, reactive, type ComputedRef } from 'vue';

/** 路由配置，缺省使用协议默认路由。 */
export interface AgentRoutes {
  run: string;
  resume: string;
  abort: string;
}

export interface UseAgentOptions {
  /** 服务端基地址，缺省为同源相对路径 */
  baseUrl?: string;
  /** 覆盖默认路由 */
  routes?: Partial<AgentRoutes>;
  /** 附加请求头，可以是函数以便动态获取 token */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** 自定义 fetch 实现，便于测试或注入鉴权 */
  fetch?: typeof globalThis.fetch;
  /** 每次运行都会携带的默认参数 */
  runOptions?: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
    metadata?: Record<string, unknown>;
  };
  /** 收到每个事件时回调 */
  onEvent?: (event: AgentEvent) => void;
  /** 一次运行结束时回调 */
  onFinish?: (state: AccumulatedState) => void;
  /** 出错时回调 */
  onError?: (error: { code: string; message: string }) => void;
}

/** useAgent 返回的控制器，供组件或业务代码调用。 */
export interface AgentController {
  /** 归约后的完整状态（Vue 响应式对象，字段级变更会实时触发刷新） */
  state: AccumulatedState;
  messages: ComputedRef<AccumulatedMessage[]>;
  status: ComputedRef<AgentRunStatus>;
  isStreaming: ComputedRef<boolean>;
  error: ComputedRef<{ code: string; message: string } | undefined>;
  usage: ComputedRef<Usage | undefined>;
  sessionId: ComputedRef<string | undefined>;
  /** 当前等待回答的工具调用（挂起时存在） */
  pendingSuspend: ComputedRef<AccumulatedToolCall | undefined>;
  send(input: string, extra?: Partial<RunRequest>): Promise<void>;
  resume(answer: unknown): Promise<void>;
  abort(): Promise<void>;
  reset(): void;
}

function joinUrl(baseUrl: string | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 连接 Agent 服务端的组合式函数。
 *
 * 内部只依赖协议包提供的 SSE 解析与事件归约，因此可对接任何遵循协议的后端。
 * 组件卸载时会自动中断正在进行的请求。
 */
export function useAgent(options: UseAgentOptions = {}): AgentController {
  // 使用 Vue 的 reactive 包裹状态，并把同一对象注入归约器：
  // 归约过程中的每一次字段/数组变更都会实时触发依赖刷新，从而实现流式逐字渲染。
  const state = reactive<AccumulatedState>(createAccumulatedState());
  const accumulator = new AgentEventAccumulator(state);
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const routes: AgentRoutes = {
    run: options.routes?.run ?? DEFAULT_ROUTES.run,
    resume: options.routes?.resume ?? DEFAULT_ROUTES.resume,
    abort: options.routes?.abort ?? DEFAULT_ROUTES.abort,
  };

  let controller: AbortController | null = null;

  const messages = computed(() => state.messages);
  const status = computed(() => state.status);
  const isStreaming = computed(() => state.status === 'streaming');
  const error = computed(() => state.error);
  const usage = computed(() => state.usage);
  const sessionId = computed(() => state.sessionId);
  const pendingSuspend = computed<AccumulatedToolCall | undefined>(() => {
    const callId = state.suspendCallId;
    if (!callId) return undefined;
    for (const message of state.messages) {
      const found = message.toolCalls.find((call) => call.callId === callId);
      if (found) return found;
    }
    return undefined;
  });

  function resolveHeaders(): Record<string, string> {
    const base = typeof options.headers === 'function' ? options.headers() : options.headers;
    return {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...base,
    };
  }

  /** 把请求层错误写入状态并回调，保证默认组件也能展示错误。 */
  function reportError(err: unknown): void {
    const message = errorMessage(err);
    state.status = 'error';
    state.error = { code: 'network_error', message };
    options.onError?.({ code: 'network_error', message });
  }

  /** 开始一次请求前校验是否已有请求在途，避免共用归约器导致状态错乱。 */
  function assertIdle(): void {
    if (controller) throw new Error('已有正在进行的请求，请等待完成或先调用 abort()');
  }

  function applyEvent(event: AgentEvent): void {
    accumulator.apply(event);
    options.onEvent?.(event);

    if (event.type === 'error') {
      options.onError?.({ code: event.code, message: event.message });
    }
    if (event.type === 'run-end') {
      options.onFinish?.(state);
    }
  }

  async function stream(path: string, body: unknown, signal: AbortSignal): Promise<void> {
    const response = await doFetch(joinUrl(options.baseUrl, path), {
      method: 'POST',
      headers: resolveHeaders(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      let message = `请求失败：HTTP ${response.status}`;
      try {
        const data = (await response.json()) as { error?: { message?: string } };
        if (data.error?.message) message = data.error.message;
      } catch {
        // 非 JSON 响应，保留默认提示
      }
      throw new Error(message);
    }
    if (!response.body) throw new Error('响应缺少可读流，无法解析 SSE');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
        parseAndApply(payload);
      }
    }
    for (const payload of parser.flush()) {
      parseAndApply(payload);
    }
  }

  function parseAndApply(payload: string): void {
    let event: AgentEvent;
    try {
      event = JSON.parse(payload) as AgentEvent;
    } catch {
      return;
    }
    applyEvent(event);
  }

  async function send(input: string, extra?: Partial<RunRequest>): Promise<void> {
    if (input === '' && !extra?.input) return;
    assertIdle();
    accumulator.addUserMessage(input);

    const local = new AbortController();
    controller = local;
    try {
      await stream(
        routes.run,
        {
          input,
          ...(options.runOptions ?? {}),
          ...extra,
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
        },
        local.signal,
      );
    } catch (err) {
      if (!local.signal.aborted) reportError(err);
    } finally {
      if (controller === local) controller = null;
    }
  }

  async function resume(answer: unknown): Promise<void> {
    const currentSession = state.sessionId;
    const callId = state.suspendCallId;
    if (!currentSession || !callId) {
      throw new Error('当前没有处于挂起状态的调用');
    }
    assertIdle();

    const local = new AbortController();
    controller = local;
    const body: ResumeRequest = { sessionId: currentSession, callId, answer };
    try {
      await stream(routes.resume, body, local.signal);
    } catch (err) {
      if (!local.signal.aborted) reportError(err);
    } finally {
      if (controller === local) controller = null;
    }
  }

  async function abort(): Promise<void> {
    const currentSession = state.sessionId;
    controller?.abort();
    controller = null;

    // 本地立即收敛状态：中断后服务端的 run-end 不会再送达，
    // 若不在这里收尾，status 会一直停留在 streaming 导致 UI 卡死。
    state.status = 'idle';
    state.suspendCallId = undefined;
    for (const message of state.messages) message.streaming = false;

    if (!currentSession) return;

    try {
      await doFetch(joinUrl(options.baseUrl, routes.abort), {
        method: 'POST',
        headers: resolveHeaders(),
        body: JSON.stringify({ sessionId: currentSession }),
      });
    } catch {
      // 中断请求失败不影响本地状态
    }
  }

  function reset(): void {
    controller?.abort();
    controller = null;
    accumulator.reset();
  }

  onScopeDispose(() => {
    controller?.abort();
  });

  return {
    state,
    messages,
    status,
    isStreaming,
    error,
    usage,
    sessionId,
    pendingSuspend,
    send,
    resume,
    abort,
    reset,
  };
}
