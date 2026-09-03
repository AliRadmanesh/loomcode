# Context Compaction Design

**Date:** 2026-09-03
**Status:** Approved

## Purpose

`src/agent.ts` keeps one `input: ResponseInputItem[]` array for the
life of the process and appends to it every turn, per the week-01
design's hand-rolled conversation state (no `previous_response_id`).
Left unbounded, a long session eventually exceeds the model's context
window. This adds automatic compaction: when the conversation gets
large, older turns are summarized into a single condensed message so
long sessions don't overflow the window.

This extends the existing loop (`src/loop.ts`) rather than introducing
a new subsystem — no new files, no new call sites outside `runTurn`.

## Token estimate

No real tokenizer is added (the `openai` package doesn't ship one, and
the course conventions favor the simplest working approach over an
extra dependency). Usage is estimated as:

```
estimateTokens(input) = JSON.stringify(input).length / 3.75
```

This is a heuristic, not an exact count — it only needs to be good
enough to decide *whether* to compact, not to bill accurately.

## Trigger

`MAX_CONTEXT_TOKENS = 150_000` (fixed constant, not env-configurable —
matches the repo's simplicity principle; revisit if a later week needs
per-model budgets). Compaction runs when the estimate reaches 80% of
that budget.

## What gets kept vs. summarized

Cutting must never split a `function_call` from its
`function_call_output` — the Responses API requires that pairing. Cut
points are restricted to `role: "user"` message boundaries, since those
never fall inside a call/output pair.

`KEEP_RECENT_TURNS = 2`: the last two user-message boundaries (and
everything after them — assistant replies, tool calls, tool outputs)
are always preserved verbatim. This exists so the model always sees
the live, current request rather than a lossy paraphrase of it — the
new user message is already appended to `input` before `runTurn` (and
therefore `compactIfNeeded`) runs, so at least one turn must survive
untouched for the agent to work at all. Keeping two turns instead of
one adds a small buffer of continuity beyond that correctness minimum.

If the array has `KEEP_RECENT_TURNS` or fewer user-turn boundaries
total, compaction is skipped — there's nothing before the protected
tail to summarize.

**Known limitation, explicitly out of scope for this pass:** if the
protected tail alone (the last `KEEP_RECENT_TURNS` turns) exceeds the
budget — e.g. one turn contains a very large tool output — compaction
cannot reduce it, since that content is never a candidate for
summarization. This makes compaction a soft mitigation, not a hard
budget guarantee. Truncating individual large tool outputs would
address this but is a separate concern (shrinking turn contents, not
summarizing old turns) and is left for a later pass if it comes up in
practice.

## Summary generation and replacement

One extra `client.responses.create()` call, no tools, over the old
items plus an appended instruction asking for a short summary
preserving facts, decisions, and open threads. The resulting
`output_text` replaces the old items via `input.splice(0, cutIndex,
summaryItem)`, where `summaryItem` is `{ role: "developer", content:
"Summary of earlier conversation:\n" + summary }`. The `developer` role
(part of the Responses API's input item role union) keeps this
distinct from real user/assistant turns.

Because the loop always re-checks the whole array on every turn, a
prior summary item that's aged past the protected tail gets folded into
the next round's "old items" and re-summarized rather than
accumulating indefinitely.

## Where it runs

`compactIfNeeded({ client, model, input })` is called once at the top
of `runTurn`, before the step loop, mutating `input` in place — the
same by-reference pattern `agent.ts` already relies on. No changes to
`agent.ts` or any other caller of `runTurn` are needed.

## Out of scope

- No real tokenizer / exact token accounting.
- No per-model or env-configurable token budget.
- No truncation of individual large tool outputs (see limitation
  above).
- No error handling around the summarization call beyond what already
  exists (or doesn't) for other `responses.create` call sites in this
  codebase — a general error-resilience pass, if one happens, should
  cover this uniformly rather than special-casing compaction now.
