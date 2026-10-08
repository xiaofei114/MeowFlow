# @xiaofeiqwq/tools

[![npm](https://img.shields.io/npm/v/@xiaofeiqwq/tools.svg)](https://www.npmjs.com/package/@xiaofeiqwq/tools)

MeowFlow 内置工具集：文件系统、HTTP、Shell、代码搜索、向用户提问、子代理。

MeowFlow built-in tools: filesystem, HTTP, shell, code search, ask-user, sub-agent.

[中文](#中文) | [English](#english)

---

## 中文

### 简介

提供一组开箱即用的工具实现。它们都是普通的 `ToolDefinition`，可单独引入，也可通过 `createDefaultTools` 一次性组装。

> 本包只提供**代码工具**，不包含任何提示词内容；工具的 `description` 与 `parameters` 会作为 `ToolSpec` 交给模型。

### 安装

```bash
pnpm add @xiaofeiqwq/tools
```

### 快速上手

```ts
import { createDefaultTools } from '@xiaofeiqwq/tools';

const tools = createDefaultTools({
  root: process.cwd(),
  // 默认全部启用，可按需关闭
  enable: { shell: false },
});
```

### createDefaultTools

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `root` | `string` | 必填 | 文件、搜索、Shell 的工作目录根 |
| `enable` | `{ fs?, http?, shell?, search?, ask?, subagent? }` | 全部开启 | 按类别启用/禁用 |
| `files` | `Omit<FileToolOptions, 'root'>` | — | 文件工具配置 |
| `search` | `Omit<SearchToolOptions, 'root'>` | — | 搜索工具配置 |
| `http` | `HttpToolOptions` | — | HTTP 工具配置 |
| `shell` | `ShellToolOptions` | — | Shell 工具配置 |
| `ask` | `AskToolOptions` | — | 提问工具配置 |
| `subagent` | `SubAgentToolOptions` | — | 子代理工具配置 |

### 文件系统：createFileTools

`createFileTools({ root, maxReadLength?, maxWriteLength?, ignoredDirs? })`

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `read_file` | `path`, `offset?`, `limit?` | 读取文本文件，返回带行号内容 |
| `write_file` | `path`, `content`, `append?` | 写入文件，自动创建上级目录 |
| `list_dir` | `path?`, `recursive?` | 列出目录内容 |
| `glob` | `pattern`, `path?` | 按 glob（`**` `*` `?`）查找文件 |

默认 `maxReadLength: 40000`、`maxWriteLength: 400000`。

**安全**：所有路径都相对 `root` 解析，越界（`..` 或绝对路径逃逸）会返回可读错误，不会读写工作目录之外的文件。

### 代码搜索：createSearchTools

`createSearchTools({ root, maxResults?, ignoredDirs?, maxFileSize? })`

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `search_code` | `pattern`(正则), `path?`, `glob?`, `ignoreCase?`, `maxResults?` | 按正则搜索内容，返回 `文件:行号:内容` |

默认 `maxResults: 200`、`maxFileSize: 1000000`。会自动跳过二进制文件（检测 NUL 字节）与超限文件。

### HTTP：createHttpTools

`createHttpTools({ allowedHosts?, timeoutMs?, maxResponseLength?, allowMethods? })`

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `http_request` | `url`, `method?`, `headers?`, `body?` | 发起请求，返回状态码、响应头与响应体 |

默认 `timeoutMs: 30000`、`maxResponseLength: 40000`，允许的方法为 `GET/POST/PUT/PATCH/DELETE/HEAD`。仅支持 http/https；配置 `allowedHosts` 可做域名白名单。请求会与运行的 `AbortSignal` 合并，随运行中断而取消。

### Shell：createShellTools

`createShellTools({ cwd?, timeoutMs?, maxOutputLength?, blockedPrefixes?, requireApproval? })`

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `run_command` | `command` | 在工作目录执行命令，返回退出码与输出 |

默认 `timeoutMs: 60000`、`maxOutputLength: 40000`、`requireApproval: true`。

**安全**：默认要求审批（走挂起机制）；内置危险前缀黑名单（如 `rm -rf`、`shutdown`、`format`、`mkfs` 等）命中时直接拒绝。执行会随运行的 `AbortSignal` 终止。

### 向用户提问：createAskTool

`createAskTool({ name?, description? })` → `ask_user`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `question` | `string` | 要询问的问题 |
| `options` | `string[]` | 预设选项，为空表示自由输入 |
| `multiple` | `boolean` | 是否允许多选 |
| `detail` | `string` | 补充说明 |

该工具**不直接返回答案**，而是通过 `suspend('user-input', payload)` 挂起，使用方通过 `agent.resume({ sessionId, callId, answer })` 提交答案后继续。前端可用 `AgentSuspend` 组件渲染。

### 子代理：createSubAgentTool

`createSubAgentTool({ name?, description?, forwardEvents? })` → `task`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `prompt` | `string` | 交给子代理的完整、自包含任务说明 |
| `description` | `string` | 一句话简述 |
| `system` | `string` | 可选的子代理系统提示词 |

子代理拥有独立上下文，返回其最终文本结论，适合需要多步探索、避免污染主上下文的子任务。由 Agent 运行时注入的 `ctx.runSubAgent` 提供，受 `maxSubAgentDepth` 限制（默认 2）。设 `forwardEvents: true` 可把子代理的中间事件转发到父级事件流。

### 工具函数

本包还导出了若干复用工具：`resolveWithinRoot`、`walkFiles`（含 `WalkOptions`）、`globToRegExp`、`clip`。

---

## English

### Overview

A set of ready-to-use tool implementations. They are ordinary `ToolDefinition`s that can be imported individually or assembled at once via `createDefaultTools`.

> This package provides **code tools only** and contains no prompts; each tool's `description` and `parameters` are passed to the model as a `ToolSpec`.

### Install

```bash
pnpm add @xiaofeiqwq/tools
```

### Quick start

```ts
import { createDefaultTools } from '@xiaofeiqwq/tools';

const tools = createDefaultTools({
  root: process.cwd(),
  // everything is enabled by default; disable what you don't need
  enable: { shell: false },
});
```

### createDefaultTools

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | `string` | required | Working directory root for files, search and shell |
| `enable` | `{ fs?, http?, shell?, search?, ask?, subagent? }` | all on | Enable/disable by category |
| `files` | `Omit<FileToolOptions, 'root'>` | — | File tool options |
| `search` | `Omit<SearchToolOptions, 'root'>` | — | Search tool options |
| `http` | `HttpToolOptions` | — | HTTP tool options |
| `shell` | `ShellToolOptions` | — | Shell tool options |
| `ask` | `AskToolOptions` | — | Ask tool options |
| `subagent` | `SubAgentToolOptions` | — | Sub-agent tool options |

### Filesystem: createFileTools

`createFileTools({ root, maxReadLength?, maxWriteLength?, ignoredDirs? })`

| Tool | Params | Description |
| --- | --- | --- |
| `read_file` | `path`, `offset?`, `limit?` | Read a text file, returns numbered lines |
| `write_file` | `path`, `content`, `append?` | Write a file, creating parent dirs |
| `list_dir` | `path?`, `recursive?` | List directory contents |
| `glob` | `pattern`, `path?` | Find files by glob (`**` `*` `?`) |

Defaults: `maxReadLength: 40000`, `maxWriteLength: 400000`.

**Security**: all paths resolve relative to `root`; escapes (`..` or absolute paths) return a readable error instead of touching files outside the working directory.

### Code search: createSearchTools

`createSearchTools({ root, maxResults?, ignoredDirs?, maxFileSize? })`

| Tool | Params | Description |
| --- | --- | --- |
| `search_code` | `pattern` (regex), `path?`, `glob?`, `ignoreCase?`, `maxResults?` | Regex content search, returns `file:line:content` |

Defaults: `maxResults: 200`, `maxFileSize: 1000000`. Binary files (detected via NUL bytes) and oversized files are skipped automatically.

### HTTP: createHttpTools

`createHttpTools({ allowedHosts?, timeoutMs?, maxResponseLength?, allowMethods? })`

| Tool | Params | Description |
| --- | --- | --- |
| `http_request` | `url`, `method?`, `headers?`, `body?` | Make a request, returns status, headers and body |

Defaults: `timeoutMs: 30000`, `maxResponseLength: 40000`; allowed methods are `GET/POST/PUT/PATCH/DELETE/HEAD`. Only http/https is supported; set `allowedHosts` for a host allow-list. The request merges the run's `AbortSignal`, so it is cancelled when the run is aborted.

### Shell: createShellTools

`createShellTools({ cwd?, timeoutMs?, maxOutputLength?, blockedPrefixes?, requireApproval? })`

| Tool | Params | Description |
| --- | --- | --- |
| `run_command` | `command` | Run a command in the working directory, returns exit code and output |

Defaults: `timeoutMs: 60000`, `maxOutputLength: 40000`, `requireApproval: true`.

**Security**: approval is required by default (via the suspend mechanism); a built-in dangerous-prefix block-list (`rm -rf`, `shutdown`, `format`, `mkfs`, etc.) is rejected outright. Execution is terminated with the run's `AbortSignal`.

### Ask the user: createAskTool

`createAskTool({ name?, description? })` → `ask_user`

| Param | Type | Description |
| --- | --- | --- |
| `question` | `string` | The question to ask |
| `options` | `string[]` | Preset options; empty means free input |
| `multiple` | `boolean` | Whether multi-select is allowed |
| `detail` | `string` | Extra context |

This tool **does not return an answer directly**; it suspends via `suspend('user-input', payload)` and continues once the caller submits an answer with `agent.resume({ sessionId, callId, answer })`. Render it with the `AgentSuspend` component.

### Sub-agent: createSubAgentTool

`createSubAgentTool({ name?, description?, forwardEvents? })` → `task`

| Param | Type | Description |
| --- | --- | --- |
| `prompt` | `string` | The complete, self-contained task for the sub-agent |
| `description` | `string` | One-line summary |
| `system` | `string` | Optional sub-agent system prompt |

The sub-agent has its own context and returns its final text conclusion; it is well suited for multi-step exploration without polluting the main context. It is provided by `ctx.runSubAgent` injected by the runtime and bounded by `maxSubAgentDepth` (default 2). Set `forwardEvents: true` to forward the sub-agent's intermediate events into the parent stream.

### Utilities

This package also exports reusable helpers: `resolveWithinRoot`, `walkFiles` (with `WalkOptions`), `globToRegExp`, `clip`.
