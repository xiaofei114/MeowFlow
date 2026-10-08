import { ToolResult, defineTool, toolError, type ToolDefinition } from '@meowflow/core';
import { clip } from './utils';

export interface HttpToolOptions {
  /** 允许访问的域名白名单，为空表示不限制 */
  allowedHosts?: string[];
  /** 单次请求超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 响应体最大返回字符数，默认 40000 */
  maxResponseLength?: number;
  /** 是否允许自定义请求方法，默认 true */
  allowMethods?: string[];
}

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/** 创建网络请求工具集：http_request。 */
export function createHttpTools(options: HttpToolOptions = {}): ToolDefinition[] {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxResponseLength = options.maxResponseLength ?? 40_000;
  const allowMethods = (options.allowMethods ?? DEFAULT_METHODS).map((m) => m.toUpperCase());
  const allowedHosts = options.allowedHosts;

  const httpRequestTool = defineTool({
    name: 'http_request',
    description: '发起 HTTP 请求并返回状态码、响应头与响应体。适用于抓取网页、调用 REST API。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整请求地址，需包含协议，例如 https://example.com' },
        method: { type: 'string', description: '请求方法，默认 GET' },
        headers: {
          type: 'object',
          description: '请求头键值对',
          additionalProperties: { type: 'string' },
        },
        body: { type: 'string', description: '请求体文本，GET/HEAD 请求会忽略' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const rawUrl = String(args.url ?? '').trim();
      if (rawUrl === '') return toolError('缺少 url 参数');

      let target: URL;
      try {
        target = new URL(rawUrl);
      } catch {
        return toolError(`无效的 URL：${rawUrl}`);
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return toolError(`仅支持 http/https 协议，收到：${target.protocol}`);
      }
      if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(target.host)) {
        return toolError(`域名不在白名单内：${target.host}`);
      }

      const method = String(args.method ?? 'GET').toUpperCase();
      if (!allowMethods.includes(method)) {
        return toolError(`不允许的请求方法：${method}`);
      }

      const headers: Record<string, string> = {};
      if (args.headers && typeof args.headers === 'object') {
        for (const [key, value] of Object.entries(args.headers as Record<string, unknown>)) {
          headers[key] = String(value);
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const signal =
        typeof AbortSignal.any === 'function'
          ? AbortSignal.any([ctx.signal, controller.signal])
          : controller.signal;

      try {
        const response = await fetch(target, {
          method,
          headers,
          signal,
          ...(args.body !== undefined && method !== 'GET' && method !== 'HEAD'
            ? { body: String(args.body) }
            : {}),
        });

        const text = await response.text();
        const body = clip(text, maxResponseLength);

        const headerObject: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headerObject[key] = value;
        });

        const summary = `HTTP ${response.status} ${response.statusText}\n${body}`;
        return new ToolResult(summary, {
          url: target.toString(),
          status: response.status,
          ok: response.ok,
          headers: headerObject,
          body,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolError(`请求失败：${message}`);
      } finally {
        clearTimeout(timer);
      }
    },
  });

  return [httpRequestTool];
}
