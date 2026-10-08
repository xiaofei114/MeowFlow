# @meowflow/protocol

MeowFlow 事件协议：前后端与其他语言共用的类型、SSE 编解码与 JSON Schema。

MeowFlow event protocol: types, SSE codec and JSON Schema shared between frontend, backend and other languages.

[中文](#中文) | [English](#english)

---

## 中文

### 简介

这是 MeowFlow 的**唯一跨端契约**。它不依赖任何运行时特有的 API（同时适用于浏览器与 Node），内容包含：

- 消息与事件的 TypeScript 类型；
- 客户端 → 服务端的传输结构（`RunRequest` / `ResumeRequest` / `AbortRequest`）；
- SSE 编解码工具与增量解析器 `SseParser`；
- 参考实现 `AgentEventAccumulator`，把事件流还原成可直接渲染的消息列表；
- 与语言无关的 JSON Schema，供其他语言的后端/客户端做校验与代码生成。

### 安装

```bash
pnpm add @meowflow/protocol
```

### 事件元信息

所有事件都携带同一份元信息 `EventMeta`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `v` | `'1.0'` | 协议版本，破坏性变更时提升 |
| `runId` | `string` | 本次运行 id，同一会话的多次运行不同 |
| `sessionId` | `string` | 会话 id，跨多次运行稳定 |
| `seq` | `number` | 单调递增序号，从 0 开始，由服务端保证顺序 |
| `ts` | `number` | 事件产生时间戳（毫秒） |

### 事件类型

`AgentEvent` 是以下 14 种事件的联合类型，可用 `AgentEventOf<T>` 按 `type` 收窄：

| 事件 | 关键字段 | 说明 |
| --- | --- | --- |
| `run-start` | `model`, `resumed` | 运行开始；`resumed` 表示是否为挂起后的恢复 |
| `message-start` | `role` | 助手消息开始 |
| `thinking-delta` | `text` | 思考内容增量 |
| `text-delta` | `text` | 正文增量 |
| `tool-call-start` | `callId`, `name` | 工具调用开始 |
| `tool-call-args-delta` | `callId`, `delta` | 工具参数增量（原始 JSON 文本） |
| `tool-call-end` | `callId`, `name`, `args` | 工具参数拼装完成 |
| `tool-call-result` | `callId`, `name`, `status`, `result`, `durationMs` | 工具执行结果 |
| `tool-call-suspend` | `callId`, `name`, `reason`, `payload` | 工具挂起（`user-input` / `approval`） |
| `context-compressed` | `beforeTokens`, `afterTokens`, `summary` | 上下文已压缩 |
| `usage` | `usage` | token 用量 |
| `error` | `code`, `message` | 错误 |
| `message-end` | `message` | 助手消息结束（携带完整消息） |
| `run-end` | `status`, `suspendCallId?`, `usage?` | 运行结束 |

`RunStatus`：`completed` / `suspended` / `aborted` / `error`。

### 传输结构

```ts
interface RunRequest {
  sessionId?: string;   // 不传则由服务端生成并在 run-start 中返回
  input: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

interface ResumeRequest {
  sessionId: string;
  callId: string;       // 来自 tool-call-suspend 或 run-end.suspendCallId
  answer: unknown;
}

interface AbortRequest {
  sessionId: string;
  runId?: string;
}

interface ActionResponse { ok: true; sessionId: string; runId?: string; }
interface ErrorResponse  { ok: false; error: { code: string; message: string } }
```

默认路由 `DEFAULT_ROUTES`：

```ts
{
  run: '/agent/run',
  resume: '/agent/resume',
  abort: '/agent/abort',
  session: '/agent/session',
  health: '/agent/health',
}
```

### SSE 编解码

```ts
import {
  encodeSse,
  encodeSseNamed,
  encodeSseComment,
  decodeSseEvent,
  SseParser,
  SSE_CONTENT_TYPE,
} from '@meowflow/protocol';

// 服务端
const chunk = encodeSse(event);        // "data: {...}\n\n"
const ping = encodeSseComment('ping'); // ": ping\n\n"（心跳）

// 客户端：增量解析
const parser = new SseParser();
const payloads = parser.push(textChunk);  // 返回本次能解析出的 data 载荷
const tail = parser.flush();              // 结束时处理最后一个无空行结尾的块
for (const payload of [...payloads, ...tail]) {
  const event = decodeSseEvent(payload);  // -> AgentEvent
}
```

### 事件归约器

`AgentEventAccumulator` 是协议语义的参考实现，把事件流还原为可直接渲染的 `AccumulatedState`：

```ts
import { AgentEventAccumulator, createAccumulatedState } from '@meowflow/protocol';

const accumulator = new AgentEventAccumulator();
for await (const event of stream) accumulator.apply(event);

accumulator.state.messages; // AccumulatedMessage[]：role / content / thinking / toolCalls / streaming
accumulator.state.status;   // 'idle' | 'streaming' | 'suspended' | 'error'
```

构造函数支持注入自定义的 state 对象，从而与响应式库结合（例如 Vue 的 `reactive()`）：

```ts
import { reactive } from 'vue';
const state = reactive(createAccumulatedState());
const accumulator = new AgentEventAccumulator(state);
// 之后对 state 的每次变更都会触发响应式更新
```

`reset()` 可清空状态；`applyAll(events)` 可批量归约。

### JSON Schema

`agentEventJsonSchema`（draft-07）是与语言无关的协议契约，可交给任意语言做运行时校验或生成模型代码：

```ts
import { agentEventJsonSchema } from '@meowflow/protocol';
```

### 其他语言如何对接

只要遵循以下约定，任何语言的后端/前端都能与 MeowFlow 生态互通：

1. HTTP 路由与请求体使用上文「传输结构」中的 JSON 字段；
2. 响应使用 `text/event-stream`，每条事件以 `data: {JSON}\n\n` 推送；
3. 事件字段与「事件类型」表一致，且带齐 `EventMeta`；
4. 版本以 `v` 字段标识（当前 `1.0`）。

`PROTOCOL_VERSION` 与 `SSE_CONTENT_TYPE` 两个常量可避免各处硬编码。

---

## English

### Overview

This is MeowFlow's **single cross-platform contract**. It depends on no runtime-specific API (works in both browsers and Node) and contains:

- TypeScript types for messages and events;
- Client-to-server transport structures (`RunRequest` / `ResumeRequest` / `AbortRequest`);
- SSE encoding helpers and the incremental `SseParser`;
- `AgentEventAccumulator`, a reference reducer that turns an event stream into a render-ready message list;
- A language-agnostic JSON Schema for validation and code generation in other languages.

### Install

```bash
pnpm add @meowflow/protocol
```

### Event meta

Every event carries the same `EventMeta`:

| Field | Type | Description |
| --- | --- | --- |
| `v` | `'1.0'` | Protocol version, bumped on breaking changes |
| `runId` | `string` | Run id, unique per run within a session |
| `sessionId` | `string` | Session id, stable across runs |
| `seq` | `number` | Monotonic sequence starting at 0, ordered by the server |
| `ts` | `number` | Event timestamp in milliseconds |

### Event types

`AgentEvent` is a union of the following 14 events; narrow it by `type` with `AgentEventOf<T>`:

| Event | Key fields | Purpose |
| --- | --- | --- |
| `run-start` | `model`, `resumed` | Run started (`resumed` marks a resume) |
| `message-start` | `role` | Assistant message started |
| `thinking-delta` | `text` | Thinking delta |
| `text-delta` | `text` | Content delta |
| `tool-call-start` | `callId`, `name` | Tool call started |
| `tool-call-args-delta` | `callId`, `delta` | Tool args delta (raw JSON text) |
| `tool-call-end` | `callId`, `name`, `args` | Tool args fully assembled |
| `tool-call-result` | `callId`, `name`, `status`, `result`, `durationMs` | Tool result |
| `tool-call-suspend` | `callId`, `name`, `reason`, `payload` | Tool suspended (`user-input` / `approval`) |
| `context-compressed` | `beforeTokens`, `afterTokens`, `summary` | Context compressed |
| `usage` | `usage` | Token usage |
| `error` | `code`, `message` | Error |
| `message-end` | `message` | Assistant message finished (full message) |
| `run-end` | `status`, `suspendCallId?`, `usage?` | Run finished |

`RunStatus`: `completed` / `suspended` / `aborted` / `error`.

### Transport structures

```ts
interface RunRequest {
  sessionId?: string;   // generated by the server if omitted, returned in run-start
  input: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

interface ResumeRequest {
  sessionId: string;
  callId: string;       // from tool-call-suspend or run-end.suspendCallId
  answer: unknown;
}

interface AbortRequest {
  sessionId: string;
  runId?: string;
}

interface ActionResponse { ok: true; sessionId: string; runId?: string; }
interface ErrorResponse  { ok: false; error: { code: string; message: string } }
```

Default routes (`DEFAULT_ROUTES`):

```ts
{
  run: '/agent/run',
  resume: '/agent/resume',
  abort: '/agent/abort',
  session: '/agent/session',
  health: '/agent/health',
}
```

### SSE codec

```ts
import {
  encodeSse,
  encodeSseNamed,
  encodeSseComment,
  decodeSseEvent,
  SseParser,
  SSE_CONTENT_TYPE,
} from '@meowflow/protocol';

// Server
const chunk = encodeSse(event);        // "data: {...}\n\n"
const ping = encodeSseComment('ping'); // ": ping\n\n" (heartbeat)

// Client: incremental parsing
const parser = new SseParser();
const payloads = parser.push(textChunk);  // data payloads parsed from this chunk
const tail = parser.flush();              // handle a final block without a trailing blank line
for (const payload of [...payloads, ...tail]) {
  const event = decodeSseEvent(payload);  // -> AgentEvent
}
```

### Event reducer

`AgentEventAccumulator` is the reference implementation of the protocol semantics; it turns an event stream into a render-ready `AccumulatedState`:

```ts
import { AgentEventAccumulator, createAccumulatedState } from '@meowflow/protocol';

const accumulator = new AgentEventAccumulator();
for await (const event of stream) accumulator.apply(event);

accumulator.state.messages; // AccumulatedMessage[]: role / content / thinking / toolCalls / streaming
accumulator.state.status;   // 'idle' | 'streaming' | 'suspended' | 'error'
```

The constructor accepts an injected state object so it can integrate with reactive libraries (e.g. Vue's `reactive()`):

```ts
import { reactive } from 'vue';
const state = reactive(createAccumulatedState());
const accumulator = new AgentEventAccumulator(state);
// every subsequent mutation of state triggers reactive updates
```

`reset()` clears the state; `applyAll(events)` reduces in batch.

### JSON Schema

`agentEventJsonSchema` (draft-07) is the language-agnostic contract, ready for runtime validation or code generation in any language:

```ts
import { agentEventJsonSchema } from '@meowflow/protocol';
```

### Interop with other languages

Any backend/frontend in any language can interoperate with the MeowFlow ecosystem by following these rules:

1. Use the JSON fields from "Transport structures" above for HTTP routes and request bodies;
2. Respond with `text/event-stream`, pushing each event as `data: {JSON}\n\n`;
3. Match the fields in the "Event types" table and always include `EventMeta`;
4. Identify the version via the `v` field (currently `1.0`).

The `PROTOCOL_VERSION` and `SSE_CONTENT_TYPE` constants avoid hard-coding these values.
