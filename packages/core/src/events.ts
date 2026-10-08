import { PROTOCOL_VERSION } from '@meowflow/protocol';
import type { AgentEvent } from '@meowflow/protocol';

/** 对联合类型做分配式 Omit，避免 Omit 把联合压扁。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 由框架负责补齐元信息的“半成品”事件，工具与内部逻辑只需产出这一层。 */
export type EmittableEvent = DistributiveOmit<
  AgentEvent,
  'v' | 'runId' | 'sessionId' | 'seq' | 'ts'
>;

/**
 * 事件工厂：为一次运行内的事件补齐版本号、运行 id、会话 id、序号与时间戳。
 *
 * 序号由工厂单调递增分配，保证事件流顺序可被前端直接信任。
 */
export class EventFactory {
  private seq = 0;

  constructor(
    private readonly runId: string,
    private readonly sessionId: string,
  ) {}

  create(event: EmittableEvent): AgentEvent {
    const base = {
      v: PROTOCOL_VERSION,
      runId: this.runId,
      sessionId: this.sessionId,
      seq: this.seq,
      ts: Date.now(),
    };
    this.seq += 1;
    return { ...base, ...event } as AgentEvent;
  }
}
