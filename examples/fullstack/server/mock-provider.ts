import type { ChatParams, Message, Provider, ProviderChunk } from '@meowflow/core';

/**
 * Demo 用的 mock provider。
 *
 * 它不访问任何网络，按帧吐出假数据，用于在**没有 API Key** 的情况下
 * 也能完整体验流式输出、思考过程、工具调用与挂起交互。
 * 只需实现 `Provider` 接口即可接入，这也印证了框架的适配层是开放的。
 */
export interface MockProviderOptions {
  /** 模型名，仅用于界面展示 */
  model?: string;
  /** 每个增量片段之间的延迟（毫秒），用于演示流式效果 */
  delayMs?: number;
}

const TEXT_CHUNK_SIZE = 2;

const DEFAULT_TEXT = `这是 MeowFlow Demo 的模拟回复。

当前没有检测到 OPENAI_API_KEY，因此由内置的 mock provider 生成内容，用来演示流式输出、思考过程、工具调用与挂起交互。

你可以试试这几句：
「帮我看看当前目录下有哪些文件」—— 触发一次内置工具调用
「北京天气怎么样」—— 触发自定义工具 get_weather
「我该选哪个方案」—— 触发挂起提问，等待你在界面里作答

配置真实模型的 API Key 后，会切换成真正的模型。`;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 中断时抛出名称为 AbortError 的错误，交由框架识别为主动中断。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('运行已被中断');
    error.name = 'AbortError';
    throw error;
  }
}

function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user') return message.content;
  }
  return '';
}

/** 最后一条 user 消息之后是否已经产生了工具结果（用于判断该收尾还是继续）。 */
function hasToolResultAfterLastUser(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    if (message.role === 'user') return false;
    if (message.role === 'tool') return true;
  }
  return false;
}

function lastToolResult(messages: Message[]): { name: string; content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    if (message.role === 'tool') return { name: message.name, content: message.content };
    if (message.role === 'user') return undefined;
  }
  return undefined;
}

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content.length;
    if (message.role === 'assistant' && message.thinking) chars += message.thinking.length;
  }
  return Math.max(1, Math.round(chars / 2));
}

function splitText(text: string, size = TEXT_CHUNK_SIZE): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断）`;
}

type MockScript =
  | { kind: 'text'; thinking: string; text: string }
  | { kind: 'tool'; thinking: string; toolName: string; args: Record<string, unknown> };

function summarize(tool: { name: string; content: string } | undefined): string {
  const content = clip(tool?.content ?? '', 600);
  switch (tool?.name) {
    case 'list_dir':
      return `我查看了当前目录，内容如下：\n\n${content}\n\n需要我读取其中某个文件，或者继续做点别的吗？`;
    case 'ask_user':
      return `收到你的选择：${content}\n\n很好，我们就按这个方向继续。`;
    case 'get_weather':
      return `工具返回：${content}\n\n需要我查别的城市吗？`;
    default:
      return `工具返回结果：\n\n${content}`;
  }
}

function buildScript(
  userText: string,
  afterTool: boolean,
  tool: { name: string; content: string } | undefined,
): MockScript {
  // 工具已经执行过：这一轮只做总结，避免无限调用工具。
  if (afterTool) {
    return {
      kind: 'text',
      thinking: '工具已经返回结果，我来整理一下给用户。',
      text: summarize(tool),
    };
  }

  if (/选择|哪个|方案|该选/.test(userText)) {
    return {
      kind: 'tool',
      thinking: '这是一个需要用户拍板的问题，我先用 ask_user 问清楚偏好。',
      toolName: 'ask_user',
      args: {
        question: '你更倾向于哪个方案？',
        options: ['方案 A：快速上线', '方案 B：稳健重构', '方案 C：先小范围试点'],
        multiple: false,
        detail: '这是 Demo 的演示问题，随便选一个即可。',
      },
    };
  }

  if (/天气|气温|weather/i.test(userText)) {
    return {
      kind: 'tool',
      thinking: '用户问天气，我调用自定义工具 get_weather。',
      toolName: 'get_weather',
      args: { city: '北京' },
    };
  }

  if (/文件|目录|file|dir|folder/i.test(userText)) {
    return {
      kind: 'tool',
      thinking: '用户想看目录内容，我调用 list_dir 工具。',
      toolName: 'list_dir',
      args: { path: '.' },
    };
  }

  return {
    kind: 'text',
    thinking: '这是一个普通问题，我组织一段说明作为回答。',
    text: DEFAULT_TEXT,
  };
}

class MockProvider implements Provider {
  readonly name = 'mock';
  readonly model: string;

  private readonly delayMs: number;
  private callSeq = 0;

  constructor(options: MockProviderOptions = {}) {
    this.model = options.model ?? 'mock-agent';
    this.delayMs = options.delayMs ?? 16;
  }

  async *chat(params: ChatParams): AsyncGenerator<ProviderChunk> {
    const { messages, signal } = params;
    const afterTool = hasToolResultAfterLastUser(messages);
    const tool = lastToolResult(messages);
    const script = buildScript(lastUserText(messages), afterTool, tool);
    const inputTokens = estimateTokens(messages);
    let output = '';

    throwIfAborted(signal);

    for (const text of splitText(script.thinking)) {
      throwIfAborted(signal);
      await sleep(this.delayMs);
      output += text;
      yield { type: 'thinking-delta', text };
    }

    if (script.kind === 'tool') {
      this.callSeq += 1;
      const id = `call_mock_${this.callSeq}`;
      yield { type: 'tool-call-delta', index: 0, id, name: script.toolName };
      await sleep(this.delayMs);
      const argsDelta = JSON.stringify(script.args);
      output += argsDelta;
      yield { type: 'tool-call-delta', index: 0, argsDelta };
      yield {
        type: 'finish',
        reason: 'tool-calls',
        usage: this.usage(inputTokens, output),
      };
      return;
    }

    for (const text of splitText(script.text)) {
      throwIfAborted(signal);
      await sleep(this.delayMs);
      output += text;
      yield { type: 'text-delta', text };
    }

    yield { type: 'finish', reason: 'stop', usage: this.usage(inputTokens, output) };
  }

  private usage(
    inputTokens: number,
    output: string,
  ): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } {
    const outputTokens = Math.max(1, Math.round(output.length / 2));
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }
}

/** 创建一个无需网络、开箱即用的 mock provider。 */
export function createMockProvider(options: MockProviderOptions = {}): Provider {
  return new MockProvider(options);
}
