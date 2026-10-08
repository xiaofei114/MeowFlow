import type { AgentEvent } from './events';

/** 把事件编码为一条 SSE `data:` 帧。 */
export function encodeSse(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** 编码一条自定义 SSE 事件（带 event 名）。 */
export function encodeSseNamed(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 编码 SSE 注释，通常用作心跳保活。 */
export function encodeSseComment(text: string): string {
  return `: ${text}\n\n`;
}

/** 从 `data:` 载荷解析出事件对象。 */
export function decodeSseEvent(payload: string): AgentEvent {
  return JSON.parse(payload) as AgentEvent;
}

/**
 * 增量式 SSE 解析器。
 *
 * 只处理纯文本，不关心底层是 fetch 流、Node 流还是 WebSocket，
 * 因此可以同时被浏览器与 Node 复用。
 */
export class SseParser {
  private buffer = '';

  /** 追加一段文本，返回本次能够解析出的完整 `data` 载荷列表。 */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const payloads: string[] = [];

    for (;;) {
      const boundary = this.findBoundary();
      if (boundary < 0) break;

      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + (this.buffer[boundary] === '\r' ? 4 : 2));

      const payload = parseSseBlock(block);
      if (payload !== undefined) payloads.push(payload);
    }

    return payloads;
  }

  /** 结束前调用，处理最后一个可能没有以空行结尾的块。 */
  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    if (rest.trim() === '') return [];
    const payload = parseSseBlock(rest);
    return payload === undefined ? [] : [payload];
  }

  reset(): void {
    this.buffer = '';
  }

  private findBoundary(): number {
    const lf = this.buffer.indexOf('\n\n');
    const crlf = this.buffer.indexOf('\r\n\r\n');
    if (lf < 0) return crlf;
    if (crlf < 0) return lf;
    return Math.min(lf, crlf);
  }
}

function parseSseBlock(block: string): string | undefined {
  const dataLines: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '' || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;

    const value = line.slice(5);
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
  }

  return dataLines.length === 0 ? undefined : dataLines.join('\n');
}
