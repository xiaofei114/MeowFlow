import type { ToolCall } from '@meowflow/protocol';
import { isAbortError } from '../errors';
import { safeJsonParse, stringifyValue } from '../utils';
import type { ToolRegistry } from './registry';
import { ToolResult, isSuspend, isToolResult, type ToolContext, type ToolSuspend } from './types';

/** 工具执行的两种归宿：直接得到结果，或需要挂起等待外部输入。 */
export type ToolExecutionOutcome =
  { kind: 'result'; result: ToolResult } | { kind: 'suspend'; suspend: ToolSuspend };

export interface ExecuteToolOptions {
  call: ToolCall;
  registry: ToolRegistry;
  ctx: ToolContext;
}

/** 解析模型给出的工具参数，失败时返回可读错误。 */
export function parseToolArguments(raw: string): {
  args: Record<string, unknown>;
  error?: Error;
} {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) return { args: {}, error: parsed.error };
  const value = parsed.value;
  if (value === undefined || value === null) return { args: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { args: {}, error: new Error('工具参数必须是 JSON 对象') };
  }
  return { args: value as Record<string, unknown> };
}

/** 把工具返回值归一化为 ToolResult。 */
export function normalizeToolResult(value: unknown): ToolResult {
  if (isToolResult(value)) return value;
  if (value === undefined || value === null) return new ToolResult('');
  if (typeof value === 'string') return new ToolResult(value);
  return new ToolResult(stringifyValue(value), value);
}

/** 执行一次工具调用，内部吞掉异常并转为失败结果，保证主循环不中断。 */
export async function executeToolCall(options: ExecuteToolOptions): Promise<ToolExecutionOutcome> {
  const { call, registry, ctx } = options;
  const tool = registry.get(call.name);

  if (!tool) {
    return {
      kind: 'result',
      result: new ToolResult(`未找到名为 “${call.name}” 的工具。`, undefined, true),
    };
  }

  const { args, error } = parseToolArguments(call.arguments);
  if (error) {
    return {
      kind: 'result',
      result: new ToolResult(
        `工具 “${call.name}” 的参数解析失败：${error.message}`,
        undefined,
        true,
      ),
    };
  }

  try {
    const output = await tool.execute(args, ctx);
    if (isSuspend(output)) return { kind: 'suspend', suspend: output };
    return { kind: 'result', result: normalizeToolResult(output) };
  } catch (err) {
    if (isAbortError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(`工具 ${call.name} 执行失败`, { error: message });
    return { kind: 'result', result: new ToolResult(`工具执行失败：${message}`, undefined, true) };
  }
}
