# Week 1 CLI Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bootstrap's one-shot `src/agent.ts` into an interactive, tool-calling CLI agent (web search, file read/write/edit/list, shell commands) with a human-approval gate on risky actions, proven by a separate eval suite.

**Architecture:** A hand-rolled Responses API loop (`src/loop.ts`) holds conversation state as an array of input items and round-trips with the model until it stops calling tools (the "no tool call" stop rule) or hits a step cap. Tools are plain `{name, description, parameters, execute}` objects in a registry; risky ones (`write_file`, `edit_file`, `run_command`) are gated by an injected `confirm` function so the CLI can prompt a human and the eval suite can auto-approve. The eval suite (`src/eval/`) checks tool-choice on live single-turn prompts and full tool-order + LLM-judged behavior on multi-turn prompts with mocked `web_search`/`run_command`.

**Tech Stack:** TypeScript on Bun, `openai` npm package against OpenRouter (Responses API), `bun:test` for unit tests, Node builtins (`node:fs/promises`, `node:readline/promises`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-week-01-cli-agent-design.md`

## Execution Rule (human review checkpoints)

The human partner reviews and learns from each Task before the next one starts.
After finishing all steps of a Task (before commit), **stop** and wait
for explicit go-ahead before beginning the next Task. Do not batch multiple
Tasks together.

## Global Constraints

- Single LLM provider: every call (agent loop, `web_search`, eval judge) goes through the one OpenRouter-backed `OpenAI` client (`OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL`). No second provider/key.
- `web_search` uses OpenRouter's `plugins: [{ id: "web" }]` mechanism, not OpenAI's `tools:[{type:"web_search"}]` syntax (OpenRouter doesn't forward that).
- Conversation state is a hand-rolled `ResponseInputItem[]` array resent each call — never `previous_response_id`.
- `MAX_STEPS = 15` per user turn.
- `RISKY = new Set(["write_file", "edit_file", "run_command"])` exactly — no `delete_file` tool exists.
- Every tool's `execute` catches its own errors and returns `"Error: ..."` strings — it never throws.
- File layout is fixed per the spec's modular folder structure (below) — do not flatten or reorganize it.
- No new npm dependencies. No streaming. No sandboxing of `run_command` beyond the approval gate.
- `tsconfig.json` is strict (`strict: true`, `noUncheckedIndexedAccess: true`) — all code must satisfy it; `bun run <file>` / `bun test` double as the type check (Bun type-checks on run).

## File Layout (target end state)

```
src/
  agent.ts
  loop.ts
  loop.test.ts
  tools/
    index.ts
    web-search.ts
    web-search.test.ts
    write-file.ts
    read-file.ts
    edit-file.ts
    list-files.ts
    filesystem-tools.test.ts
    run-command.ts
    run-command.test.ts
  eval/
    eval.ts
    cases.ts
    mock-tools.ts
    judge.ts
```

---

### Task 1: Bare agent loop (no tools yet)

**Files:**
- Create: `src/tools/index.ts`
- Create: `src/loop.ts`
- Create: `src/loop.test.ts`
- Modify: `src/agent.ts` (replace the bootstrap's hardcoded one-shot call)
- Modify: `package.json` (no script change needed — `dev` already runs `src/agent.ts`)

**Interfaces:**
- Produces: `Tool` interface, `ToolRegistry` type, `RISKY: Set<string>` (empty for now), `toolSchemas(registry: ToolRegistry): OpenAI.Responses.FunctionTool[]` — all from `src/tools/index.ts`.
- Produces: `ResponsesClient` interface, `MAX_STEPS: number`, `runTurn(opts: RunTurnOptions): Promise<string>` — from `src/loop.ts`. `RunTurnOptions = { client: ResponsesClient; model: string; input: OpenAI.Responses.ResponseInputItem[]; registry: ToolRegistry; confirm: (description: string) => Promise<boolean> }`.
- Consumes: nothing from earlier tasks (this is the first task).

- [ ] **Step 1: Write `src/tools/index.ts`**

```ts
import type OpenAI from "openai";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export type ToolRegistry = Record<string, Tool>;

export const RISKY = new Set<string>();

export function toolSchemas(registry: ToolRegistry): OpenAI.Responses.FunctionTool[] {
  return Object.values(registry).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));
}
```

- [ ] **Step 2: Write the failing test for the loop's stop rule, threading, and step cap — `src/loop.test.ts`**

```ts
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { runTurn, MAX_STEPS, type ResponsesClient } from "./loop.ts";
import type { Tool, ToolRegistry } from "./tools/index.ts";

function fakeResponse(
  outputText: string,
  calls: Array<{ name: string; args: Record<string, unknown>; call_id: string }> = [],
): { output: OpenAI.Responses.ResponseOutputItem[]; output_text: string } {
  const output = calls.map((c) => ({
    type: "function_call" as const,
    call_id: c.call_id,
    name: c.name,
    arguments: JSON.stringify(c.args),
  }));
  return { output: output as unknown as OpenAI.Responses.ResponseOutputItem[], output_text: outputText };
}

test("stop rule: no function_call means print and return", async () => {
  const client: ResponsesClient = {
    responses: {
      create: async () => fakeResponse("Tokyo"),
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "capital of Japan?" }];
  const answer = await runTurn({ client, model: "m", input, registry: {}, confirm: async () => true });
  expect(answer).toBe("Tokyo");
  expect(input).toHaveLength(1);
});

test("threads a function_call and its output into input, then stops", async () => {
  let calls = 0;
  const echoTool: Tool = {
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    execute: async (args) => `echoed:${JSON.stringify(args)}`,
  };
  const registry: ToolRegistry = { echo: echoTool };
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        calls++;
        if (calls === 1) return fakeResponse("", [{ name: "echo", args: { x: 1 }, call_id: "call_1" }]);
        return fakeResponse("done");
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "go" }];
  const confirmCalls: string[] = [];
  const answer = await runTurn({
    client,
    model: "m",
    input,
    registry,
    confirm: async (d) => {
      confirmCalls.push(d);
      return true;
    },
  });
  expect(answer).toBe("done");
  expect(confirmCalls).toHaveLength(0); // echo isn't risky
  expect(input).toHaveLength(3); // user message, function_call, function_call_output
  const outputItem = input[2]! as OpenAI.Responses.ResponseInputItem.FunctionCallOutput;
  expect(outputItem.type).toBe("function_call_output");
  expect(outputItem.call_id).toBe("call_1");
  expect(outputItem.output).toBe('echoed:{"x":1}');
});

test("unknown tool name produces an Error string, never throws", async () => {
  let call = 0;
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        call++;
        if (call === 1) return fakeResponse("", [{ name: "bogus", args: {}, call_id: "call_1" }]);
        return fakeResponse("done");
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "go" }];
  const answer = await runTurn({ client, model: "m", input, registry: {}, confirm: async () => true });
  expect(answer).toBe("done");
  const outputItem = input[2]! as OpenAI.Responses.ResponseInputItem.FunctionCallOutput;
  expect(outputItem.output).toBe('Error: unknown tool "bogus"');
});

test("step cap: gives up after MAX_STEPS if the model never stops calling tools", async () => {
  let createCalls = 0;
  const echoTool: Tool = {
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    execute: async () => "echoed",
  };
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        createCalls++;
        return fakeResponse("", [{ name: "echo", args: {}, call_id: `call_${createCalls}` }]);
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "go" }];
  const answer = await runTurn({
    client,
    model: "m",
    input,
    registry: { echo: echoTool },
    confirm: async () => true,
  });
  expect(createCalls).toBe(MAX_STEPS);
  expect(answer).toContain(`${MAX_STEPS}`);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/loop.test.ts`
Expected: FAIL — `./loop.ts` does not exist yet (module not found).

- [ ] **Step 4: Write `src/loop.ts`**

```ts
import type OpenAI from "openai";
import { RISKY, toolSchemas, type ToolRegistry } from "./tools/index.ts";

export const MAX_STEPS = 15;

export interface ResponsesClient {
  responses: {
    create(params: {
      model: string;
      input: OpenAI.Responses.ResponseInputItem[];
      tools: OpenAI.Responses.FunctionTool[];
    }): Promise<{ output: OpenAI.Responses.ResponseOutputItem[]; output_text: string }>;
  };
}

export interface RunTurnOptions {
  client: ResponsesClient;
  model: string;
  input: OpenAI.Responses.ResponseInputItem[];
  registry: ToolRegistry;
  confirm: (description: string) => Promise<boolean>;
}

export async function runTurn(opts: RunTurnOptions): Promise<string> {
  const { client, model, input, registry, confirm } = opts;
  const tools = toolSchemas(registry);

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.responses.create({ model, input, tools });

    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );

    if (calls.length === 0) {
      return response.output_text;
    }

    for (const call of calls) {
      input.push(call);
      const tool = registry[call.name];
      let result: string;

      if (!tool) {
        result = `Error: unknown tool "${call.name}"`;
      } else {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        if (RISKY.has(call.name)) {
          const allowed = await confirm(`${call.name}(${call.arguments})`);
          result = allowed ? await tool.execute(args) : "User denied this action.";
        } else {
          result = await tool.execute(args);
        }
      }

      input.push({ type: "function_call_output", call_id: call.call_id, output: result });
    }
  }

  return `Gave up after ${MAX_STEPS} steps without a final answer.`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/loop.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Rewrite `src/agent.ts` as the interactive CLI**

```ts
import "dotenv/config";
import OpenAI from "openai";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runTurn } from "./loop.ts";
import type { ToolRegistry } from "./tools/index.ts";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL,
});
const model = process.env.OPENROUTER_MODEL!;
const registry: ToolRegistry = {};

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const confirm = async (description: string): Promise<boolean> => {
    const answer = await rl.question(`I'd like to ${description}. Allow? (y/n) › `);
    return answer.trim().toLowerCase() === "y";
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [];

  while (true) {
    const line = await rl.question("you › ");
    if (!line.trim()) continue;
    input.push({ role: "user", content: line });
    const answer = await runTurn({ client, model, input, registry, confirm });
    console.log(`agent › ${answer}`);
  }
}

main();
```

- [ ] **Step 7: Type-check and smoke-run**

Run: `bun run src/agent.ts` (needs a real `.env` with `OPENROUTER_API_KEY`/`OPENROUTER_BASE_URL`/`OPENROUTER_MODEL`), type "what's the capital of Japan?", confirm it answers, then Ctrl+C to exit.
Expected: no type errors on startup, and a plain-text answer with no tool involved (the stop rule).

- [ ] **Step 8: Commit**

```bash
git add src/agent.ts src/loop.ts src/loop.test.ts src/tools/index.ts
git commit -m "feat: add bare tool-calling loop and CLI"
```

---

### Task 2: `web_search` tool

**Files:**
- Create: `src/tools/web-search.ts`
- Create: `src/tools/web-search.test.ts`
- Modify: `src/tools/index.ts` (add `createToolRegistry` factory)
- Modify: `src/agent.ts` (use the factory instead of `{}`)

**Interfaces:**
- Consumes: `Tool` from `src/tools/index.ts` (Task 1).
- Produces: `createWebSearchTool(deps: { client: OpenAI; model: string }): Tool` from `src/tools/web-search.ts`. `createToolRegistry(deps: { client: OpenAI; model: string }): ToolRegistry` from `src/tools/index.ts` (later tasks add more entries to its returned object).

- [ ] **Step 1: Write the failing test — `src/tools/web-search.test.ts`**

```ts
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { createWebSearchTool } from "./web-search.ts";

test("returns the model's output_text and passes the web plugin", async () => {
  let capturedParams: unknown;
  const fakeClient = {
    responses: {
      create: async (params: unknown) => {
        capturedParams = params;
        return { output_text: "Node 24, 23, 22", output: [] };
      },
    },
  } as unknown as OpenAI;

  const tool = createWebSearchTool({ client: fakeClient, model: "m" });
  const result = await tool.execute({ query: "latest node versions" });

  expect(result).toBe("Node 24, 23, 22");
  expect(capturedParams).toMatchObject({
    plugins: [{ id: "web", max_results: 5 }],
  });
});

test("returns an Error string instead of throwing on failure", async () => {
  const fakeClient = {
    responses: {
      create: async () => {
        throw new Error("network down");
      },
    },
  } as unknown as OpenAI;

  const tool = createWebSearchTool({ client: fakeClient, model: "m" });
  const result = await tool.execute({ query: "x" });

  expect(result).toBe("Error: network down");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/tools/web-search.test.ts`
Expected: FAIL — `./web-search.ts` does not exist.

- [ ] **Step 3: Write `src/tools/web-search.ts`**

```ts
import type OpenAI from "openai";
import type { Tool } from "./index.ts";

export interface WebSearchDeps {
  client: OpenAI;
  model: string;
}

export function createWebSearchTool({ client, model }: WebSearchDeps): Tool {
  return {
    name: "web_search",
    description: "Search the web for current or external information and return a concise answer.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for." } },
      required: ["query"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const query = String(args.query ?? "");
      try {
        const response = await client.responses.create({
          model,
          input: `Search the web and answer concisely: ${query}`,
          plugins: [{ id: "web", max_results: 5 }],
        } as OpenAI.Responses.ResponseCreateParamsNonStreaming & {
          plugins: Array<{ id: "web"; max_results?: number }>;
        });
        return response.output_text;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
```

`plugins` is an OpenRouter-only extension not present in the `openai` package's own types, so the params object is cast at the call site — this is the one place in the codebase that cast is needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/tools/web-search.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add `createToolRegistry` to `src/tools/index.ts`**

Append to the file from Task 1:

```ts
import type OpenAI from "openai";
import { createWebSearchTool } from "./web-search.ts";

export function createToolRegistry(deps: { client: OpenAI; model: string }): ToolRegistry {
  return {
    web_search: createWebSearchTool(deps),
  };
}
```

- [ ] **Step 6: Modify `src/agent.ts` to use the factory**

Replace `const registry: ToolRegistry = {};` and its import with:

```ts
import { createToolRegistry } from "./tools/index.ts";
// ...
const registry = createToolRegistry({ client, model });
```

(Remove the now-unused `ToolRegistry` type import.)

- [ ] **Step 7: Smoke-run**

Run: `bun run src/agent.ts`, ask "find me the three most recent stable Node.js versions", confirm it searches and answers (no approval prompt — `web_search` isn't risky).
Expected: a real, current-looking answer.

- [ ] **Step 8: Commit**

```bash
git add src/tools/index.ts src/tools/web-search.ts src/tools/web-search.test.ts src/agent.ts
git commit -m "feat: add web_search tool"
```

---

### Task 3: Filesystem tools (write, read, edit, list)

**Files:**
- Create: `src/tools/write-file.ts`, `src/tools/read-file.ts`, `src/tools/edit-file.ts`, `src/tools/list-files.ts`
- Create: `src/tools/filesystem-tools.test.ts`
- Modify: `src/tools/index.ts` (register the four in `createToolRegistry`)

**Interfaces:**
- Consumes: `Tool` from `src/tools/index.ts`.
- Produces: `writeFileTool`, `readFileTool`, `editFileTool`, `listFilesTool` — each a `Tool` const, exported from their own file. `edit_file`'s contract: replace the **first** occurrence of `oldString` with `newString`; if `oldString` isn't present, return `"Error: oldString not found in <path>"` without modifying the file.

- [ ] **Step 1: Write the failing tests — `src/tools/filesystem-tools.test.ts`**

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileTool } from "./write-file.ts";
import { readFileTool } from "./read-file.ts";
import { editFileTool } from "./edit-file.ts";
import { listFilesTool } from "./list-files.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-fs-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("write_file creates a file with the given content", async () => {
  const path = join(dir, "hello.txt");
  const result = await writeFileTool.execute({ path, content: "hi" });
  expect(result).toContain(path);
  expect(await fsReadFile(path, "utf8")).toBe("hi");
});

test("write_file overwrites an existing file", async () => {
  const path = join(dir, "hello.txt");
  await writeFileTool.execute({ path, content: "first" });
  await writeFileTool.execute({ path, content: "second" });
  expect(await fsReadFile(path, "utf8")).toBe("second");
});

test("read_file returns the file's contents", async () => {
  const path = join(dir, "hello.txt");
  await writeFileTool.execute({ path, content: "hi" });
  const result = await readFileTool.execute({ path });
  expect(result).toBe("hi");
});

test("read_file on a missing path returns an Error string, not a throw", async () => {
  const result = await readFileTool.execute({ path: join(dir, "missing.txt") });
  expect(result).toStartWith("Error:");
});

test("edit_file replaces the first occurrence of oldString", async () => {
  const path = join(dir, "primes.py");
  await writeFileTool.execute({ path, content: "print first 20 primes" });
  const result = await editFileTool.execute({ path, oldString: "20", newString: "50" });
  expect(result).toBe(`Edited ${path}`);
  expect(await fsReadFile(path, "utf8")).toBe("print first 50 primes");
});

test("edit_file returns an Error string when oldString isn't found", async () => {
  const path = join(dir, "primes.py");
  await writeFileTool.execute({ path, content: "print first 20 primes" });
  const result = await editFileTool.execute({ path, oldString: "999", newString: "50" });
  expect(result).toBe(`Error: oldString not found in ${path}`);
  expect(await fsReadFile(path, "utf8")).toBe("print first 20 primes");
});

test("edit_file on a missing file returns an Error string", async () => {
  const result = await editFileTool.execute({
    path: join(dir, "missing.py"),
    oldString: "a",
    newString: "b",
  });
  expect(result).toStartWith("Error:");
});

test("list_files lists entries in a directory", async () => {
  await writeFileTool.execute({ path: join(dir, "a.txt"), content: "" });
  await writeFileTool.execute({ path: join(dir, "b.txt"), content: "" });
  const result = await listFilesTool.execute({ dir });
  expect(result.split("\n").sort()).toEqual(["a.txt", "b.txt"]);
});

test("list_files on a missing directory returns an Error string", async () => {
  const result = await listFilesTool.execute({ dir: join(dir, "nope") });
  expect(result).toStartWith("Error:");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tools/filesystem-tools.test.ts`
Expected: FAIL — the four tool modules don't exist yet.

- [ ] **Step 3: Write `src/tools/write-file.ts`**

```ts
import { writeFile as fsWriteFile } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create a file or overwrite it with new content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
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
};
```

- [ ] **Step 4: Write `src/tools/read-file.ts`**

```ts
import { readFile as fsReadFile } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a file's contents.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(args) {
    const path = String(args.path ?? "");
    try {
      return await fsReadFile(path, "utf8");
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
```

- [ ] **Step 5: Write `src/tools/edit-file.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const editFileTool: Tool = {
  name: "edit_file",
  description: "Replace the first occurrence of oldString with newString in an existing file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
    },
    required: ["path", "oldString", "newString"],
  },
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
};
```

- [ ] **Step 6: Write `src/tools/list-files.ts`**

```ts
import { readdir } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const listFilesTool: Tool = {
  name: "list_files",
  description: "List the entries in a directory.",
  parameters: {
    type: "object",
    properties: { dir: { type: "string" } },
    required: ["dir"],
  },
  async execute(args) {
    const dir = String(args.dir ?? ".");
    try {
      const entries = await readdir(dir);
      return entries.join("\n");
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/tools/filesystem-tools.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 8: Register the four tools in `src/tools/index.ts`**

Update `createToolRegistry`:

```ts
import { writeFileTool } from "./write-file.ts";
import { readFileTool } from "./read-file.ts";
import { editFileTool } from "./edit-file.ts";
import { listFilesTool } from "./list-files.ts";

export function createToolRegistry(deps: { client: OpenAI; model: string }): ToolRegistry {
  return {
    web_search: createWebSearchTool(deps),
    write_file: writeFileTool,
    read_file: readFileTool,
    edit_file: editFileTool,
    list_files: listFilesTool,
  };
}
```

- [ ] **Step 9: Smoke-run**

Run: `bun run src/agent.ts`, ask it to create a file and read it back.
Expected: it calls `write_file` (no gate yet — Task 5 adds that), then can `read_file` it back correctly.

- [ ] **Step 10: Commit**

```bash
git add src/tools/write-file.ts src/tools/read-file.ts src/tools/edit-file.ts src/tools/list-files.ts src/tools/filesystem-tools.test.ts src/tools/index.ts
git commit -m "feat: add filesystem tools (write, read, edit, list)"
```

---

### Task 4: `run_command` tool

**Files:**
- Create: `src/tools/run-command.ts`
- Create: `src/tools/run-command.test.ts`
- Modify: `src/tools/index.ts` (register it)

**Interfaces:**
- Consumes: `Tool` from `src/tools/index.ts`.
- Produces: `runCommandTool: Tool` from `src/tools/run-command.ts`.

- [ ] **Step 1: Write the failing tests — `src/tools/run-command.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tools/run-command.test.ts`
Expected: FAIL — `./run-command.ts` does not exist.

- [ ] **Step 3: Write `src/tools/run-command.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tools/run-command.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Register it in `src/tools/index.ts`**

```ts
import { runCommandTool } from "./run-command.ts";

export function createToolRegistry(deps: { client: OpenAI; model: string }): ToolRegistry {
  return {
    web_search: createWebSearchTool(deps),
    write_file: writeFileTool,
    read_file: readFileTool,
    edit_file: editFileTool,
    list_files: listFilesTool,
    run_command: runCommandTool,
  };
}
```

- [ ] **Step 6: Smoke-run**

Run: `bun run src/agent.ts`, ask it to write a python script printing the first 20 primes and run it.
Expected: it writes the file then runs it and prints the primes (still no approval gate — Task 5 adds that).

- [ ] **Step 7: Commit**

```bash
git add src/tools/run-command.ts src/tools/run-command.test.ts src/tools/index.ts
git commit -m "feat: add run_command tool"
```

---

### Task 5: Approval gate for risky tools

**Files:**
- Modify: `src/tools/index.ts:9` (populate `RISKY`)
- Modify: `src/loop.test.ts` (add gating tests)

**Interfaces:**
- Consumes: `runTurn` from `src/loop.ts` (Task 1 — already threads `confirm` and checks `RISKY`, unexercised until now since `RISKY` was empty).
- Produces: nothing new — this task turns on behavior `loop.ts` already implements.

- [ ] **Step 1: Write the failing tests — append to `src/loop.test.ts`**

```ts
test("risky tool: denial feeds back 'User denied this action.' and does not execute", async () => {
  let executed = false;
  const fakeWriteFile: Tool = {
    name: "write_file",
    description: "fake",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      executed = true;
      return "wrote it";
    },
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
  const answer = await runTurn({
    client,
    model: "m",
    input,
    registry: { write_file: fakeWriteFile },
    confirm: async () => false,
  });
  expect(answer).toBe("done");
  expect(executed).toBe(false);
  const outputItem = input[2]! as OpenAI.Responses.ResponseInputItem.FunctionCallOutput;
  expect(outputItem.output).toBe("User denied this action.");
});

test("risky tool: approval runs it normally", async () => {
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
  const answer = await runTurn({
    client,
    model: "m",
    input,
    registry: { write_file: fakeWriteFile },
    confirm: async () => true,
  });
  expect(answer).toBe("done");
  const outputItem = input[2]! as OpenAI.Responses.ResponseInputItem.FunctionCallOutput;
  expect(outputItem.output).toBe("wrote it");
});
```

(Add `import type { Tool } from "./tools/index.ts";` to the top of `src/loop.test.ts` if not already present from Task 1.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/loop.test.ts`
Expected: FAIL on the two new tests — `RISKY` is still empty, so `write_file` isn't gated (execute runs even when `confirm` returns `false`).

- [ ] **Step 3: Populate `RISKY` in `src/tools/index.ts`**

```ts
export const RISKY = new Set(["write_file", "edit_file", "run_command"]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/loop.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Smoke-run the CLI end-to-end**

Run: `bun run src/agent.ts`, ask it to write a file. Confirm the CLI prints `I'd like to write_file(...). Allow? (y/n) ›` and pauses; answer `n` and confirm the agent reports the denial back in its next reply instead of crashing; ask again and answer `y` and confirm it proceeds.

- [ ] **Step 6: Commit**

```bash
git add src/tools/index.ts src/loop.test.ts
git commit -m "feat: gate risky tools behind human approval"
```

---

### Task 6: Eval suite — single-turn tool-choice cases

**Files:**
- Create: `src/eval/cases.ts`
- Create: `src/eval/eval.ts`
- Modify: `package.json` (add an `eval` script)

**Interfaces:**
- Consumes: `createToolRegistry`, `toolSchemas` from `src/tools/index.ts`.
- Produces: `SingleTurnCase` interface and `singleTurnCases: SingleTurnCase[]` from `src/eval/cases.ts`. `runSingleTurnEval(client: OpenAI, model: string): Promise<EvalResult[]>` and `EvalResult = { name: string; passed: boolean; detail: string }` from `src/eval/eval.ts` (Task 7 adds `runMultiTurnEval` and the combined `main()` to this same file).

This task's correctness depends on live model behavior (the spec requires the tool-choice check to call the real model, not a mock), so its "test cycle" is: run it against the real API and read the printed report, rather than a offline pass/fail `bun:test`. That live check is deliverable 2 of the assignment, not a throwaway step.

- [ ] **Step 1: Write `src/eval/cases.ts`**

```ts
export interface SingleTurnCase {
  name: string;
  prompt: string;
  expectedTool: string | null;
}

export const singleTurnCases: SingleTurnCase[] = [
  { name: "arithmetic (no tool)", prompt: "What is 2+2?", expectedTool: null },
  { name: "web search", prompt: "Search for the latest React version.", expectedTool: "web_search" },
  { name: "write file", prompt: "Create hello.txt with 'hi' inside.", expectedTool: "write_file" },
];
```

- [ ] **Step 2: Write `src/eval/eval.ts`**

```ts
import "dotenv/config";
import OpenAI from "openai";
import { createToolRegistry, toolSchemas } from "../tools/index.ts";
import { singleTurnCases } from "./cases.ts";

export interface EvalResult {
  name: string;
  passed: boolean;
  detail: string;
}

export async function runSingleTurnEval(client: OpenAI, model: string): Promise<EvalResult[]> {
  const registry = createToolRegistry({ client, model });
  const tools = toolSchemas(registry);
  const results: EvalResult[] = [];

  for (const c of singleTurnCases) {
    const response = await client.responses.create({ model, input: c.prompt, tools });
    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );
    const calledTool = calls[0]?.name ?? null;
    results.push({
      name: c.name,
      passed: calledTool === c.expectedTool,
      detail: `expected ${c.expectedTool ?? "no tool"}, got ${calledTool ?? "no tool"}`,
    });
  }
  return results;
}

async function main() {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL,
  });
  const model = process.env.OPENROUTER_MODEL!;

  const results = await runSingleTurnEval(client, model);
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"} - ${r.name} (${r.detail})`);
  }
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n${passedCount}/${results.length} passed`);
}

main();
```

- [ ] **Step 3: Add the `eval` script to `package.json`**

```json
"scripts": {
  "dev": "bun run src/agent.ts",
  "eval": "bun run src/eval/eval.ts"
}
```

- [ ] **Step 4: Run it against the real API**

Run: `bun run eval`
Expected: three `PASS`/`FAIL` lines and a pass rate. If any case fails, read `detail` — it will name the tool the model actually chose — and decide whether the tool's `description`/`parameters` need sharpening (fix inline) or the case itself was miscalibrated, before moving on.

- [ ] **Step 5: Commit**

```bash
git add src/eval/cases.ts src/eval/eval.ts package.json
git commit -m "feat: add single-turn tool-choice eval"
```

---

### Task 7: Eval suite — multi-turn behavior + LLM judge + combined report

**Files:**
- Create: `src/eval/mock-tools.ts`
- Create: `src/eval/judge.ts`
- Modify: `src/eval/cases.ts` (add `MultiTurnCase` and `multiTurnCases`)
- Modify: `src/eval/eval.ts` (add `runMultiTurnEval`, combine both reports in `main()`)
- Modify: `.env.example` (add `OPENROUTER_JUDGE_MODEL`)

**Interfaces:**
- Consumes: `Tool`, `ToolRegistry`, `createToolRegistry` from `src/tools/index.ts`; `runTurn` from `src/loop.ts`; `EvalResult` from `src/eval/eval.ts` (Task 6).
- Produces: `mockWebSearchTool`, `mockRunCommandTool` (`Tool` consts) from `src/eval/mock-tools.ts`. `judge(client: OpenAI, judgeModel: string, question: string, answer: string): Promise<boolean>` from `src/eval/judge.ts`. `MultiTurnCase` interface and `multiTurnCases: MultiTurnCase[]` from `src/eval/cases.ts`. `runMultiTurnEval(client: OpenAI, model: string, judgeModel: string): Promise<EvalResult[]>` from `src/eval/eval.ts`.

Like Task 6, correctness here depends on live model + judge calls, so this task's cycle is also "run it against the real API, read the report" rather than an offline assertion — with the important exception that tool *order* and the *file actually being written* are checked deterministically (only the final "did it answer correctly" bit is judged by the model).

- [ ] **Step 1: Write `src/eval/mock-tools.ts`**

```ts
import type { Tool } from "../tools/index.ts";

export const mockWebSearchTool: Tool = {
  name: "web_search",
  description: "Mock web search for eval.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  async execute() {
    return "The three most recent stable Node.js versions are 24, 23, and 22.";
  },
};

export const mockRunCommandTool: Tool = {
  name: "run_command",
  description: "Mock run_command for eval.",
  parameters: {
    type: "object",
    properties: { cmd: { type: "string" } },
    required: ["cmd"],
  },
  async execute() {
    return "2 3 5 7 11 13 17 19 23";
  },
};
```

- [ ] **Step 2: Write `src/eval/judge.ts`**

```ts
import type OpenAI from "openai";

export async function judge(
  client: OpenAI,
  judgeModel: string,
  question: string,
  answer: string,
): Promise<boolean> {
  const response = await client.responses.create({
    model: judgeModel,
    input: `Did this response correctly ${question}? Response: """${answer}"""\nAnswer PASS or FAIL only.`,
  });
  return response.output_text.trim().toUpperCase().startsWith("PASS");
}
```

- [ ] **Step 3: Add `MultiTurnCase` and cases to `src/eval/cases.ts`**

Append:

```ts
export interface MultiTurnCase {
  name: string;
  prompt: string;
  expectedToolOrder: string[];
  verifyFile?: string;
  judgeQuestion: string;
}

export const multiTurnCases: MultiTurnCase[] = [
  {
    name: "write then run",
    prompt: "Write a python script primes.py that prints the first 5 primes, then run it.",
    expectedToolOrder: ["write_file", "run_command"],
    verifyFile: "primes.py",
    judgeQuestion: "write a script and run it, printing prime numbers",
  },
];
```

- [ ] **Step 4: Add `runMultiTurnEval` to `src/eval/eval.ts`**

Add these imports at the top:

```ts
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../loop.ts";
import type { Tool, ToolRegistry } from "../tools/index.ts";
import { mockWebSearchTool, mockRunCommandTool } from "./mock-tools.ts";
import { judge } from "./judge.ts";
import { multiTurnCases } from "./cases.ts";
```

Add the function:

```ts
function wrapWithCallLog(registry: ToolRegistry, log: string[]): ToolRegistry {
  const wrapped: ToolRegistry = {};
  for (const [name, tool] of Object.entries(registry)) {
    wrapped[name] = {
      ...tool,
      execute: async (args) => {
        log.push(name);
        return tool.execute(args);
      },
    } satisfies Tool;
  }
  return wrapped;
}

export async function runMultiTurnEval(
  client: OpenAI,
  model: string,
  judgeModel: string,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const c of multiTurnCases) {
    const dir = await mkdtemp(join(tmpdir(), "agent-eval-"));
    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      const baseRegistry = createToolRegistry({ client, model });
      baseRegistry.web_search = mockWebSearchTool;
      baseRegistry.run_command = mockRunCommandTool;
      const calledOrder: string[] = [];
      const registry = wrapWithCallLog(baseRegistry, calledOrder);

      const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: c.prompt }];
      const answer = await runTurn({ client, model, input, registry, confirm: async () => true });

      const orderOk = c.expectedToolOrder.every((name, i) => calledOrder[i] === name);
      const fileOk = c.verifyFile ? existsSync(join(dir, c.verifyFile)) : true;
      const judgeOk = await judge(client, judgeModel, c.judgeQuestion, answer);

      results.push({
        name: c.name,
        passed: orderOk && fileOk && judgeOk,
        detail: `order=${calledOrder.join(",")}, fileOk=${fileOk}, judgeOk=${judgeOk}, answer=${answer}`,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  }

  return results;
}
```

- [ ] **Step 5: Update `main()` in `src/eval/eval.ts` to run and report both suites**

```ts
async function main() {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL,
  });
  const model = process.env.OPENROUTER_MODEL!;
  const judgeModel = process.env.OPENROUTER_JUDGE_MODEL!;

  const results = [
    ...(await runSingleTurnEval(client, model)),
    ...(await runMultiTurnEval(client, model, judgeModel)),
  ];

  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"} - ${r.name} (${r.detail})`);
  }
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n${passedCount}/${results.length} passed`);
}
```

- [ ] **Step 6: Add `OPENROUTER_JUDGE_MODEL` to `.env.example` and your real `.env`**

```
OPENROUTER_JUDGE_MODEL=
```

Pick any model available on your OpenRouter account, distinct from `OPENROUTER_MODEL`.

- [ ] **Step 7: Run the full eval suite against the real API**

Run: `bun run eval`
Expected: single-turn results followed by the multi-turn "write then run" result, then a combined pass rate (e.g. `4/4 passed`). Save this output — it's deliverable 2.

- [ ] **Step 8: Commit**

```bash
git add src/eval/mock-tools.ts src/eval/judge.ts src/eval/cases.ts src/eval/eval.ts .env.example
git commit -m "feat: add multi-turn behavior eval with LLM judge"
```

---

### Task 8: Transcript and NOTES.md deliverables

**Files:**
- Create: `TRANSCRIPT.md` (or paste directly into the submission per your instructor's preferred format — adjust the path if they specify one)
- Create: `NOTES.md`

This task is manual verification and documentation, not code — there is nothing to unit-test. It's also where the CLI's interactive behavior (readline prompts, the y/n gate, live network/model calls) gets exercised for real, since Tasks 1–7 tested the underlying logic with fakes/mocks.

- [ ] **Step 1: Run the CLI interactively and capture a 5–10 turn transcript**

Run: `bun run src/agent.ts`. Have a conversation that includes, in this order:
1. A plain question with no tool ("what's the capital of Japan?").
2. A web search ("find me the three most recent stable Node.js versions").
3. A write-then-run ("write a python script that prints the first 20 primes, then run it") — approve both y/n prompts.
4. An edit ("open primes.py and change 20 to 50") — approve the y/n prompt.
5. At least one action you **deny** at a y/n prompt (e.g. ask it to run `rm` on something and answer `n`) — confirm the agent's next reply acknowledges the denial instead of crashing.

Copy the full terminal transcript (your input and the agent's output, including the y/n prompts) into `TRANSCRIPT.md`.

- [ ] **Step 2: Write `NOTES.md`**

Half a page covering, per the assignment's grading rubric:
- What was hardest (be specific — e.g. getting the Responses API's function-call/function-call-output threading right, or getting OpenRouter's web plugin working instead of OpenAI's hosted tool syntax).
- One concrete bug the eval suite caught that manual testing had missed.
- One thing you'd add next (e.g. a `delete_file` tool, persisting conversation history across runs, streaming output).

- [ ] **Step 3: Commit**

```bash
git add TRANSCRIPT.md NOTES.md
git commit -m "docs: add session transcript and NOTES.md"
```
