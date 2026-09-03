# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four gaps flagged by the Week 1 course review — an unguarded `JSON.parse` that can crash the agent loop, a `run_command` tool with no timeout or output cap, an approval gate that dumps raw JSON at the user, and a thin eval suite with no negative or error-recovery cases.

**Architecture:** Four independent, small changes to existing files — no new subsystems, no new runtime dependencies. (1) `src/loop.ts` gets a try/catch around argument parsing. (2) `src/tools/run-command.ts` factors its process-spawning into an exported `runWithTimeout(cmd, timeoutMs, maxOutputChars)` so a timeout and output cap can be tested without waiting 30 real seconds. (3) The `Tool` interface (`src/tools/index.ts`) gains an optional `describe?(args)` method that the four risky tools implement, and `loop.ts`'s confirmation call site uses it instead of raw JSON. (4) `src/eval/cases.ts` and `src/eval/mock-tools.ts` gain new cases and a mock that can simulate failure.

**Tech Stack:** Same as the rest of the branch — TypeScript on Bun, `openai` npm package against OpenRouter (Responses API), `bun:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-review-fixes-design.md`

## Global Constraints

- `run_command`'s `TIMEOUT_MS = 30_000` and `MAX_OUTPUT_CHARS = 4_000` are fixed exported constants, not env-configurable (matches the repo's simplicity principle).
- The timeout/cap values are overridable only via `runWithTimeout`'s optional parameters — a test seam, not user-facing or model-facing configuration. `runCommandTool.execute` always calls it with the defaults.
- `Tool.describe` is optional; only the four `RISKY` tools (`write_file`, `edit_file`, `run_command`, `delete_file`) implement it. `loop.ts` falls back to the raw `` `${call.name}(${call.arguments})` `` string when a risky tool has no `describe`.
- No change to `RISKY` set membership — only how each risky call's confirmation text is generated.
- No retry logic for the model on a JSON-parse failure — the fix makes the failure visible via the existing `function_call_output` channel; nothing enforces a retry.

---

### Task 1: Guard against malformed tool-call arguments

**Files:**
- Modify: `src/loop.ts:90-109` (the per-call loop inside `runTurn`)
- Test: `src/loop.test.ts`

**Interfaces:**
- Consumes: nothing new — `RunTurnOptions`, `ResponsesClient`, `ToolRegistry` all unchanged.
- Produces: no new exports. Behavior change only: a `function_call` whose `arguments` string fails `JSON.parse` now produces a `function_call_output` of `Error: invalid arguments JSON: <message>` instead of throwing out of `runTurn`.

- [ ] **Step 1: Write the failing test — append to `src/loop.test.ts`**

```ts
test("malformed tool call arguments produce an Error string, never throws", async () => {
  const okTool: Tool = {
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    execute: async () => "should not run",
  };
  let call = 0;
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        call++;
        if (call === 1) {
          return {
            output: [
              { type: "function_call", call_id: "call_1", name: "echo", arguments: "{not valid json" },
            ] as unknown as OpenAI.Responses.ResponseOutputItem[],
            output_text: "",
          };
        }
        return fakeResponse("done");
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "go" }];
  const answer = await runTurn({ client, model: "m", input, registry: { echo: okTool }, confirm: async () => true });
  expect(answer).toBe("done");
  const outputItem = input[2]! as OpenAI.Responses.ResponseInputItem.FunctionCallOutput;
  expect(outputItem.output).toStartWith("Error: invalid arguments JSON:");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/loop.test.ts`
Expected: FAIL — `runTurn` rejects with the raw `SyntaxError` from `JSON.parse` (e.g. `Unexpected token 'o', "{not valid"... is not valid JSON`) instead of resolving, since nothing currently catches it. This confirms today's crash, not a typo in the test.

- [ ] **Step 3: Guard the parse in `src/loop.ts`**

Replace the existing block:

```ts
      } else {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        if (RISKY.has(call.name)) {
          const allowed = await confirm(call.name, `${call.name}(${call.arguments})`);
          result = allowed ? await tool.execute(args) : "User denied this action.";
        } else {
          result = await tool.execute(args);
        }
      }
```

with:

```ts
      } else {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch (err) {
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: `Error: invalid arguments JSON: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }
        if (RISKY.has(call.name)) {
          const allowed = await confirm(call.name, `${call.name}(${call.arguments})`);
          result = allowed ? await tool.execute(args) : "User denied this action.";
        } else {
          result = await tool.execute(args);
        }
      }
```

The `continue` skips the loop's final `input.push({ type: "function_call_output", ... })` for this iteration since the catch block already pushed the error output itself — every other path (unknown tool, successful parse) still falls through to that final push unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/loop.test.ts`
Expected: PASS — 12/12 (11 existing + 1 new).

- [ ] **Step 5: Full regression check**

Run: `bun test` (whole repo) — expect all pass.
Run: `bunx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add src/loop.ts src/loop.test.ts
git commit -m "fix: guard against malformed tool-call arguments in the loop"
```

---

### Task 2: Add a timeout and output cap to `run_command`

**Files:**
- Modify: `src/tools/run-command.ts` (full rewrite of the file body, same exports plus new ones)
- Test: `src/tools/run-command.test.ts`

**Interfaces:**
- Consumes: `Tool` type from `src/tools/index.ts` (existing, unchanged in this task).
- Produces: `export const TIMEOUT_MS = 30_000`, `export const MAX_OUTPUT_CHARS = 4_000`, `export async function runWithTimeout(cmd: string, timeoutMs = TIMEOUT_MS, maxOutputChars = MAX_OUTPUT_CHARS): Promise<string>`. `runCommandTool: Tool` keeps its existing shape; `execute` now delegates to `runWithTimeout`.

- [ ] **Step 1: Write the failing tests — append to `src/tools/run-command.test.ts`**

```ts
import { runCommandTool, runWithTimeout, TIMEOUT_MS } from "./run-command.ts";

test("run_command times out and returns an Error string instead of hanging", async () => {
  const result = await runWithTimeout("sleep 5", 50);
  expect(result).toBe("Error: command timed out after 50ms");
});

test("run_command output beyond the cap is truncated with a marker", async () => {
  const result = await runWithTimeout("yes x | head -c 5000", TIMEOUT_MS, 100);
  expect(result).toContain("... (truncated,");
  expect(result.length).toBeLessThan(200);
});
```

(Update the existing `import { runCommandTool } from "./run-command.ts";` line at the top of the file to the combined import above rather than adding a second import line.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tools/run-command.test.ts`
Expected: FAIL — `runWithTimeout` and `TIMEOUT_MS` are not exported yet (`error: export named 'runWithTimeout' not found`), and even once importable, the current `runCommandTool` has no timeout or cap so `sleep 5` would actually sleep for 5 real seconds and never produce a timeout error.

- [ ] **Step 3: Implement in `src/tools/run-command.ts`**

Replace the entire file with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tools/run-command.test.ts`
Expected: PASS — 4/4 (2 existing + 2 new). The existing `"runs a command and returns its stdout"` and `"a failing command returns an Error string, not a throw"` tests are unaffected since neither hits the timeout or the 4000-char cap.

- [ ] **Step 5: Full regression check**

Run: `bun test` (whole repo) — expect all pass.
Run: `bunx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tools/run-command.ts src/tools/run-command.test.ts
git commit -m "feat: add timeout and output cap to run_command"
```

---

### Task 3: Human-readable approval descriptions

**Files:**
- Modify: `src/tools/index.ts` (extend the `Tool` interface)
- Modify: `src/tools/write-file.ts`
- Modify: `src/tools/edit-file.ts`
- Modify: `src/tools/run-command.ts` (builds on Task 2's version)
- Modify: `src/tools/delete-file.ts`
- Modify: `src/loop.ts:100-106` (the `RISKY` branch inside `runTurn`)
- Modify: `src/loop.test.ts` (update one existing test, add a fallback test)
- Test: `src/tools/filesystem-tools.test.ts`, `src/tools/run-command.test.ts`

**Interfaces:**
- Consumes: `Tool` interface (Task 3 extends it in place), `RISKY` set (unchanged), `runCommandTool`/`runWithTimeout` from Task 2 (unchanged by this task except for the added `describe`).
- Produces: `Tool.describe?: (args: Record<string, unknown>) => string`. `runTurn`'s risky-call confirmation text is now `tool.describe ? tool.describe(args) : \`${call.name}(${call.arguments})\``.

- [ ] **Step 1: Write the failing tests**

Append to `src/tools/filesystem-tools.test.ts`:

```ts
test("write_file describe summarizes path and byte length", () => {
  expect(writeFileTool.describe!({ path: "notes.txt", content: "hi" })).toBe("write notes.txt (2 bytes)");
});

test("edit_file describe names the path", () => {
  expect(editFileTool.describe!({ path: "config.json", oldString: "a", newString: "b" })).toBe("edit config.json");
});

test("delete_file describe names the path", () => {
  expect(deleteFileTool.describe!({ path: "notes.txt" })).toBe("delete notes.txt");
});
```

Append to `src/tools/run-command.test.ts`:

```ts
test("run_command describe echoes the full command", () => {
  expect(runCommandTool.describe!({ cmd: "rm -rf ./tmp" })).toBe("run: rm -rf ./tmp");
});
```

In `src/loop.test.ts`, update the existing test `"risky tool: confirm receives the tool name alongside the description"`: add a `describe` to its fake tool and change the assertion:

```ts
test("risky tool: confirm receives the tool name alongside the description", async () => {
  const fakeWriteFile: Tool = {
    name: "write_file",
    description: "fake",
    parameters: { type: "object", properties: {} },
    execute: async () => "wrote it",
    describe: (args) => `write ${String(args.path ?? "")}`,
  };
  let call = 0;
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        call++;
        if (call === 1) return fakeResponse("", [{ name: "write_file", args: { path: "x" }, call_id: "call_1" }]);
        return fakeResponse("done");
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "write x" }];
  const seen: Array<{ name: string; description: string }> = [];
  await runTurn({
    client,
    model: "m",
    input,
    registry: { write_file: fakeWriteFile },
    confirm: async (name, description) => {
      seen.push({ name, description });
      return true;
    },
  });
  expect(seen).toEqual([{ name: "write_file", description: "write x" }]);
});
```

Then add a new test to `src/loop.test.ts` right after it, covering the fallback path:

```ts
test("risky tool: falls back to raw JSON description when the tool has no describe", async () => {
  const fakeWriteFile: Tool = {
    name: "write_file",
    description: "fake",
    parameters: { type: "object", properties: {} },
    execute: async () => "wrote it",
  };
  let call = 0;
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        call++;
        if (call === 1) return fakeResponse("", [{ name: "write_file", args: { path: "x" }, call_id: "call_1" }]);
        return fakeResponse("done");
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "write x" }];
  const seen: string[] = [];
  await runTurn({
    client,
    model: "m",
    input,
    registry: { write_file: fakeWriteFile },
    confirm: async (_name, description) => {
      seen.push(description);
      return true;
    },
  });
  expect(seen).toEqual(['write_file({"path":"x"})']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tools/filesystem-tools.test.ts src/tools/run-command.test.ts src/loop.test.ts`
Expected: FAIL — `describe` is `undefined` on every tool today, so `writeFileTool.describe!(...)` throws `TypeError: writeFileTool.describe is not a function` (same for edit/delete/run_command), and the updated `loop.test.ts` assertion (`"write x"`) doesn't match today's raw-JSON output (`'write_file({"path":"x"})'`). The new fallback test is expected to already pass (documents current behavior) — that's fine, it should stay green through Step 4.

- [ ] **Step 3: Implement**

`src/tools/index.ts` — add one line to the `Tool` interface:

```ts
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
  describe?: (args: Record<string, unknown>) => string;
}
```

`src/tools/write-file.ts` — add `describe` after `execute`, inside the object literal:

```ts
  async execute(args) {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    try {
      await fsWriteFile(path, content, "utf8");
      return `Wrote ${content.length} bytes to ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  describe(args) {
    return `write ${String(args.path ?? "")} (${String(args.content ?? "").length} bytes)`;
  },
```

`src/tools/edit-file.ts` — add `describe` after `execute`:

```ts
  async execute(args) {
    const path = String(args.path ?? "");
    const oldString = String(args.oldString ?? "");
    const newString = String(args.newString ?? "");
    try {
      const content = await readFile(path, "utf8");
      if (!content.includes(oldString)) {
        return `Error: oldString not found in ${path}`;
      }
      await writeFile(path, content.replace(oldString, newString), "utf8");
      return `Edited ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  describe(args) {
    return `edit ${String(args.path ?? "")}`;
  },
```

`src/tools/delete-file.ts` — add `describe` after `execute`:

```ts
  async execute(args) {
    const path = String(args.path ?? "");
    try {
      await unlink(path);
      return `Deleted ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  describe(args) {
    return `delete ${String(args.path ?? "")}`;
  },
```

`src/tools/run-command.ts` — add `describe` after `execute` in `runCommandTool`:

```ts
  async execute(args) {
    return runWithTimeout(String(args.cmd ?? ""));
  },
  describe(args) {
    return `run: ${String(args.cmd ?? "")}`;
  },
```

`src/loop.ts` — change the `RISKY` branch:

```ts
        if (RISKY.has(call.name)) {
          const description = tool.describe ? tool.describe(args) : `${call.name}(${call.arguments})`;
          const allowed = await confirm(call.name, description);
          result = allowed ? await tool.execute(args) : "User denied this action.";
        } else {
          result = await tool.execute(args);
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tools/filesystem-tools.test.ts src/tools/run-command.test.ts src/loop.test.ts`
Expected: PASS — all tests in these three files green, including the new fallback test (which exercises a `write_file` fake with no `describe` and still expects the raw-JSON string).

- [ ] **Step 5: Full regression check**

Run: `bun test` (whole repo) — expect all pass.
Run: `bunx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tools/index.ts src/tools/write-file.ts src/tools/edit-file.ts \
        src/tools/run-command.ts src/tools/delete-file.ts src/loop.ts \
        src/loop.test.ts src/tools/filesystem-tools.test.ts src/tools/run-command.test.ts
git commit -m "feat: show human-readable descriptions in the approval gate"
```

---

### Task 4: Eval suite — negative cases and error recovery

**Files:**
- Modify: `src/eval/cases.ts`
- Modify: `src/eval/mock-tools.ts`

**Interfaces:**
- Consumes: `SingleTurnCase`, `MultiTurnCase` interfaces (existing, unchanged), `Tool` type for `mockRunCommandTool` (existing, unchanged).
- Produces: no new exports — `singleTurnCases` gains 3 entries, `multiTurnCases` gains 1 entry, `mockRunCommandTool.execute` becomes argument-dependent instead of a hardcoded string.

This task has no `bun:test` red/green cycle: `src/eval/eval.ts` calls the real OpenRouter API and isn't covered by unit tests (matches the existing project pattern — the eval suite is a standalone script run via `bun run eval`, not part of `bun test`). Verification here is a type-check plus the full unit-test regression, since neither the new cases nor the mock change any code path the unit tests exercise. Actually running the new eval cases against a live model is a manual follow-up.

- [ ] **Step 1: Add the new cases to `src/eval/cases.ts`**

Append to `singleTurnCases`:

```ts
export const singleTurnCases: SingleTurnCase[] = [
  { name: "arithmetic (no tool)", prompt: "What is 2+2?", expectedTool: null },
  { name: "web search", prompt: "Search for the latest React version.", expectedTool: "web_search" },
  { name: "write file", prompt: "Create hello.txt with 'hi' inside.", expectedTool: "write_file" },
  { name: "binary conversion (no tool)", prompt: "What's 2+2 in binary?", expectedTool: null },
  { name: "explain git rebase (no tool)", prompt: "Explain what git rebase does.", expectedTool: null },
  { name: "unit conversion (no tool)", prompt: "Convert 10 miles to km.", expectedTool: null },
];
```

Append to `multiTurnCases`:

```ts
export const multiTurnCases: MultiTurnCase[] = [
  {
    name: "write then run",
    prompt: "Write a python script primes.py that prints the first 5 primes, then run it.",
    expectedToolOrder: ["write_file", "run_command"],
    verifyFile: "primes.py",
    judgeQuestion: "write a script and run it, printing prime numbers",
  },
  {
    name: "reports command failure honestly",
    prompt: "Run the command `false` and tell me what happened.",
    expectedToolOrder: ["run_command"],
    judgeQuestion: "run a command that fails and honestly report that it failed, without claiming success",
  },
];
```

- [ ] **Step 2: Make the mock command failable in `src/eval/mock-tools.ts`**

Replace `mockRunCommandTool`:

```ts
export const mockRunCommandTool: Tool = {
  name: "run_command",
  description: "Mock run_command for eval.",
  parameters: {
    type: "object",
    properties: { cmd: { type: "string" } },
    required: ["cmd"],
  },
  async execute(args) {
    const cmd = String(args.cmd ?? "");
    if (cmd.includes("false")) {
      return "Error: exited with code 1";
    }
    return "2 3 5 7 11";
  },
};
```

This keeps the existing "write then run" case passing (its command won't contain `"false"`) while giving the new failure case a way to see a mocked failure without a real shell exit code.

- [ ] **Step 3: Type-check and run the full unit-test suite**

Run: `bunx tsc --noEmit -p .` — expect no errors.
Run: `bun test` (whole repo) — expect all pass (these files aren't imported by any `bun:test` file, so the count is unchanged from Task 3's end state).

- [ ] **Step 4: Commit**

```bash
git add src/eval/cases.ts src/eval/mock-tools.ts
git commit -m "test: add negative and error-recovery eval cases"
```

- [ ] **Step 5 (manual, post-merge): run the live eval**

With `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, and `OPENROUTER_JUDGE_MODEL` set in `.env`, run `bun run eval` and confirm all 7 single-turn cases and both multi-turn cases pass. This step needs live credentials and network access, so it isn't part of the automated task cycle above — flagging it here so it isn't silently skipped.
