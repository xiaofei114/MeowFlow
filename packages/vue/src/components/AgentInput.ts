import { defineComponent, h, ref } from 'vue';

/** 输入框：Enter 发送，Shift+Enter 换行；流式中显示停止按钮。 */
export const AgentInput = defineComponent({
  name: 'AgentInput',
  props: {
    disabled: { type: Boolean, default: false },
    streaming: { type: Boolean, default: false },
    placeholder: { type: String, default: '输入消息，Enter 发送，Shift+Enter 换行' },
    sendText: { type: String, default: '发送' },
    stopText: { type: String, default: '停止' },
  },
  emits: {
    submit: (_value: string) => true,
    stop: () => true,
  },
  setup(props, { emit, slots }) {
    const text = ref('');

    const submit = (): void => {
      const value = text.value.trim();
      // 流式进行中不允许再次提交，避免与后端并发运行互相干扰
      if (value === '' || props.disabled || props.streaming) return;
      emit('submit', value);
      text.value = '';
    };

    return () => {
      if (slots.default) {
        return slots.default({
          text: text.value,
          submit,
          setText: (value: string) => {
            text.value = value;
          },
        });
      }

      return h('div', { class: 'ak-input' }, [
        h('textarea', {
          class: 'ak-input__field',
          value: text.value,
          placeholder: props.placeholder,
          disabled: props.disabled,
          onInput: (event: Event) => {
            text.value = (event.target as HTMLTextAreaElement).value;
          },
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          },
        }),
        props.streaming
          ? h(
              'button',
              { class: 'ak-input__stop', type: 'button', onClick: () => emit('stop') },
              props.stopText,
            )
          : h(
              'button',
              {
                class: 'ak-input__send',
                type: 'button',
                disabled: props.disabled,
                onClick: submit,
              },
              props.sendText,
            ),
      ]);
    };
  },
});
