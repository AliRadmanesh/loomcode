# AI Engineering Course — Repository Bootstrap Design

**Date:** 2026-08-27
**Status:** Approved

## Purpose

This repository holds the homework for an "AI Engineering" course. The
course's end goal is to build a Claude Code clone from scratch, without
using any agent frameworks, so that the underlying mechanics of an
agentic coding assistant (LLM calls, tool use, the agent loop, etc.) are
fully understood rather than abstracted away.

Each week of the course adds a homework exercise. This document defines
the conventions for organizing that work across git branches and
commits, and the initial bootstrap deliverable that every week builds on
top of.

## Constraints and decisions

- **Language:** TypeScript.
- **Runtime/tooling:** Bun (`bun init`, `bun run`, `bun add`) — no other
  package manager or bundler.
- **LLM request style:** OpenAI **Responses API** (`client.responses.create`),
  not the older Chat Completions API.
- **LLM SDK:** the official `openai` npm package.
- **Model provider:** OpenRouter, used as an OpenAI-compatible endpoint
  (custom `baseURL` + OpenRouter API key), so any model available on
  OpenRouter can be swapped in.
- **Hard rule — no agent frameworks:** no LangChain, LlamaIndex, Vercel
  AI SDK, or similar. The tool-calling loop, prompt assembly, memory,
  etc. must be implemented by hand. This is the pedagogical point of the
  course.

## Branch model

Weekly branches **stack** on top of each other, since later weeks extend
the agent built in earlier weeks:

```
main ──●────────────────────────────▶ (bootstrap only: scaffold, docs, base agent.ts)
        \
         ●──●──●  week-01
               \
                ●──●──●  week-02
                       \
                        ●──●──●  week-03
```

- `main` contains only the shared bootstrap (this design's deliverable):
  project scaffold, `.env.example`, `CLAUDE.md`, `AGENTS.md`, and the
  base `agent.ts`. It does not accumulate homework solutions.
- `week-NN` branches from the previous week's branch (`week-01` branches
  from `main`, `week-02` from `week-01`, and so on), carrying forward all
  prior weeks' code.
- Each week branch is what gets sent to the instructor for review.

## Commit convention

Within a week's branch, each discrete step/section of that week's
assignment is its own commit, committed in the order the steps were
completed. Commit messages describe the step (e.g. "add tool-calling
loop", "add file-read tool", "add streaming output"), giving the
instructor a readable, incremental history of how the week's solution
was built.

## Bootstrap deliverable (this design, on `main`)

1. `git init` at the repository root.
2. `bun init` to scaffold a minimal TypeScript project (no framework
   template).
3. Dependencies:
   - `openai` (LLM SDK)
   - `dotenv` (env var loading)
   - `@types/node` (dev dependency, for Node type definitions Bun relies
     on for some globals/APIs)
4. `.env.example` with:
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_BASE_URL`
5. `agent.ts`:
   - Loads environment variables via `dotenv`.
   - Constructs an `OpenAI` client from the `openai` package, pointed at
     OpenRouter via `baseURL` + `apiKey` from the env vars above.
   - Makes one basic call using `client.responses.create(...)` with a
     simple hardcoded prompt/question.
   - Logs the model's answer to the console.
6. `package.json` gets a script (e.g. `dev` or `start`) that runs
   `bun run agent.ts`.

## Documentation

- **`CLAUDE.md`** (repo root): project-specific instructions for Claude
  Code sessions — the branch/commit conventions above, the tech stack
  (TypeScript + Bun, OpenAI Responses API via the `openai` package,
  OpenRouter as the model provider), and the no-agent-frameworks rule.
- **`AGENTS.md`** (repo root): the same conventions, phrased
  framework-agnostically, for any other AI coding tool that reads this
  file.
- This spec (`docs/superpowers/specs/2026-08-27-course-bootstrap-design.md`)
  is the canonical record of these decisions and is committed to git.

## Out of scope

- No week-01 (or any week's) homework content is part of this design.
  Each week gets its own design/plan once the assignment is known, built
  on its own stacked branch.
- No testing framework, linting, or CI setup — not requested, and
  premature for a single-file bootstrap.
