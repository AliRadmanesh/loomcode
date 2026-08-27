import type { Tool } from "./index.ts";

export const runCommandTool: Tool = {
  name: "run_command",
  description: "Run a shell command and return its combined stdout/stderr.",
  parameters: {
    type: "object",
    properties: { cmd: { type: "string" } },
    required: ["cmd"],
  },
  async execute(args) {
    const cmd = String(args.cmd ?? "");
    try {
      const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const combined = (stdout + stderr).trim();
      if (exitCode !== 0) {
        return `Error: exited with code ${exitCode}\n${combined}`;
      }
      return combined || "(no output)";
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
