/** 一次模型调用的 token 消耗统计。 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** 创建 Usage，便于累加时保持字段齐全。 */
export function createUsage(inputTokens = 0, outputTokens = 0): Usage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/** 累加两个 Usage；任意一方为空时返回另一方。 */
export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  return createUsage(a.inputTokens + b.inputTokens, a.outputTokens + b.outputTokens);
}
