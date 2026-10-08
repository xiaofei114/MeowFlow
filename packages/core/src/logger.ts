export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const LEVEL_WEIGHT: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 不输出任何日志。 */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** 输出到控制台。 */
export const consoleLogger: Logger = {
  debug: (message, meta) => console.debug(message, meta ?? ''),
  info: (message, meta) => console.info(message, meta ?? ''),
  warn: (message, meta) => console.warn(message, meta ?? ''),
  error: (message, meta) => console.error(message, meta ?? ''),
};

/** 按级别过滤的日志器工厂，默认使用控制台输出。 */
export function createLogger(level: LogLevel = 'info', prefix = '[meowflow]'): Logger {
  if (level === 'silent') return silentLogger;

  const threshold = LEVEL_WEIGHT[level];
  const wrap =
    (method: Exclude<LogLevel, 'silent'>, sink: (message: string, meta?: unknown) => void) =>
    (message: string, meta?: Record<string, unknown>): void => {
      if (LEVEL_WEIGHT[method] < threshold) return;
      sink(`${prefix} ${message}`, meta);
    };

  return {
    debug: wrap('debug', console.debug),
    info: wrap('info', console.info),
    warn: wrap('warn', console.warn),
    error: wrap('error', console.error),
  };
}
