import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { ToolResult, defineTool, toolError, type ToolDefinition } from '@meowflow/core';
import { clip, globToRegExp, resolveWithinRoot, walkFiles } from './utils';

export interface FileToolOptions {
  /** 工作目录根，所有路径都相对它解析且不允许越界 */
  root: string;
  /** 单次读取返回的最大字符数 */
  maxReadLength?: number;
  /** 单次写入允许的最大字符数 */
  maxWriteLength?: number;
  /** 遍历时忽略的目录名 */
  ignoredDirs?: string[];
}

/** 创建文件系统工具集：read_file / write_file / list_dir / glob。 */
export function createFileTools(options: FileToolOptions): ToolDefinition[] {
  const root = resolve(options.root);
  const maxReadLength = options.maxReadLength ?? 40_000;
  const maxWriteLength = options.maxWriteLength ?? 400_000;
  const ignoredDirs = options.ignoredDirs;

  /** 解析路径，越界时返回可直接回填给模型的可读错误。 */
  const resolveOrError = (target: string): { path?: string; error?: ToolResult } => {
    try {
      return { path: resolveWithinRoot(root, target) };
    } catch (error) {
      return { error: toolError(error instanceof Error ? error.message : String(error)) };
    }
  };

  const readFileTool = defineTool({
    name: 'read_file',
    description: '读取工作目录内的文本文件，返回带行号的内容。大文件可用 offset/limit 分段读取。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作目录的文件路径' },
        offset: { type: 'integer', description: '起始行号，从 1 开始，默认 1' },
        limit: { type: 'integer', description: '最多读取的行数，默认读到结尾' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const rawPath = String(args.path ?? '');
      const resolved = resolveOrError(rawPath);
      if (resolved.error) return resolved.error;
      const filePath = resolved.path as string;

      const info = await stat(filePath).catch(() => undefined);
      if (!info) return toolError(`文件不存在：${rawPath}`);
      if (!info.isFile()) return toolError(`不是文件：${rawPath}`);

      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      const offset = Math.max(1, Number(args.offset ?? 1));
      const limit = args.limit === undefined ? lines.length : Math.max(1, Number(args.limit));
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join('\n');

      return new ToolResult(clip(numbered, maxReadLength), {
        path: relative(root, filePath).split('\\').join('/'),
        totalLines: lines.length,
        returnedLines: slice.length,
      });
    },
  });

  const writeFileTool = defineTool({
    name: 'write_file',
    description: '写入文本文件，自动创建上级目录。默认覆盖整个文件，append 为 true 时追加内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作目录的文件路径' },
        content: { type: 'string', description: '要写入的文本内容' },
        append: { type: 'boolean', description: '是否追加而不是覆盖，默认 false' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const rawPath = String(args.path ?? '');
      const content = String(args.content ?? '');
      if (content.length > maxWriteLength) {
        return toolError(`内容超过单次写入上限（${maxWriteLength} 字符）`);
      }

      const resolved = resolveOrError(rawPath);
      if (resolved.error) return resolved.error;
      const filePath = resolved.path as string;

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, args.append === true ? { flag: 'a' } : undefined);

      const relPath = relative(root, filePath).split('\\').join('/');
      const action = args.append === true ? '追加' : '写入';
      return new ToolResult(`已${action} ${relPath}（${content.length} 字符）`, {
        path: relPath,
        bytes: Buffer.byteLength(content, 'utf8'),
      });
    },
  });

  const listDirTool = defineTool({
    name: 'list_dir',
    description: '列出目录内容。recursive 为 true 时递归列出所有文件（相对路径）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作目录的目录路径，默认 .' },
        recursive: { type: 'boolean', description: '是否递归列出，默认 false' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const rawPath = String(args.path ?? '.');
      const resolved = resolveOrError(rawPath);
      if (resolved.error) return resolved.error;
      const dirPath = resolved.path as string;

      if (args.recursive === true) {
        const files = await walkFiles(rawPath, { root, ...(ignoredDirs ? { ignoredDirs } : {}) });
        return new ToolResult(files.length > 0 ? files.join('\n') : '（空目录）', {
          files,
          count: files.length,
        });
      }

      const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => undefined);
      if (!entries) return toolError(`目录不存在：${rawPath}`);

      const lines = entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort((a, b) => a.localeCompare(b));

      return new ToolResult(lines.length > 0 ? lines.join('\n') : '（空目录）', { entries: lines });
    },
  });

  const globTool = defineTool({
    name: 'glob',
    description: '按 glob 模式查找文件，支持 **、*、?，例如 src/**/*.ts。返回相对工作目录的路径。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式，例如 **/*.ts' },
        path: { type: 'string', description: '搜索起始目录，默认 .' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const pattern = String(args.pattern ?? '');
      const base = String(args.path ?? '.');
      if (pattern === '') return toolError('缺少 pattern 参数');
      const resolved = resolveOrError(base);
      if (resolved.error) return resolved.error;

      const allFiles = await walkFiles(base, { root, ...(ignoredDirs ? { ignoredDirs } : {}) });
      const prefix = base === '.' || base === '' ? '' : `${base.replace(/\/+$/, '')}/`;
      const matcher = globToRegExp(pattern);

      const matched = allFiles.filter((file) => {
        const scoped = file.startsWith(prefix) ? file.slice(prefix.length) : file;
        return matcher.test(scoped) || matcher.test(basename(scoped));
      });

      return new ToolResult(matched.length > 0 ? matched.join('\n') : '（未匹配到文件）', {
        files: matched,
        count: matched.length,
      });
    },
  });

  return [readFileTool, writeFileTool, listDirTool, globTool];
}
