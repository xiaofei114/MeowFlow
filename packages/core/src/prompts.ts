import { readFile, readdir } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { stringifyValue } from './utils';

/** 提示词模板。 */
export interface PromptTemplate {
  name: string;
  content: string;
}

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** 定义提示词，等价于直接写字符串，仅用于语义表达。 */
export function definePrompt(content: string): string {
  return content;
}

/**
 * 渲染提示词模板，把 `{{key}}` 替换为变量值。
 *
 * 未提供的变量会原样保留，便于定位遗漏的占位符。
 */
export function renderPrompt(template: string, variables: Record<string, unknown> = {}): string {
  return template.replace(VARIABLE_PATTERN, (match, key: string) => {
    if (!(key in variables)) return match;
    const value = variables[key];
    return value === undefined ? match : stringifyValue(value);
  });
}

/** 从文件加载单个提示词模板，支持 .md 与 .txt。 */
export async function loadPromptFile(path: string): Promise<PromptTemplate> {
  const content = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '').trim();
  return { name: basename(path, extname(path)), content };
}

/** 加载目录下的所有提示词模板。 */
export async function loadPromptDir(dir: string): Promise<PromptTemplate[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const templates: PromptTemplate[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (ext !== '.md' && ext !== '.txt') continue;
    templates.push(await loadPromptFile(join(dir, entry.name)));
  }

  return templates;
}
