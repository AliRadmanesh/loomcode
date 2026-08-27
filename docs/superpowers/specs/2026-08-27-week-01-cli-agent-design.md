# Week 1 — Command-Line Agent Design

**Date:** 2026-08-27
**Status:** Approved

## Purpose

Week 1's assignment is to build a single interactive command-line agent
that a person can talk to in a loop. It must answer plain questions
from its own knowledge, search the web, write and run scripts, edit
existing files, gate every risky action behind a human yes/no, and be
proven correct by an eval suite rather than a one-off demo transcript.

This builds directly on the bootstrap (`docs/superpowers/specs/2026-08-27-course-bootstrap-design.md`):
same stack (TypeScript, Bun, OpenAI Responses API via `openai`, single
OpenRouter provider), extended from the one-shot `src/agent.ts` call
into a stateful, tool-calling loop.

## Assignment requirements (source of truth)

The agent must support, in one interactive session:

1. Answer general questions with no tool call.
2. Search the web when it needs current/external facts.
3. Write a script to disk and run it.
4. Edit a file that already exists.
5. Ask for human approval (y/n) before any risky action: writing,
   editing, or running a command. Denial feeds back into the
   conversation instead of crashing.
6. Be checked by a separate eval suite (single-turn tool-choice cases,
   including a no-tool negative case, plus multi-turn behavior cases
   scored by an LLM judge), reporting a pass rate.

Non-functional requirements: tool errors are returned to the model as
text, never crash the loop; a step cap prevents infinite tool-call
loops.

## Branch

`week-01`, branched from `main`. Carries forward the bootstrap's
`src/agent.ts` and extends it in place per the commit convention (one
commit per build step below).

## Constraints and decisions

- **Single LLM provider:** every model call — the agent loop, the
  `web_search` tool, and the eval's LLM judge — goes through the one
  OpenRouter client (`OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL`), per
  the bootstrap's no-second-provider convention. No separate OpenAI key.
- **Web search:** OpenRouter's own hosted search, not OpenAI's
  `tools:[{type:"web_search"}]` syntax — OpenRouter does not pass that
  syntax through. Instead the `web_search` tool's `execute` makes its
  own nested `client.responses.create({ plugins: [{ id: "web",
  max_results: 5 }], input: query })` call and returns `output_text`.
  This keeps `web_search` an ordinary tool function (mockable, subject
  to the same error handling as every other tool) rather than a
  transparent server-side injection the agent loop can't see.
- **Conversation state is hand-rolled, not `previous_response_id`.**
  `previous_response_id` requires the provider to persist responses
  server-side; relying on it would hide the exact mechanics this course
  exists to make visible. Instead the loop keeps its own
  `input: ResponseInputItem[]` array and resends the full array (plus
  new items) on every request.
- **No `delete_file` tool.** The assignment's example `RISKY` set
  mentions `delete_file`, but the required tool table only lists
  `web_search`, `write_file`, `read_file`, `edit_file`, `list_files`,
  `run_command`. Only those six are implemented. The risky set is kept
  as a plain array/Set (not hardcoded logic) so adding a tool to it
  later is a one-line change.
- **File layout is modular** (folders per concern), anticipating that
  later weeks add more tools and eval cases on top of this same branch
  lineage.

## File layout

```
src/
  agent.ts              — CLI entry: readline "you ›" loop, wires everything together
  loop.ts               — the agent loop: Responses API round-trips, step cap, stop rule
  tools/
    index.ts            — tool registry (name → {schema, execute}) and the RISKY set
    web-search.ts
    write-file.ts
    read-file.ts
    edit-file.ts
    list-files.ts
    run-command.ts
  eval/
    eval.ts              — eval runner, prints the pass-rate report
    cases.ts              — single-turn and multi-turn case definitions
    mock-tools.ts         — canned web_search/run_command results for multi-turn cases
    judge.ts              — LLM-as-judge call (OPENROUTER_JUDGE_MODEL)
```

## Conversation loop (Responses API mechanics)

The loop maintains one `input: ResponseInputItem[]` array per process
run (in-memory only; no persistence across runs — not required by the
assignment).

Per user turn:

1. Append `{ role: "user", content: <what the person typed> }` to `input`.
2. Loop, bounded by `MAX_STEPS = 15`:
   - Call `client.responses.create({ model, input, tools })`.
   - If the response's output contains no `function_call` items, this
     is the **stop rule**: print the assistant's text and return to the
     `you ›` prompt.
   - Otherwise, for each `function_call` item: append it to `input`,
     resolve and run the tool (through the approval gate if risky),
     append a `{ type: "function_call_output", call_id, output:
     <result string> }` item to `input`, then continue the loop with
     the updated `input`.
   - If the loop reaches `MAX_STEPS` without a stop, print a "gave up
     after N steps" message and return to the prompt.

## Tool registry and schemas

Each tool is:

```ts
{
  name: string,
  description: string,
  parameters: <JSON schema for the function's arguments>,
  execute: (args) => Promise<string>,
}
```

`execute` never throws. Internally it wraps its work in try/catch and
returns `"Error: " + message` on failure, so a failed tool call is
handed back to the model as ordinary text it can react to — never a
crash. This applies uniformly to all six tools (e.g. `read_file` on a
missing path returns an error string, not an exception).

`RISKY = new Set(["write_file", "edit_file", "run_command"])`.
`web_search`, `read_file`, and `list_files` run unconditionally — they
can't mutate anything.

## Approval gate

The loop takes a `confirm: (description: string) => Promise<boolean>`
function as a parameter, injected rather than hardcoded:

- The CLI (`agent.ts`) passes a real `readline`-backed y/n prompt.
- The eval suite passes a stub that always resolves `true` (no human is
  present during automated runs).

Before executing a call to a tool in `RISKY`, the loop prints what it's
about to do (tool name + arguments) and awaits `confirm(...)`.

- On `true`: run the tool normally.
- On `false`: skip execution; push `"User denied this action."` as
  that call's `function_call_output`, and continue the loop — the model
  sees the denial as a normal tool result and decides what to do next.

## Eval suite

Separate from the agent (`src/eval/`), run on demand (not part of the
interactive CLI).

**Single-turn — tool choice.** Call `responses.create` directly with
the tool schemas (no execution of the chosen tool), and assert which
`function_call` name (if any) appears in the output. Cases include the
three from the assignment (arithmetic → no tool, "latest React
version" → `web_search`, "create hello.txt" → `write_file`) plus the
required negative case proving the model doesn't reach for a tool on a
trivial question.

**Multi-turn — behavior.** Run the real loop (`loop.ts`) end-to-end
against the real tool registry, except `web_search` and `run_command`
are swapped for deterministic mocks (`src/eval/mock-tools.ts`) that
return canned strings — fast, free, no network/process calls.
Filesystem tools (`write_file`/`read_file`/`edit_file`/`list_files`)
run for real against a scratch temp directory created per case, since
they're already fast/free/deterministic. `confirm` is stubbed to always
approve. Each case asserts:

- the tools were called in a sensible order (e.g. write before run),
  and
- the final answer is correct, scored by an LLM judge
  (`src/eval/judge.ts`, using `OPENROUTER_JUDGE_MODEL` — a fixed model
  distinct from whatever `OPENROUTER_MODEL` the agent itself is
  running, so the judge never grades its own output and stays stable if
  the agent model is swapped): prompt it with "Did this response
  correctly do X? Answer PASS or FAIL."

**Report.** `eval.ts` prints a pass rate (`"N/M passed"`) and lists
which named cases failed. Its stdout output is one of the graded
deliverables, so no extra formatting/export step is needed — the run
output is pasted directly into the submission.

## Build order (maps to commits on `week-01`)

One commit per step, in this order, matching the assignment's
suggested build order:

1. Bare loop — `loop.ts` + `agent.ts`, no tools, confirms plain-text
   answers work (the stop rule).
2. `web_search` tool wired in.
3. Filesystem tools: `write_file`, `read_file`, `edit_file`,
   `list_files`.
4. `run_command`, enabling write-then-run.
5. Approval gate wraps the `RISKY` tools.
6. Eval suite (`src/eval/`), written last so it can catch what manual
   testing missed.
7. Transcript + `NOTES.md` deliverables.

## Deliverables (per assignment)

- The agent (`src/agent.ts`, `src/loop.ts`, `src/tools/`).
- The eval suite (`src/eval/`) and a pasted copy of its pass-rate
  output.
- A 5–10 turn transcript showing: a plain answer, a web search, a
  write-then-run, an edit, and at least one denied action.
- `NOTES.md`: hardest part, one bug the eval caught, one thing to add
  next.

## Out of scope

- No sandboxing of `run_command` beyond the approval gate — the
  assignment specifies human approval as the safety mechanism, not
  process isolation.
- No persistence of conversation history across process runs.
- No streaming output — the assignment's transcript format is
  request/response, not token-streamed.
- No additional tools beyond the required six.
