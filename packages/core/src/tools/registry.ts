import type { ToolSpec } from '@xiaofeiqwq/protocol';
import type { ToolDefinition } from './types';

/** 工具注册表，负责注册、查找与导出给模型的工具声明。 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    this.registerAll(tools);
  }

  register(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: ToolDefinition[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 全部工具，含隐藏工具。 */
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** 导出给模型的工具声明，自动过滤隐藏工具。 */
  toSpecs(): ToolSpec[] {
    return this.list()
      .filter((tool) => !tool.hidden)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  /** 派生一个新的注册表，追加/覆盖指定工具，便于子代理定制工具集。 */
  extend(tools: ToolDefinition[]): ToolRegistry {
    return new ToolRegistry(this.list()).registerAll(tools);
  }
}
