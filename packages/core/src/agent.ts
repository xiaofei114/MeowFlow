import { addUsage } from '@meowflow/protocol';
import type {
  AgentEvent,
  AssistantMessage,
  Message,
  RunStatus,
  SuspendReason,
  ToolCall,
  ToolMessage,
  Usage,
} from '@meowflow/protocol';
import {
  ContextManager,
  SUMMARY_MARKER,
  compressContext,
  estimateMessagesTokens,
  type ContextOptions,
} from './context';
import { MeowFlowError, AbortedError, ConfigError, isAbortError } from './errors';
import { EventFactory, type EmittableEvent } from './events';
import { createLogger, silentLogger, type Logger, type LogLevel } from './logger';
import { renderPrompt } from './prompts';
import { resolveProvider, type ProviderInput } from './provider/types';
import {
  MemorySessionStore,
  createSessionState,
  type SessionState,
  type SessionStore,
} from './session';
import { findSkill, type Skill } from './skills';
import { executeToolCall, parseToolArguments } from './tools/executor';
import { ToolRegistry } from './tools/registry';
import {
  ToolResult,
  defineTool,
  toolError,
  type SubAgentOptions,
  type ToolContext,
  type ToolDefinition,
} from './tools/types';
import { generateId, stringifyValue } from './utils';

const DEFAULT_SYSTEM_PROMPT =
  '你是一个可以调用工具的 AI 助手。请根据用户需求，必要时调用合适的工具来完成任务，并给出清晰的中文回答。';

/** 表示“交由外部处理”，不立即返回结果。 */
const PENDING = Symbol('meowflow.pending');

/** 技能注入方式：lazy 先给索引按需加载，eager 全量注入。 */
export type SkillMode = 'lazy' | 'eager';

/** 挂起请求，交给使用方决定如何获得答案。 */
export interface SuspendRequest {
  sessionId: string;
  runId: string;
  callId: string;
  toolName: string;
  reason: SuspendReason;
  payload: unknown;
}

/**
 * 挂起处理器。
 *
 * 提供该回调即进入“单进程自动模式”：框架拿到返回值后直接继续，不落库、不结束运行。
 * 不提供则进入“挂起-恢复模式”：状态持久化到 SessionStore，等待外部 resume。
 */
export type SuspendHandler = (request: SuspendRequest) => unknown | Promise<unknown>;

export interface RunInput {
  input: string;
  sessionId?: string;
  /** 本次运行覆盖系统提示词 */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ResumeInput {
  sessionId: string;
  callId: string;
  answer: unknown;
  signal?: AbortSignal;
}

export interface AgentOptions {
  provider: ProviderInput;
  tools?: ToolDefinition[];
  skills?: Skill[];
  /** 技能注入方式，默认 lazy */
  skillMode?: SkillMode;
  /** 基础系统提示词 */
  systemPrompt?: string;
  /** 带变量的系统提示词模板（优先级高于 systemPrompt） */
  promptTemplate?: string;
  promptVariables?: Record<string, unknown>;
  context?: Partial<ContextOptions>;
  session?: SessionStore;
  logger?: Logger | LogLevel | false;
  /** 单次运行最大迭代轮数，默认 10 */
  maxIterations?: number;
  /** 挂起处理器，提供则进入单进程自动模式 */
  onSuspend?: SuspendHandler;
  /** 自定义 id 生成器 */
  idGenerator?: (prefix: string) => string;
  /** 会话默认元信息 */
  metadata?: Record<string, unknown>;
  /** 子代理最大嵌套深度，默认 2 */
  maxSubAgentDepth?: number;
}

/** 运行结果摘要。 */
export interface RunOutcome {
  status: RunStatus;
  suspendCallId?: string;
  usage?: Usage;
}

type BatchOutcome = { kind: 'continue' } | { kind: 'suspended'; callId: string };

type ResolvedCall =
  | { kind: 'result'; result: ToolResult }
  | { kind: 'suspend'; reason: SuspendReason; payload: unknown };

interface LoopContext {
  state: SessionState;
  factory: EventFactory;
  runId: string;
  signal: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  usage?: Usage;
}

/** 把工具内部推送的事件实时汇入主事件流的缓冲队列。 */
class EventBuffer {
  private items: EmittableEvent[] = [];
  private waiter: (() => void) | null = null;

  push(event: EmittableEvent): void {
    this.items.push(event);
    this.notify();
  }

  notify(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  drain(): EmittableEvent[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }

  wait(): Promise<void> {
    if (this.items.length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiter = resolve;
    });
  }
}

function mergeSignals(external: AbortSignal | undefined, internal: AbortSignal): AbortSignal {
  if (!external) return internal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([external, internal]);
  const controller = new AbortController();
  // 任一信号在监听前就已中止时，监听器不会再触发，必须立即透传中止状态
  if (external.aborted || internal.aborted) {
    controller.abort();
    return controller.signal;
  }
  const abort = () => controller.abort();
  external.addEventListener('abort', abort, { once: true });
  internal.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

/** 去掉事件元信息，得到可再次交给 EventFactory 的半成品事件。 */
function stripMeta(event: AgentEvent): EmittableEvent {
  const copy: Record<string, unknown> = { ...event };
  delete copy.v;
  delete copy.runId;
  delete copy.sessionId;
  delete copy.seq;
  delete copy.ts;
  return copy as EmittableEvent;
}

function normalizeResult(value: unknown): ToolResult {
  if (value instanceof ToolResult) return value;
  if (typeof value === 'string') return new ToolResult(value);
  if (value === undefined || value === null) return new ToolResult('');
  return new ToolResult(stringifyValue(value), value);
}

function resolveLogger(input: Logger | LogLevel | false | undefined): Logger {
  if (input === false || input === undefined) return silentLogger;
  if (typeof input === 'string') return createLogger(input);
  return input;
}

/**
 * Agent 运行时。
 *
 * 一个 Agent 实例可服务多个会话：把 `sessionId` 传进 `run` 即可复用上下文，
 * 每个会话的运行彼此独立，可并发执行。
 */
export class Agent {
  readonly tools: ToolRegistry;
  readonly skills: Skill[];
  readonly sessionStore: SessionStore;

  private readonly provider: ProviderInput;
  private readonly userTools: ToolDefinition[];
  private readonly skillMode: SkillMode;
  private readonly systemPrompt?: string;
  private readonly promptTemplate?: string;
  private readonly promptVariables: Record<string, unknown>;
  private readonly contextManager: ContextManager;
  private readonly logger: Logger;
  private readonly maxIterations: number;
  private readonly onSuspend?: SuspendHandler;
  private readonly idGenerator: (prefix: string) => string;
  private readonly metadata?: Record<string, unknown>;
  private readonly maxSubAgentDepth: number;
  private readonly depth: number;
  private readonly controllers = new Map<string, AbortController>();

  constructor(options: AgentOptions, runtime?: { depth: number }) {
    if (!options.provider) throw new ConfigError('缺少 provider 配置');

    this.provider = options.provider;
    this.userTools = options.tools ?? [];
    this.skills = options.skills ?? [];
    this.skillMode = options.skillMode ?? 'lazy';
    this.systemPrompt = options.systemPrompt;
    this.promptTemplate = options.promptTemplate;
    this.promptVariables = options.promptVariables ?? {};
    this.contextManager = new ContextManager(options.context);
    this.sessionStore = options.session ?? new MemorySessionStore();
    this.maxIterations = options.maxIterations ?? 10;
    this.onSuspend = options.onSuspend;
    this.idGenerator = options.idGenerator ?? ((prefix) => generateId(prefix));
    this.metadata = options.metadata;
    this.maxSubAgentDepth = options.maxSubAgentDepth ?? 2;
    this.depth = runtime?.depth ?? 0;
    this.logger = resolveLogger(options.logger);

    const builtin: ToolDefinition[] = [];
    if (this.skillMode === 'lazy' && this.skills.length > 0) {
      builtin.push(this.createLoadSkillTool());
    }
    this.tools = new ToolRegistry([...this.userTools, ...builtin]);
  }

  /** 发起一次运行，产出事件流。 */
  async *run(input: RunInput): AsyncGenerator<AgentEvent> {
    const sessionId = input.sessionId ?? this.idGenerator('session');
    const runId = this.idGenerator('run');
    const state =
      (await this.sessionStore.get(sessionId)) ?? createSessionState(sessionId, this.metadata);

    if (state.pending) {
      throw new ConfigError(`会话 ${sessionId} 正处于挂起状态，请先调用 resume 提交答案后再运行`);
    }

    this.applySystemPrompt(state, input.system);
    if (input.input !== '') state.messages.push({ role: 'user', content: input.input });
    if (input.metadata) state.metadata = { ...state.metadata, ...input.metadata };
    await this.sessionStore.set(state);

    const controller = new AbortController();
    const ctx: LoopContext = {
      state,
      factory: new EventFactory(runId, sessionId),
      runId,
      signal: mergeSignals(input.signal, controller.signal),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    };

    this.controllers.set(sessionId, controller);
    yield ctx.factory.create({
      type: 'run-start',
      model: resolveProvider(this.provider).model,
      resumed: false,
    });

    yield* this.execute(ctx);
  }

  /** 恢复一次被挂起的运行。 */
  async *resume(input: ResumeInput): AsyncGenerator<AgentEvent> {
    const state = await this.sessionStore.get(input.sessionId);
    if (!state) throw new ConfigError(`会话不存在：${input.sessionId}`);

    const pending = state.pending;
    if (!pending) throw new ConfigError(`会话 ${input.sessionId} 当前没有挂起的调用`);

    const runId = this.idGenerator('run');
    const controller = new AbortController();
    const ctx: LoopContext = {
      state,
      factory: new EventFactory(runId, state.id),
      runId,
      signal: mergeSignals(input.signal, controller.signal),
    };

    this.controllers.set(state.id, controller);
    yield ctx.factory.create({
      type: 'run-start',
      model: resolveProvider(this.provider).model,
      resumed: true,
    });

    yield* this.execute(ctx, {
      calls: pending.calls,
      index: pending.index,
      callId: input.callId,
      answer: input.answer,
    });
  }

  /** 中断指定会话正在进行的运行。 */
  abort(sessionId: string): boolean {
    const controller = this.controllers.get(sessionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** 读取会话状态。 */
  async getSession(sessionId: string): Promise<SessionState | undefined> {
    return this.sessionStore.get(sessionId);
  }

  /** 手动压缩指定会话的上下文。 */
  async compress(sessionId: string): Promise<AgentEvent | undefined> {
    const state = await this.sessionStore.get(sessionId);
    if (!state) return undefined;

    const result = await compressContext({
      provider: resolveProvider(this.provider),
      messages: state.messages,
      keepRecentMessages: this.contextManager.options.keepRecentMessages,
      maxToolResultLength: this.contextManager.options.maxToolResultLength,
    });
    if (!result.compressed) return undefined;

    state.messages = result.messages;
    await this.sessionStore.set(state);

    const factory = new EventFactory(this.idGenerator('compress'), sessionId);
    return factory.create({
      type: 'context-compressed',
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      summary: result.summary,
    });
  }

  /** 当前上下文 token 估算。 */
  estimateTokens(messages: Message[]): number {
    return estimateMessagesTokens(messages);
  }

  private async *execute(
    ctx: LoopContext,
    resume?: { calls: ToolCall[]; index: number; callId: string; answer: unknown },
  ): AsyncGenerator<AgentEvent> {
    let outcome: RunOutcome = { status: 'error' };

    try {
      outcome = yield* this.drive(ctx, resume);
    } catch (error) {
      if (isAbortError(error)) {
        outcome = { status: 'aborted', usage: ctx.usage };
      } else {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error('运行失败', { error: err.message });
        yield ctx.factory.create({
          type: 'error',
          code: err instanceof MeowFlowError ? err.code : 'internal_error',
          message: err.message,
        });
        outcome = { status: 'error', usage: ctx.usage };
      }
    } finally {
      this.controllers.delete(ctx.state.id);
    }

    yield ctx.factory.create({
      type: 'run-end',
      status: outcome.status,
      ...(outcome.suspendCallId ? { suspendCallId: outcome.suspendCallId } : {}),
      ...(outcome.usage ? { usage: outcome.usage } : {}),
    });
  }

  private async *drive(
    ctx: LoopContext,
    resume?: { calls: ToolCall[]; index: number; callId: string; answer: unknown },
  ): AsyncGenerator<AgentEvent, RunOutcome> {
    if (resume) {
      const batch = yield* this.executeBatch(ctx, resume.calls, resume.index, {
        callId: resume.callId,
        answer: resume.answer,
      });
      if (batch.kind === 'suspended') {
        return { status: 'suspended', suspendCallId: batch.callId, usage: ctx.usage };
      }
    }

    return yield* this.runIterations(ctx);
  }

  private async *runIterations(ctx: LoopContext): AsyncGenerator<AgentEvent, RunOutcome> {
    const provider = resolveProvider(this.provider);
    const specs = this.tools.toSpecs();

    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      if (ctx.signal.aborted) return { status: 'aborted', usage: ctx.usage };

      yield* this.maybeCompress(ctx);

      const assistant: AssistantMessage = { role: 'assistant', content: '' };
      const accumulated = new Map<number, { id: string; name: string; args: string }>();
      const started = new Set<number>();

      yield ctx.factory.create({ type: 'message-start', role: 'assistant' });

      for await (const chunk of provider.chat({
        messages: ctx.state.messages,
        ...(specs.length > 0 ? { tools: specs } : {}),
        ...(ctx.temperature !== undefined ? { temperature: ctx.temperature } : {}),
        ...(ctx.maxTokens !== undefined ? { maxTokens: ctx.maxTokens } : {}),
        signal: ctx.signal,
      })) {
        switch (chunk.type) {
          case 'text-delta': {
            assistant.content += chunk.text;
            yield ctx.factory.create({ type: 'text-delta', text: chunk.text });
            break;
          }
          case 'thinking-delta': {
            assistant.thinking = (assistant.thinking ?? '') + chunk.text;
            yield ctx.factory.create({ type: 'thinking-delta', text: chunk.text });
            break;
          }
          case 'tool-call-delta': {
            const entry = accumulated.get(chunk.index) ?? { id: '', name: '', args: '' };
            if (chunk.id) entry.id = chunk.id;
            if (chunk.name) entry.name = chunk.name;
            if (chunk.argsDelta) entry.args += chunk.argsDelta;
            accumulated.set(chunk.index, entry);

            if (!started.has(chunk.index) && entry.id !== '' && entry.name !== '') {
              started.add(chunk.index);
              yield ctx.factory.create({
                type: 'tool-call-start',
                callId: entry.id,
                name: entry.name,
              });
            }
            if (chunk.argsDelta && started.has(chunk.index)) {
              yield ctx.factory.create({
                type: 'tool-call-args-delta',
                callId: entry.id,
                delta: chunk.argsDelta,
              });
            }
            break;
          }
          case 'finish': {
            if (chunk.usage) {
              ctx.usage = addUsage(ctx.usage, chunk.usage);
              yield ctx.factory.create({ type: 'usage', usage: chunk.usage });
            }
            break;
          }
        }
      }

      const ordered = [...accumulated.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, value]) => value)
        .filter((value) => value.name !== '');

      if (ordered.length > 0) {
        assistant.toolCalls = ordered.map((value) => ({
          id: value.id !== '' ? value.id : this.idGenerator('call'),
          name: value.name,
          arguments: value.args !== '' ? value.args : '{}',
        }));
      }

      yield ctx.factory.create({ type: 'message-end', message: assistant });
      ctx.state.messages.push(assistant);
      await this.sessionStore.set(ctx.state);

      if (!assistant.toolCalls || assistant.toolCalls.length === 0) {
        return { status: 'completed', usage: ctx.usage };
      }

      const batch = yield* this.executeBatch(ctx, assistant.toolCalls, 0);
      if (batch.kind === 'suspended') {
        return { status: 'suspended', suspendCallId: batch.callId, usage: ctx.usage };
      }
    }

    this.logger.warn('达到最大迭代轮数，强制结束', { maxIterations: this.maxIterations });
    return { status: 'completed', usage: ctx.usage };
  }

  private async *executeBatch(
    ctx: LoopContext,
    calls: ToolCall[],
    startIndex: number,
    injected?: { callId: string; answer: unknown },
  ): AsyncGenerator<AgentEvent, BatchOutcome> {
    for (let index = startIndex; index < calls.length; index += 1) {
      const call = calls[index];
      if (!call) continue;
      if (ctx.signal.aborted) throw new AbortedError();

      const startedAt = Date.now();
      let result: ToolResult;

      if (injected && call.id === injected.callId) {
        result = normalizeResult(injected.answer);
      } else {
        const parsed = parseToolArguments(call.arguments);
        yield ctx.factory.create({
          type: 'tool-call-end',
          callId: call.id,
          name: call.name,
          args: parsed.error ? call.arguments : parsed.args,
        });

        const resolved = yield* this.resolveCall(ctx, call);
        if (resolved.kind === 'suspend') {
          const answer = await this.resolveSuspend(ctx, call, resolved.reason, resolved.payload);
          if (answer === PENDING) {
            ctx.state.pending = { calls, index, runId: ctx.runId };
            await this.sessionStore.set(ctx.state);
            yield ctx.factory.create({
              type: 'tool-call-suspend',
              callId: call.id,
              name: call.name,
              reason: resolved.reason,
              payload: resolved.payload,
            });
            return { kind: 'suspended', callId: call.id };
          }
          result = normalizeResult(answer);
        } else {
          result = resolved.result;
        }
      }

      const message: ToolMessage = {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: result.content,
        isError: result.isError,
      };
      ctx.state.messages.push(message);
      yield ctx.factory.create({
        type: 'tool-call-result',
        callId: call.id,
        name: call.name,
        status: result.isError ? 'error' : 'ok',
        result: result.data ?? result.content,
        durationMs: Date.now() - startedAt,
      });
      await this.sessionStore.set(ctx.state);
    }

    ctx.state.pending = undefined;
    await this.sessionStore.set(ctx.state);
    return { kind: 'continue' };
  }

  /**
   * 解析一次工具调用。
   *
   * 工具执行期间允许通过 `ctx.emit` 推送事件（例如子代理的中间输出），
   * 这里用缓冲队列把工具 Promise 与事件产出并行起来，保证实时性。
   */
  private async *resolveCall(
    ctx: LoopContext,
    call: ToolCall,
  ): AsyncGenerator<AgentEvent, ResolvedCall> {
    const tool = this.tools.get(call.name);

    if (tool?.requiresApproval) {
      const args = parseToolArguments(call.arguments).args;
      return {
        kind: 'suspend',
        reason: 'approval',
        payload: {
          toolName: call.name,
          args,
          message: tool.approvalPrompt?.(args) ?? `即将执行工具 ${call.name}，是否允许？`,
        },
      };
    }

    const buffer = new EventBuffer();
    const toolCtx = this.createToolContext(ctx, buffer);
    const promise = executeToolCall({ call, registry: this.tools, ctx: toolCtx });

    let settled = false;
    const markSettled = (): void => {
      settled = true;
      buffer.notify();
    };
    promise.then(markSettled, markSettled);

    while (!settled) {
      await Promise.race([
        promise.then(
          () => undefined,
          () => undefined,
        ),
        buffer.wait(),
      ]);
      for (const event of buffer.drain()) yield ctx.factory.create(event);
    }

    for (const event of buffer.drain()) yield ctx.factory.create(event);

    const outcome = await promise;
    if (outcome.kind === 'suspend') {
      return { kind: 'suspend', reason: outcome.suspend.reason, payload: outcome.suspend.payload };
    }
    return { kind: 'result', result: outcome.result };
  }

  private async resolveSuspend(
    ctx: LoopContext,
    call: ToolCall,
    reason: SuspendReason,
    payload: unknown,
  ): Promise<unknown | typeof PENDING> {
    if (!this.onSuspend) return PENDING;
    return this.onSuspend({
      sessionId: ctx.state.id,
      runId: ctx.runId,
      callId: call.id,
      toolName: call.name,
      reason,
      payload,
    });
  }

  private createToolContext(ctx: LoopContext, buffer: EventBuffer): ToolContext {
    return {
      sessionId: ctx.state.id,
      runId: ctx.runId,
      signal: ctx.signal,
      logger: this.logger,
      emit: (event) => buffer.push(event),
      runSubAgent: (options) => this.spawnSubAgent(ctx, options, buffer),
      ...(ctx.state.metadata ? { metadata: ctx.state.metadata } : {}),
    };
  }

  private async spawnSubAgent(
    parent: LoopContext,
    options: SubAgentOptions,
    buffer: EventBuffer,
  ): Promise<string> {
    if (this.depth >= this.maxSubAgentDepth) {
      return '已达到子代理的最大嵌套深度，无法继续创建子代理。';
    }

    const subAgent = new Agent(
      {
        provider: this.provider,
        tools: this.userTools,
        skills: this.skills,
        skillMode: this.skillMode,
        ...(this.systemPrompt !== undefined ? { systemPrompt: this.systemPrompt } : {}),
        ...(this.promptTemplate !== undefined ? { promptTemplate: this.promptTemplate } : {}),
        promptVariables: this.promptVariables,
        context: this.contextManager.options,
        session: new MemorySessionStore(),
        logger: this.logger,
        maxIterations: this.maxIterations,
        ...(this.onSuspend ? { onSuspend: this.onSuspend } : {}),
        maxSubAgentDepth: this.maxSubAgentDepth,
      },
      { depth: this.depth + 1 },
    );

    let output = '';
    for await (const event of subAgent.run({
      input: options.input,
      ...(options.system ? { system: options.system } : {}),
      signal: parent.signal,
    })) {
      if (event.type === 'text-delta') output += event.text;
      if (options.forwardEvents) buffer.push(stripMeta(event));
    }

    return output;
  }

  private async *maybeCompress(ctx: LoopContext): AsyncGenerator<AgentEvent> {
    if (!this.contextManager.shouldCompress(ctx.state.messages)) return;

    const result = await compressContext({
      provider: resolveProvider(this.provider),
      messages: ctx.state.messages,
      keepRecentMessages: this.contextManager.options.keepRecentMessages,
      maxToolResultLength: this.contextManager.options.maxToolResultLength,
      signal: ctx.signal,
    });
    if (!result.compressed) return;

    ctx.state.messages = result.messages;
    await this.sessionStore.set(ctx.state);
    yield ctx.factory.create({
      type: 'context-compressed',
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      summary: result.summary,
    });
  }

  private applySystemPrompt(state: SessionState, override?: string): void {
    const content = this.buildSystemPrompt(override);
    const first = state.messages[0];
    if (first && first.role === 'system') {
      // 上一次运行压缩出的摘要挂在 system 消息里，重建提示词时必须保留这段，
      // 否则每次 run 都会把摘要冲掉，压缩等于白做。
      const markerIndex = first.content.indexOf(SUMMARY_MARKER);
      first.content =
        markerIndex >= 0 ? `${content}\n\n${first.content.slice(markerIndex)}` : content;
    } else {
      state.messages.unshift({ role: 'system', content });
    }
  }

  private buildSystemPrompt(override?: string): string {
    const base =
      override ??
      (this.promptTemplate !== undefined
        ? renderPrompt(this.promptTemplate, this.promptVariables)
        : this.systemPrompt) ??
      DEFAULT_SYSTEM_PROMPT;

    const skillSection = this.buildSkillSection();
    return skillSection === '' ? base : `${base}\n\n${skillSection}`;
  }

  private buildSkillSection(): string {
    if (this.skills.length === 0) return '';

    if (this.skillMode === 'eager') {
      return [
        '# 可用技能',
        ...this.skills.map((skill) => `## ${skill.meta.name}\n${skill.content}`),
      ].join('\n\n');
    }

    const lines = this.skills.map((skill) => {
      const suffix = skill.meta.whenToUse ? `（适用场景：${skill.meta.whenToUse}）` : '';
      return `- ${skill.meta.name}：${skill.meta.description}${suffix}`;
    });

    return [
      '# 可用技能',
      '当任务与以下技能匹配时，先调用 load_skill 获取完整说明，再按说明执行：',
      ...lines,
    ].join('\n');
  }

  private createLoadSkillTool(): ToolDefinition<Record<string, unknown>> {
    return defineTool({
      name: 'load_skill',
      description: '加载指定技能的完整说明。当任务与某个可用技能匹配时，先调用本工具获取技能内容。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '要加载的技能名称' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      execute: (args) => {
        const name = stringifyValue(args.name);
        const skill = findSkill(this.skills, name);
        if (!skill) return toolError(`未找到技能：${name}`);
        return new ToolResult(skill.content, { name: skill.meta.name });
      },
    });
  }
}
