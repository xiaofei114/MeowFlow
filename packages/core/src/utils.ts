/** 生成唯一 id，优先使用 Web Crypto，保证跨运行时可用。 */
export function generateId(prefix = ''): string {
  const cryptoApi = globalThis.crypto;
  const raw =
    cryptoApi && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: Error };

/** 安全解析 JSON，失败时返回错误而不是抛异常。 */
export function safeJsonParse(text: string): JsonParseResult {
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** 把任意值转成便于模型阅读的字符串。 */
export function stringifyValue(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 截断过长字符串，保留尾部省略号。 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** 把值限制在 [min, max] 区间。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 归一化 baseURL，去掉结尾多余的斜杠。 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
