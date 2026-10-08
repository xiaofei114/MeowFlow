import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 技能元信息，来自 Markdown frontmatter。 */
export interface SkillMeta {
  name: string;
  description: string;
  /** 什么时候该用这个技能，用于按需注入提示词 */
  whenToUse?: string;
  /** 关联的工具名列表 */
  tools?: string[];
  /** 允许携带任意自定义字段 */
  [key: string]: unknown;
}

/** 一个技能：元信息 + Markdown 正文。 */
export interface Skill {
  meta: SkillMeta;
  content: string;
  /** 来源文件路径 */
  source?: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * 解析 SKILL.md：首部 `---` 包裹的 frontmatter + 正文。
 *
 * frontmatter 只支持常见子集（键值、布尔、数字、行内数组、`- ` 列表），
 * 保持零依赖；复杂结构请改用 TS 定义技能对象。
 */
export function parseSkillMarkdown(markdown: string, source?: string): Skill {
  const match = FRONTMATTER_PATTERN.exec(markdown.replace(/^\uFEFF/, ''));

  if (!match) {
    throw new Error(source ? `技能文件缺少 frontmatter：${source}` : '技能内容缺少 frontmatter');
  }

  const rawMeta = parseFrontmatter(match[1] ?? '');
  const content = (match[2] ?? '').trim();
  const name = typeof rawMeta.name === 'string' ? rawMeta.name : '';
  const description = typeof rawMeta.description === 'string' ? rawMeta.description : '';

  if (!name) throw new Error(source ? `技能缺少 name：${source}` : '技能缺少 name');

  const meta = { ...rawMeta, name, description } as SkillMeta;
  return source === undefined ? { meta, content } : { meta, content, source };
}

/** 定义技能对象，跳过 Markdown 解析。 */
export function defineSkill(skill: Skill): Skill {
  return skill;
}

export interface LoadSkillsOptions {
  /** 技能根目录，会递归查找技能文件 */
  dir: string;
  /** 技能文件名，默认 SKILL.md */
  fileName?: string;
  /** 最大递归深度，默认 4 */
  maxDepth?: number;
}

/** 从目录递归加载所有技能。单个文件解析失败会被跳过，不影响其余技能。 */
export async function loadSkills(options: LoadSkillsOptions): Promise<Skill[]> {
  const fileName = options.fileName ?? 'SKILL.md';
  const maxDepth = options.maxDepth ?? 4;
  const skills: Skill[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name === fileName) {
        try {
          const raw = await readFile(fullPath, 'utf8');
          skills.push(parseSkillMarkdown(raw, fullPath));
        } catch {
          // 忽略非法技能文件
        }
      }
    }
  }

  await walk(options.dir, 0);
  return skills;
}

/** 按名称查找技能。 */
export function findSkill(skills: Skill[], name: string): Skill | undefined {
  return skills.find((skill) => skill.meta.name === name);
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let listKey: string | null = null;
  let listValue: unknown[] | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const listItem = /^-\s+(.*)$/.exec(trimmed);
    if (listItem && listKey && listValue) {
      listValue.push(scalar(listItem[1] ?? ''));
      continue;
    }

    const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;

    const key = pair[1] ?? '';
    const rawValue = (pair[2] ?? '').trim();

    if (rawValue === '') {
      listKey = key;
      listValue = [];
      result[key] = listValue;
      continue;
    }

    listKey = null;
    listValue = null;

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      result[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
        .map(scalar);
      continue;
    }

    result[key] = scalar(rawValue);
  }

  return result;
}

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
