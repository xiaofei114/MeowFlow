import { PROTOCOL_VERSION } from './version';

type JsonSchema = Record<string, unknown>;

const envelope: JsonSchema = {
  v: { type: 'string', const: PROTOCOL_VERSION },
  runId: { type: 'string', minLength: 1 },
  sessionId: { type: 'string', minLength: 1 },
  seq: { type: 'integer', minimum: 0 },
  ts: { type: 'integer', minimum: 0 },
};

const usageSchema: JsonSchema = {
  type: 'object',
  required: ['inputTokens', 'outputTokens', 'totalTokens'],
  properties: {
    inputTokens: { type: 'integer', minimum: 0 },
    outputTokens: { type: 'integer', minimum: 0 },
    totalTokens: { type: 'integer', minimum: 0 },
  },
};

function variant(
  type: string,
  properties: JsonSchema = {},
  required: string[] = Object.keys(properties),
): JsonSchema {
  return {
    title: type,
    type: 'object',
    required: ['v', 'runId', 'sessionId', 'seq', 'ts', 'type', ...required],
    properties: {
      ...envelope,
      type: { const: type },
      ...properties,
    },
  };
}

/**
 * AgentEvent 的 JSON Schema（draft-07）。
 *
 * 提供给非 TypeScript 的后端/客户端做校验与代码生成，是与语言无关的协议契约。
 */
export const agentEventJsonSchema: JsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://meowflow.dev/schema/agent-event.v${PROTOCOL_VERSION}.json`,
  title: 'AgentEvent',
  oneOf: [
    variant('run-start', { model: { type: 'string' }, resumed: { type: 'boolean' } }),
    variant('message-start', { role: { const: 'assistant' } }),
    variant('thinking-delta', { text: { type: 'string' } }),
    variant('text-delta', { text: { type: 'string' } }),
    variant('tool-call-start', { callId: { type: 'string' }, name: { type: 'string' } }),
    variant('tool-call-args-delta', { callId: { type: 'string' }, delta: { type: 'string' } }),
    variant('tool-call-end', { callId: { type: 'string' }, name: { type: 'string' }, args: {} }),
    variant('tool-call-result', {
      callId: { type: 'string' },
      name: { type: 'string' },
      status: { enum: ['ok', 'error'] },
      result: {},
      durationMs: { type: 'number', minimum: 0 },
    }),
    variant('tool-call-suspend', {
      callId: { type: 'string' },
      name: { type: 'string' },
      reason: { enum: ['user-input', 'approval'] },
      payload: {},
    }),
    variant('context-compressed', {
      beforeTokens: { type: 'integer', minimum: 0 },
      afterTokens: { type: 'integer', minimum: 0 },
      summary: { type: 'string' },
    }),
    variant('usage', { usage: usageSchema }),
    variant('error', { code: { type: 'string' }, message: { type: 'string' } }),
    variant('message-end', { message: { type: 'object' } }),
    variant(
      'run-end',
      {
        status: { enum: ['completed', 'suspended', 'aborted', 'error'] },
        suspendCallId: { type: 'string' },
        usage: usageSchema,
      },
      ['status'],
    ),
  ],
};
