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
- `package.json`, `tsconfig.json`, and `.env*` live at the repo root and
  are shared by every week. The base `src/agent.ts` at the root is the
  bootstrap starting point and is left as-is — see "Module layout" below
  for where weekly code actually goes.
- LLM calls go through the OpenAI **Responses API**
  (`client.responses.create`), never Chat Completions.
- LLM SDK is the official `openai` npm package.
- Model provider is **OpenRouter**, used as an OpenAI-compatible endpoint
  via a custom `baseURL` (`OPENROUTER_BASE_URL`) and API key
  (`OPENROUTER_API_KEY`), both loaded from `.env` via `dotenv`.

## Module layout

Everything lives on `main` — there are no weekly branches. Each week is
its own top-level directory (`week-01/`, `week-02/`, ...) holding that
week's `src/` and any week-specific notes (`NOTES.md`, `TRANSCRIPT.md`).
A week's directory never imports from another week's directory — each
one is an independent module, not an extension of the previous week's
code. If a later week needs something an earlier week built, copy the
relevant code into the new week's directory rather than importing across
weeks.

Shared, repo-wide things stay at the root: tooling config
(`package.json`, `tsconfig.json`, `.env.example`), the base
`src/agent.ts` bootstrap, the `scripts/dev.ts`/`scripts/eval.ts`
dispatchers (`bun run dev [week-NN]`, `bun run eval [week-NN]`), root
docs (`CLAUDE.md`, `AGENTS.md`, `README.md`), and all design docs under
`docs/superpowers/` (see below — this directory is shared across all
weeks, not per-week).

## Commit convention

Each discrete step/section of a week's assignment is its own commit, in
the order completed, with a message describing that step. This gives a
readable, incremental history per week, all directly on `main`.

## Design docs

Architectural decisions for every week are recorded under the one
shared `docs/superpowers/specs/` (with matching `docs/superpowers/plans/`
implementation plans) before implementation — not inside each week's
directory. See `docs/superpowers/specs/2026-08-27-course-bootstrap-design.md`
for the bootstrap's design.
