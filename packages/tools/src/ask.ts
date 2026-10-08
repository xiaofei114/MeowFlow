import { defineTool, suspend, type ToolDefinition } from '@meowflow/core';

/** 向用户提问的挂起载荷，前端据此渲染交互表单。 */
export interface AskUserPayload {
  question: string;
  /** 预设选项，为空表示自由输入 */
  options?: string[];
  /** 是否允许选择多个选项 */
  multiple?: boolean;
  /** 补充说明 */
  detail?: string;
}

export interface AskToolOptions {
  /** 自定义工具名，默认 ask_user */
  name?: string;
  /** 自定义工具描述 */
  description?: string;
}

/**
 * 创建 ask_user 工具。
 *
 * 该工具不直接返回答案，而是通过挂起机制把问题交给前端：
 * 使用方通过 `resume(sessionId, callId, answer)` 提交用户答案后继续运行。
 */
export function createAskTool(options: AskToolOptions = {}): ToolDefinition[] {
  const askUserTool = defineTool({
    name: options.name ?? 'ask_user',
    description:
      options.description ??
      '当缺少必要信息、存在歧义或需要用户确认方案时，向用户提问并等待回答。可提供预设选项。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要询问用户的问题' },
        options: {
          type: 'array',
          description: '可选的候选项列表；不提供时由用户自由输入',
          items: { type: 'string' },
        },
        multiple: { type: 'boolean', description: '是否允许选择多个选项，默认 false' },
        detail: { type: 'string', description: '补充背景说明，帮助用户理解问题' },
      },
      required: ['question'],
      additionalProperties: false,
    },
    execute: (args) => {
      const question = String(args.question ?? '');
      const payload: AskUserPayload = { question };

      if (Array.isArray(args.options) && args.options.length > 0) {
        payload.options = args.options.map((item) => String(item));
      }
      if (args.multiple === true) payload.multiple = true;
      if (args.detail !== undefined) payload.detail = String(args.detail);

      // 交给外部回答，恢复时会用答案替换本次调用结果。
      return suspend('user-input', payload);
    },
  });

  return [askUserTool];
}
