/**
 * 默认样式。
 *
 * 通过 CSS 变量暴露主题能力，使用方既可覆盖变量微调，也可完全不用默认组件、
 * 只使用 useAgent 组合式函数自行渲染。
 */
export const AGENT_STYLES = `
.ak-chat {
  --ak-bg: #ffffff;
  --ak-border: #e5e7eb;
  --ak-text: #1f2937;
  --ak-muted: #6b7280;
  --ak-accent: #2563eb;
  --ak-user-bg: #eff6ff;
  --ak-assistant-bg: #f9fafb;
  --ak-tool-bg: #f3f4f6;
  --ak-error: #dc2626;
  --ak-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  color: var(--ak-text);
  background: var(--ak-bg);
  font-size: 14px;
  line-height: 1.6;
}
.ak-chat__list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 4px; }
.ak-chat__empty { color: var(--ak-muted); text-align: center; padding: 32px 0; }
.ak-msg { border: 1px solid var(--ak-border); border-radius: var(--ak-radius); padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
.ak-msg--user { background: var(--ak-user-bg); }
.ak-msg--assistant { background: var(--ak-assistant-bg); }
.ak-msg__role { font-size: 12px; color: var(--ak-muted); margin-bottom: 4px; }
.ak-msg__content:empty::after { content: '…'; color: var(--ak-muted); }
.ak-thinking { margin-bottom: 8px; border-left: 2px solid var(--ak-border); padding-left: 8px; color: var(--ak-muted); font-size: 13px; }
.ak-thinking__toggle { cursor: pointer; user-select: none; color: var(--ak-muted); }
.ak-tool { margin-top: 8px; border: 1px solid var(--ak-border); border-radius: var(--ak-radius); background: var(--ak-tool-bg); overflow: hidden; }
.ak-tool__head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.ak-tool__name { font-weight: 600; }
.ak-tool__status { margin-left: auto; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: #e5e7eb; color: var(--ak-muted); }
.ak-tool__status--running { background: #dbeafe; color: #1d4ed8; }
.ak-tool__status--ok { background: #dcfce7; color: #15803d; }
.ak-tool__status--error { background: #fee2e2; color: var(--ak-error); }
.ak-tool__status--suspended { background: #fef9c3; color: #a16207; }
.ak-tool__body { border-top: 1px solid var(--ak-border); padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto; }
.ak-tool__label { color: var(--ak-muted); font-size: 12px; margin: 6px 0 2px; }
.ak-input { display: flex; gap: 8px; align-items: flex-end; border-top: 1px solid var(--ak-border); padding-top: 12px; }
.ak-input__field { flex: 1; resize: none; border: 1px solid var(--ak-border); border-radius: var(--ak-radius); padding: 8px 10px; font: inherit; color: inherit; outline: none; min-height: 40px; max-height: 160px; }
.ak-input__field:focus { border-color: var(--ak-accent); }
.ak-input__send { border: none; border-radius: var(--ak-radius); background: var(--ak-accent); color: #fff; padding: 9px 16px; cursor: pointer; font: inherit; }
.ak-input__send:disabled { opacity: 0.5; cursor: not-allowed; }
.ak-input__stop { border: 1px solid var(--ak-border); border-radius: var(--ak-radius); background: transparent; color: var(--ak-text); padding: 9px 16px; cursor: pointer; font: inherit; }
.ak-suspend { border: 1px solid #fde68a; background: #fffbeb; border-radius: var(--ak-radius); padding: 10px 12px; }
.ak-suspend__question { font-weight: 600; margin-bottom: 8px; }
.ak-suspend__options { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.ak-suspend__option { border: 1px solid var(--ak-border); border-radius: 999px; background: #fff; padding: 4px 12px; cursor: pointer; font: inherit; }
.ak-suspend__option--active { border-color: var(--ak-accent); color: var(--ak-accent); }
.ak-suspend__actions { display: flex; gap: 8px; }
.ak-error { color: var(--ak-error); font-size: 13px; }
`;

let injected = false;

/** 注入默认样式，只执行一次；SSR 环境下自动跳过。 */
export function ensureAgentStyles(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.setAttribute('data-meowflow', '');
  style.textContent = AGENT_STYLES;
  document.head.appendChild(style);
}
