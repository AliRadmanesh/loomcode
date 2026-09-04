import type { Tool } from "./index.ts";

export const TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_CHARS = 4_000;

function capOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated, ${text.length - maxChars} more chars)`;
}

export async function runWithTimeout(
  cmd: string,
  timeoutMs = TIMEOUT_MS,
  maxOutputChars = MAX_OUTPUT_CHARS,
): Promise<string> {
  try {
    const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    if (timedOut) {
      return `Error: command timed out after ${timeoutMs}ms`;
    }

    const combined = (stdout + stderr).trim();
    if (exitCode !== 0) {
      return capOutput(`Error: exited with code ${exitCode}\n${combined}`, maxOutputChars);
    }
    return capOutput(combined || "(no output)", maxOutputChars);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const runCommandTool: Tool = {
  name: "run_command",
  description: "Run a shell command and return its combined stdout/stderr.",
  parameters: {
    type: "object",
    properties: { cmd: { type: "string" } },
    required: ["cmd"],
  },
  async execute(args) {
    return runWithTimeout(String(args.cmd ?? ""));
  },
};
