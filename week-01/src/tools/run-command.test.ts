import { test, expect } from "bun:test";
import { runCommandTool, runWithTimeout, TIMEOUT_MS } from "./run-command.ts";

test("runs a command and returns its stdout", async () => {
  const result = await runCommandTool.execute({ cmd: "echo hello" });
  expect(result).toContain("hello");
});

test("a failing command returns an Error string, not a throw", async () => {
  const result = await runCommandTool.execute({ cmd: "exit 1" });
  expect(result).toStartWith("Error:");
});

test("run_command times out and returns an Error string instead of hanging", async () => {
  const result = await runWithTimeout("sleep 5", 50);
  expect(result).toBe("Error: command timed out after 50ms");
});

test("run_command output beyond the cap is truncated with a marker", async () => {
  const result = await runWithTimeout("yes x | head -c 5000", TIMEOUT_MS, 100);
  expect(result).toContain("... (truncated,");
  expect(result.length).toBeLessThan(200);
});

test("run_command describe echoes the full command", () => {
  expect(runCommandTool.describe!({ cmd: "rm -rf ./tmp" })).toBe("run: rm -rf ./tmp");
});
