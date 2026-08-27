# AI Engineering Course — Repo Conventions

This repo is homework for an "AI Engineering" course. The end goal is to
build a Claude Code clone from scratch, **without any agent frameworks**
(no LangChain, LlamaIndex, Vercel AI SDK, etc.) — the tool-calling loop,
prompt assembly, and memory must be hand-rolled so the underlying
mechanics are fully understood.

## Tech stack

- TypeScript, run and managed with **Bun** (`bun init`, `bun add`, `bun run`)
  — no npm/yarn/pnpm, no bundler.
- All source code lives under `src/` (e.g. `src/agent.ts`). Root stays for
  config (`package.json`, `tsconfig.json`, `.env*`) and docs (`CLAUDE.md`,
  `AGENTS.md`, `docs/`).
- LLM calls go through the OpenAI **Responses API**
  (`client.responses.create`), never Chat Completions.
- LLM SDK is the official `openai` npm package.
- Model provider is **OpenRouter**, used as an OpenAI-compatible endpoint
  via a custom `baseURL` (`OPENROUTER_BASE_URL`) and API key
  (`OPENROUTER_API_KEY`), both loaded from `.env` via `dotenv`.

## Branch model

Weekly homework branches stack on top of each other, since later weeks
extend the agent built in earlier weeks:

```
main ──●───────────────▶ (bootstrap only)
        \
         ●──●──●  week-01
               \
                ●──●──●  week-02
```

- `main` holds only the shared bootstrap (project scaffold, docs, base
  `src/agent.ts`) and never accumulates homework solutions.
- `week-NN` branches from the previous week's branch (`week-01` from
  `main`, `week-02` from `week-01`, ...), carrying forward all prior
  weeks' code.
- Each week's branch is what gets submitted to the instructor.

## Commit convention

Within a week's branch, each discrete step/section of that week's
assignment is its own commit, in the order completed, with a message
describing that step (e.g. "add tool-calling loop", "add file-read
tool"). This gives a readable, incremental history per week.

## Design docs

Architectural decisions are recorded under
`docs/superpowers/specs/` before implementation. See
`docs/superpowers/specs/2026-08-27-course-bootstrap-design.md` for the
bootstrap's design.
