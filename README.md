# loomcode

A Claude Code clone, built from scratch — coursework for
**[Build a Claude Code Clone From Scratch](https://pjsofts.github.io/)**,
a 12-week mentorship by Pouria Jahandideh. This repo is the TypeScript
track: weaving together the agent loop, tool use, and a production
runtime by hand, with **no agent frameworks**.

## Why

The course starts from first principles — the agent loop, evals, a
production runtime — and finishes with a real AI coding tool built from
the ground up. So instead of reaching for LangChain, LlamaIndex, the
Vercel AI SDK, or similar, everything here — prompt assembly, the
tool-calling loop, memory — is implemented directly against the LLM
provider's API.

## Curriculum

**Part I — Foundations (weeks 1–3):** agent loop fundamentals, tool
calling, structured outputs, evaluation frameworks, context engineering,
RAG basics, runtime architecture, crash recovery, sandboxed execution.

**Part II — Building the clone (weeks 4–12):** a streaming chat
interface with cost metering, code manipulation tools (read/write/edit/
bash), semantic search over a custom vector database, planning and
memory management, a secure sandbox with live preview, tracing and
reliability testing, and multi-agent orchestration.

## Tech stack

- **TypeScript**, run and managed with **[Bun](https://bun.sh)** — no
  npm/yarn/pnpm, no bundler.
- **[OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)**
  (`client.responses.create`) via the official `openai` npm package.
- **[OpenRouter](https://openrouter.ai)** as the model provider, used as
  an OpenAI-compatible endpoint (custom `baseURL` + API key), so any
  model available on OpenRouter can be swapped in via env var.

## Week 1: interactive CLI agent

Week 1 turned the bootstrap's one-shot call into an interactive,
tool-calling CLI agent:

- **Hand-rolled agent loop** (`src/loop.ts`) — holds conversation state as
  a plain `ResponseInputItem[]` array resent on every call (no
  `previous_response_id`), and round-trips with the model until it stops
  calling tools or hits a `MAX_STEPS` cap.
- **Six tools** (`src/tools/`): `web_search` (via OpenRouter's `web`
  plugin), `read_file`, `write_file`, `edit_file`, `list_files`, and
  `run_command`.
- **Human-approval gate** — `write_file`, `edit_file`, and `run_command`
  are risky, so the loop pauses and asks `y`/`n` before running them; a
  denial is fed back to the model instead of crashing.
- **Eval suite** (`src/eval/`) — single-turn tool-choice checks against
  the live model, plus a multi-turn case (mocked `web_search`/
  `run_command`) that checks tool order, that the expected file exists,
  and uses an LLM judge to check the final answer is actually correct.

See `TRANSCRIPT.md` for a live session and `NOTES.md` for what came out of
building it, and `docs/superpowers/plans/2026-08-27-week-01-cli-agent-plan.md`
for the implementation plan.

## Getting started

```bash
bun install
cp .env.example .env
```

Fill in `.env` with your OpenRouter API key (and optionally different
models — `OPENROUTER_JUDGE_MODEL` powers the eval suite's LLM judge and
should differ from `OPENROUTER_MODEL`):

```
OPENROUTER_API_KEY=your-key-here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=z-ai/glm-5.3-flash
OPENROUTER_JUDGE_MODEL=
```

Then:

```bash
bun run dev    # start the interactive CLI agent
bun test       # run the unit test suite
bun run eval   # run the eval suite against the live model
```

## Project structure

```
.
├── src/
│   ├── agent.ts          # interactive CLI entrypoint
│   ├── loop.ts            # the tool-calling agent loop
│   ├── tools/              # web_search, read/write/edit/list_files, run_command
│   └── eval/                # single-turn + multi-turn eval suite, LLM judge
├── docs/superpowers/
│   ├── specs/            # design docs for each piece of work
│   └── plans/            # implementation plans
├── TRANSCRIPT.md         # a full week-1 session transcript
├── NOTES.md              # what was hardest, a bug the eval caught, what's next
├── CLAUDE.md             # conventions for Claude Code sessions
├── AGENTS.md             # conventions for other AI coding tools
└── .env.example
```

## Repo conventions

This repo tracks a 12-week mentorship, so branches and commits are
structured to make each week's work easy to review independently.

**Branches stack week over week**, since later weeks extend the agent
built in earlier ones:

```
main ──●───────────────▶ (bootstrap only: scaffold, docs, base agent.ts)
        \
         ●──●──●  week-01
               \
                ●──●──●  week-02
```

- `main` holds only the shared bootstrap and never accumulates homework
  solutions.
- `week-NN` branches from the previous week's branch, carrying forward
  all prior weeks' code, and is what gets submitted for review.

**Commits are per-step within a week** — each discrete step of that
week's assignment is its own commit, in the order completed, so the
history reads as a build log of the solution.

See `CLAUDE.md`/`AGENTS.md` for the full conventions, and
`docs/superpowers/specs/2026-08-27-course-bootstrap-design.md` for the
design behind this bootstrap.
