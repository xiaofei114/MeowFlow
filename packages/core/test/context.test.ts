import { describe, expect, it } from 'vitest';
import type { Message } from '@xiaofeiqwq/protocol';
import { compressContext, estimateTokens, type Provider, type ProviderChunk } from '../src/index';

function summaryProvider(text = '摘要'): Provider {
  return {
    name: 'mock',
    model: 'mock-1',
    async *chat(): AsyncGenerator<ProviderChunk> {
      yield { type: 'text-delta', text };
      yield { type: 'finish', reason: 'stop' };
    },
  };
}

describe('estimateTokens', () => {
  it('中文按字估算，英文按 4 字符估算', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('compressContext', () => {
  it('尾部没有 user 消息时不压缩，避免丢掉最近上下文', async () => {
    const messages: Message[] = [
      { role: 'system', content: '系统' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', name: 'echo', content: 'r1' },
      { role: 'tool', toolCallId: 'c1', name: 'echo', content: 'r2' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'echo', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c2', name: 'echo', content: 'r3' },
    ];

    const result = await compressContext({
      provider: summaryProvider(),
      messages,
      keepRecentMessages: 2,
      maxToolResultLength: 100,
    });

    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('切分点对齐到 user，且保留最近消息', async () => {
    const messages: Message[] = [
      { role: 'system', content: '系统' },
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: '第二轮' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: '第三轮' },
      { role: 'assistant', content: 'a3' },
    ];

    const result = await compressContext({
      provider: summaryProvider('已压缩的摘要'),
      messages,
      keepRecentMessages: 2,
      maxToolResultLength: 100,
    });

    expect(result.compressed).toBe(true);
    expect(result.summary).toBe('已压缩的摘要');
    // 保留 system + 摘要，且 recent 必须以 user 开头
    expect(result.messages[0]?.role).toBe('system');
    expect(result.messages[0]?.content).toContain('已压缩的摘要');
    expect(result.messages[1]?.role).toBe('user');
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });
});
