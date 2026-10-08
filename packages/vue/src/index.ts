// 前端适配出口：headless composable + 默认样式组件。
import type { App, Component, Plugin } from 'vue';
import { AgentChat } from './components/AgentChat';
import { AgentInput } from './components/AgentInput';
import { AgentMessage } from './components/AgentMessage';
import { AgentSuspend } from './components/AgentSuspend';
import { AgentToolCall } from './components/AgentToolCall';

export * from './useAgent';
export * from './styles';
export * from './components/AgentChat';
export * from './components/AgentMessage';
export * from './components/AgentToolCall';
export * from './components/AgentInput';
export * from './components/AgentSuspend';

/** 可全局注册的组件映射。 */
const components: Record<string, Component> = {
  AgentChat,
  AgentMessage,
  AgentToolCall,
  AgentInput,
  AgentSuspend,
};

/** Vue 插件，用于一次性注册全部组件。 */
export const MeowFlowVue: Plugin = {
  install(app: App): void {
    for (const [name, component] of Object.entries(components)) {
      app.component(name, component);
    }
  },
};

export { AgentChat, AgentMessage, AgentToolCall, AgentInput, AgentSuspend };
