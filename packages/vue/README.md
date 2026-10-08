# @xiaofeiqwq/vue

[![npm](https://img.shields.io/npm/v/@xiaofeiqwq/vue.svg)](https://www.npmjs.com/package/@xiaofeiqwq/vue)

MeowFlow 前端适配：Vue3 headless composable 与默认样式组件。

MeowFlow frontend adapter: Vue 3 headless composable and default-styled components.

[中文](#中文) | [English](#english)

---

## 中文

### 简介

把遵循协议的后端（例如 [`@xiaofeiqwq/server`](../server/README.md)）接进 Vue3：

- `useAgent`：headless 组合式函数，内部只依赖协议包的 SSE 解析与事件归约，可对接任何遵循协议的后端；
- 一组默认样式组件：`AgentChat` / `AgentMessage` / `AgentToolCall` / `AgentSuspend` / `AgentInput`，每个都提供插槽便于替换局部实现。

需要 Vue `^3.4.0`。

### 安装

```bash
pnpm add @xiaofeiqwq/vue
```

### 最简用法：开箱即用的界面

```vue
<script setup lang="ts">
import { AgentChat, ensureAgentStyles } from '@xiaofeiqwq/vue';
ensureAgentStyles();
</script>

<template>
  <div style="height: 100vh">
    <AgentChat base-url="http://localhost:3000" title="编码助手" show-usage />
  </div>
</template>
```

`ensureAgentStyles()` 会注入一次默认样式（SSR 环境自动跳过）；也可设 `:auto-styles="false"` 手动控制。

### 全局注册

```ts
import { createApp } from 'vue';
import { MeowFlowVue } from '@xiaofeiqwq/vue';

createApp(App).use(MeowFlowVue).mount('#app'); // 注册 AgentChat 等全部组件
```

### useAgent

```ts
import { useAgent } from '@xiaofeiqwq/vue';

const agent = useAgent({
  baseUrl: 'http://localhost:3000',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
  onEvent: (event) => console.debug(event),
  onError: (error) => console.error(error.code, error.message),
});
```

| 选项 | 类型 | 说明 |
| --- | --- | --- |
| `baseUrl` | `string` | 服务端基地址，缺省为同源相对路径 |
| `routes` | `Partial<{ run, resume, abort }>` | 覆盖默认路由 |
| `headers` | `Record<string,string> \| () => Record<string,string>` | 附加请求头，函数形式便于动态取 token |
| `fetch` | `typeof fetch` | 自定义 fetch，便于测试或注入鉴权 |
| `runOptions` | `{ system?, temperature?, maxTokens?, metadata? }` | 每次运行携带的默认参数 |
| `onEvent` | `(event: AgentEvent) => void` | 收到每个事件时回调 |
| `onFinish` | `(state: AccumulatedState) => void` | 一次运行结束时回调 |
| `onError` | `(error: { code, message }) => void` | 出错时回调 |

返回的控制器：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `state` | `AccumulatedState` | 归约后的完整状态（Vue 响应式对象，字段级变更实时刷新） |
| `messages` | `ComputedRef<AccumulatedMessage[]>` | 消息列表（含 content / thinking / toolCalls / streaming） |
| `status` | `ComputedRef<AgentRunStatus>` | `idle` / `streaming` / `suspended` / `error` |
| `isStreaming` | `ComputedRef<boolean>` | 是否正在流式输出 |
| `error` | `ComputedRef<{ code, message } \| undefined>` | 当前错误 |
| `usage` | `ComputedRef<Usage \| undefined>` | token 用量 |
| `sessionId` | `ComputedRef<string \| undefined>` | 会话 id |
| `pendingSuspend` | `ComputedRef<AccumulatedToolCall \| undefined>` | 挂起时待回答的工具调用 |

| 方法 | 说明 |
| --- | --- |
| `send(input, extra?)` | 发送一条用户消息并发起运行 |
| `resume(answer)` | 提交挂起调用的答案并继续 |
| `abort()` | 中断当前运行 |
| `reset()` | 清空本地状态 |

组件卸载时会自动中断正在进行的请求。

```vue
<script setup lang="ts">
import { useAgent } from '@xiaofeiqwq/vue';

const agent = useAgent({ baseUrl: 'http://localhost:3000' });
</script>

<template>
  <div>
    <div v-for="message in agent.messages.value" :key="message.id">
      <b>{{ message.role }}</b>
      <div>{{ message.content }}</div>
    </div>
    <button @click="agent.send('你好')">发送</button>
  </div>
</template>
```

### 组件

#### AgentChat

完整对话界面，接受与 `useAgent` 相同的连接配置，也可直接传入已创建的控制器。

| Prop | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `agent` | `AgentController` | — | 复用外部控制器；不传则内部创建 |
| `baseUrl` / `routes` / `headers` / `runOptions` | 同 `useAgent` | — | 连接配置 |
| `title` | `string` | — | 标题 |
| `emptyText` | `string` | `'开始对话，向 Agent 提出你的需求'` | 空状态文案 |
| `placeholder` | `string` | 输入框占位 | — |
| `autoStyles` | `boolean` | `true` | 是否注入默认样式 |
| `showUsage` | `boolean` | `false` | 是否展示 token 用量 |

插槽：`header`、`empty`、`message({ message })`、`suspend({ call, answer })`、`footer`、`input({ send, abort, streaming })`。

#### AgentMessage

渲染一条消息：思考过程（可折叠）、正文与其中的工具调用。

- Prop：`message: AccumulatedMessage`
- 插槽：`default({ message })`、`thinking({ thinking })`、`tool-call({ call })`

#### AgentToolCall

渲染单个工具调用的参数与结果，默认折叠、点击展开。

- Props：`call: AccumulatedToolCall`、`defaultOpen = false`
- 插槽：`default({ call, open, toggle })`

#### AgentSuspend

渲染挂起提示：`approval` 显示「允许/拒绝」，`user-input` 显示选项或自由输入框。

- Prop：`call: AccumulatedToolCall`
- 事件：`answer(value)`
- 插槽：`default({ call, answer })`

#### AgentInput

输入框：Enter 发送、Shift+Enter 换行；流式中显示停止按钮。

- Props：`disabled`、`streaming`、`placeholder`、`sendText`（默认「发送」）、`stopText`（默认「停止」）
- 事件：`submit(value)`、`stop`
- 插槽：`default({ text, submit, setText })`

### 样式定制

默认样式通过 `.ak-chat` 上的 CSS 变量暴露主题能力，覆盖变量即可微调：

```css
.ak-chat {
  --ak-accent: #7c3aed;
  --ak-user-bg: #f5f3ff;
  --ak-assistant-bg: #fafafa;
  --ak-radius: 12px;
}
```

可用变量：`--ak-bg`、`--ak-border`、`--ak-text`、`--ak-muted`、`--ak-accent`、`--ak-user-bg`、`--ak-assistant-bg`、`--ak-tool-bg`、`--ak-error`、`--ak-radius`。

也可以完全不使用默认组件，只用 `useAgent` 自行渲染，或使用 `AGENT_STYLES` 自行注入。

---

## English

### Overview

Connects a protocol-compliant backend (e.g. [`@xiaofeiqwq/server`](../server/README.md)) to Vue 3:

- `useAgent`: a headless composable that depends only on the protocol package's SSE parsing and event reducer, so it works with any protocol-compliant backend;
- A set of default-styled components: `AgentChat` / `AgentMessage` / `AgentToolCall` / `AgentSuspend` / `AgentInput`, each with slots for partial replacement.

Requires Vue `^3.4.0`.

### Install

```bash
pnpm add @xiaofeiqwq/vue
```

### Minimal usage: a ready-made UI

```vue
<script setup lang="ts">
import { AgentChat, ensureAgentStyles } from '@xiaofeiqwq/vue';
ensureAgentStyles();
</script>

<template>
  <div style="height: 100vh">
    <AgentChat base-url="http://localhost:3000" title="Coding assistant" show-usage />
  </div>
</template>
```

`ensureAgentStyles()` injects the default styles once (skipped automatically under SSR); set `:auto-styles="false"` to control it yourself.

### Global registration

```ts
import { createApp } from 'vue';
import { MeowFlowVue } from '@xiaofeiqwq/vue';

createApp(App).use(MeowFlowVue).mount('#app'); // registers AgentChat and friends
```

### useAgent

```ts
import { useAgent } from '@xiaofeiqwq/vue';

const agent = useAgent({
  baseUrl: 'http://localhost:3000',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
  onEvent: (event) => console.debug(event),
  onError: (error) => console.error(error.code, error.message),
});
```

| Option | Type | Description |
| --- | --- | --- |
| `baseUrl` | `string` | Server base URL; defaults to same-origin relative paths |
| `routes` | `Partial<{ run, resume, abort }>` | Override default routes |
| `headers` | `Record<string,string> \| () => Record<string,string>` | Extra headers; use a function for dynamic tokens |
| `fetch` | `typeof fetch` | Custom fetch for tests or auth injection |
| `runOptions` | `{ system?, temperature?, maxTokens?, metadata? }` | Defaults sent with every run |
| `onEvent` | `(event: AgentEvent) => void` | Called for each event |
| `onFinish` | `(state: AccumulatedState) => void` | Called when a run finishes |
| `onError` | `(error: { code, message }) => void` | Called on error |

Returned controller:

| Field | Type | Description |
| --- | --- | --- |
| `state` | `AccumulatedState` | Full reduced state (Vue reactive object, updates on field changes) |
| `messages` | `ComputedRef<AccumulatedMessage[]>` | Messages (content / thinking / toolCalls / streaming) |
| `status` | `ComputedRef<AgentRunStatus>` | `idle` / `streaming` / `suspended` / `error` |
| `isStreaming` | `ComputedRef<boolean>` | Whether output is streaming |
| `error` | `ComputedRef<{ code, message } \| undefined>` | Current error |
| `usage` | `ComputedRef<Usage \| undefined>` | Token usage |
| `sessionId` | `ComputedRef<string \| undefined>` | Session id |
| `pendingSuspend` | `ComputedRef<AccumulatedToolCall \| undefined>` | The tool call awaiting an answer, if suspended |

| Method | Description |
| --- | --- |
| `send(input, extra?)` | Send a user message and start a run |
| `resume(answer)` | Submit an answer for a suspended call and continue |
| `abort()` | Abort the current run |
| `reset()` | Clear local state |

The in-flight request is aborted automatically when the component unmounts.

```vue
<script setup lang="ts">
import { useAgent } from '@xiaofeiqwq/vue';

const agent = useAgent({ baseUrl: 'http://localhost:3000' });
</script>

<template>
  <div>
    <div v-for="message in agent.messages.value" :key="message.id">
      <b>{{ message.role }}</b>
      <div>{{ message.content }}</div>
    </div>
    <button @click="agent.send('Hello')">Send</button>
  </div>
</template>
```

### Components

#### AgentChat

A complete chat UI. Accepts the same connection config as `useAgent`, or an existing controller.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `agent` | `AgentController` | — | Reuse an external controller; created internally otherwise |
| `baseUrl` / `routes` / `headers` / `runOptions` | same as `useAgent` | — | Connection config |
| `title` | `string` | — | Title |
| `emptyText` | `string` | `'Start a conversation...'` | Empty-state text |
| `placeholder` | `string` | input placeholder | — |
| `autoStyles` | `boolean` | `true` | Whether to inject default styles |
| `showUsage` | `boolean` | `false` | Whether to show token usage |

Slots: `header`, `empty`, `message({ message })`, `suspend({ call, answer })`, `footer`, `input({ send, abort, streaming })`.

#### AgentMessage

Renders one message: collapsible thinking, content, and its tool calls.

- Prop: `message: AccumulatedMessage`
- Slots: `default({ message })`, `thinking({ thinking })`, `tool-call({ call })`

#### AgentToolCall

Renders a single tool call's args and result; collapsed by default, click to expand.

- Props: `call: AccumulatedToolCall`, `defaultOpen = false`
- Slot: `default({ call, open, toggle })`

#### AgentSuspend

Renders a suspension: `approval` shows Allow/Deny, `user-input` shows options or a free-text field.

- Prop: `call: AccumulatedToolCall`
- Event: `answer(value)`
- Slot: `default({ call, answer })`

#### AgentInput

Input box: Enter to send, Shift+Enter for newline; shows a stop button while streaming.

- Props: `disabled`, `streaming`, `placeholder`, `sendText` (default "发送"), `stopText` (default "停止")
- Events: `submit(value)`, `stop`
- Slot: `default({ text, submit, setText })`

### Styling

Default styles expose theming through CSS variables on `.ak-chat`; override them to tweak the look:

```css
.ak-chat {
  --ak-accent: #7c3aed;
  --ak-user-bg: #f5f3ff;
  --ak-assistant-bg: #fafafa;
  --ak-radius: 12px;
}
```

Available variables: `--ak-bg`, `--ak-border`, `--ak-text`, `--ak-muted`, `--ak-accent`, `--ak-user-bg`, `--ak-assistant-bg`, `--ak-tool-bg`, `--ak-error`, `--ak-radius`.

You can also skip the default components entirely, render with `useAgent` yourself, or inject `AGENT_STYLES` on your own.
