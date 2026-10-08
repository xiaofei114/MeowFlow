import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolResult, type ToolContext, type ToolDefinition } from '@xiaofeiqwq/core';
import {
  createFileTools,
  createSearchTools,
  globToRegExp,
  resolveWithinRoot,
  walkFiles,
} from '../src/index';

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`未找到工具：${name}`);
  return tool;
}

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

describe('globToRegExp', () => {
  it('支持 **、*、?', () => {
    expect(globToRegExp('**/*.ts').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
  });
});

describe('resolveWithinRoot', () => {
  it('拒绝越界路径', () => {
    expect(() => resolveWithinRoot('/work', '../secret')).toThrow();
    expect(resolveWithinRoot('/work', 'a/b.txt').replace(/\\/g, '/')).toContain('/work/a/b.txt');
  });
});

describe('文件系统工具', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'meowflow-fs-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('write_file 与 read_file 往返', async () => {
    const tools = createFileTools({ root });
    const write = findTool(tools, 'write_file');
    const read = findTool(tools, 'read_file');

    await write.execute({ path: 'notes/a.txt', content: '第一行\n第二行' }, stubContext);
    expect(await readFile(join(root, 'notes/a.txt'), 'utf8')).toBe('第一行\n第二行');

    const result = await read.execute({ path: 'notes/a.txt' }, stubContext);
    expect(result).toBeInstanceOf(ToolResult);
    expect((result as ToolResult).content).toContain('第一行');
    expect((result as ToolResult).content).toContain('第二行');
  });

  it('read_file 支持 offset 与 limit', async () => {
    const tools = createFileTools({ root });
    const read = findTool(tools, 'read_file');

    const result = (await read.execute(
      { path: 'notes/a.txt', offset: 2, limit: 1 },
      stubContext,
    )) as ToolResult;
    expect(result.content).toContain('第二行');
    expect(result.content).not.toContain('第一行');
  });

  it('list_dir 递归列出文件', async () => {
    const tools = createFileTools({ root });
    const list = findTool(tools, 'list_dir');

    const result = (await list.execute({ path: '.', recursive: true }, stubContext)) as ToolResult;
    expect(result.data).toMatchObject({ files: ['notes/a.txt'] });
  });

  it('glob 匹配文件', async () => {
    const tools = createFileTools({ root });
    const glob = findTool(tools, 'glob');

    const result = (await glob.execute({ pattern: '**/*.txt' }, stubContext)) as ToolResult;
    expect(result.data).toMatchObject({ files: ['notes/a.txt'] });
  });

  it('越界写入被拒绝', async () => {
    const tools = createFileTools({ root });
    const write = findTool(tools, 'write_file');

    const result = (await write.execute(
      { path: '../escape.txt', content: 'x' },
      stubContext,
    )) as ToolResult;
    expect(result.isError).toBe(true);
  });

  it('search_code 的搜索目录同样不允许越界', async () => {
    const tools = createSearchTools({ root });
    const search = findTool(tools, 'search_code');

    await expect(search.execute({ pattern: 'root', path: '../..' }, stubContext)).rejects.toThrow(
      /路径越界/,
    );
  });

  it('walkFiles 在遍历入口拦截越界目录', async () => {
    await expect(walkFiles('../..', { root })).rejects.toThrow(/路径越界/);
  });
});
