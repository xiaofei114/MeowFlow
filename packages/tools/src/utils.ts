import { isAbsolute, relative, resolve } from 'node:path';

/** 把目标路径解析到根目录内，越界时抛错，防止读写工作区之外的文件。 */
export function resolveWithinRoot(root: string, target: string): string {
  const base = resolve(root);
  const resolved = resolve(base, target);
  const rel = relative(base, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越界，仅允许访问工作目录内的文件：${target}`);
  }
  return resolved;
}

/** 默认忽略的目录，避免遍历 node_modules 等超大目录。 */
export const DEFAULT_IGNORED_DIRS = ['node_modules', '.git', 'dist', 'coverage', '.pnpm-store'];

export interface WalkOptions {
  root: string;
  ignoredDirs?: string[];
  maxFiles?: number;
  maxDepth?: number;
}

/**
 * 递归遍历目录，返回相对路径列表。
 *
 * 使用广度优先并限制文件数量，保证在大仓目录下也不会失控。
 */
export async function walkFiles(startDir: string, options: WalkOptions): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const ignored = new Set(options.ignoredDirs ?? DEFAULT_IGNORED_DIRS);
  const maxFiles = options.maxFiles ?? 5_000;
  const maxDepth = options.maxDepth ?? 12;

  const root = resolve(options.root);
  // 统一在遍历入口做越界校验，所有调用方（list_dir/glob/search_code）都受保护。
  const start = resolveWithinRoot(root, startDir);
  const results: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];

  while (queue.length > 0 && results.length < maxFiles) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth > maxDepth) continue;

    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = resolve(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        results.push(relative(root, fullPath).split('\\').join('/'));
        if (results.length >= maxFiles) break;
      }
    }
  }

  return results;
}

/** 把 glob 模式转换为正则，支持 `**`、`*`、`?`。 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.split('\\').join('/');
  let source = '';
  let index = 0;

  while (index < normalized.length) {
    const char = normalized[index] ?? '';

    if (char === '*') {
      if (normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 3;
        } else {
          source += '.*';
          index += 2;
        }
        continue;
      }
      source += '[^/]*';
      index += 1;
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      index += 1;
      continue;
    }

    if ('\\^$.|+()[]{}'.includes(char)) {
      source += `\\${char}`;
      index += 1;
      continue;
    }

    source += char;
    index += 1;
  }

  return new RegExp(`^${source}$`);
}

/** 截断过长文本，并标注省略的字符数。 */
export function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n…（已省略 ${text.length - maxLength} 个字符）`;
}
