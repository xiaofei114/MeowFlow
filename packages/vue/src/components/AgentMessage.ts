import type { AccumulatedMessage } from '@xiaofeiqwq/protocol';
import { defineComponent, h, ref, type PropType, type VNodeChild } from 'vue';
import { AgentToolCall } from './AgentToolCall';

/** 渲染一条消息：思考过程、正文与其中的工具调用。 */
export const AgentMessage = defineComponent({
  name: 'AgentMessage',
  props: {
    message: { type: Object as PropType<AccumulatedMessage>, required: true },
  },
  setup(props, { slots }) {
    const thinkingOpen = ref(false);

    return () => {
      const message = props.message;
      if (slots.default) return slots.default({ message });

      const children: VNodeChild[] = [
        h('div', { class: 'ak-msg__role' }, message.role === 'user' ? '用户' : '助手'),
      ];

      if (message.thinking !== '') {
        children.push(
          slots.thinking
            ? slots.thinking({ thinking: message.thinking })
            : h('div', { class: 'ak-thinking' }, [
                h(
                  'div',
                  {
                    class: 'ak-thinking__toggle',
                    onClick: () => {
                      thinkingOpen.value = !thinkingOpen.value;
                    },
                  },
                  thinkingOpen.value ? '▾ 思考过程' : '▸ 思考过程',
                ),
                thinkingOpen.value ? h('div', {}, message.thinking) : null,
              ]),
        );
      }

      if (message.content !== '') {
        children.push(h('div', { class: 'ak-msg__content' }, message.content));
      } else if (message.streaming) {
        children.push(h('div', { class: 'ak-msg__content' }));
      }

      for (const call of message.toolCalls) {
        children.push(
          slots['tool-call'] ? slots['tool-call']({ call }) : h(AgentToolCall, { call }),
        );
      }

      return h('div', { class: ['ak-msg', `ak-msg--${message.role}`] }, children);
    };
  },
});
