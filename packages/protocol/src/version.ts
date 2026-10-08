/**
 * 协议版本号。
 *
 * 任何破坏性的协议变更都必须提升该版本，前端组件与其他语言后端据此做兼容判断。
 */
export const PROTOCOL_VERSION = '1.0';

export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** SSE 事件流的 HTTP 路径，服务端与客户端共用，避免各自硬编码。 */
export const SSE_CONTENT_TYPE = 'text/event-stream; charset=utf-8';
