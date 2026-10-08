import { describe, expect, it } from 'vitest';
import type { ToolContext, ToolDefinition, ToolResult } from '@meowflow/core';
import { createShellTools } from '../src/index';

const stubContext: ToolContext = {
  sessionId: 's',
  runId: 'r',
  signal: new AbortController().signal,
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
  emit: () => undefined,
};

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`未找到工具：${name}`);
  return tool;
}

describe('Shell 工具', () => {
  it('黑名单会识别空格与路径前缀等绕过写法', async () => {
    const run = findTool(createShellTools({ cwd: process.cwd() }), 'run_command');
    const commands = ['rm -rf /', 'rm    -rf /tmp', '/bin/rm -rf /tmp', 'RM -RF /tmp'];

    for (const command of commands) {
      const result = (await run.execute({ command }, stubContext)) as ToolResult;
      expect(result.isError).toBe(true);
      expect(result.content).toContain('危险前缀');
    }
  });
});
