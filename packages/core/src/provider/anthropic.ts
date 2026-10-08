import { SseParser } from '@xiaofeiqwq/protocol';
import type { Message, Usage } from '@xiaofeiqwq/protocol';
import { ProviderError, isAbortError } from '../errors';
import { normalizeBaseUrl, safeJsonParse } from '../utils';
import type { FetchLike } from './openai-compat';
import type { ChatParams, FinishReason, Provider, ProviderChunk } from './types';

export interface AnthropicOptions {
  model: string;
  apiKey: string;
  baseURL?: string;
  /** anthropic-version 头，默认 2023-06-01 */
  version?: string;
  /** max_tokens 为必填项，默认 4096 */
  maxTokens?: number;
  /** 开启扩展思考时的预算 token */
  thinkingBudget?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fetch?: FetchLike;
}

interface AnthropicBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

function parseToolInput(raw: string): unknown {
  const parsed = safeJsonParse(raw);
  return parsed.ok ? parsed.value : raw;
}

/** 把内部消息格式转换为 Anthropic Messages 格式。 */
export function toAnthropicMessages(messages: Message[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const result: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }

    if (message.role === 'user') {
      result.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (message.content !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseToolInput(call.arguments),
        });
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
      result.push({ role: 'assistant', content: blocks });
      continue;
    }

    // tool 结果必须作为 user 消息中的 tool_result 块，且连续的多个结果应合并
    const block: AnthropicBlock = {
      type: 'tool_result',
      tool_use_id: message.toolCallId,
      content: message.content,
    };
    if (message.isError) block.is_error = true;

    const last = result.at(-1);
    const mergeable =
      last !== undefined &&
      last.role === 'user' &&
      last.content.length > 0 &&
      last.content.every((item) => item.type === 'tool_result');

    if (last && mergeable) last.content.push(block);
    else result.push({ role: 'user', content: [block] });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: result,
  };
}

function normalizeStopReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool-calls';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content-filter';
    default:
      return 'unknown';
  }
}

/** Anthropic Claude 的 Provider。 */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly version: string;
  private readonly maxTokens: number;
  private readonly thinkingBudget?: number;
  private readonly headers: Record<string, string>;
  private readonly extraBody: Record<string, unknown>;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicOptions) {
    if (!options.model) throw new ProviderError('缺少 model 参数');
    if (!options.apiKey) throw new ProviderError('缺少 apiKey');
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.baseURL = normalizeBaseUrl(options.baseURL ?? 'https://api.anthropic.com/v1');
    this.version = options.version ?? '2023-06-01';
    this.maxTokens = options.maxTokens ?? 4096;
    this.thinkingBudget = options.thinkingBudget;
    this.headers = options.headers ?? {};
    this.extraBody = options.extraBody ?? {};
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async *chat(params: ChatParams): AsyncGenerator<ProviderChunk> {
    const response = await this.request(params);
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('模型响应缺少可读流');

    const decoder = new TextDecoder();
    const parser = new SseParser();
    let finishReason: FinishReason = 'unknown';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
          const result = this.parseEvent(payload);
          if (!result) continue;
          if (result.finishReason) finishReason = result.finishReason;
          if (result.inputTokens !== undefined) inputTokens = result.inputTokens;
          if (result.outputTokens !== undefined) outputTokens = result.outputTokens;
          for (const piece of result.chunks) yield piece;
        }
      }

      // 处理可能缺少结尾空行的最后一个事件块（通常是 message_delta / usage）。
      for (const payload of [...parser.push(decoder.decode()), ...parser.flush()]) {
        const result = this.parseEvent(payload);
        if (!result) continue;
        if (result.finishReason) finishReason = result.finishReason;
        if (result.inputTokens !== undefined) inputTokens = result.inputTokens;
        if (result.outputTokens !== undefined) outputTokens = result.outputTokens;
        for (const piece of result.chunks) yield piece;
      }
    } finally {
      reader.releaseLock();
    }

    const usage: Usage | undefined =
      inputTokens > 0 || outputTokens > 0
        ? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
        : undefined;

    yield { type: 'finish', reason: finishReason, usage };
  }

  private async request(params: ChatParams): Promise<Response> {
    const converted = toAnthropicMessages(params.messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: params.maxTokens ?? this.maxTokens,
      messages: converted.messages,
      stream: true,
    };
    if (converted.system !== undefined) body.system = converted.system;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }
    if (this.thinkingBudget !== undefined) {
      body.thinking = { type: 'enabled', budget_tokens: this.thinkingBudget };
    }

    Object.assign(body, this.extraBody);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-api-key': this.apiKey,
          'anthropic-version': this.version,
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (error) {
      // 主动中断不是错误，原样抛出，交由上层识别为 aborted
      if (isAbortError(error) || params.signal?.aborted) throw error;
      throw new ProviderError(`请求 Anthropic 失败：${(error as Error).message}`, { cause: error });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(`Anthropic 返回 ${response.status}：${detail.slice(0, 500)}`, {
        status: response.status,
        code: 'provider_http_error',
      });
    }

    return response;
  }

  private parseEvent(payload: string): {
    chunks: ProviderChunk[];
    finishReason?: FinishReason;
    inputTokens?: number;
    outputTokens?: number;
  } | null {
    const parsed = safeJsonParse(payload);
    if (!parsed.ok) return null;

    const data = parsed.value as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return null;

    const type = data.type;
    const chunks: ProviderChunk[] = [];

    switch (type) {
      case 'message_start': {
        const message = (data.message ?? {}) as Record<string, unknown>;
        const usage = (message.usage ?? {}) as Record<string, unknown>;
        return { chunks, inputTokens: Number(usage.input_tokens ?? 0) };
      }
      case 'content_block_start': {
        const block = (data.content_block ?? {}) as Record<string, unknown>;
        if (block.type === 'tool_use') {
          chunks.push({
            type: 'tool-call-delta',
            index: Number(data.index ?? 0),
            id: typeof block.id === 'string' ? block.id : undefined,
            name: typeof block.name === 'string' ? block.name : undefined,
          });
        }
        return { chunks };
      }
      case 'content_block_delta': {
        const delta = (data.delta ?? {}) as Record<string, unknown>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          chunks.push({ type: 'text-delta', text: delta.text });
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          chunks.push({ type: 'thinking-delta', text: delta.thinking });
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          chunks.push({
            type: 'tool-call-delta',
            index: Number(data.index ?? 0),
            argsDelta: delta.partial_json,
          });
        }
        return { chunks };
      }
      case 'message_delta': {
        const delta = (data.delta ?? {}) as Record<string, unknown>;
        const usage = (data.usage ?? {}) as Record<string, unknown>;
        return {
          chunks,
          finishReason: normalizeStopReason(
            typeof delta.stop_reason === 'string' ? delta.stop_reason : undefined,
          ),
          outputTokens: Number(usage.output_tokens ?? 0),
        };
      }
      case 'error': {
        const error = (data.error ?? {}) as Record<string, unknown>;
        throw new ProviderError(
          `Anthropic 流式错误：${String(error.message ?? JSON.stringify(error))}`,
          { code: 'provider_stream_error' },
        );
      }
      default:
        return { chunks };
    }
  }
}

/** 创建 Anthropic Provider。 */
export function anthropic(options: AnthropicOptions): AnthropicProvider {
  return new AnthropicProvider(options);
}
