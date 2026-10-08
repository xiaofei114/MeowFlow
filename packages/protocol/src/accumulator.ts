import type { AgentEvent, RunStatus, SuspendReason } from './events';
import type { Usage } from './usage';

/** 工具调用在客户端侧的状态。 */
export type ToolCallStatus = 'pending' | 'running' | 'ok' | 'error' | 'suspended';

export interface AccumulatedToolCall {
  callId: string;
  name: string;
  /** 流式拼装中的原始 JSON 文本 */
  argsText: string;
  /** 拼装完成后的参数对象 */
  args?: unknown;
  status: ToolCallStatus;
  result?: unknown;
  suspendReason?: SuspendReason;
  suspendPayload?: unknown;
  durationMs?: number;
}

export interface AccumulatedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking: string;
  toolCalls: AccumulatedToolCall[];
  /** 是否仍在流式输出 */
  streaming: boolean;
  createdAt: number;
}

export type AgentRunStatus = 'idle' | 'streaming' | 'suspended' | 'error';

export interface AccumulatedState {
  messages: AccumulatedMessage[];
  status: AgentRunStatus;
  error?: { code: string; message: string };
  usage?: Usage;
  runId?: string;
  sessionId?: string;
  /** 挂起时待回答的调用 id */
  suspendCallId?: string;
}

/** 创建一份空白状态。 */
export function createAccumulatedState(): AccumulatedState {
  return { messages: [], status: 'idle' };
}

/**
 * 事件归约器：把 `AgentEvent` 流还原成可直接渲染的消息列表。
 *
 * 这是协议语义的参考实现，Vue 组件以及任何 JS 客户端都可以直接复用。
 */
export class AgentEventAccumulator {
  readonly state: AccumulatedState;

  private messageSeq = 0;

  /**
   * @param state 可注入的状态对象。传入 Vue 的 `reactive()` / MobX 等响应式对象时，
   * 归约过程中的所有变更都会经过它，从而获得深度响应式更新。
   */
  constructor(state: AccumulatedState = createAccumulatedState()) {
    this.state = state;
  }

  /** 追加一条用户消息（发送输入时调用）。 */
  addUserMessage(text: string): AccumulatedMessage {
    const message: AccumulatedMessage = {
      id: this.nextMessageId('user'),
      role: 'user',
      content: text,
      thinking: '',
      toolCalls: [],
      streaming: false,
      createdAt: Date.now(),
    };
    this.state.messages.push(message);
    return message;
  }

  apply(event: AgentEvent): void {
    switch (event.type) {
      case 'run-start': {
        this.state.runId = event.runId;
        this.state.sessionId = event.sessionId;
        this.state.status = 'streaming';
        this.state.error = undefined;
        this.state.suspendCallId = undefined;
        break;
      }
      case 'message-start': {
        this.pushAssistant();
        break;
      }
      case 'thinking-delta': {
        const message = this.currentAssistant();
        message.thinking += event.text;
        break;
      }
      case 'text-delta': {
        const message = this.currentAssistant();
        message.content += event.text;
        break;
      }
      case 'tool-call-start': {
        const message = this.currentAssistant();
        message.toolCalls.push({
          callId: event.callId,
          name: event.name,
          argsText: '',
          status: 'pending',
        });
        break;
      }
      case 'tool-call-args-delta': {
        const call = this.findToolCall(event.callId);
        if (call) call.argsText += event.delta;
        break;
      }
      case 'tool-call-end': {
        const call = this.findToolCall(event.callId);
        if (call) {
          call.args = event.args;
          call.status = 'running';
        }
        break;
      }
      case 'tool-call-result': {
        const call = this.findToolCall(event.callId);
        if (call) {
          call.status = event.status;
          call.result = event.result;
          call.durationMs = event.durationMs;
        }
        break;
      }
      case 'tool-call-suspend': {
        const call = this.findToolCall(event.callId);
        if (call) {
          call.status = 'suspended';
          call.suspendReason = event.reason;
          call.suspendPayload = event.payload;
        }
        this.state.status = 'suspended';
        this.state.suspendCallId = event.callId;
        break;
      }
      case 'message-end': {
        const message = this.currentAssistant();
        message.content = event.message.content;
        message.thinking = event.message.thinking ?? '';
        message.streaming = false;
        break;
      }
      case 'usage': {
        this.state.usage = event.usage;
        break;
      }
      case 'error': {
        this.state.status = 'error';
        this.state.error = { code: event.code, message: event.message };
        break;
      }
      case 'run-end': {
        this.state.status = toRunStatus(event.status);
        this.state.usage = event.usage ?? this.state.usage;
        if (event.status === 'suspended') {
          this.state.suspendCallId = event.suspendCallId ?? this.state.suspendCallId;
        } else {
          this.state.suspendCallId = undefined;
        }
        this.finishStreaming();
        break;
      }
      case 'context-compressed': {
        break;
      }
    }
  }

  /** 批量归约事件。 */
  applyAll(events: Iterable<AgentEvent>): void {
    for (const event of events) this.apply(event);
  }

  reset(): void {
    this.messageSeq = 0;
    this.state.messages = [];
    this.state.status = 'idle';
    this.state.error = undefined;
    this.state.usage = undefined;
    this.state.runId = undefined;
    this.state.sessionId = undefined;
    this.state.suspendCallId = undefined;
  }

  private nextMessageId(role: string): string {
    this.messageSeq += 1;
    return `${role}-${Date.now()}-${this.messageSeq}`;
  }

  private pushAssistant(): AccumulatedMessage {
    const message: AccumulatedMessage = {
      id: this.nextMessageId('assistant'),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      streaming: true,
      createdAt: Date.now(),
    };
    this.state.messages.push(message);
    return message;
  }

  private currentAssistant(): AccumulatedMessage {
    const last = this.state.messages.at(-1);
    if (last && last.role === 'assistant') return last;
    return this.pushAssistant();
  }

  private findToolCall(callId: string): AccumulatedToolCall | undefined {
    for (let i = this.state.messages.length - 1; i >= 0; i -= 1) {
      const message = this.state.messages[i];
      if (!message) continue;
      for (let j = message.toolCalls.length - 1; j >= 0; j -= 1) {
        const call = message.toolCalls[j];
        if (call && call.callId === callId) return call;
      }
    }
    return undefined;
  }

  private finishStreaming(): void {
    const last = this.state.messages.at(-1);
    if (last && last.role === 'assistant') last.streaming = false;
  }
}

function toRunStatus(status: RunStatus): AgentRunStatus {
  if (status === 'suspended') return 'suspended';
  if (status === 'error') return 'error';
  return 'idle';
}
