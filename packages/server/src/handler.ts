import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  MeowFlowError,
  createLogger,
  silentLogger,
  type Agent,
  type Logger,
  type LogLevel,
} from '@xiaofeiqwq/core';
import {
  DEFAULT_ROUTES,
  PROTOCOL_VERSION,
  SSE_CONTENT_TYPE,
  encodeSse,
  encodeSseComment,
  type AgentEvent,
  type ErrorResponse,
  type ResumeRequest,
  type RunRequest,
} from '@xiaofeiqwq/protocol';

/** 路由表类型，键与默认路由一致，值可覆盖。 */
export type AgentRoutes = typeof DEFAULT_ROUTES;

export interface AgentHandlerOptions {
  /** Agent 实例，所有请求共用，会话之间彼此隔离 */
  agent: Agent;
  /** 覆盖默认路由 */
  routes?: Partial<AgentRoutes>;
  /** 是否开启 CORS，默认开启并允许任意来源 */
  cors?: boolean | { origin?: string; headers?: string[] };
  /** 允许的最大请求体字节数，默认 1MB */
  maxBodyBytes?: number;
  /** SSE 心跳间隔（毫秒），0 表示关闭，默认 15000 */
  heartbeatMs?: number;
  /** 日志器 */
  logger?: Logger | LogLevel | false;
}

/** Node 请求监听器签名。 */
export type AgentRequestListener = (req: IncomingMessage, res: ServerResponse) => void;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function resolveLogger(input: Logger | LogLevel | false | undefined): Logger {
  if (input === false || input === undefined) return silentLogger;
  if (typeof input === 'string') return createLogger(input);
  return input;
}

function corsHeaders(cors: AgentHandlerOptions['cors']): Record<string, string> {
  if (cors === false) return {};
  const origin = typeof cors === 'object' && cors.origin ? cors.origin : '*';
  const headers =
    typeof cors === 'object' && cors.headers
      ? cors.headers.join(', ')
      : 'Content-Type, Authorization, X-Session-Id';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': headers,
    'Access-Control-Max-Age': '86400',
  };
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('请求体超过允许大小'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string>,
): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE, ...extra });
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  extra: Record<string, string>,
): void {
  const payload: ErrorResponse = { ok: false, error: { code, message } };
  sendJson(res, status, payload, extra);
}

function eventMeta(event: AgentEvent): { sessionId: string; runId: string; seq: number } {
  return { sessionId: event.sessionId, runId: event.runId, seq: event.seq };
}

/**
 * 创建 Agent 的 HTTP 请求监听器。
 *
 * 只依赖 Node 内置 http 模块，可直接交给 `http.createServer` 使用，
 * 也可挂载到任意支持 `(req, res)` 的框架上。
 */
export function createAgentHandler(options: AgentHandlerOptions): AgentRequestListener {
  const { agent } = options;
  const routes: AgentRoutes = { ...DEFAULT_ROUTES, ...options.routes };
  const cors = corsHeaders(options.cors);
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const logger = resolveLogger(options.logger);

  /** 以 SSE 形式推送事件流，首个事件到达前不发送响应头，便于把错误退回 JSON。 */
  async function streamEvents(
    res: ServerResponse,
    source: AsyncGenerator<AgentEvent>,
    onSessionId: (sessionId: string) => void,
  ): Promise<void> {
    let started = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let last: AgentEvent | undefined;

    const start = (): void => {
      if (started || res.writableEnded) return;
      started = true;
      res.writeHead(200, {
        'Content-Type': SSE_CONTENT_TYPE,
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...cors,
      });
      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(encodeSseComment('ping'));
        }, heartbeatMs);
      }
    };

    try {
      for await (const event of source) {
        start();
        if (event.type === 'run-start') onSessionId(event.sessionId);
        last = event;
        if (!res.writableEnded) res.write(encodeSse(event));
      }
      start();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = err instanceof MeowFlowError ? err.code : 'internal_error';
      logger.error('SSE 事件流异常', { code, error: err.message });

      if (!started) {
        sendError(res, 500, code, err.message, cors);
        return;
      }
      if (!res.writableEnded && last) {
        const meta = eventMeta(last);
        res.write(
          encodeSse({
            v: PROTOCOL_VERSION,
            type: 'error',
            code,
            message: err.message,
            sessionId: meta.sessionId,
            runId: meta.runId,
            seq: meta.seq + 1,
            ts: Date.now(),
          }),
        );
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }

  async function handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, maxBodyBytes);
    let payload: RunRequest;
    try {
      payload = JSON.parse(raw) as RunRequest;
    } catch {
      sendError(res, 400, 'invalid_json', '请求体不是合法 JSON', cors);
      return;
    }
    if (typeof payload?.input !== 'string') {
      sendError(res, 400, 'invalid_request', '缺少字符串类型的 input 字段', cors);
      return;
    }

    let sessionId = payload.sessionId;
    let completed = false;
    res.on('close', () => {
      if (!completed && sessionId) agent.abort(sessionId);
    });

    await streamEvents(
      res,
      agent.run({
        input: payload.input,
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        ...(payload.system ? { system: payload.system } : {}),
        ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
        ...(payload.maxTokens !== undefined ? { maxTokens: payload.maxTokens } : {}),
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
      }),
      (id) => {
        sessionId = id;
      },
    );
    completed = true;
  }

  async function handleResume(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, maxBodyBytes);
    let payload: ResumeRequest;
    try {
      payload = JSON.parse(raw) as ResumeRequest;
    } catch {
      sendError(res, 400, 'invalid_json', '请求体不是合法 JSON', cors);
      return;
    }
    if (typeof payload?.sessionId !== 'string' || typeof payload?.callId !== 'string') {
      sendError(res, 400, 'invalid_request', '缺少 sessionId 或 callId', cors);
      return;
    }

    let completed = false;
    res.on('close', () => {
      if (!completed) agent.abort(payload.sessionId);
    });

    await streamEvents(
      res,
      agent.resume({
        sessionId: payload.sessionId,
        callId: payload.callId,
        answer: payload.answer,
      }),
      () => undefined,
    );
    completed = true;
  }

  async function handleAbort(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, maxBodyBytes);
    let payload: { sessionId?: string };
    try {
      payload = JSON.parse(raw) as { sessionId?: string };
    } catch {
      sendError(res, 400, 'invalid_json', '请求体不是合法 JSON', cors);
      return;
    }
    if (typeof payload?.sessionId !== 'string') {
      sendError(res, 400, 'invalid_request', '缺少 sessionId', cors);
      return;
    }

    const aborted = agent.abort(payload.sessionId);
    sendJson(res, 200, { ok: true, sessionId: payload.sessionId, aborted }, cors);
  }

  async function handleSession(url: URL, res: ServerResponse): Promise<void> {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      sendError(res, 400, 'invalid_request', '缺少 sessionId 查询参数', cors);
      return;
    }
    const state = await agent.getSession(sessionId);
    if (!state) {
      sendError(res, 404, 'not_found', `会话不存在：${sessionId}`, cors);
      return;
    }
    sendJson(res, 200, { ok: true, session: state }, cors);
  }

  return (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';

      if (method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (method === 'GET' && url.pathname === routes.health) {
        sendJson(res, 200, { ok: true, version: PROTOCOL_VERSION, routes }, cors);
        return;
      }
      if (method === 'GET' && url.pathname === routes.session) {
        await handleSession(url, res);
        return;
      }
      if (method === 'POST' && url.pathname === routes.run) {
        await handleRun(req, res);
        return;
      }
      if (method === 'POST' && url.pathname === routes.resume) {
        await handleResume(req, res);
        return;
      }
      if (method === 'POST' && url.pathname === routes.abort) {
        await handleAbort(req, res);
        return;
      }

      sendError(res, 404, 'not_found', `未找到路由：${method} ${url.pathname}`, cors);
    })().catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('请求处理失败', { error: err.message });
      if (!res.writableEnded) sendError(res, 500, 'internal_error', err.message, cors);
    });
  };
}
