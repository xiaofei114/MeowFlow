<script setup lang="ts">
import { AgentChat, useAgent } from '@xiaofeiqwq/vue';

// 不传 baseUrl：默认走同源相对路径，由 Vite 的 /agent 代理转发到后端。
const agent = useAgent();
const busy = agent.isStreaming;

const examples = [
  { label: '打招呼（流式文本）', text: '你好，简单介绍一下你自己' },
  { label: '查看目录（内置工具）', text: '帮我看看当前目录下有哪些文件' },
  { label: '查天气（自定义工具）', text: '北京天气怎么样？' },
  { label: '帮我决策（挂起提问）', text: '我该选哪个方案？' },
];

function pick(text: string): void {
  if (busy.value) return;
  void agent.send(text);
}
</script>

<template>
  <div class="demo">
    <header class="demo__bar">
      <span class="demo__hint">点击示例快速体验：</span>
      <button
        v-for="item in examples"
        :key="item.label"
        class="demo__btn"
        :disabled="busy"
        @click="pick(item.text)"
      >
        {{ item.label }}
      </button>
    </header>
    <div class="demo__chat">
      <AgentChat
        :agent="agent"
        title="MeowFlow 全栈 Demo"
        empty-text="点击上方示例，或直接输入消息开始对话"
        show-usage
      />
    </div>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
  background: #f3f4f6;
}
.demo {
  height: 100%;
  box-sizing: border-box;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 900px;
  margin: 0 auto;
}
.demo__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.demo__hint {
  font-size: 13px;
  color: #6b7280;
}
.demo__btn {
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #1f2937;
  border-radius: 999px;
  padding: 6px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.demo__btn:hover {
  border-color: #2563eb;
  color: #2563eb;
}
.demo__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.demo__btn:disabled:hover {
  border-color: #e5e7eb;
  color: #1f2937;
}
.demo__chat {
  flex: 1;
  min-height: 0;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
}
</style>
