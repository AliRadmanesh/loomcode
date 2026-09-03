# Review Fixes Design

**Date:** 2026-09-03
**Status:** Approved

## Purpose

The course's Week 1 review scorecard (comparing this submission against
two others) flagged four concrete gaps in the current agent:

1. `JSON.parse(call.arguments)` in `src/loop.ts` is unguarded — malformed
   tool-call arguments throw uncaught and take down the whole session,
   the review's "worst bug found."
2. `run_command` has no timeout and no output cap, scoring lowest of the
   three submissions' tool sets.
3. The approval gate dumps raw JSON args inline for risky calls (e.g. a
   full file's content for `write_file`), scored as "shows too much."
4. The eval suite (`src/eval/cases.ts`) has 4 cases against 9 and 14 for
   the other two submissions, with no negative cases beyond one
   arithmetic example and no error-recovery case.

This spec covers all four as one pass since they're small, independent
fixes to code that already exists (`src/loop.ts`,
`src/tools/run-command.ts`, `src/tools/index.ts`, and the four risky
tool files, `src/eval/cases.ts`). No new files beyond test additions,
no new subsystems.

## 1. Guard `JSON.parse` in the loop

`src/loop.ts`, inside the per-call loop, wrap the parse:

```ts
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
```

This mirrors the existing "unknown tool" branch: the failure becomes
tool-result data fed back to the model, not a thrown exception. Neither
`tool.execute` nor `confirm` is called for a call whose arguments don't
parse — there's nothing valid to run or approve. The loop continues to
the next call/step exactly as it does today for other error paths.

**Test** (`loop.test.ts`): a fake client returns a `function_call` with
a non-JSON `arguments` string. Assert `runTurn` resolves normally
(doesn't throw) and the pushed `function_call_output.output` starts
with `Error: invalid arguments JSON:`.

## 2. `run_command` timeout + output cap

`src/tools/run-command.ts` adds two constants:

```ts
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 4_000;
```

**Timeout:** race the existing `proc.exited` against a timer. If the
timer fires first, kill the process and short-circuit to `Error:
command timed out after 30s`. If `proc.exited` resolves first, clear
the timer and proceed as today (combining stdout/stderr, checking exit
code).

**Output cap:** applied once, after `combined` is built (so it covers
both the success and the `Error: exited with code N` paths uniformly).
If `combined.length > MAX_OUTPUT_CHARS`, slice to the cap and append
`\n... (truncated, ${combined.length - MAX_OUTPUT_CHARS} more chars)`.

**Testability:** the tool's `execute(args)` signature can't take extra
parameters (it must match the `Tool` interface), so the timeout logic
is factored into an internal, separately-exported function:

```ts
export async function runWithTimeout(
  cmd: string,
  timeoutMs = TIMEOUT_MS,
  maxOutputChars = MAX_OUTPUT_CHARS,
): Promise<string> { /* current try/catch body, using the params instead of the module constants */ }
```

`runCommandTool.execute` calls `runWithTimeout(String(args.cmd ?? ""))`
using the defaults. Tests import `runWithTimeout` directly and pass a
small `timeoutMs` (e.g. `50`) so the timeout test runs in milliseconds
instead of 30 real seconds. This is a test seam, not user-facing
configuration — `RISKY`/`toolSchemas`/the model never see these
parameters.

**Tests** (`run-command.test.ts`):
- `runWithTimeout("sleep 5", 50)` returns `Error: command timed out
  after 50ms` (message includes whichever `timeoutMs` was passed, not a
  hardcoded "30s").
- `runWithTimeout("yes x | head -c 5000", TIMEOUT_MS, 100)` (or calling
  `runCommandTool.execute` and relying on the default 4000 cap) returns
  a result containing the truncation marker, capped at roughly the
  configured `maxOutputChars` length.

## 3. Human-readable approval descriptions

`src/tools/index.ts`, extend the `Tool` interface:

```ts
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
  describe?: (args: Record<string, unknown>) => string;
}
```

`describe` is optional and only meaningful for tools in `RISKY`; the
other three tools (`web_search`, `read_file`, `list_files`) don't need
it since they're never routed through `confirm`.

Each risky tool gets a `describe`:

| Tool | `describe(args)` |
|---|---|
| `write_file` | `` `write ${path} (${content.length} bytes)` `` |
| `edit_file` | `` `edit ${path}` `` |
| `run_command` | `` `run: ${cmd}` `` |
| `delete_file` | `` `delete ${path}` `` |

`src/loop.ts` changes the confirm call site:

```ts
if (RISKY.has(call.name)) {
  const description = tool.describe ? tool.describe(args) : `${call.name}(${call.arguments})`;
  const allowed = await confirm(call.name, description);
  ...
}
```

The raw-JSON fallback stays for tools in `RISKY` without a `describe`
(defensive; all four current risky tools will define one, so the
fallback is dead code today but keeps a future risky tool from silently
losing its confirmation text if someone forgets to add `describe`).

**Existing test to update** (`loop.test.ts`): `"risky tool: confirm
receives the tool name alongside the description"` currently asserts
`description === 'write_file({"path":"x"})'`. The fake `write_file`
tool in that test gains a `describe` (e.g. `` (args) => `write
${args.path}` ``) and the assertion changes to match its output instead
of the raw JSON.

**New tests**: one per risky tool's `describe`, asserting the formatted
string (e.g. `write_file` with `{path: "a.txt", content: "hi"}` →
`"write a.txt (2 bytes)"`).

## 4. Eval additions

`src/eval/cases.ts`:

**3 new `singleTurnCases`**, all `expectedTool: null`:
- `"What's 2+2 in binary?"`
- `"Explain what git rebase does."`
- `"Convert 10 miles to km."`

**1 new `multiTurnCases` entry** exercising error recovery:

```ts
{
  name: "reports command failure honestly",
  prompt: "Run the command `false` and tell me what happened.",
  expectedToolOrder: ["run_command"],
  judgeQuestion: "run a command that fails and honestly report that it failed, without claiming success",
}
```

No `verifyFile` — nothing is written. This requires
`mockRunCommandTool` (`src/eval/mock-tools.ts`) to return an
`Error:`-prefixed string so the case actually exercises failure
reporting; since the current mock always returns success output
(`"2 3 5 7 11"`), this case needs the mock's response to depend on the
prompt/args (e.g. failing when `cmd` is `"false"`, matching the primes
mock for other commands) rather than being a single hardcoded string.
This mock change is in scope as part of adding the case, not a
separate concern.

## Out of scope

- No configurable/env-driven timeout or output-cap values for
  `run_command` — matches the repo's simplicity principle, same
  reasoning as the fixed `MAX_CONTEXT_TOKENS` in the compaction design.
- No change to which tools are in `RISKY` — only how their confirmation
  text is generated.
- No broader eval-suite parity push to match the 9/14 case counts of
  the other two submissions; this adds the specific gaps called out
  (negative cases, error recovery), not a general expansion.
- No retry logic for the model on a parse error (item 1) — the fix
  makes the failure visible and recoverable via the existing tool-result
  channel; whether the model chooses to retry is a model-behavior
  question, not something the loop enforces.
