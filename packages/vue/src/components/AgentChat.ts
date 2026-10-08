import type { AccumulatedMessage } from '@xiaofeiqwq/protocol';
import { computed, defineComponent, h, type PropType, type VNodeChild } from 'vue';
import { ensureAgentStyles } from '../styles';
import {
  useAgent,
  type AgentController,
  type AgentRoutes,
  type UseAgentOptions,
} from '../useAgent';
import { AgentInput } from './AgentInput';
import { AgentMessage } from './AgentMessage';
import { AgentSuspend } from './AgentSuspend';

/** AgentChat 接受与 useAgent 相同的连接配置，也可直接传入已创建的控制器。 */
export interface AgentChatProps {
  agent?: AgentController;
  baseUrl?: string;
  routes?: Partial<AgentRoutes>;
  headers?: UseAgentOptions['headers'];
  runOptions?: UseAgentOptions['runOptions'];
  title?: string;
  emptyText?: string;
  placeholder?: string;
  /** 是否注入默认样式，默认 true */
  autoStyles?: boolean;
  /** 是否展示 token 用量 */
  showUsage?: boolean;
}

/**
 * 默认样式的完整对话界面。
 *
 * 所有区域都提供插槽，既可直接使用，也可按需替换某一部分实现自定义。
 */
export const AgentChat = defineComponent({
  name: 'AgentChat',
  props: {
    agent: { type: Object as PropType<AgentController>, default: undefined },
    baseUrl: { type: String, default: undefined },
    routes: { type: Object as PropType<Partial<AgentRoutes>>, default: undefined },
    headers: {
      type: [Object, Function] as PropType<UseAgentOptions['headers']>,
      default: undefined,
    },
    runOptions: { type: Object as PropType<UseAgentOptions['runOptions']>, default: undefined },
    title: { type: String, default: undefined },
    emptyText: { type: String, default: '开始对话，向 Agent 提出你的需求' },
    placeholder: { type: String, default: '输入消息，Enter 发送，Shift+Enter 换行' },
    autoStyles: { type: Boolean, default: true },
    showUsage: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    if (props.autoStyles) ensureAgentStyles();

    const controller =
      props.agent ??
      useAgent({
        ...(props.baseUrl !== undefined ? { baseUrl: props.baseUrl } : {}),
        ...(props.routes !== undefined ? { routes: props.routes } : {}),
        ...(props.headers !== undefined ? { headers: props.headers } : {}),
        ...(props.runOptions !== undefined ? { runOptions: props.runOptions } : {}),
      });

    const busy = computed(() => controller.status.value === 'streaming');

    const renderMessage = (message: AccumulatedMessage): VNodeChild =>
      slots.message ? slots.message({ message }) : h(AgentMessage, { message });

    return () => {
      const list: VNodeChild[] =
        controller.messages.value.length === 0
          ? [slots.empty ? slots.empty() : h('div', { class: 'ak-chat__empty' }, props.emptyText)]
          : controller.messages.value.map(renderMessage);

      const children: VNodeChild[] = [];

      if (slots.header) {
        children.push(slots.header());
      } else if (props.title) {
        children.push(h('div', { class: 'ak-msg__role' }, props.title));
      }

      children.push(h('div', { class: 'ak-chat__list' }, list));

      const pending = controller.pendingSuspend.value;
      if (pending) {
        children.push(
          slots.suspend
            ? slots.suspend({
                call: pending,
                answer: (value: unknown) => void controller.resume(value),
              })
            : h(AgentSuspend, {
                call: pending,
                onAnswer: (value: unknown) => void controller.resume(value),
              }),
        );
      }

      if (controller.error.value) {
        children.push(h('div', { class: 'ak-error' }, controller.error.value.message));
      }

      if (props.showUsage && controller.usage.value) {
        const usage = controller.usage.value;
        children.push(
          h(
            'div',
            { class: 'ak-msg__role' },
            `输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} tokens`,
          ),
        );
      }

      if (slots.footer) children.push(slots.footer());

      if (slots.input) {
        children.push(
          slots.input({
            send: controller.send,
            abort: controller.abort,
            streaming: busy.value,
          }),
        );
      } else {
        children.push(
          h(AgentInput, {
            streaming: busy.value,
            placeholder: props.placeholder,
            onSubmit: (value: string) => void controller.send(value),
            onStop: () => void controller.abort(),
          }),
        );
      }

      return h('div', { class: 'ak-chat' }, children);
    };
  },
});
