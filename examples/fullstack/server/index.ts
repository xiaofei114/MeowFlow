/**
 * Demo 服务端入口。
 *
 * 未配置 OPENAI_API_KEY 时使用内置 mock provider，可零配置直接跑通；
 * 配置后自动切换到真实模型（任何 OpenAI 兼容服务均可）。
 */
import { resolve } from 'node:path';
import { Agent, openaiCompat } from '@meowflow/core';
import { createAgentServer } from '@meowflow/server';
import { createDefaultTools } from '@meowflow/tools';
import { createMockProvider } from './mock-provider';
import { createWeatherTool } from './tools';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.MEOWFLOW_MODEL ?? 'gpt-4o-mini';
const port = Number(process.env.PORT ?? 3000);
const root = resolve(process.cwd());

const provider = apiKey
  ? openaiCompat({
      model,
      apiKey,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    })
  : createMockProvider({ model: 'mock-agent' });

const agent = new Agent({
  provider,
  // 内置工具 + 自定义工具混用
  tools: [...createDefaultTools({ root }), createWeatherTool()],
  systemPrompt: '你是一个可以读写文件、执行命令、检索代码的编码助手，请用中文回答。',
  // 不提供 onSuspend：进入「挂起-恢复」模式，审批与提问都交给前端处理。
});

const server = createAgentServer({ agent, port });
const info = await server.listen();

console.log(`[demo] Agent 服务已启动：${info.url}`);
console.log(
  `[demo] 模型：${apiKey ? model : 'mock-agent（未配置 OPENAI_API_KEY，使用内置 mock）'}`,
);
console.log(`[demo] 运行：POST ${info.url}/agent/run`);
console.log(`[demo] 恢复：POST ${info.url}/agent/resume`);
console.log(`[demo] 中断：POST ${info.url}/agent/abort`);
console.log(`[demo] 前端请访问 Vite 开发服务器（默认 http://localhost:5173）`);
