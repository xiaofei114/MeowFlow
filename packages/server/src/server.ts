import { createServer, type Server } from 'node:http';
import { createAgentHandler, type AgentHandlerOptions } from './handler';

export interface AgentServerOptions extends AgentHandlerOptions {
  /** 监听端口，默认 3000 */
  port?: number;
  /** 监听地址，默认 0.0.0.0 */
  host?: string;
}

export interface ListenInfo {
  host: string;
  port: number;
  url: string;
}

/** 由 createAgentServer 返回的服务句柄。 */
export interface AgentServer {
  /** 底层 http 服务，可自行挂载额外逻辑 */
  server: Server;
  /** 启动监听并返回实际地址 */
  listen(): Promise<ListenInfo>;
  /** 关闭服务 */
  close(): Promise<void>;
}

/** 创建内嵌 HTTP 服务，暴露 Agent 的 run/resume/abort/session/health 接口。 */
export function createAgentServer(options: AgentServerOptions): AgentServer {
  const handler = createAgentHandler(options);
  const server = createServer(handler);

  return {
    server,
    listen: async (): Promise<ListenInfo> => {
      const port = options.port ?? 3000;
      const host = options.host ?? '0.0.0.0';

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });

      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      const display = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
      return { host, port: actualPort, url: `http://${display}:${actualPort}` };
    },
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
