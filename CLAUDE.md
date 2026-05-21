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
| Styling | Tailwind 4 + minimal shadcn primitives | Tailwind 4 uses `@import "tailwindcss"` and `@theme` directives (NOT v3's `@tailwind base/components/utilities`). Don't downgrade. |
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
- No `!` non-null assertions. Biome's `noNonNullAssertion` rejects them at commit time. Use proper narrowing (`if (!x) throw …`) or destructure with a defensive check.

## Lint & format

- Biome only. Don't add ESLint or Prettier.
- `biome.json` at the repo root covers both apps.
- Run `bun run lint:fix` before committing if the hook complains.

## Pre-commit hook

- Husky + lint-staged at the repo root.
- Hook auto-fixes formatting on staged files, then runs `bun run typecheck` across both apps.
- Tests are NOT in pre-commit (too slow) — run via CI or manually.
- **Never use `--no-verify`** unless explicitly asked. If a hook fails, fix the underlying issue.

## Upload flow (two-stage, load-bearing)

There is **no** `POST /api/bills`. Upload is two requests with a short-lived `bill_drafts` row between them:

1. `POST /api/bills/prepare` — multipart upload → store PDF → call Claude → run supplier match → insert draft row → return `{ draftId, proposal, match }`. Nothing in `bills` yet.
2. `POST /api/bills/confirm` — body `{ draftId, supplier: { kind: 'existing', id } | { kind: 'create', name, orgNumber, vatNumber } }` → resolve supplier, validate proposal, insert `bills` + `journal_entries` + `postings` in one transaction, delete draft.

Also: `GET /api/bills/drafts/:id` (JSON for the confirm page), `GET /api/bills/drafts/:id/pdf` (preview), `DELETE /api/bills/drafts/:id` (abandon).

Drafts have a 1-hour TTL; `/prepare` sweeps expired ones on every call (no background job — don't add one without checking first).

The frontend route map mirrors this: `/bills/confirm/[draftId]` for the supplier confirmation step, `/bills/[id]` for the already-confirmed bill detail. Don't conflate them.

## Suppliers + matching (load-bearing)

Every confirmed bill has a NOT NULL `supplier_id`. Suppliers are never silently created — the user always confirms.

Matching priority in [`backend/src/lib/suppliers.ts`](backend/src/lib/suppliers.ts) `findSupplierMatch`:

1. exact `org_number` (Swedish 10-digit `556677-8899`)
2. exact `vat_number` (country-prefixed `SE556677889901`)
3. exact name (case-insensitive, whitespace-collapsed) — multiple exact hits return as candidates
4. partial-name candidates (top 5, ILIKE `%name%`)
5. none

Do not reorder. The CLI mnemonic is "org → vat → name → candidates → none". Identifiers are stored in canonical form (VAT uppercase, org trimmed) — normalize at both insert and match time via the helpers in the same file.

The matching module is the single seam for upgrading to fuzzy matching later (e.g. `pg_trgm` similarity). Don't sprinkle fuzziness elsewhere.

## Frontend rules

- Next.js App Router. Server components by default; add `'use client'` only when the component needs state, effects, or browser APIs.
- After mutations, call `router.refresh()` so the server component re-fetches — don't manage shadow state in the client.
- Do NOT proxy backend calls through Next.js route handlers. Use the `rewrites` in `next.config.ts`.
- Tailwind 4: use the `@theme` tokens from `app/globals.css` via `text-(--color-foreground)` etc. Don't add raw hex colours.
- shadcn-style primitives live in `frontend/components/ui` — currently just `Button`. Add new ones there.
- Postings table is read-only. Don't add inline editing without asking first.
- Two bill routes: `/bills/[id]` (confirmed) vs `/bills/confirm/[draftId]` (pre-confirm). Confirmed-detail components must not assume a draft is in scope; confirm-page components must not assume a `Bill` row exists.

## Package manager

- Bun only. Never `npm`/`yarn`/`pnpm`.
- Lockfile is `bun.lock` (text format, commit it).

## Database

- Migrations via drizzle-kit. `bun run db:generate` to create one, `bun run db:migrate` to apply.
- Run inside the backend container or natively — both work.
- Migrations are committed. Never delete a committed migration; write a new one.
- Six tables: `accounts` (BAS chart, seeded by migration 0001), `suppliers`, `bills` (with NOT NULL `supplier_id` FK), `bill_drafts`, `journal_entries`, `postings`. Full schema in [`backend/src/db/schema.ts`](backend/src/db/schema.ts).
- If a migration that adds a NOT NULL column fails on stale dev data, `docker compose down -v` to nuke the volume and re-apply from scratch. For real production data you'd need a backfill — out of scope here.

## Secrets

- Never commit `.env`, `.env.local`, or `anthropic_api_key.txt`. All gitignored.
- The `.env.example` files (root, backend, frontend) are committed with placeholders.

## LLM

- Model: `claude-sonnet-4-6`. Don't downgrade silently. Override via `ANTHROPIC_MODEL` env if you need to.
- Send the PDF natively as a `document` content block — don't add a PDF-parsing library.
- In dev/prod, call the real API. In tests, inject a stub by passing `generateJournal` to `createApp({ db, generateJournal })`. The real factory is `createAnthropicJournalGenerator` from [`backend/src/lib/anthropic.ts`](backend/src/lib/anthropic.ts). Don't mock at the module level.
- The chart of accounts flows through the generator as a per-call argument so the system prompt is built fresh each request from the live DB chart. Don't go back to a module-level constant.
- The proposal is zod-validated before it leaves the generator; the route's job is to take that already-typed proposal and persist it.

## Accounting invariants (load-bearing)

- Every persisted journal entry MUST satisfy `sum(debit) === sum(credit)` to the cent.
- Every posting's `account_number` MUST exist in the BAS chart. Source of truth is the `accounts` table; the constant in `lib/accounts.ts` is the seed (migration 0001) and a fallback for pure tests. **Routes always load the live chart via `loadChart(db)` and pass it to `assertAccountsValid`** — don't rely on the module-level fallback in production code.
- Use integer-cent arithmetic in validators — never raw floats.
- Validators live in `backend/src/lib/journal.ts` as pure functions and are covered by `backend/tests/journal.test.ts`.
- **Validation failures don't reject the upload.** If `assertBalanced` or `assertAccountsValid` throws, the route still persists bill + entry + postings, with the issues serialized into `journal_entries.validation_errors` and `status = 'pending'`. The UI surfaces the errors but doesn't block approval — by design, so the accountant can override. Don't move validation into a pre-insert gate without checking first.

## Commits

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Merge commits when integrating branches — never rebase shared history.

## PDF storage seam

- All disk I/O for PDFs lives in [`backend/src/lib/storage.ts`](backend/src/lib/storage.ts) (~30 lines). Don't put `Bun.write`, `Bun.file`, or `fs.*` calls anywhere else.
- The rest of the codebase only knows about a `storage_path` string. Swapping to R2/S3 should be a one-file change.
- Draft cleanup deletes the PDF file alongside the row — use `deleteDraftAndPdf` in `routes/bills.ts`, don't reach into storage directly.

## Tests

- Tests live **next to the source files they cover** — `foo.ts` and `foo.test.ts` in the same directory. Bun's test runner discovers `*.test.ts` recursively. Four test files today:
  - `src/lib/journal.test.ts` (pure validators)
  - `src/lib/suppliers.test.ts` (mostly pure + DB integration)
  - `src/routes/bills.test.ts` (HTTP via `app.request()`)
  - `src/routes/suppliers.test.ts`
- The `tests/` directory holds shared infra only: `setup.ts` (preloaded via `bunfig.toml`'s `[test].preload`) and `fixtures/proposal.ts` (canned Claude responses for stubbing). New tests go next to source, not into `tests/`.
- Setup runs via `bunfig.toml`'s `[test].preload = ["./tests/setup.ts"]` — sets safe env defaults before any `src/` import triggers env validation.
- Route tests share the singleton `queryClient` from `src/db/client.ts`. Each file ends only its own local `sql` in `afterAll` — never end `queryClient` from a test file or you'll break sibling files.
- `beforeEach` truncates transactional tables (`postings, journal_entries, bills, bill_drafts, suppliers`) but **keeps the seeded `accounts`** so the BAS chart is always available.
- No frontend tests yet. Don't add them without confirming first — `bun test` is backend-only by deliberate scope.

## Sample PDFs

Sample PDFs live in `sample_invoices/` — `simple_invoice.pdf` is the one shipped with the take-home. The directory is mounted into the backend container at `/app/sample_invoices` for tests; locally tests resolve `../../sample_invoices/`. Drop additional test PDFs into the same folder.
