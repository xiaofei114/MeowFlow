# MeowFlow

轻量、自由、可自定义的 AI Agent 全栈开发框架。

Lightweight, flexible and customizable full-stack framework for building AI agents.

[中文](#中文) | [English](#english)

---

## 中文

### 简介

MeowFlow 是一套用于开发 AI Agent 的 TypeScript 工具库（monorepo），覆盖从调用模型、加载工具与技能、注入提示词，到流式推送、工具调用展示、思考展示与上下文压缩的完整链路。

它把「协议」放在最中心：前后端之间只通过一份与语言无关的事件协议通信，因此：

- 后端可以用这个包快速搭出 Agent，也可以只用核心引擎，自行对接任意模型服务；
- 前端可以用官方 Vue3 组件开箱即用，也可以只依赖协议自行渲染；
- 其他语言的后端只要遵循同一份 JSON 协议，即可被前端组件直接消费。

### 设计理念

| 原则 | 说明 |
| --- | --- |
| 协议优先 | `@meowflow/protocol` 是唯一的跨端契约：类型 + SSE 编解码 + 事件归约器 + JSON Schema |
| 足够轻量 | 不绑定具体模型 SDK，自研统一适配层；不引入分词器等重依赖 |
| 足够自由 | 每一步都可替换：Provider、工具、会话存储、前端渲染、样式 |
| 该有的都有 | 工具系统、技能、提示词模板、挂起-恢复（HITL）、上下文压缩、日志与错误码一应俱全 |

### 包结构

| 包 | 说明 | 运行环境 |
| --- | --- | --- |
| [`@meowflow/protocol`](packages/protocol/README.md) | 事件协议、传输结构、SSE 编解码、事件归约器、JSON Schema | 浏览器 / Node |
| [`@meowflow/core`](packages/core/README.md) | 核心引擎：Provider 适配、Agent 主循环、工具注册、技能、提示词、上下文压缩、会话 | Node |
| [`@meowflow/tools`](packages/tools/README.md) | 内置工具：文件系统、HTTP、Shell、代码搜索、向用户提问、子代理 | Node |
| [`@meowflow/server`](packages/server/README.md) | 服务端适配：基于协议的 HTTP + SSE 接口 | Node |
| [`@meowflow/vue`](packages/vue/README.md) | 前端适配：Vue3 headless composable + 默认样式组件 | 浏览器 |

### 架构

```
┌─────────────────────────────────────────────────────────┐
│  前端 (Vue3 / 任意语言)                                    │
│  useAgent() + <AgentChat/>  ← 只依赖协议包                 │
└───────────────▲─────────────────────────────────────────┘
                │  HTTP + SSE (AgentEvent 流)
┌───────────────┴─────────────────────────────────────────┐
│  @meowflow/server   createAgentServer / createAgentHandler│
├─────────────────────────────────────────────────────────┤
│  @meowflow/core     Agent 主循环                          │
│    ├─ Provider 适配层 (OpenAI 兼容 / Anthropic / 自定义)   │
│    ├─ ToolRegistry + 挂起恢复 (HITL)                       │
│    ├─ Skills / Prompts / 上下文压缩 / SessionStore         │
├─────────────────────────────────────────────────────────┤
│  @meowflow/tools    内置工具实现                            │
└─────────────────────────────────────────────────────────┘
                │
                ▼
        模型服务 (OpenAI / DeepSeek / Qwen / Kimi / Claude ...)
```

### 安装

需要 Node.js >= 18。

```bash
# 后端
pnpm add @meowflow/core @meowflow/tools @meowflow/server

# 前端
pnpm add @meowflow/vue

# 仅在需要自行实现跨语言后端/前端时
pnpm add @meowflow/protocol
```

### 快速上手

#### 后端：起一个带内置工具的 Agent 服务

```ts
import { Agent, openaiCompat } from '@meowflow/core';
import { createDefaultTools } from '@meowflow/tools';
import { createAgentServer } from '@meowflow/server';

const agent = new Agent({
  provider: openaiCompat({
    model: 'deepseek-chat',
    apiKey: process.env.OPENAI_API_KEY!,
    baseURL: 'https://api.deepseek.com/v1',
  }),
  tools: createDefaultTools({ root: process.cwd() }),
  systemPrompt: '你是一个可以读写文件、执行命令的编码助手。',
  // 单进程自动模式：直接处理挂起请求；不传则进入挂起-恢复模式，等待前端 resume。
  onSuspend: (request) => (request.reason === 'approval' ? false : '（未回答）'),
});

const server = createAgentServer({ agent, port: 3000 });
const info = await server.listen();
console.log(`已启动 ${info.url}`);
```

```bash
curl -N -X POST http://localhost:3000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"列出当前目录下的文件"}'
```

#### 前端：一个完整的对话界面

```vue
<script setup lang="ts">
import { AgentChat, ensureAgentStyles } from '@meowflow/vue';
ensureAgentStyles();
</script>

<template>
  <div style="height: 100vh">
    <AgentChat base-url="http://localhost:3000" title="编码助手" show-usage />
  </div>
</template>
```

也可以只用 headless 组合式函数，自行渲染：

```ts
import { useAgent } from '@meowflow/vue';

const agent = useAgent({ baseUrl: 'http://localhost:3000' });
await agent.send('你好');
console.log(agent.messages.value); // 响应式，流式更新
```

### 完整 Demo（推荐先跑这个）

[`examples/fullstack`](examples/fullstack/README.md) 是仓库里唯一的完整示例：Node 端 SSE 服务 + Vue3 聊天界面，覆盖流式输出、思考过程、内置工具调用、自定义工具调用、挂起提问，以及 mock / 真实模型切换。**无需 API Key** 即可跑通。

```bash
pnpm install
pnpm --filter @meowflow/example-fullstack dev
# 打开 http://localhost:5173
```

### 协议概览

服务端通过 SSE 推送 `AgentEvent`，全部事件共享统一元信息：`v`（协议版本）、`runId`、`sessionId`、`seq`（单调递增）、`ts`。

| 事件 | 用途 |
| --- | --- |
| `run-start` | 一次运行开始 |
| `message-start` / `message-end` | 助手消息的开始与结束 |
| `text-delta` / `thinking-delta` | 正文与思考的增量 |
| `tool-call-start` / `tool-call-args-delta` / `tool-call-end` | 工具调用的流式拼装 |
| `tool-call-result` | 工具执行结果 |
| `tool-call-suspend` | 工具挂起，等待用户输入或审批 |
| `context-compressed` | 上下文已压缩 |
| `usage` | token 用量 |
| `error` | 错误 |
| `run-end` | 一次运行结束（completed / suspended / aborted / error） |

细节见 [`@meowflow/protocol`](packages/protocol/README.md)。

### 核心概念

- **Provider**：模型服务适配器。内置 OpenAI 兼容（覆盖 OpenAI / DeepSeek / 通义千问 / Kimi / 智谱 / Ollama / vLLM）与 Anthropic，也可实现 `Provider` 接口接入任意服务。
- **工具（Tool）**：用 `defineTool` 声明 `name / description / parameters(JSON Schema) / execute`，返回值会被归一化为 `ToolResult`；返回 `suspend(...)` 即可挂起。
- **挂起-恢复（HITL）**：需要用户输入或危险操作审批时，框架把状态持久化到 `SessionStore`，前端 `resume(answer)` 后从断点继续。
- **技能（Skill）**：Markdown + frontmatter 描述的能力，按 `lazy`（先给索引按需加载）或 `eager`（全量注入）注入系统提示词。
- **提示词（Prompt）**：支持 `{{variable}}` 模板与从目录批量加载。
- **上下文压缩**：超过阈值时用一次模型调用把早期历史压缩为摘要，保留 system 与最近 N 条消息，切分点对齐 `user` 消息。

### 开发

```bash
pnpm install         # 安装依赖
pnpm build           # 构建全部包 (ESM + CJS + d.ts)
pnpm test            # 运行单元测试
pnpm typecheck       # 类型检查
pnpm lint            # ESLint
pnpm format          # Prettier

pnpm --filter @meowflow/example-fullstack dev   # 运行完整 demo
```

### 许可证

MIT

---

## English

### Overview

MeowFlow is a TypeScript toolkit (monorepo) for building AI agents. It covers the whole path from calling models, loading tools and skills, and injecting prompts, to streaming output, tool-call rendering, thinking display, and context compression.

It puts the *protocol* at the center: frontend and backend communicate only through a language-agnostic event protocol. As a result:

- A backend can bootstrap an agent with this package, or use only the core engine and wire up any model service itself.
- A frontend can drop in the official Vue 3 components, or depend on the protocol alone and render however it likes.
- A backend in any other language can be consumed directly by the frontend components as long as it follows the same JSON protocol.

### Design principles

| Principle | Description |
| --- | --- |
| Protocol first | `@meowflow/protocol` is the single cross-platform contract: types + SSE codec + event reducer + JSON Schema |
| Lightweight | No vendor SDK lock-in, self-built unified adapter layer, no heavy dependencies such as tokenizers |
| Flexible | Everything is replaceable: Provider, tools, session store, frontend rendering, styles |
| Batteries included | Tool system, skills, prompt templates, suspend/resume (HITL), context compression, logging and error codes |

### Packages

| Package | Description | Runtime |
| --- | --- | --- |
| [`@meowflow/protocol`](packages/protocol/README.md) | Event protocol, transport structures, SSE codec, event reducer, JSON Schema | Browser / Node |
| [`@meowflow/core`](packages/core/README.md) | Core engine: provider adapters, agent loop, tool registry, skills, prompts, context compression, sessions | Node |
| [`@meowflow/tools`](packages/tools/README.md) | Built-in tools: filesystem, HTTP, shell, code search, ask-user, sub-agent | Node |
| [`@meowflow/server`](packages/server/README.md) | Server adapter: protocol-based HTTP + SSE endpoints | Node |
| [`@meowflow/vue`](packages/vue/README.md) | Frontend adapter: Vue 3 headless composable + default-styled components | Browser |

### Install

Node.js >= 18 is required.

```bash
# Backend
pnpm add @meowflow/core @meowflow/tools @meowflow/server

# Frontend
pnpm add @meowflow/vue

# Only when implementing a cross-language backend/frontend yourself
pnpm add @meowflow/protocol
```

### Quick start

#### Backend: an agent server with built-in tools

```ts
import { Agent, openaiCompat } from '@meowflow/core';
import { createDefaultTools } from '@meowflow/tools';
import { createAgentServer } from '@meowflow/server';

const agent = new Agent({
  provider: openaiCompat({
    model: 'deepseek-chat',
    apiKey: process.env.OPENAI_API_KEY!,
    baseURL: 'https://api.deepseek.com/v1',
  }),
  tools: createDefaultTools({ root: process.cwd() }),
  systemPrompt: 'You are a coding assistant that can read/write files and run commands.',
  // Single-process auto mode: resolve suspensions inline. Omit it to use suspend/resume mode.
  onSuspend: (request) => (request.reason === 'approval' ? false : '(no answer)'),
});

const server = createAgentServer({ agent, port: 3000 });
const info = await server.listen();
console.log(`Listening on ${info.url}`);
```

```bash
curl -N -X POST http://localhost:3000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"List the files in the current directory"}'
```

#### Frontend: a complete chat UI

```vue
<script setup lang="ts">
import { AgentChat, ensureAgentStyles } from '@meowflow/vue';
ensureAgentStyles();
</script>

<template>
  <div style="height: 100vh">
    <AgentChat base-url="http://localhost:3000" title="Coding assistant" show-usage />
  </div>
</template>
```

Or use the headless composable and render yourself:

```ts
import { useAgent } from '@meowflow/vue';

const agent = useAgent({ baseUrl: 'http://localhost:3000' });
await agent.send('Hello');
console.log(agent.messages.value); // reactive, streaming updates
```

### Full demo (start here)

[`examples/fullstack`](examples/fullstack/README.md) is the single complete example in this repo: a Node SSE server plus a Vue 3 chat UI, covering streaming, thinking, built-in tools, custom tools, suspend/resume, and mock / real model switching. It works **without an API key**.

```bash
pnpm install
pnpm --filter @meowflow/example-fullstack dev
# open http://localhost:5173
```

### Protocol at a glance

The server pushes `AgentEvent`s over SSE. Every event shares the same meta: `v` (protocol version), `runId`, `sessionId`, `seq` (monotonic), `ts`.

| Event | Purpose |
| --- | --- |
| `run-start` | A run started |
| `message-start` / `message-end` | Start and end of an assistant message |
| `text-delta` / `thinking-delta` | Content and thinking deltas |
| `tool-call-start` / `tool-call-args-delta` / `tool-call-end` | Streaming assembly of tool calls |
| `tool-call-result` | Tool execution result |
| `tool-call-suspend` | Tool suspended, awaiting user input or approval |
| `context-compressed` | Context has been compressed |
| `usage` | Token usage |
| `error` | Error |
| `run-end` | Run finished (completed / suspended / aborted / error) |

See [`@meowflow/protocol`](packages/protocol/README.md) for details.

### Core concepts

- **Provider**: a model-service adapter. Ships with OpenAI-compatible (OpenAI / DeepSeek / Qwen / Kimi / Zhipu / Ollama / vLLM) and Anthropic. Implement the `Provider` interface to plug in anything else.
- **Tool**: declare `name / description / parameters (JSON Schema) / execute` with `defineTool`. Return values are normalized to `ToolResult`; return `suspend(...)` to suspend.
- **Suspend/resume (HITL)**: when user input or approval is needed, state is persisted to a `SessionStore`; the frontend calls `resume(answer)` to continue from the breakpoint.
- **Skill**: capabilities described by Markdown + frontmatter, injected into the system prompt in `lazy` (index only, loaded on demand) or `eager` (fully inlined) mode.
- **Prompt**: `{{variable}}` templates plus batch loading from a directory.
- **Context compression**: once a threshold is exceeded, early history is summarized by one model call while the system prompt and the most recent N messages are kept, with the split aligned to a `user` message.

### Development

```bash
pnpm install         # install dependencies
pnpm build           # build all packages (ESM + CJS + d.ts)
pnpm test            # run unit tests
pnpm typecheck       # type check
pnpm lint            # ESLint
pnpm format          # Prettier

pnpm --filter @meowflow/example-fullstack dev   # run the full demo
```

### License

MIT
