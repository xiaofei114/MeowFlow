import { ToolResult, defineTool, toolError, type ToolDefinition } from '@meowflow/core';

export interface SubAgentToolOptions {
  /** 自定义工具名，默认 task */
  name?: string;
  /** 自定义工具描述 */
  description?: string;
  /** 是否把子代理的中间事件转发到父级事件流，默认 false */
  forwardEvents?: boolean;
}

/**
 * 创建 task 工具：把复杂子任务委派给独立上下文的子代理执行。
 *
 * 子代理由 Agent 运行时注入 `ctx.runSubAgent` 提供，受最大嵌套深度限制。
 */
export function createSubAgentTool(options: SubAgentToolOptions = {}): ToolDefinition[] {
  const forwardEvents = options.forwardEvents ?? false;

  const taskTool = defineTool({
    name: options.name ?? 'task',
    description:
      options.description ??
      '把一项独立的复杂子任务委派给子代理执行，返回其最终文本结论。适合需要多步探索、避免污染主上下文的任务。',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '子任务的一句话简述' },
        prompt: { type: 'string', description: '交给子代理的完整任务说明，需自包含' },
        system: { type: 'string', description: '可选的子代理系统提示词' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const prompt = String(args.prompt ?? '').trim();
      if (prompt === '') return toolError('缺少 prompt 参数');

      if (!ctx.runSubAgent) {
        return toolError('当前运行环境未启用子代理能力（缺少 runSubAgent）。');
      }

      const description = args.description === undefined ? undefined : String(args.description);
      const system = args.system === undefined ? undefined : String(args.system);

      const output = await ctx.runSubAgent({
        input: prompt,
        forwardEvents,
        ...(system !== undefined ? { system } : {}),
        ...(description !== undefined ? { metadata: { description } } : {}),
      });

      return new ToolResult(output === '' ? '（子代理未返回内容）' : output, {
        ...(description !== undefined ? { description } : {}),
        output,
      });
    },
  });

  return [taskTool];
}
