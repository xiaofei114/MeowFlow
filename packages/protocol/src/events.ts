import type { AssistantMessage } from './messages';
import type { Usage } from './usage';
import type { ProtocolVersion } from './version';

/** 一次 Agent 运行的最终状态。 */
export type RunStatus = 'completed' | 'suspended' | 'aborted' | 'error';

/** 工具挂起原因：等待用户输入，或等待危险操作审批。 */
export type SuspendReason = 'user-input' | 'approval';

/** 工具执行结果状态。 */
export type ToolResultStatus = 'ok' | 'error';

/** 所有事件共有的元信息，用于前端排序、过滤与断线续传。 */
export interface EventMeta {
  /** 协议版本 */
  v: ProtocolVersion;
  /** 本次运行 id，同一会话的多次运行不同 */
  runId: string;
  /** 会话 id，跨多次运行稳定 */
  sessionId: string;
  /** 单调递增序号，从 0 开始 */
  seq: number;
  /** 事件产生时间戳（毫秒） */
  ts: number;
}

export interface RunStartEvent extends EventMeta {
  type: 'run-start';
  model: string;
  /** 本次运行是否为挂起后的恢复 */
  resumed: boolean;
}

export interface MessageStartEvent extends EventMeta {
  type: 'message-start';
  role: 'assistant';
}

export interface ThinkingDeltaEvent extends EventMeta {
  type: 'thinking-delta';
  text: string;
}

export interface TextDeltaEvent extends EventMeta {
  type: 'text-delta';
  text: string;
}

export interface ToolCallStartEvent extends EventMeta {
  type: 'tool-call-start';
  callId: string;
  name: string;
}

export interface ToolCallArgsDeltaEvent extends EventMeta {
  type: 'tool-call-args-delta';
  callId: string;
  delta: string;
}

export interface ToolCallEndEvent extends EventMeta {
  type: 'tool-call-end';
  callId: string;
  name: string;
  /** 解析后的参数对象；解析失败时为原始字符串。 */
  args: unknown;
}

export interface ToolCallResultEvent extends EventMeta {
  type: 'tool-call-result';
  callId: string;
  name: string;
  status: ToolResultStatus;
  result: unknown;
  durationMs: number;
}

export interface ToolCallSuspendEvent extends EventMeta {
  type: 'tool-call-suspend';
  callId: string;
  name: string;
  reason: SuspendReason;
  /** 挂起上下文，例如 ask_user 的问题列表。 */
  payload: unknown;
}

export interface ContextCompressedEvent extends EventMeta {
  type: 'context-compressed';
  beforeTokens: number;
  afterTokens: number;
  summary: string;
}

export interface UsageEvent extends EventMeta {
  type: 'usage';
  usage: Usage;
}

export interface ErrorEvent extends EventMeta {
  type: 'error';
  code: string;
  message: string;
}

export interface MessageEndEvent extends EventMeta {
  type: 'message-end';
  message: AssistantMessage;
}

export interface RunEndEvent extends EventMeta {
  type: 'run-end';
  status: RunStatus;
  /** 挂起时的待处理调用 id，便于客户端直接回传答案 */
  suspendCallId?: string;
  usage?: Usage;
}

/** 服务端推送给前端的全部事件。 */
export type AgentEvent =
  | RunStartEvent
  | MessageStartEvent
  | ThinkingDeltaEvent
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolCallArgsDeltaEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | ToolCallSuspendEvent
  | ContextCompressedEvent
  | UsageEvent
  | ErrorEvent
  | MessageEndEvent
  | RunEndEvent;

/** 所有事件类型字面量。 */
export type AgentEventType = AgentEvent['type'];

/** 按 type 收窄事件类型。 */
export type AgentEventOf<T extends AgentEventType> = Extract<AgentEvent, { type: T }>;
