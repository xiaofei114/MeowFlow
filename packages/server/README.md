# @meowflow/server

MeowFlow 服务端适配：基于协议规范的 HTTP + SSE 接口，供任意语言的前端或后端对接。

MeowFlow server adapter: protocol-based HTTP + SSE endpoints consumable by any frontend or backend.

[中文](#中文) | [English](#english)

---

## 中文

### 简介

把 [`@meowflow/core`](../core/README.md) 的 `Agent` 暴露为一组符合 [`@meowflow/protocol`](../protocol/README.md) 规范的 HTTP 接口：以 SSE 流式推送 `AgentEvent`，并提供恢复、中断、会话查询与健康检查。

只依赖 Node 内置 `http` 模块，因此既可用 `createAgentServer` 一键起服务，也可用 `createAgentHandler` 挂载到自己的 http 服务或任意支持 `(req, res)` 的框架上。

### 安装

```bash
pnpm add @meowflow/server
```

### 快速上手

```ts
import { Agent, openaiCompat } from '@meowflow/core';
import { createDefaultTools } from '@meowflow/tools';
import { createAgentServer } from '@meowflow/server';

const agent = new Agent({
  provider: openaiCompat({ model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY! }),
  tools: createDefaultTools({ root: process.cwd() }),
});

const server = createAgentServer({ agent, port: 3000 });
const info = await server.listen();
console.log(`已启动 ${info.url}`);

// 稍后：await server.close();
```

### createAgentServer

`createAgentServer(options: AgentServerOptions)` 在 `createAgentHandler` 基础上内嵌了一个 http 服务，返回：

| 成员 | 说明 |
| --- | --- |
| `server` | 底层 `http.Server`，可自行挂载额外逻辑 |
| `listen()` | 启动监听，返回实际地址 `{ host, port, url }` |
| `close()` | 关闭服务 |

选项在 `AgentHandlerOptions` 之外增加：

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `port` | `number` | `3000` | 监听端口 |
| `host` | `string` | `'0.0.0.0'` | 监听地址 |

### createAgentHandler

`createAgentHandler(options: AgentHandlerOptions)` 返回 `(req, res) => void` 监听器，可交给 `http.createServer` 或挂载到任意框架：

```ts
import { createServer } from 'node:http';
import { createAgentHandler } from '@meowflow/server';

const handler = createAgentHandler({
  agent,
  routes: { run: '/api/agent/run' }, // 覆盖默认路由（可选）
  cors: { origin: 'https://app.example.com' },
  heartbeatMs: 15000,
  maxBodyBytes: 1_048_576,
  logger: 'info',
});

createServer(handler).listen(3000);
```

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `agent` | `Agent` | 必填 | Agent 实例，所有请求共用，会话之间彼此隔离 |
| `routes` | `Partial<AgentRoutes>` | `DEFAULT_ROUTES` | 覆盖默认路由 |
| `cors` | `boolean \| { origin?, headers? }` | 开启并允许任意来源 | CORS 配置，`false` 关闭 |
| `maxBodyBytes` | `number` | `1048576` | 请求体最大字节数 |
| `heartbeatMs` | `number` | `15000` | SSE 心跳间隔，`0` 关闭 |
| `logger` | `Logger \| LogLevel \| false` | 静默 | 日志器 |

### 路由

默认路由见 `DEFAULT_ROUTES`，可整体或部分覆盖。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/agent/run` | 发起运行，SSE 推送事件流 |
| `POST` | `/agent/resume` | 恢复被挂起的运行，SSE 推送事件流 |
| `POST` | `/agent/abort` | 中断运行，返回 `{ ok, sessionId, aborted }` |
| `GET` | `/agent/session?sessionId=` | 查询会话状态，返回 `{ ok, session }` |
| `GET` | `/agent/health` | 健康检查，返回 `{ ok, version, routes }` |
| `OPTIONS` | 任意 | CORS 预检，返回 204 |

请求体遵循协议包的 `RunRequest` / `ResumeRequest` / `AbortRequest`。

### SSE 行为

- 响应头：`Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`；
- 首个事件到达前不发送响应头，因此启动错误能以 JSON（HTTP 500）返回；
- 流开始后若发生错误，会追加一条 `error` 事件而不是断开；
- 按 `heartbeatMs` 推送 `: ping` 注释帧保活；
- 客户端断开（`res` close）时会自动 `agent.abort(sessionId)`，避免资源泄漏。

### curl 示例

```bash
# 运行
curl -N -X POST http://localhost:3000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"列出当前目录下的文件"}'

# 恢复（callId 来自 tool-call-suspend 或 run-end.suspendCallId）
curl -N -X POST http://localhost:3000/agent/resume \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"session_xxx","callId":"call_yyy","answer":"蓝色"}'

# 中断
curl -X POST http://localhost:3000/agent/abort \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"session_xxx"}'
```

---

## English

### Overview

Exposes an [`@meowflow/core`](../core/README.md) `Agent` as a set of HTTP endpoints conforming to the [`@meowflow/protocol`](../protocol/README.md): streaming `AgentEvent`s over SSE, plus resume, abort, session query and health check.

It depends only on Node's built-in `http` module, so you can either spin up a server with `createAgentServer`, or mount `createAgentHandler` onto your own http server or any framework supporting `(req, res)`.

### Install

```bash
pnpm add @meowflow/server
```

### Quick start

```ts
import { Agent, openaiCompat } from '@meowflow/core';
import { createDefaultTools } from '@meowflow/tools';
import { createAgentServer } from '@meowflow/server';

const agent = new Agent({
  provider: openaiCompat({ model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY! }),
  tools: createDefaultTools({ root: process.cwd() }),
});

const server = createAgentServer({ agent, port: 3000 });
const info = await server.listen();
console.log(`Listening on ${info.url}`);

// Later: await server.close();
```

### createAgentServer

`createAgentServer(options: AgentServerOptions)` embeds an http server on top of `createAgentHandler` and returns:

| Member | Description |
| --- | --- |
| `server` | The underlying `http.Server`, ready for extra logic |
| `listen()` | Start listening, returns the actual address `{ host, port, url }` |
| `close()` | Close the server |

In addition to `AgentHandlerOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `3000` | Listen port |
| `host` | `string` | `'0.0.0.0'` | Listen host |

### createAgentHandler

`createAgentHandler(options: AgentHandlerOptions)` returns a `(req, res) => void` listener for `http.createServer` or any framework:

```ts
import { createServer } from 'node:http';
import { createAgentHandler } from '@meowflow/server';

const handler = createAgentHandler({
  agent,
  routes: { run: '/api/agent/run' }, // override default routes (optional)
  cors: { origin: 'https://app.example.com' },
  heartbeatMs: 15000,
  maxBodyBytes: 1_048_576,
  logger: 'info',
});

createServer(handler).listen(3000);
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `agent` | `Agent` | required | Shared Agent instance; sessions are isolated from each other |
| `routes` | `Partial<AgentRoutes>` | `DEFAULT_ROUTES` | Override default routes |
| `cors` | `boolean \| { origin?, headers? }` | on, any origin | CORS config; `false` disables |
| `maxBodyBytes` | `number` | `1048576` | Max request body bytes |
| `heartbeatMs` | `number` | `15000` | SSE heartbeat interval; `0` disables |
| `logger` | `Logger \| LogLevel \| false` | silent | Logger |

### Routes

Default routes come from `DEFAULT_ROUTES` and can be overridden wholly or partially.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/agent/run` | Start a run; streams events over SSE |
| `POST` | `/agent/resume` | Resume a suspended run; streams events over SSE |
| `POST` | `/agent/abort` | Abort a run; returns `{ ok, sessionId, aborted }` |
| `GET` | `/agent/session?sessionId=` | Query session state; returns `{ ok, session }` |
| `GET` | `/agent/health` | Health check; returns `{ ok, version, routes }` |
| `OPTIONS` | any | CORS preflight, returns 204 |

Request bodies follow the protocol package's `RunRequest` / `ResumeRequest` / `AbortRequest`.

### SSE behavior

- Response headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`;
- No response headers are sent before the first event, so startup errors can be returned as JSON (HTTP 500);
- After the stream starts, an `error` event is appended instead of dropping the connection;
- A `: ping` comment frame is sent every `heartbeatMs` to keep the connection alive;
- When the client disconnects (`res` close), `agent.abort(sessionId)` is called automatically to avoid leaks.

### curl examples

```bash
# Run
curl -N -X POST http://localhost:3000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"List the files in the current directory"}'

# Resume (callId from tool-call-suspend or run-end.suspendCallId)
curl -N -X POST http://localhost:3000/agent/resume \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"session_xxx","callId":"call_yyy","answer":"blue"}'

# Abort
curl -X POST http://localhost:3000/agent/abort \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"session_xxx"}'
```
