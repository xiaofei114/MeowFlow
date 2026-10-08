import type { Message, ToolCall } from '@meowflow/protocol';
import type { MaybePromise } from './tools/types';

/** 挂起中的工具调用批次，用于恢复运行。 */
export interface PendingToolBatch {
  /** 本批次全部工具调用 */
  calls: ToolCall[];
  /** 当前等待外部答案的调用下标 */
  index: number;
  /** 产生该挂起的运行 id */
  runId: string;
}

/** 会话状态，可完整序列化，便于落库或跨进程恢复。 */
export interface SessionState {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  /** 存在时表示会话处于挂起中 */
  pending?: PendingToolBatch;
  metadata?: Record<string, unknown>;
}

/** 会话存储接口，默认提供内存实现，可自行接入 Redis / 数据库。 */
export interface SessionStore {
  get(id: string): MaybePromise<SessionState | undefined>;
  set(state: SessionState): MaybePromise<void>;
  delete?(id: string): MaybePromise<void>;
  list?(): MaybePromise<SessionState[]>;
}

/** 创建一份空会话状态。 */
export function createSessionState(id: string, metadata?: Record<string, unknown>): SessionState {
  const now = Date.now();
  return {
    id,
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...(metadata ? { metadata } : {}),
  };
}

/** 基于 Map 的内存会话存储，适合单进程与测试。 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  set(state: SessionState): void {
    state.updatedAt = Date.now();
    this.sessions.set(state.id, state);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  list(): SessionState[] {
    return [...this.sessions.values()];
  }

  clear(): void {
    this.sessions.clear();
  }
}
