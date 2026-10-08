import { type ToolDefinition } from '@xiaofeiqwq/core';
import { createAskTool, type AskToolOptions } from './ask';
import { createFileTools, type FileToolOptions } from './fs';
import { createHttpTools, type HttpToolOptions } from './http';
import { createSearchTools, type SearchToolOptions } from './search';
import { createShellTools, type ShellToolOptions } from './shell';
import { createSubAgentTool, type SubAgentToolOptions } from './subagent';

export * from './ask';
export * from './fs';
export * from './http';
export * from './search';
export * from './shell';
export * from './subagent';
export { clip, globToRegExp, resolveWithinRoot, walkFiles } from './utils';
export type { WalkOptions } from './utils';

/** 默认工具集的组合配置。 */
export interface DefaultToolsOptions {
  /** 文件与搜索类工具的工作目录根 */
  root: string;
  /** 启用的工具类别，默认全部启用 */
  enable?: {
    fs?: boolean;
    http?: boolean;
    shell?: boolean;
    search?: boolean;
    ask?: boolean;
    subagent?: boolean;
  };
  files?: Omit<FileToolOptions, 'root'>;
  search?: Omit<SearchToolOptions, 'root'>;
  http?: HttpToolOptions;
  shell?: ShellToolOptions;
  ask?: AskToolOptions;
  subagent?: SubAgentToolOptions;
}

/**
 * 按需组装一套内置工具，供 Agent 直接使用。
 *
 * 只做组合与默认值处理，各工具的实现与配置保持独立。
 */
export function createDefaultTools(options: DefaultToolsOptions): ToolDefinition[] {
  const enable = options.enable ?? {};
  const tools: ToolDefinition[] = [];

  if (enable.fs !== false) {
    tools.push(...createFileTools({ root: options.root, ...options.files }));
  }
  if (enable.search !== false) {
    tools.push(...createSearchTools({ root: options.root, ...options.search }));
  }
  if (enable.http !== false) {
    tools.push(...createHttpTools(options.http ?? {}));
  }
  if (enable.shell !== false) {
    tools.push(...createShellTools({ cwd: options.root, ...options.shell }));
  }
  if (enable.ask !== false) {
    tools.push(...createAskTool(options.ask ?? {}));
  }
  if (enable.subagent !== false) {
    tools.push(...createSubAgentTool(options.subagent ?? {}));
  }

  return tools;
}
