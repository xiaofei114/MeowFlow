/** MeowFlow 所有异常的统一基类，携带机器可读的错误码。 */
export class MeowFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** 模型服务调用失败（网络、鉴权、限流、响应格式异常等）。 */
export class ProviderError extends MeowFlowError {
  readonly status?: number;

  constructor(message: string, options: { cause?: unknown; status?: number; code?: string } = {}) {
    super(options.code ?? 'provider_error', message, { cause: options.cause });
    this.status = options.status;
  }
}

/** 工具定义或执行出错。 */
export class ToolError extends MeowFlowError {
  readonly toolName?: string;

  constructor(
    message: string,
    options: { toolName?: string; cause?: unknown; code?: string } = {},
  ) {
    super(options.code ?? 'tool_error', message, { cause: options.cause });
    this.toolName = options.toolName;
  }
}

/** 参数配置错误。 */
export class ConfigError extends MeowFlowError {
  constructor(message: string) {
    super('config_error', message);
  }
}

/** 运行被主动中断。 */
export class AbortedError extends MeowFlowError {
  constructor(message = '运行已被中断') {
    super('aborted', message);
  }
}

/** 判断是否为主动中断导致的错误。 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof AbortedError) return true;
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }
  return false;
}
