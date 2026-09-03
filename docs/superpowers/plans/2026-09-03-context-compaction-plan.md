# Context Compaction Implementation Plan

**Goal:** Add automatic context compaction to the agent loop so long sessions don't overflow the model's context window — when the conversation's estimated token usage crosses 80% of a fixed budget, summarize the older turns into a single condensed message while preserving the most recent turns verbatim.

**Architecture:** A new `compactIfNeeded({ client, model, input })` function in `src/loop.ts`, called once at the top of `runTurn` before the step loop. It estimates tokens with a `chars/3.75` heuristic, and if over 80% of `MAX_CONTEXT_TOKENS`, finds the last `KEEP_RECENT_TURNS` user-message boundaries, calls the model once (no tools) to summarize everything before that cut point, and splices the old items out in favor of a single `{ role: "developer" }` summary message. `input` is mutated in place, matching the array-by-reference pattern `agent.ts` already relies on — no other files change.

**Tech Stack:** Same as the rest of the branch — TypeScript on Bun, `openai` npm package against OpenRouter (Responses API), `bun:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-context-compaction-design.md`

## Global Constraints

- No real tokenizer — token usage is estimated as `JSON.stringify(input).length / 3.75`.
- `MAX_CONTEXT_TOKENS = 150_000` (fixed constant, not env-configurable).
- `KEEP_RECENT_TURNS = 2` — cutting only ever happens at `role: "user"` boundaries, never inside a `function_call`/`function_call_output` pair.
- If the array has `KEEP_RECENT_TURNS` or fewer user-turn boundaries total, compaction is skipped (nothing safe to compact).
- No truncation of individual large tool outputs, no per-model budgets, no extra error handling around the summarization call beyond what already exists (or doesn't) elsewhere in the codebase — all explicitly out of scope per the spec.

---

### Task 1: Compact old turns when the conversation grows large

**Files:**
- Modify: `src/loop.ts`
- Modify: `src/loop.test.ts`

**Interfaces:**
- Consumes: `ResponsesClient` from `src/loop.ts` (existing).
- Produces: `MAX_CONTEXT_TOKENS: number`, `KEEP_RECENT_TURNS: number`, `CompactOptions` interface, and `compactIfNeeded(opts: CompactOptions): Promise<void>` — all from `src/loop.ts`. `runTurn` calls it internally; its own signature is unchanged.

- [x] **Step 1: Write the failing tests — append to `src/loop.test.ts`**

Three cases: under budget (no-op, zero summarization calls), over budget with enough turns (old turns replaced by a `developer` summary message, last `KEEP_RECENT_TURNS` turns preserved verbatim), and over budget but with too few user turns to safely cut (no-op).

- [x] **Step 2: Run the tests to verify they fail**

Ran `bun test src/loop.test.ts` — failed with `SyntaxError: Export named 'compactIfNeeded' not found in module`, confirming the tests exercise a feature that doesn't exist yet (not a typo).

- [x] **Step 3: Implement `compactIfNeeded` in `src/loop.ts`**

`estimateTokens` (chars/3.75 heuristic) → threshold check against `MAX_CONTEXT_TOKENS * 0.8` → find `role: "user"` indices → bail if `userIndices.length <= KEEP_RECENT_TURNS` → cut at `userIndices[userIndices.length - KEEP_RECENT_TURNS]` → one `client.responses.create()` call (no tools) over the old items plus a summarization instruction → `input.splice(0, cutIndex, summaryItem)` with `summaryItem = { role: "developer", content: "Summary of earlier conversation:\n" + response.output_text }`.

- [x] **Step 4: Run the tests to verify they pass**

Ran `bun test src/loop.test.ts` — 10/10 pass (3 new + 7 existing, unaffected).

- [x] **Step 5: Wire it into `runTurn`**

Added `await compactIfNeeded({ client, model, input });` at the top of `runTurn`, before the step loop. No change to `RunTurnOptions` or any caller (`agent.ts`, `eval/eval.ts`).

- [x] **Step 6: Full regression check**

Ran `bun test` (whole repo) — 25/25 pass. Ran `bunx tsc --noEmit -p .` — no errors.

- [x] **Step 7: Code review**

Dispatched a code-reviewer subagent against the working-tree diff. Verdict: "Ready to merge, with fixes (non-blocking)" — no Critical or blocking Important issues; flagged the missing design/plan docs (addressed by this plan and its companion spec) and the absence of try/catch around the summarization call (confirmed consistent with every other `responses.create` call site in the codebase — left as a known, matching gap rather than special-cased here).

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-09-03-context-compaction-design.md \
        docs/superpowers/plans/2026-09-03-context-compaction-plan.md \
        src/loop.ts src/loop.test.ts
git commit -m "feat: add context compaction to the agent loop"
```
