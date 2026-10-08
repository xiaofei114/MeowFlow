import type { AccumulatedToolCall } from '@meowflow/protocol';
import { defineComponent, h, ref, type PropType, type VNodeChild } from 'vue';

const STATUS_LABEL: Record<AccumulatedToolCall['status'], string> = {
  pending: '准备中',
  running: '执行中',
  ok: '完成',
  error: '失败',
  suspended: '等待确认',
};

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 渲染单个工具调用的参数与结果，默认折叠，可点击展开。 */
export const AgentToolCall = defineComponent({
  name: 'AgentToolCall',
  props: {
    call: { type: Object as PropType<AccumulatedToolCall>, required: true },
    defaultOpen: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const open = ref(props.defaultOpen);
    const toggle = (): void => {
      open.value = !open.value;
    };

    return () => {
      const call = props.call;
      if (slots.default) return slots.default({ call, open: open.value, toggle });

      const head = h('div', { class: 'ak-tool__head', onClick: toggle }, [
        h('span', { class: 'ak-tool__name' }, call.name),
        h(
          'span',
          { class: `ak-tool__status ak-tool__status--${call.status}` },
          STATUS_LABEL[call.status],
        ),
      ]);

      const body: VNodeChild[] = [];
      if (open.value) {
        const argsText = call.args !== undefined ? toText(call.args) : call.argsText;
        if (argsText !== '') {
          body.push(h('div', { class: 'ak-tool__label' }, '参数'));
          body.push(h('div', { class: 'ak-tool__body' }, argsText));
        }
        if (call.result !== undefined) {
          body.push(h('div', { class: 'ak-tool__label' }, '结果'));
          body.push(h('div', { class: 'ak-tool__body' }, toText(call.result)));
        }
        if (call.status === 'suspended') {
          body.push(h('div', { class: 'ak-tool__label' }, '该工具正在等待用户处理'));
        }
      }

      return h('div', { class: 'ak-tool' }, [head, ...body]);
    };
  },
});
