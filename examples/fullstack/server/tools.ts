/**
 * 自定义工具示例。
 *
 * 用 `defineTool` 定义后，即可和内置工具一起挂到 Agent 的 `tools` 上。
 * 这里刻意不依赖网络，方便 demo 离线跑通；真实场景把 fetch 那段放开即可。
 */
import { defineTool, toolError, toolResult, type ToolDefinition } from '@meowflow/core';

type WeatherArgs = { city: string; unit?: 'c' | 'f' };

/** 查询天气的自定义工具。 */
export function createWeatherTool(): ToolDefinition {
  return defineTool({
    name: 'get_weather',
    description: '查询指定城市的当前天气。',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名，例如 北京' },
        unit: { type: 'string', enum: ['c', 'f'], description: '温度单位，默认 c' },
      },
      required: ['city'],
      additionalProperties: false,
    },
    async execute(rawArgs, ctx) {
      // 参数类型按需收窄（Agent.tools 是 ToolDefinition[]，Args 默认 Record<string, unknown>）
      const args = rawArgs as WeatherArgs;
      const city = args.city.trim();
      if (!city) return toolError('城市名不能为空。');

      const unit = args.unit ?? 'c';
      ctx.logger.debug(`查询天气：${city}`);

      // 真实场景替换成真正的请求：
      //   const res = await fetch(`https://api.example.com/weather?city=${encodeURIComponent(city)}`, {
      //     signal: ctx.signal,
      //   });
      //   if (!res.ok) return toolError(`天气服务返回 ${res.status}`);
      const data = { temp: unit === 'f' ? 68 : 20, text: '晴' };

      // content 回填给模型；data 回填给前端（前端可直接结构化渲染）。
      return toolResult(`${city} 当前${data.text}，气温 ${data.temp}°${unit.toUpperCase()}`, {
        city,
        temp: data.temp,
        unit,
        text: data.text,
      });
    },
  });
}
