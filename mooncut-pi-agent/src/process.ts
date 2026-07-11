import {spawn} from "node:child_process";

export type ProcessResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export const runProcess = async (
  command: string,
  args: string[],
  options: {cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number} = {},
): Promise<ProcessResult> => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {...process.env, ...options.env},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  let timeout: NodeJS.Timeout | undefined;
  let forceKill: NodeJS.Timeout | undefined;
  let exitFallback: NodeJS.Timeout | undefined;
  const result = await new Promise<ProcessResult>((resolvePromise, reject) => {
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (exitFallback) clearTimeout(exitFallback);
      resolvePromise({
        command: [command, ...args].join(" "),
        exitCode: code ?? -1,
        stdout,
        stderr,
      });
    };
    child.once("error", reject);
    child.once("close", finish);
    child.once("exit", (code) => {
      // A browser grandchild can inherit stdout/stderr and keep Node's `close`
      // event pending after the actual command has exited. Preserve a short
      // drain window, then finish from `exit` so jobs never stall indefinitely.
      exitFallback = setTimeout(() => finish(code), 1_000);
    });
    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        forceKill = setTimeout(() => child.kill("SIGKILL"), 5_000);
      }, options.timeoutMs);
    }
  });
  if (timeout) clearTimeout(timeout);
  if (forceKill) clearTimeout(forceKill);
  if (exitFallback) clearTimeout(exitFallback);
  if (result.exitCode !== 0) {
    throw new Error(`${result.command} failed (${result.exitCode})\n${result.stderr || result.stdout}`);
  }
  return result;
};
