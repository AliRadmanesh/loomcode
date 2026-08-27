# AI Engineering Course — Repo Conventions

This repo is homework for an "AI Engineering" course. The end goal is to
build a Claude Code clone from scratch, **without any agent frameworks**
(no LangChain, LlamaIndex, Vercel AI SDK, or equivalents in any
language) — the tool-calling loop, prompt assembly, and memory must be
hand-rolled so the underlying mechanics are fully understood.

## Simplicity principle

Each week, build the **simplest version** of whatever is being discussed
that week, from scratch. Avoid complexity from the start — no
speculative abstractions, no unrequested features, no extra tooling. If
a later week's assignment needs more, extend the existing base
gradually at that point rather than pre-building for it now.

## Tech stack

- TypeScript, run and managed with **Bun** — no npm/yarn/pnpm, no bundler.
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

Weekly homework branches stack on top of each other: `week-01` branches
from `main`, `week-02` from `week-01`, and so on, since later weeks
extend the agent built in earlier weeks. `main` holds only the shared
bootstrap (scaffold, docs, base `src/agent.ts`) and never accumulates
homework solutions. Each week's branch is what gets submitted for
review.

## Commit convention

Within a week's branch, each discrete step/section of that week's
assignment is its own commit, in the order completed, with a message
describing that step. This gives a readable, incremental history per
week.

## Design docs

Architectural decisions are recorded under `docs/superpowers/specs/`
before implementation.
