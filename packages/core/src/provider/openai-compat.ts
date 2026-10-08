import { SseParser } from '@meowflow/protocol';
import type { Message, Usage } from '@meowflow/protocol';
import { ProviderError, isAbortError } from '../errors';
import { normalizeBaseUrl, safeJsonParse } from '../utils';
import type { ChatParams, FinishReason, Provider, ProviderChunk } from './types';

/** 可注入的 fetch 实现，便于测试或接入自定义代理。 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAICompatOptions {
  /** 模型名，例如 gpt-4o-mini / deepseek-chat / qwen-plus */
  model: string;
  apiKey?: string;
  /** 接口地址，默认 OpenAI 官方；兼容 OpenAI 协议的服务填各自地址即可 */
  baseURL?: string;
  /** 供应商标识，仅用于展示与日志 */
  name?: string;
  headers?: Record<string, string>;
  /** 是否请求 usage 统计（stream_options.include_usage），个别网关不支持可关闭 */
  includeUsage?: boolean;
  /** 追加/覆盖请求体字段，用于适配各家私有参数 */
  extraBody?: Record<string, unknown>;
  /** 自定义 fetch */
  fetch?: FetchLike;
  /** 思考内容所在字段名，默认自动识别 reasoning_content 与 reasoning */
  reasoningField?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** 把统一的内部消息格式转换为 OpenAI Chat Completions 格式。 */
export function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((message): OpenAIMessage => {
    switch (message.role) {
      case 'system':
        return { role: 'system', content: message.content };
      case 'user':
        return { role: 'user', content: message.content };
      case 'assistant': {
        const hasTools = Boolean(message.toolCalls && message.toolCalls.length > 0);
        const result: OpenAIMessage = {
          role: 'assistant',
          content: hasTools && message.content === '' ? null : message.content,
        };
        if (hasTools && message.toolCalls) {
          result.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          }));
        }
        return result;
      }
      case 'tool':
        return {
          role: 'tool',
          content: message.content,
          tool_call_id: message.toolCallId,
        };
    }
  });
}

function normalizeFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
    case 'function_call':
      return 'tool-calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content-filter';
    case 'error':
      return 'error';
    default:
      return 'unknown';
  }
}

function parseUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const input = Number(record.prompt_tokens ?? 0);
  const output = Number(record.completion_tokens ?? 0);
  const total = Number(record.total_tokens ?? input + output);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return undefined;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

/**
 * OpenAI 兼容协议的 Provider。
 *
 * 覆盖 OpenAI、DeepSeek、通义千问、Kimi、智谱、Ollama、vLLM 等绝大多数服务，
 * 差异部分通过 `baseURL` / `extraBody` / `reasoningField` 配置即可适配。
 */
export class OpenAICompatProvider implements Provider {
  readonly name: string;
  readonly model: string;

  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly includeUsage: boolean;
  private readonly extraBody: Record<string, unknown>;
  private readonly fetchImpl: FetchLike;
  private readonly reasoningFields: string[];

  constructor(options: OpenAICompatOptions) {
    if (!options.model) throw new ProviderError('缺少 model 参数');
    this.model = options.model;
    this.name = options.name ?? 'openai-compat';
    this.baseURL = normalizeBaseUrl(options.baseURL ?? 'https://api.openai.com/v1');
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.includeUsage = options.includeUsage ?? true;
    this.extraBody = options.extraBody ?? {};
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.reasoningFields = options.reasoningField
      ? [options.reasoningField]
      : ['reasoning_content', 'reasoning'];
  }

  async *chat(params: ChatParams): AsyncGenerator<ProviderChunk> {
    const response = await this.request(params);

    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('模型响应缺少可读流');

    const decoder = new TextDecoder();
    const parser = new SseParser();
    let finishReason: FinishReason = 'unknown';
    let usage: Usage | undefined;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
          const chunk = this.parseChunk(payload);
          if (!chunk) continue;
          if (chunk.finishReason) finishReason = chunk.finishReason;
          if (chunk.usage) usage = chunk.usage;
          for (const piece of chunk.chunks) yield piece;
        }
      }

      for (const payload of [...parser.push(decoder.decode()), ...parser.flush()]) {
        const chunk = this.parseChunk(payload);
        if (!chunk) continue;
        if (chunk.finishReason) finishReason = chunk.finishReason;
        if (chunk.usage) usage = chunk.usage;
        for (const piece of chunk.chunks) yield piece;
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'finish', reason: finishReason, usage };
  }

  private async request(params: ChatParams): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(params.messages),
      stream: true,
    };

    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (this.includeUsage) body.stream_options = { include_usage: true };
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    Object.assign(body, this.extraBody);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...this.headers,
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (error) {
      // 主动中断不是错误，原样抛出，交由上层识别为 aborted
      if (isAbortError(error) || params.signal?.aborted) throw error;
      throw new ProviderError(`请求模型服务失败：${(error as Error).message}`, { cause: error });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(`模型服务返回 ${response.status}：${detail.slice(0, 500)}`, {
        status: response.status,
        code: 'provider_http_error',
      });
    }

    return response;
  }

  private parseChunk(payload: string): {
    chunks: ProviderChunk[];
    finishReason?: FinishReason;
    usage?: Usage;
  } | null {
    if (payload === '[DONE]') return null;

    const parsed = safeJsonParse(payload);
    if (!parsed.ok) return null;

    const data = parsed.value as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return null;

    if (data.error) {
      const error = data.error as Record<string, unknown>;
      throw new ProviderError(
        `模型服务返回错误：${String(error.message ?? JSON.stringify(error))}`,
        { code: 'provider_stream_error' },
      );
    }

    const chunks: ProviderChunk[] = [];
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const choice = choices[0] as Record<string, unknown> | undefined;

    if (choice) {
      const delta = (choice.delta ?? {}) as Record<string, unknown>;

      const reasoning = this.readReasoning(delta);
      if (reasoning) chunks.push({ type: 'thinking-delta', text: reasoning });

      const content = delta.content;
      if (typeof content === 'string' && content !== '') {
        chunks.push({ type: 'text-delta', text: content });
      }

      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const raw of toolCalls) {
        const call = raw as Record<string, unknown>;
        const fn = (call.function ?? {}) as Record<string, unknown>;
        const index = typeof call.index === 'number' ? call.index : 0;
        const deltaChunk: ProviderChunk = { type: 'tool-call-delta', index };
        if (typeof call.id === 'string') deltaChunk.id = call.id;
        if (typeof fn.name === 'string' && fn.name !== '') deltaChunk.name = fn.name;
        if (typeof fn.arguments === 'string' && fn.arguments !== '')
          deltaChunk.argsDelta = fn.arguments;
        chunks.push(deltaChunk);
      }
    }

    const result: { chunks: ProviderChunk[]; finishReason?: FinishReason; usage?: Usage } = {
      chunks,
    };

    if (choice && typeof choice.finish_reason === 'string') {
      result.finishReason = normalizeFinishReason(choice.finish_reason);
    }

    const parsedUsage = parseUsage(data.usage);
    if (parsedUsage) result.usage = parsedUsage;

    return result;
  }

  private readReasoning(delta: Record<string, unknown>): string | undefined {
    for (const field of this.reasoningFields) {
      const value = delta[field];
      if (typeof value === 'string' && value !== '') return value;
    }
    return undefined;
  }
}

/** 创建 OpenAI 兼容 Provider。 */
export function openaiCompat(options: OpenAICompatOptions): OpenAICompatProvider {
  return new OpenAICompatProvider(options);
}

/**
 * 常见服务商的 baseURL 预设，直接填 `preset: 'deepseek'` 即可。
 */
export const OPENAI_COMPAT_PRESETS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  siliconflow: 'https://api.siliconflow.cn/v1',
  ollama: 'http://localhost:11434/v1',
  vllm: 'http://localhost:8000/v1',
};
