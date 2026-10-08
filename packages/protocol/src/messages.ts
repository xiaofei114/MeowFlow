/** 对话消息角色。 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 模型请求的工具调用。
 *
 * `arguments` 保持为原始 JSON 字符串，因为流式输出时参数是逐段拼装的，
 * 只有拼装完成后才解析成对象（见 `tool-call-end` 事件）。
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  /** 部分模型（如 DeepSeek-R1 / Claude）返回的思考内容。 */
  thinking?: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  toolCallId: string;
  name: string;
  /** 工具执行结果，统一序列化为字符串。 */
  content: string;
  isError?: boolean;
}

/** 会话中一条完整的消息，与 OpenAI Chat Completions 的形态保持一致。 */
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** 供模型解析的工具声明（JSON Schema 描述参数）。 */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
