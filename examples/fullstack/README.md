# MeowFlow 全栈 Demo

一个开箱即跑的全栈示例：Node 端用 MeowFlow 起 SSE 服务，Vue3 端用 `@meowflow/vue` 的组件渲染。

A ready-to-run full-stack example: a Node SSE server built with MeowFlow, rendered by `@meowflow/vue` components.

[中文](#中文) | [English](#english)

---

## 中文

### 特点

- **零配置可跑**：未设置 `OPENAI_API_KEY` 时使用内置 mock provider，无需联网、无需密钥即可完整体验流式输出、思考过程、内置工具调用、自定义工具调用与挂起交互。
- **切换真实模型**：设置 `OPENAI_API_KEY` 后自动切换到真实模型（任何 OpenAI 兼容服务均可）。
- **内置 + 自定义工具**：既挂载了 `@meowflow/tools` 的全部默认工具，也用 `defineTool` 演示了一个自定义工具 `get_weather`。
- **HITL 演示**：服务端不提供 `onSuspend`，因此提问会以「挂起」形式推到前端，由用户在界面上作答后再继续。

### 运行

```bash
# 在仓库根目录
pnpm install
pnpm --filter @meowflow/example-fullstack dev
```

然后打开 http://localhost:5173 。

`dev` 会同时启动：

| 进程 | 地址 | 说明 |
| --- | --- | --- |
| 服务端 | http://localhost:3000 | `tsx watch server/index.ts` |
| 前端 | http://localhost:5173 | Vite，已把 `/agent` 代理到 3000 |

也可以分别启动：`pnpm --filter @meowflow/example-fullstack dev:server` / `dev:web`。

### 体验路径

界面上方有四个示例按钮：

| 按钮 | 预期效果 |
| --- | --- |
| 打招呼（流式文本） | 助手逐字流式输出一段介绍，并展示思考过程 |
| 查看目录（内置工具） | 触发一次真实的 `list_dir` 工具调用，展示工具名、状态与结果，再输出总结 |
| 查天气（自定义工具） | 触发 `defineTool` 定义的 `get_weather`，同时演示工具返回的 `data` 被结构化渲染 |
| 帮我决策（挂起提问） | 触发 `ask_user` 挂起，界面出现提问面板；选择后点击确认，Agent 从断点继续作答 |

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 无 | 不设置则使用内置 mock provider |
| `OPENAI_BASE_URL` | OpenAI 官方 | 兼容服务的地址，如 `https://api.deepseek.com/v1` |
| `MEOWFLOW_MODEL` | `gpt-4o-mini` | 模型名 |
| `PORT` | `3000` | 服务端端口 |

例如接入 DeepSeek：

```bash
# PowerShell
$env:OPENAI_API_KEY="sk-xxx"; $env:OPENAI_BASE_URL="https://api.deepseek.com/v1"; $env:MEOWFLOW_MODEL="deepseek-chat"
pnpm --filter @meowflow/example-fullstack dev
```

```bash
# bash
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://api.deepseek.com/v1 MEOWFLOW_MODEL=deepseek-chat \
  pnpm --filter @meowflow/example-fullstack dev
```

### 目录结构

```
examples/fullstack/
  server/
    index.ts          # 服务端入口：选择 provider、组装 Agent 与 SSE 服务
    mock-provider.ts  # 无需网络的 mock provider（实现 Provider 接口）
    tools.ts          # 自定义工具示例（defineTool）
  src/
    main.ts           # 前端入口
    App.vue           # 页面：示例按钮 + <AgentChat/>
  index.html
  vite.config.ts      # /agent 代理到 3000
```

### 单独体验后端

```bash
curl -N -X POST http://localhost:3000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"帮我看看当前目录下有哪些文件"}'
```

---

## English

### Highlights

- **Runs with zero config**: without `OPENAI_API_KEY`, a built-in mock provider is used, so you can experience streaming, thinking, built-in tools, custom tools and suspend/resume with no network or key.
- **Switch to a real model**: set `OPENAI_API_KEY` to use a real model (any OpenAI-compatible service works).
- **Built-in + custom tools**: it mounts all default tools from `@meowflow/tools` and also demonstrates a custom `get_weather` tool defined with `defineTool`.
- **HITL demo**: the server omits `onSuspend`, so questions are pushed to the frontend as suspensions and continue after the user answers.

### Run

```bash
# from the repo root
pnpm install
pnpm --filter @meowflow/example-fullstack dev
```

Then open http://localhost:5173 .

`dev` starts both:

| Process | Address | Notes |
| --- | --- | --- |
| Server | http://localhost:3000 | `tsx watch server/index.ts` |
| Web | http://localhost:5173 | Vite, proxying `/agent` to 3000 |

You can also start them separately: `pnpm --filter @meowflow/example-fullstack dev:server` / `dev:web`.

### What to try

Four example buttons are shown at the top:

| Button | Expected result |
| --- | --- |
| 打招呼（流式文本） | The assistant streams an intro character by character and shows its thinking |
| 查看目录（内置工具） | Triggers a real `list_dir` tool call, shows the tool name, status and result, then summarizes |
| 查天气（自定义工具） | Triggers the `get_weather` tool defined with `defineTool`, and renders the tool's `data` structurally |
| 帮我决策（挂起提问） | Triggers an `ask_user` suspension; pick an option and confirm, then the agent continues |

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Without it, the built-in mock provider is used |
| `OPENAI_BASE_URL` | OpenAI | Base URL of a compatible service, e.g. `https://api.deepseek.com/v1` |
| `MEOWFLOW_MODEL` | `gpt-4o-mini` | Model name |
| `PORT` | `3000` | Server port |

### Layout

```
examples/fullstack/
  server/
    index.ts          # entry: pick a provider, assemble the Agent and the SSE server
    mock-provider.ts  # offline mock provider (implements the Provider interface)
    tools.ts          # custom tool example (defineTool)
  src/
    main.ts           # frontend entry
    App.vue           # page: example buttons + <AgentChat/>
  index.html
  vite.config.ts      # proxies /agent to 3000
```

### Try the backend alone

```bash
curl -N -X POST http://localhost:3000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"List the files in the current directory"}'
```
