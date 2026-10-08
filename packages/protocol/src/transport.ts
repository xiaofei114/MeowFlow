/**
 * 客户端 → 服务端的传输结构。
 *
 * 这些结构与语言无关，任何语言实现的后端只要遵循同样的 JSON 格式即可对接。
 */

/** 发起一次运行。 */
export interface RunRequest {
  /** 会话 id；不传则由服务端生成，并在 `run-start` 事件中返回 */
  sessionId?: string;
  /** 用户输入 */
  input: string;
  /** 本次运行覆盖默认 system 提示词 */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** 业务侧透传数据，框架原样带回 */
  metadata?: Record<string, unknown>;
}

/** 恢复一次被挂起的运行。 */
export interface ResumeRequest {
  sessionId: string;
  /** 挂起的工具调用 id，来自 `tool-call-suspend` 或 `run-end.suspendCallId` */
  callId: string;
  /** 用户给出的答案或审批结果 */
  answer: unknown;
}

/** 中断一次运行。 */
export interface AbortRequest {
  sessionId: string;
  runId?: string;
}

/** 非流式接口的成功响应。 */
export interface ActionResponse {
  ok: true;
  sessionId: string;
  runId?: string;
}

/** 统一错误响应体。 */
export interface ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

/** 服务端默认路由。 */
export const DEFAULT_ROUTES = {
  run: '/agent/run',
  resume: '/agent/resume',
  abort: '/agent/abort',
  session: '/agent/session',
  health: '/agent/health',
} as const;
