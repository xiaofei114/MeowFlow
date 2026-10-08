import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ToolResult, defineTool, toolError, type ToolDefinition } from '@meowflow/core';
import { clip, globToRegExp, walkFiles } from './utils';

export interface SearchToolOptions {
  /** 工作目录根 */
  root: string;
  /** 最多返回的匹配行数，默认 200 */
  maxResults?: number;
  /** 遍历时忽略的目录名 */
  ignoredDirs?: string[];
  /** 单文件读取上限（字节），超过则跳过 */
  maxFileSize?: number;
}

interface MatchLine {
  file: string;
  line: number;
  text: string;
}

/** 简单判断是否为二进制内容：出现 NUL 字节即视为二进制。 */
function looksBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 8000);
  for (let i = 0; i < length; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** 创建代码搜索工具集：search_code。 */
export function createSearchTools(options: SearchToolOptions): ToolDefinition[] {
  const root = resolve(options.root);
  const maxResults = options.maxResults ?? 200;
  const ignoredDirs = options.ignoredDirs;
  const maxFileSize = options.maxFileSize ?? 1_000_000;

  const searchCodeTool = defineTool({
    name: 'search_code',
    description:
      '在工作目录内按正则搜索代码内容，返回 文件:行号:内容。可用 glob 限定文件范围，例如 src/**/*.ts。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式，例如 function\\s+\\w+' },
        path: { type: 'string', description: '搜索起始目录，默认 .' },
        glob: { type: 'string', description: '文件过滤 glob，例如 **/*.ts' },
        ignoreCase: { type: 'boolean', description: '是否忽略大小写，默认 false' },
        maxResults: { type: 'integer', description: '最多返回的匹配行数' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const rawPattern = String(args.pattern ?? '');
      if (rawPattern === '') return toolError('缺少 pattern 参数');

      let regex: RegExp;
      try {
        regex = new RegExp(rawPattern, args.ignoreCase === true ? 'i' : '');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolError(`无效的正则表达式：${message}`);
      }

      const base = String(args.path ?? '.');
      const fileFilter = args.glob === undefined ? undefined : globToRegExp(String(args.glob));
      const limit = Math.max(1, Number(args.maxResults ?? maxResults));

      const files = await walkFiles(base, { root, ...(ignoredDirs ? { ignoredDirs } : {}) });
      const matches: MatchLine[] = [];
      let scanned = 0;

      for (const file of files) {
        if (matches.length >= limit) break;
        if (fileFilter && !fileFilter.test(file)) continue;

        const absolute = resolve(root, file);
        const content = await readFile(absolute).catch(() => undefined);
        if (!content) continue;
        if (content.byteLength > maxFileSize) continue;
        if (looksBinary(content)) continue;

        scanned += 1;
        const lines = content.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? '';
          if (regex.test(line)) {
            matches.push({ file, line: i + 1, text: line.trim() });
            if (matches.length >= limit) break;
          }
        }
      }

      if (matches.length === 0) {
        return new ToolResult('（未匹配到内容）', { matches: [], count: 0 });
      }

      const rendered = matches
        .map((match) => `${match.file}:${match.line}: ${match.text}`)
        .join('\n');

      return new ToolResult(clip(rendered, 40_000), {
        matches,
        count: matches.length,
        scannedFiles: scanned,
        truncated: matches.length >= limit,
      });
    },
  });

  return [searchCodeTool];
}
