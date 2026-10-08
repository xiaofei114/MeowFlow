# @meowflow/core

MeowFlow 核心引擎：AI 适配、Agent 主循环、工具与技能系统、上下文压缩、挂起恢复。

MeowFlow core engine: provider adapters, agent loop, tool and skill systems, context compression, suspend/resume.

[中文](#中文) | [English](#english)

---

## 中文

### 简介

`@meowflow/core` 提供不依赖任何 Web 框架的 Agent 运行时，运行在 Node 环境。它向外产出 `AgentEvent` 异步流，因此既可直连 [`@meowflow/server`](../server/README.md) 暴露为 SSE，也可自行消费。

同时它重导出了 [`@meowflow/protocol`](../protocol/README.md) 的所有类型与工具，使用方只需引入本包即可。

### 安装

```bash
pnpm add @meowflow/core
```

### 快速上手

```ts
import { Agent, openaiCompat } from '@meowflow/core';

const agent = new Agent({
  provider: openaiCompat({
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
  }),
  systemPrompt: '你是一个乐于助人的中文助手。',
});

for await (const event of agent.run({ input: '你好' })) {
  if (event.type === 'text-delta') process.stdout.write(event.text);
}
```

### Agent

`Agent` 是运行时核心。一个实例可服务多个会话：把 `sessionId` 传入 `run` 即可复用上下文，各会话的运行彼此独立、可并发。

```ts
new Agent(options: AgentOptions)
```

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `provider` | `Provider \| (() => Provider)` | 必填 | 模型适配器，传函数可惰性创建 |
| `tools` | `ToolDefinition[]` | `[]` | 工具列表 |
| `skills` | `Skill[]` | `[]` | 技能列表 |
| `skillMode` | `'lazy' \| 'eager'` | `'lazy'` | 技能注入方式 |
| `systemPrompt` | `string` | 内置默认 | 基础系统提示词 |
| `promptTemplate` | `string` | — | 带变量的模板，优先级高于 `systemPrompt` |
| `promptVariables` | `Record<string, unknown>` | `{}` | 模板变量 |
| `context` | `Partial<ContextOptions>` | — | 上下文压缩配置 |
| `session` | `SessionStore` | `MemorySessionStore` | 会话存储 |
| `logger` | `Logger \| LogLevel \| false` | `false` | 日志器 |
| `maxIterations` | `number` | `10` | 单次运行最大迭代轮数 |
| `onSuspend` | `SuspendHandler` | — | 挂起处理器，见下 |
| `idGenerator` | `(prefix: string) => string` | 内置 | 自定义 id 生成器 |
| `metadata` | `Record<string, unknown>` | — | 会话默认元信息 |
| `maxSubAgentDepth` | `number` | `2` | 子代理最大嵌套深度 |

#### 方法

| 方法 | 说明 |
| --- | --- |
| `run(input: RunInput): AsyncGenerator<AgentEvent>` | 发起一次运行 |
| `resume(input: ResumeInput): AsyncGenerator<AgentEvent>` | 恢复一次被挂起的运行 |
| `abort(sessionId: string): boolean` | 中断指定会话的运行 |
| `getSession(sessionId): Promise<SessionState \| undefined>` | 读取会话状态 |
| `compress(sessionId): Promise<AgentEvent \| undefined>` | 手动压缩上下文，返回 `context-compressed` 事件 |
| `estimateTokens(messages): number` | 估算一组消息的 token |

`RunInput`：`{ input, sessionId?, system?, temperature?, maxTokens?, metadata?, signal? }`。
`ResumeInput`：`{ sessionId, callId, answer, signal? }`。

### 挂起-恢复（HITL）

当工具需要用户输入或危险操作审批时，有两种模式：

**单进程自动模式**：提供 `onSuspend` 回调，框架拿到返回值后直接继续，不落库、不结束运行。

```ts
onSuspend: async (request) => {
  // request: { sessionId, runId, callId, toolName, reason, payload }
  if (request.reason === 'approval') return false; // 拒绝
  return '用户回答';
};
```

**挂起-恢复模式**：不提供 `onSuspend`。框架把状态写入 `SessionStore`，产出 `tool-call-suspend` 事件与 `run-end(status: 'suspended', suspendCallId)`，等待外部提交答案：

```ts
await agent.resume({ sessionId, callId, answer: '蓝色' });
```

### Provider 适配

内置两种适配器，覆盖市面上绝大多数服务。

```ts
import { openaiCompat, anthropic, OPENAI_COMPAT_PRESETS } from '@meowflow/core';

const a = openaiCompat({
  model: 'deepseek-chat',
  apiKey: '...',
  baseURL: OPENAI_COMPAT_PRESETS.deepseek, // openai/deepseek/moonshot/qwen/zhipu/siliconflow/ollama/vllm
  includeUsage: true,                       // 网关不支持 stream_options 时可设 false
  reasoningField: 'reasoning_content',      // 思考字段名，默认自动识别 reasoning_content / reasoning
  extraBody: {},                            // 追加/覆盖请求体字段
  fetch: customFetch,                       // 自定义 fetch（代理、测试）
  headers: {},
});

const b = anthropic({
  model: 'claude-3-5-sonnet-latest',
  apiKey: '...',
  version: '2023-06-01',
  maxTokens: 4096,
  thinkingBudget: 2048, // 开启扩展思考
});
```

差异较大的服务可实现 `Provider` 接口：

```ts
interface Provider {
  readonly name: string;
  readonly model: string;
  chat(params: ChatParams): AsyncIterable<ProviderChunk>;
}
```

`ProviderChunk` 有四种：`text-delta` / `thinking-delta` / `tool-call-delta` / `finish`。

### 工具系统

```ts
import { defineTool, ToolResult, toolResult, toolError, suspend } from '@meowflow/core';

const weather = defineTool({
  name: 'get_weather',
  description: '查询指定城市的天气',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: '城市名' } },
    required: ['city'],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    // ctx: { sessionId, runId, signal, logger, emit, runSubAgent?, metadata? }
    if (args.city === '') return toolError('缺少城市名');
    return new ToolResult(`${args.city} 晴，25℃`, { temp: 25 }); // 第二个参数是给前端的结构化数据
  },
});
```

`execute` 返回值会被归一化：返回字符串 → 内容；返回对象 → 序列化为 JSON；返回 `ToolResult` → 精细控制内容与前端数据；返回 `suspend(reason, payload)` → 挂起。

工具可选字段：`requiresApproval`（执行前走审批挂起）、`approvalPrompt(args)`、`hidden`（对模型隐藏）。

`ToolRegistry` 负责注册、查找与导出给模型的 `ToolSpec`；`executeToolCall({ call, registry, ctx })` 执行单次调用并吞掉异常转为失败结果。

### 技能

技能是 Markdown + frontmatter 描述的能力。

```markdown
---
name: 代码审查
description: 审查代码质量与安全
whenToUse: 当用户要求 review 代码时
tools: [read_file, search_code]
---

（技能正文，会被注入或被 load_skill 加载）
```

```ts
import { parseSkillMarkdown, defineSkill, loadSkills, findSkill } from '@meowflow/core';

const skills = await loadSkills({ dir: './skills', fileName: 'SKILL.md', maxDepth: 4 });
```

- `skillMode: 'lazy'`（默认）：系统提示词只注入技能索引，并自动注册内置工具 `load_skill`，由模型按需加载完整内容；
- `skillMode: 'eager'`：把所有技能正文直接注入系统提示词。

### 提示词

```ts
import {
  definePrompt,
  renderPrompt,
  loadPromptFile,
  loadPromptDir,
} from '@meowflow/core';

renderPrompt('你好 {{name}}', { name: '世界' }); // "你好 世界"，未提供的变量原样保留
const { content } = await loadPromptFile('./prompts/system.md');
const all = await loadPromptDir('./prompts');   // 加载 .md / .txt
```

### 上下文压缩

```ts
import { ContextManager, compressContext, DEFAULT_CONTEXT_OPTIONS } from '@meowflow/core';
```

`DEFAULT_CONTEXT_OPTIONS`：`maxTokens: 128000`、`compressThreshold: 0.8`、`keepRecentMessages: 8`、`maxToolResultLength: 2000`。

`ContextManager.shouldCompress(messages)` 在估算 token 超过 `maxTokens * compressThreshold` 时返回 `true`；运行时会在每轮迭代前自动检查并压缩（产出 `context-compressed` 事件）。压缩会保留 system 消息与最近若干条消息，切分点对齐到 `user` 消息，避免把工具调用与其结果拆开。

token 估算为启发式（CJK 约 1 token/字，其余约 4 字符/token），不引入分词器依赖。

### 会话

```ts
import { MemorySessionStore, createSessionState } from '@meowflow/core';

interface SessionStore {
  get(id: string): MaybePromise<SessionState | undefined>;
  set(state: SessionState): MaybePromise<void>;
  delete?(id: string): MaybePromise<void>;
  list?(): MaybePromise<SessionState[]>;
}
```

`SessionState` 可完整序列化（`id` / `messages` / `createdAt` / `updatedAt` / `pending?` / `metadata?`），便于落库或跨进程恢复；实现该接口即可接入 Redis、数据库等。默认提供基于 `Map` 的 `MemorySessionStore`。

### 错误与日志

错误基类 `MeowFlowError` 携带 `code`，具体包括 `ProviderError`、`ToolError`、`ConfigError`、`AbortedError`；`isAbortError(error)` 用于判断是否为主动中断。

日志：`createLogger(level, prefix)` 按级别过滤，`silentLogger` / `consoleLogger` 可直接使用，或实现 `Logger` 接口接入自有日志系统。

---

## English

### Overview

`@meowflow/core` provides a web-framework-agnostic agent runtime for Node. It produces an async stream of `AgentEvent`s, so it can either feed [`@meowflow/server`](../server/README.md) to expose SSE, or be consumed directly.

It also re-exports everything from [`@meowflow/protocol`](../protocol/README.md), so this package is the only import you need.

### Install

```bash
pnpm add @meowflow/core
```

### Quick start

```ts
import { Agent, openaiCompat } from '@meowflow/core';

const agent = new Agent({
  provider: openaiCompat({
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
  }),
  systemPrompt: 'You are a helpful assistant.',
});

for await (const event of agent.run({ input: 'Hello' })) {
  if (event.type === 'text-delta') process.stdout.write(event.text);
}
```

### Agent

`Agent` is the runtime core. One instance can serve many sessions: pass `sessionId` to `run` to reuse context; sessions run independently and may execute concurrently.

```ts
new Agent(options: AgentOptions)
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | `Provider \| (() => Provider)` | required | Model adapter; pass a function for lazy creation |
| `tools` | `ToolDefinition[]` | `[]` | Tools |
| `skills` | `Skill[]` | `[]` | Skills |
| `skillMode` | `'lazy' \| 'eager'` | `'lazy'` | Skill injection mode |
| `systemPrompt` | `string` | built-in | Base system prompt |
| `promptTemplate` | `string` | — | Template with variables, takes priority over `systemPrompt` |
| `promptVariables` | `Record<string, unknown>` | `{}` | Template variables |
| `context` | `Partial<ContextOptions>` | — | Context compression config |
| `session` | `SessionStore` | `MemorySessionStore` | Session store |
| `logger` | `Logger \| LogLevel \| false` | `false` | Logger |
| `maxIterations` | `number` | `10` | Max iterations per run |
| `onSuspend` | `SuspendHandler` | — | Suspend handler, see below |
| `idGenerator` | `(prefix: string) => string` | built-in | Custom id generator |
| `metadata` | `Record<string, unknown>` | — | Default session metadata |
| `maxSubAgentDepth` | `number` | `2` | Max sub-agent nesting depth |

#### Methods

| Method | Description |
| --- | --- |
| `run(input: RunInput): AsyncGenerator<AgentEvent>` | Start a run |
| `resume(input: ResumeInput): AsyncGenerator<AgentEvent>` | Resume a suspended run |
| `abort(sessionId: string): boolean` | Abort the run of a session |
| `getSession(sessionId): Promise<SessionState \| undefined>` | Read session state |
| `compress(sessionId): Promise<AgentEvent \| undefined>` | Compress context manually, returns a `context-compressed` event |
| `estimateTokens(messages): number` | Estimate tokens for messages |

`RunInput`: `{ input, sessionId?, system?, temperature?, maxTokens?, metadata?, signal? }`.
`ResumeInput`: `{ sessionId, callId, answer, signal? }`.

### Suspend/resume (HITL)

When a tool needs user input or approval, there are two modes:

**Single-process auto mode**: provide `onSuspend`; the framework continues with the returned value without persisting state or ending the run.

```ts
onSuspend: async (request) => {
  // request: { sessionId, runId, callId, toolName, reason, payload }
  if (request.reason === 'approval') return false; // deny
  return 'user answer';
};
```

**Suspend/resume mode**: omit `onSuspend`. State is written to the `SessionStore`, and the run emits a `tool-call-suspend` event plus `run-end(status: 'suspended', suspendCallId)`, waiting for an external answer:

```ts
await agent.resume({ sessionId, callId, answer: 'blue' });
```

### Provider adapters

Two adapters cover the vast majority of services.

```ts
import { openaiCompat, anthropic, OPENAI_COMPAT_PRESETS } from '@meowflow/core';

const a = openaiCompat({
  model: 'deepseek-chat',
  apiKey: '...',
  baseURL: OPENAI_COMPAT_PRESETS.deepseek, // openai/deepseek/moonshot/qwen/zhipu/siliconflow/ollama/vllm
  includeUsage: true,                       // set false for gateways without stream_options support
  reasoningField: 'reasoning_content',      // auto-detects reasoning_content / reasoning by default
  extraBody: {},                            // extra/overriding request body fields
  fetch: customFetch,                       // custom fetch (proxy, tests)
  headers: {},
});

const b = anthropic({
  model: 'claude-3-5-sonnet-latest',
  apiKey: '...',
  version: '2023-06-01',
  maxTokens: 4096,
  thinkingBudget: 2048, // enable extended thinking
});
```

For services with bigger differences, implement the `Provider` interface:

```ts
interface Provider {
  readonly name: string;
  readonly model: string;
  chat(params: ChatParams): AsyncIterable<ProviderChunk>;
}
```

`ProviderChunk` has four variants: `text-delta` / `thinking-delta` / `tool-call-delta` / `finish`.

### Tool system

```ts
import { defineTool, ToolResult, toolResult, toolError, suspend } from '@meowflow/core';

const weather = defineTool({
  name: 'get_weather',
  description: 'Get the weather for a city',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    // ctx: { sessionId, runId, signal, logger, emit, runSubAgent?, metadata? }
    if (args.city === '') return toolError('missing city');
    return new ToolResult(`${args.city} is sunny, 25C`, { temp: 25 }); // 2nd arg: structured data for the frontend
  },
});
```

The return value of `execute` is normalized: a string → content; an object → JSON text; a `ToolResult` → precise control over content and frontend data; `suspend(reason, payload)` → suspend.

Optional tool fields: `requiresApproval` (suspend for approval before execution), `approvalPrompt(args)`, `hidden` (hide from the model).

`ToolRegistry` registers, looks up and exports `ToolSpec`s for the model; `executeToolCall({ call, registry, ctx })` executes one call and swallows exceptions into a failure result.

### Skills

Skills are capabilities described by Markdown + frontmatter.

```markdown
---
name: Code review
description: Review code quality and security
whenToUse: When the user asks to review code
tools: [read_file, search_code]
---

(skill body, injected or loaded via load_skill)
```

```ts
import { parseSkillMarkdown, defineSkill, loadSkills, findSkill } from '@meowflow/core';

const skills = await loadSkills({ dir: './skills', fileName: 'SKILL.md', maxDepth: 4 });
```

- `skillMode: 'lazy'` (default): only a skill index is injected, and a built-in `load_skill` tool is registered for the model to load full content on demand;
- `skillMode: 'eager'`: all skill bodies are inlined into the system prompt.

### Prompts

```ts
import { definePrompt, renderPrompt, loadPromptFile, loadPromptDir } from '@meowflow/core';

renderPrompt('Hello {{name}}', { name: 'world' }); // "Hello world"; unknown vars are left as-is
const { content } = await loadPromptFile('./prompts/system.md');
const all = await loadPromptDir('./prompts');      // loads .md / .txt
```

### Context compression

```ts
import { ContextManager, compressContext, DEFAULT_CONTEXT_OPTIONS } from '@meowflow/core';
```

`DEFAULT_CONTEXT_OPTIONS`: `maxTokens: 128000`, `compressThreshold: 0.8`, `keepRecentMessages: 8`, `maxToolResultLength: 2000`.

`ContextManager.shouldCompress(messages)` returns `true` when the estimated tokens exceed `maxTokens * compressThreshold`; the runtime checks this before each iteration and compresses automatically (emitting `context-compressed`). Compression keeps system messages and the most recent messages, with the split aligned to a `user` message so tool calls are never separated from their results.

Token estimation is heuristic (about 1 token per CJK char, about 4 chars per token otherwise) and pulls in no tokenizer dependency.

### Sessions

```ts
import { MemorySessionStore, createSessionState } from '@meowflow/core';

interface SessionStore {
  get(id: string): MaybePromise<SessionState | undefined>;
  set(state: SessionState): MaybePromise<void>;
  delete?(id: string): MaybePromise<void>;
  list?(): MaybePromise<SessionState[]>;
}
```

`SessionState` is fully serializable (`id` / `messages` / `createdAt` / `updatedAt` / `pending?` / `metadata?`), so it is easy to persist or restore across processes; implement the interface to plug in Redis, databases, etc. A `Map`-based `MemorySessionStore` is provided by default.

### Errors and logging

The base error `MeowFlowError` carries a `code`; concrete errors include `ProviderError`, `ToolError`, `ConfigError`, `AbortedError`. `isAbortError(error)` detects deliberate aborts.

Logging: `createLogger(level, prefix)` filters by level; `silentLogger` / `consoleLogger` are ready to use, or implement the `Logger` interface to hook into your own logging system.
