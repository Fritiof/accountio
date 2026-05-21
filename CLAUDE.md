# CLAUDE.md — Guardrails for Accountio

Concise rules for any Claude session working in this repo. Read this first.

## What this is

A take-home assignment: a web app where an accountant uploads a Swedish supplier invoice (PDF), an LLM generates a balanced double-entry journal entry against the BAS chart of accounts, both are persisted, and the accountant approves or rejects the proposal side-by-side with the PDF.

See [interview.md](interview.md) for the original spec.

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend runtime | Bun | Runs TypeScript natively, no transpile step, ships its own test runner. |
| Backend lang | TypeScript (`strict`) | Type safety; `any` is forbidden. |
| HTTP | Hono | Tiny, fast, Bun-native ergonomics, easy in-process testing via `app.request()`. |
| ORM | Drizzle + drizzle-kit | TypeScript-first, SQL-shaped, clean migrations. |
| DB | Postgres 18 | Relational data fits the journal/postings shape; matches docker compose vibe. |
| LLM | `@anthropic-ai/sdk` (Claude Sonnet 4.6) | Native PDF document blocks + tool-use for structured output. |
| Frontend | Next.js 16 (App Router) + React 19 | Server components for data fetching, client islands for interactivity. |
| Styling | Tailwind + shadcn/ui | Fast, accessible primitives, easy to extend live. |
| Tests | `bun test` (built-in) | No Jest, no Vitest. |
| Lint/format | Biome | Single binary, replaces ESLint + Prettier. |
| Pre-commit | Husky + lint-staged | Blocks commits with `any`, type errors, or formatting drift. |

## Run modes (both supported, both must stay working)

- **Docker**: `docker compose up --build` — postgres + backend + frontend, all with hot reload.
- **Local**: `docker compose up -d postgres` for the DB, then `bun run dev` separately in `backend/` and `frontend/`.

Never hardcode hosts/ports/URLs. Read everything from env. Defaults in `backend/.env.example` and `frontend/.env.example` target `localhost`; `docker-compose.yml` overrides them for the docker network.

## Language rules

- `strict: true` in both `tsconfig.json` files, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- **No `any`** — explicit or implicit. The pre-commit hook will reject the commit. Biome catches explicit `: any`; TypeScript catches implicit.
- No `// @ts-ignore`. Use `// @ts-expect-error` with a one-line reason if absolutely necessary.
- No `as unknown as T` casts to silence the compiler — narrow the type properly.

## Lint & format

- Biome only. Don't add ESLint or Prettier.
- `biome.json` at the repo root covers both apps.
- Run `bun run lint:fix` before committing if the hook complains.

## Pre-commit hook

- Husky + lint-staged at the repo root.
- Hook auto-fixes formatting on staged files, then runs `bun run typecheck` across both apps.
- Tests are NOT in pre-commit (too slow) — run via CI or manually.
- **Never use `--no-verify`** unless explicitly asked. If a hook fails, fix the underlying issue.

## Frontend rules

- Next.js App Router. Server components by default; add `'use client'` only when the component needs state, effects, or browser APIs.
- After mutations, call `router.refresh()` so the server component re-fetches — don't manage shadow state in the client.
- Do NOT proxy backend calls through Next.js route handlers. Use the `rewrites` in `next.config.ts`.
- shadcn components live in `frontend/components/ui`.
- Postings table is read-only. Don't add inline editing without asking first.

## Package manager

- Bun only. Never `npm`/`yarn`/`pnpm`.
- Lockfile is `bun.lock` (text format, commit it).

## Database

- Migrations via drizzle-kit. `bun run db:generate` to create one, `bun run db:migrate` to apply.
- Run inside the backend container or natively — both work.
- Migrations are committed. Never delete a committed migration; write a new one.

## Secrets

- Never commit `.env`, `.env.local`, or `anthropic_api_key.txt`. All gitignored.
- The `.env.example` files (root, backend, frontend) are committed with placeholders.

## LLM

- Model: `claude-sonnet-4-6`. Don't downgrade silently. Override via `ANTHROPIC_MODEL` env if you need to.
- Send the PDF natively as a `document` content block — don't add a PDF-parsing library.
- In dev/prod, call the real API. In tests, inject a stub via the `createAnthropicClient` factory exported from `backend/src/lib/anthropic.ts`. Don't mock at the module level.

## Accounting invariants (load-bearing)

- Every persisted journal entry MUST satisfy `sum(debit) === sum(credit)` to the cent.
- Every posting's `account_number` MUST exist in the BAS chart (`backend/src/lib/accounts.ts`).
- Use integer-cent arithmetic in validators — never raw floats.
- Validators live in `backend/src/lib/journal.ts` as pure functions and are covered by `backend/tests/journal.test.ts`.

## Commits

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Merge commits when integrating branches — never rebase shared history.

## Sample PDF

The take-home shipped with `simple_invoice.pdf` in the repo root. Use it for manual E2E checks and as a reference fixture.
