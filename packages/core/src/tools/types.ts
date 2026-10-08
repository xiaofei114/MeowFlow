import type { AgentEvent, SuspendReason } from '@meowflow/protocol';
import type { Logger } from '../logger';

/** 对联合类型做分配式 Omit。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 工具内部可以推送的事件（元信息由框架补齐）。 */
export type ToolEmitEvent = DistributiveOmit<
  AgentEvent,
  'v' | 'runId' | 'sessionId' | 'seq' | 'ts'
>;

/** 子代理运行参数。 */
export interface SubAgentOptions {
  input: string;
  system?: string;
  /** 是否把子代理的事件转发到父级事件流，默认 false */
  forwardEvents?: boolean;
  metadata?: Record<string, unknown>;
}

/** 工具执行上下文。 */
export interface ToolContext {
  sessionId: string;
  runId: string;
  /** 中断信号，长耗时工具应当响应它 */
  signal: AbortSignal;
  logger: Logger;
  /** 工具内部推送事件（例如子代理的中间输出） */
  emit(event: ToolEmitEvent): void;
  /** 运行一个子代理并返回其文本结果，由 Agent 注入 */
  runSubAgent?(options: SubAgentOptions): Promise<string>;
  /** 透传的业务数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 工具执行结果，用于精细控制返回给模型与前端的内容。
 *
 * 使用类而非普通对象，避免与工具自身的业务对象（同样含 content 字段）混淆。
 */
export class ToolResult<Data = unknown> {
  /** 回填给模型的文本 */
  readonly content: string;
  /** 是否表示失败 */
  readonly isError: boolean;
  /** 回填给前端的结构化数据，缺省时前端使用 content */
  readonly data?: Data;

  constructor(content: string, data?: Data, isError = false) {
    this.content = content;
    this.data = data;
    this.isError = isError;
  }
}

/** 工具请求挂起，等待外部（用户输入或审批）后再继续。 */
export interface ToolSuspend {
  readonly __meowflowSuspend: true;
  reason: SuspendReason;
  payload: unknown;
}

const SUSPEND_FLAG = '__meowflowSuspend' as const;

/** 构造一个挂起信号。 */
export function suspend(reason: SuspendReason, payload?: unknown): ToolSuspend {
  return { [SUSPEND_FLAG]: true, reason, payload };
}

/** 判断返回值是否为挂起信号。 */
export function isSuspend(value: unknown): value is ToolSuspend {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[SUSPEND_FLAG] === true
  );
}

/** 判断返回值是否为 ToolResult。 */
export function isToolResult(value: unknown): value is ToolResult {
  return value instanceof ToolResult;
}

/** 构造 ToolResult 的语法糖。 */
export function toolResult<Data = unknown>(content: string, data?: Data): ToolResult<Data> {
  return new ToolResult(content, data);
}

/** 构造一个失败结果。 */
export function toolError(content: string): ToolResult {
  return new ToolResult(content, undefined, true);
}

export type MaybePromise<T> = T | Promise<T>;

/**
 * 工具定义。
 *
 * `execute` 的返回值会被框架归一化：
 * - 返回字符串 → 直接作为内容
 * - 返回对象 → 序列化为 JSON 文本
 * - 返回 `toolResult(...)` → 精细控制内容与前端数据
 * - 返回 `suspend(...)` → 挂起等待外部处理
 */
export interface ToolDefinition<Args extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema 参数描述，会原样交给模型 */
  parameters: Record<string, unknown>;
  execute(args: Args, ctx: ToolContext): MaybePromise<unknown>;
  /** 执行前是否需要用户审批（走挂起机制） */
  requiresApproval?: boolean;
  /** 审批提示文案，缺省时使用通用提示 */
  approvalPrompt?: (args: Args) => string;
  /** 是否对模型隐藏（仅内部调用，例如 load_skill） */
  hidden?: boolean;
}

/** 定义工具，并提供参数类型推断。 */
export function defineTool<Args extends Record<string, unknown> = Record<string, unknown>>(
  definition: ToolDefinition<Args>,
): ToolDefinition<Args> {
  return definition;
}
