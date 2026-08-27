import { test, expect } from "bun:test";
import { runCommandTool } from "./run-command.ts";

test("runs a command and returns its stdout", async () => {
  const result = await runCommandTool.execute({ cmd: "echo hello" });
  expect(result).toContain("hello");
});

test("a failing command returns an Error string, not a throw", async () => {
  const result = await runCommandTool.execute({ cmd: "exit 1" });
  expect(result).toStartWith("Error:");
});
