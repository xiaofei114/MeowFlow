import type { AccumulatedToolCall } from '@meowflow/protocol';
import { defineComponent, h, ref, watch, type PropType, type VNodeChild } from 'vue';

interface ApprovalPayload {
  toolName?: string;
  args?: unknown;
  message?: string;
}

interface AskPayload {
  question?: string;
  options?: string[];
  multiple?: boolean;
  detail?: string;
}

function asApproval(payload: unknown): ApprovalPayload {
  return (payload ?? {}) as ApprovalPayload;
}

function asAsk(payload: unknown): AskPayload {
  return (payload ?? {}) as AskPayload;
}

/** 渲染挂起提示：危险操作审批或向用户提问，回答后通过 answer 事件回传。 */
export const AgentSuspend = defineComponent({
  name: 'AgentSuspend',
  props: {
    call: { type: Object as PropType<AccumulatedToolCall>, required: true },
  },
  emits: {
    answer: (_value: unknown) => true,
  },
  setup(props, { emit, slots }) {
    const text = ref('');
    const selected = ref<string[]>([]);

    watch(
      () => props.call.callId,
      () => {
        text.value = '';
        selected.value = [];
      },
    );

    const toggleOption = (option: string, multiple: boolean): void => {
      if (multiple) {
        selected.value = selected.value.includes(option)
          ? selected.value.filter((item) => item !== option)
          : [...selected.value, option];
        return;
      }
      selected.value = selected.value[0] === option ? [] : [option];
    };

    const submitAsk = (ask: AskPayload): void => {
      if (ask.options && ask.options.length > 0) {
        if (selected.value.length === 0) return;
        emit('answer', ask.multiple ? [...selected.value] : selected.value[0]);
        return;
      }
      const value = text.value.trim();
      if (value === '') return;
      emit('answer', value);
    };

    return () => {
      const call = props.call;
      if (slots.default)
        return slots.default({ call, answer: (value: unknown) => emit('answer', value) });

      if (call.suspendReason === 'approval') {
        const payload = asApproval(call.suspendPayload);
        return h('div', { class: 'ak-suspend' }, [
          h('div', { class: 'ak-suspend__question' }, payload.message ?? '是否允许执行？'),
          h('div', { class: 'ak-suspend__actions' }, [
            h(
              'button',
              { class: 'ak-input__send', type: 'button', onClick: () => emit('answer', true) },
              '允许',
            ),
            h(
              'button',
              { class: 'ak-input__stop', type: 'button', onClick: () => emit('answer', false) },
              '拒绝',
            ),
          ]),
        ]);
      }

      const ask = asAsk(call.suspendPayload);
      const options = ask.options ?? [];
      const hasOptions = options.length > 0;
      const multiple = ask.multiple === true;

      const children: VNodeChild[] = [
        h('div', { class: 'ak-suspend__question' }, ask.question ?? '需要你补充信息'),
      ];
      if (ask.detail) children.push(h('div', { class: 'ak-tool__label' }, ask.detail));

      if (hasOptions) {
        children.push(
          h(
            'div',
            { class: 'ak-suspend__options' },
            options.map((option) =>
              h(
                'button',
                {
                  type: 'button',
                  class: [
                    'ak-suspend__option',
                    selected.value.includes(option) ? 'ak-suspend__option--active' : '',
                  ],
                  onClick: () => toggleOption(option, multiple),
                },
                option,
              ),
            ),
          ),
        );
        children.push(
          h('div', { class: 'ak-suspend__actions' }, [
            h(
              'button',
              {
                class: 'ak-input__send',
                type: 'button',
                disabled: selected.value.length === 0,
                onClick: () => submitAsk(ask),
              },
              '确认',
            ),
          ]),
        );
      } else {
        children.push(
          h('div', { class: 'ak-input' }, [
            h('textarea', {
              class: 'ak-input__field',
              value: text.value,
              placeholder: '请输入回答',
              onInput: (event: Event) => {
                text.value = (event.target as HTMLTextAreaElement).value;
              },
              onKeydown: (event: KeyboardEvent) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitAsk(ask);
                }
              },
            }),
            h(
              'button',
              { class: 'ak-input__send', type: 'button', onClick: () => submitAsk(ask) },
              '提交',
            ),
          ]),
        );
      }

      return h('div', { class: 'ak-suspend' }, children);
    };
  },
});
