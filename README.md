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

## Getting started

```bash
bun install
cp .env.example .env
```

Fill in `.env` with your OpenRouter API key (and optionally a different
model):

```
OPENROUTER_API_KEY=your-key-here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=z-ai/glm-5.3-flash
```

Then run the base agent:

```bash
bun run dev
```

## Project structure

```
.
├── src/                  # all source code (agent.ts today, more each week)
├── docs/superpowers/
│   ├── specs/            # design docs for each piece of work
│   └── plans/            # implementation plans
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
