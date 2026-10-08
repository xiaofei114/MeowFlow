import type { Message, ToolSpec, Usage } from '@xiaofeiqwq/protocol';

/** 结束原因，各 Provider 需归一到该集合。 */
export type FinishReason =
  'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error' | 'unknown';

export interface TextDeltaChunk {
  type: 'text-delta';
  text: string;
}

export interface ThinkingDeltaChunk {
  type: 'thinking-delta';
  text: string;
}

/**
 * 工具调用增量。
 *
 * 同一轮回复中工具调用按 `index` 分组，参数通过多次 `argsDelta` 拼装。
 */
export interface ToolCallDeltaChunk {
  type: 'tool-call-delta';
  index: number;
  id?: string;
  name?: string;
  argsDelta?: string;
}

export interface FinishChunk {
  type: 'finish';
  reason: FinishReason;
  usage?: Usage;
}

export type ProviderChunk = TextDeltaChunk | ThinkingDeltaChunk | ToolCallDeltaChunk | FinishChunk;

export interface ChatParams {
  messages: Message[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** 模型服务适配器。实现该接口即可接入任意模型。 */
export interface Provider {
  /** 供应商标识，例如 openai / anthropic */
  readonly name: string;
  /** 模型名 */
  readonly model: string;
  /** 以流式方式发起一次对话 */
  chat(params: ChatParams): AsyncIterable<ProviderChunk>;
}

/** 允许惰性创建 Provider，便于每个会话使用不同模型。 */
export type ProviderInput = Provider | (() => Provider);

export function resolveProvider(input: ProviderInput): Provider {
  return typeof input === 'function' ? input() : input;
}
