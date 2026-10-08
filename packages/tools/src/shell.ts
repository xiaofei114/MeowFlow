import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { ToolResult, defineTool, toolError, type ToolDefinition } from '@xiaofeiqwq/core';
import { clip } from './utils';

export interface ShellToolOptions {
  /** 命令执行的工作目录，默认当前进程目录 */
  cwd?: string;
  /** 单条命令超时时间（毫秒），默认 60000 */
  timeoutMs?: number;
  /** 合并输出最大返回字符数，默认 40000 */
  maxOutputLength?: number;
  /** 需要审批的危险命令前缀黑名单；命中时即使在自动模式下也会请求审批 */
  blockedPrefixes?: string[];
  /** 是否对所有命令强制审批，默认 true */
  requireApproval?: boolean;
}

const DEFAULT_BLOCKED = ['rm -rf', 'shutdown', 'format', 'mkfs', 'del /f', 'rd /s'];

/**
 * 归一化命令文本，降低黑名单被空格/路径前缀绕过的风险。
 *
 * 例如 `rm    -rf`、`/bin/rm -rf`、`C:\Windows\del.exe` 都能被正确识别。
 * 这只是纵深防御的一部分，真正的安全边界仍是 `requireApproval`。
 */
function normalizeCommand(command: string): string {
  const tokens = command.toLowerCase().trim().split(/\s+/);
  const first = tokens[0];
  if (first !== undefined) {
    tokens[0] = first.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|com|sh)$/, '');
  }
  return tokens.join(' ');
}

/** 结束整个进程树，避免 `shell: true` 只杀掉 shell 而遗留子进程导致管道不关闭。 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // Windows 下用 taskkill /T 递归结束整棵进程树
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    // 非 Windows 平台把子进程放入独立进程组，用负 pid 结束整组
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 执行一条命令并收集输出，尊重外部中断信号。 */
function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RunResult> {
  return new Promise<RunResult>((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
      // 非 Windows 下建立独立进程组，便于整组结束
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const onAbort = (): void => {
      killTree(child);
    };
    // 若信号在注册监听前就已中止，监听器不会再触发，需要立即结束子树
    if (signal.aborted) killTree(child);
    else signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolvePromise({
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut,
      });
    });

    child.on('close', (code, closeSignal) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolvePromise({ code, signal: closeSignal, stdout, stderr, timedOut });
    });
  });
}

/** 创建 Shell 工具集：run_command（默认需要审批）。 */
export function createShellTools(options: ShellToolOptions = {}): ToolDefinition[] {
  const cwd = resolve(options.cwd ?? process.cwd());
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxOutputLength = options.maxOutputLength ?? 40_000;
  const requireApproval = options.requireApproval ?? true;
  const blockedPrefixes = (options.blockedPrefixes ?? DEFAULT_BLOCKED).map((prefix) => ({
    raw: prefix,
    normalized: normalizeCommand(prefix),
  }));

  const runCommandTool = defineTool({
    name: 'run_command',
    description:
      '在工作目录中执行一条 Shell 命令并返回退出码与输出。命令较长时应先说明用途，执行可能具有破坏性。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的完整命令' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    requiresApproval: requireApproval,
    approvalPrompt: (args) => `即将执行命令：${String(args.command ?? '')}，是否允许？`,
    execute: async (args, ctx) => {
      const command = String(args.command ?? '').trim();
      if (command === '') return toolError('缺少 command 参数');

      const normalized = normalizeCommand(command);
      const blocked = blockedPrefixes.find((prefix) => normalized.startsWith(prefix.normalized));
      if (blocked) {
        return toolError(`命令命中危险前缀「${blocked.raw}」，已拒绝执行`);
      }

      const result = await runCommand(command, cwd, timeoutMs, ctx.signal);

      const parts: string[] = [];
      if (result.stdout.trim() !== '') parts.push(result.stdout.trimEnd());
      if (result.stderr.trim() !== '') parts.push(`[stderr]\n${result.stderr.trimEnd()}`);

      const header = result.timedOut
        ? `命令超时（${timeoutMs}ms）已被终止`
        : `退出码：${result.code ?? 'null'}${result.signal ? `（信号 ${result.signal}）` : ''}`;
      const output = parts.join('\n\n');
      const summary = output === '' ? header : `${header}\n\n${output}`;

      return new ToolResult(
        clip(summary, maxOutputLength),
        {
          code: result.code,
          signal: result.signal,
          timedOut: result.timedOut,
          stdout: clip(result.stdout, maxOutputLength),
          stderr: clip(result.stderr, maxOutputLength),
        },
        result.code !== 0,
      );
    },
  });

  return [runCommandTool];
}
