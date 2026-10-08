import type { Message } from '@meowflow/protocol';
import type { Provider } from './provider/types';
import { truncate } from './utils';

const CJK_PATTERN = /[\u3000-\u9fff\uff00-\uffef]/g;
const MESSAGE_OVERHEAD = 4;

/**
 * 启发式 token 估算：CJK 字符约 1 token/字，其余约 4 字符/token。
 *
 * 不引入分词器依赖，误差对“是否触发压缩”这一判断已经足够。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_PATTERN) ?? []).length;
  return Math.ceil(cjkCount + (text.length - cjkCount) / 4);
}

/** 估算单条消息的 token。 */
export function estimateMessageTokens(message: Message): number {
  let tokens = MESSAGE_OVERHEAD;
  if (message.role === 'assistant') {
    tokens += estimateTokens(message.content);
    if (message.thinking) tokens += estimateTokens(message.thinking);
    for (const call of message.toolCalls ?? []) {
      tokens += estimateTokens(call.name) + estimateTokens(call.arguments) + 4;
    }
  } else {
    tokens += estimateTokens(message.content);
  }
  return tokens;
}

/** 估算一组消息的总 token。 */
export function estimateMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total;
}

export interface ContextOptions {
  /** 上下文窗口上限 */
  maxTokens: number;
  /** 触发压缩的阈值比例（0~1） */
  compressThreshold: number;
  /** 压缩时保留的最近消息条数 */
  keepRecentMessages: number;
  /** 压缩历史时，单条工具结果参与摘要的最大字符数 */
  maxToolResultLength: number;
}

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = {
  maxTokens: 128_000,
  compressThreshold: 0.8,
  keepRecentMessages: 8,
  maxToolResultLength: 2_000,
};

/** 上下文管理器：负责 token 估算与压缩触发判断。 */
export class ContextManager {
  readonly options: ContextOptions;

  constructor(options: Partial<ContextOptions> = {}) {
    this.options = { ...DEFAULT_CONTEXT_OPTIONS, ...options };
  }

  /** 触发压缩的 token 阈值。 */
  get threshold(): number {
    return Math.floor(this.options.maxTokens * this.options.compressThreshold);
  }

  estimate(messages: Message[]): number {
    return estimateMessagesTokens(messages);
  }

  shouldCompress(messages: Message[]): boolean {
    return this.estimate(messages) > this.threshold;
  }
}

export interface CompressOptions {
  provider: Provider;
  messages: Message[];
  keepRecentMessages: number;
  maxToolResultLength: number;
  signal?: AbortSignal;
}

export interface CompressResult {
  messages: Message[];
  summary: string;
  beforeTokens: number;
  afterTokens: number;
  /** 是否真正发生了压缩 */
  compressed: boolean;
}

const SUMMARY_SYSTEM_PROMPT =
  '你是上下文压缩助手。把给定的对话历史压缩成简洁要点，保留：已确认的事实与结论、用户的关键需求与偏好、已完成的操作及工具结果要点、尚未完成的任务。不要编造内容，不要寒暄，直接输出要点。';

/** 摘要段在 system 消息中的标记；后续运行重建系统提示时要原样保留这一段。 */
export const SUMMARY_MARKER = '【历史对话摘要】';

/**
 * 用一次模型调用把早期对话压缩为摘要，并保留最近的若干条消息。
 *
 * 切分点会对齐到 user 消息，避免把 assistant 的工具调用与其 tool 结果拆开。
 */
export async function compressContext(options: CompressOptions): Promise<CompressResult> {
  const { messages, keepRecentMessages, maxToolResultLength, signal } = options;
  const beforeTokens = estimateMessagesTokens(messages);

  const systemMessages: Message[] = [];
  let cursor = 0;
  while (cursor < messages.length && messages[cursor]?.role === 'system') {
    const message = messages[cursor];
    if (message) systemMessages.push(message);
    cursor += 1;
  }

  // 从“保留最近 N 条”的位置向前对齐到最近的 user 消息，
  // 保证 recent 一定以 user 开头，不会把工具调用与其结果拆开。
  let splitIndex = Math.max(cursor, messages.length - keepRecentMessages);
  while (splitIndex > cursor && messages[splitIndex]?.role !== 'user') {
    splitIndex -= 1;
  }

  const middle = messages.slice(cursor, splitIndex);
  const recent = messages.slice(splitIndex);

  if (middle.length === 0) {
    return { messages, summary: '', beforeTokens, afterTokens: beforeTokens, compressed: false };
  }

  const serialized = serializeMessages(middle, maxToolResultLength);
  let summary = '';

  for await (const chunk of options.provider.chat({
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `对话历史：\n\n${serialized}` },
    ],
    ...(signal ? { signal } : {}),
  })) {
    if (chunk.type === 'text-delta') summary += chunk.text;
  }

  summary = summary.trim();
  if (summary === '') {
    return { messages, summary: '', beforeTokens, afterTokens: beforeTokens, compressed: false };
  }

  const systemContent = [
    ...systemMessages.map((message) => message.content),
    `${SUMMARY_MARKER}\n${summary}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');

  const compressedMessages: Message[] = [{ role: 'system', content: systemContent }, ...recent];
  const afterTokens = estimateMessagesTokens(compressedMessages);

  return { messages: compressedMessages, summary, beforeTokens, afterTokens, compressed: true };
}

function serializeMessages(messages: Message[], maxToolResultLength: number): string {
  return messages
    .map((message) => {
      switch (message.role) {
        case 'system':
          return `[system] ${message.content}`;
        case 'user':
          return `[user] ${message.content}`;
        case 'assistant': {
          const parts: string[] = [];
          if (message.thinking) parts.push(`(思考) ${truncate(message.thinking, 500)}`);
          if (message.content) parts.push(message.content);
          for (const call of message.toolCalls ?? []) {
            parts.push(`(调用工具 ${call.name}) ${truncate(call.arguments, 500)}`);
          }
          return `[assistant] ${parts.join(' ')}`;
        }
        case 'tool':
          return `[tool:${message.name}] ${truncate(message.content, maxToolResultLength)}`;
      }
    })
    .join('\n');
}
