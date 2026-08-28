# Week 1 CLI Agent — Notes

## Hardest part: writing an eval that actually verifies correctness

The agent loop itself was mechanically simple once the Responses API's
`function_call`/`function_call_output` threading clicked. The harder part
was making the multi-turn eval catch a *wrong* answer instead of
rubber-stamping any answer.

**The bug:** `mockRunCommandTool` (`src/eval/mock-tools.ts`) hardcoded 9
primes (`"2 3 5 7 11 13 17 19 23"`), but the case asked for the first 5.
Tool order and file-write were both correct, so the model noticed the
mismatch and honestly flagged it — which the LLM judge correctly failed:

````
$ bun run src/eval/eval.ts
PASS - arithmetic (no tool) (expected no tool, got no tool)
PASS - web search (expected web_search, got web_search)
PASS - write file (expected write_file, got write_file)
FAIL - write then run (order=write_file,run_command, fileOk=true, judgeOk=false, answer=I've created `primes.py` and ran it.
...
**Output of `python primes.py`:**
```
2 3 5 7 11 13 17 19 23
```
Note: the output shown includes more primes than the requested 5 ... may just be an artifact of the mock execution environment — the script itself is written to print exactly 5 primes.)

3/4 passed
````

A human skimming the transcript would likely wave this through — right
tools, right order, file on disk. It only surfaced because the judge checks
the *semantic* correctness of the final answer, not just tool mechanics.

**Fix:** made the mock return exactly 5 primes (`"2 3 5 7 11"`) so it
matches the prompt. Reran → `4/4 passed`. Lesson: mocked tool outputs are
themselves eval inputs and must stay in sync with the prompt, or the eval
produces noise instead of signal.

## One thing I'd add next: surface tool output/errors to the user

The CLI logs which tool got called (`[tool] run_command({...})`) but not
what it returned. During manual testing this looked like a bug: two
`run_command` calls back to back, each with its own y/n prompt —

```
[tool] run_command({"cmd":"python fibonacci.py"})
[tool] run_command({"cmd":"python3 fibonacci.py"})
```

The model had silently gotten `python: command not found`, understood it,
and retried with `python3` — correct, intelligent behavior. But with no
visible output, it read as a glitch; I only understood it from the saved
transcript afterward.

**Next step:** print each tool's return value next to its `[tool]` line,
e.g. `[tool] run_command(...) → Error: exited with code 127`, so
self-correction like this is legible live, not just reconstructable after
the fact.
