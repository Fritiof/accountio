# Extending Accountio

Recipes for adding new features without breaking the patterns already in place. Read [CLAUDE.md](CLAUDE.md) first for the guardrails (no `any`, two-stage upload, supplier matching priority, etc.) — those are inviolable. This file is the "how do I do X?" companion.

Each section is task-shaped: do these steps in this order and the pre-commit hook + tests will catch the obvious slips.

## Adding an API endpoint

Existing endpoints live in `backend/src/routes/<name>.ts`. The pattern is:

1. **Create or extend a route factory.** Each file exports a `createXxxRoute(db [, deps])` function that returns a `Hono`. Don't put a free-standing `const route = new Hono()` at module scope — the factory pattern is what lets tests inject a different db / Anthropic stub.

2. **Mount it in `src/index.ts`** inside `createApp()`. The DB instance is `deps?.db ?? db` and any other dependencies (like `generateJournal`) come from the same `deps?.xxx ?? defaultFactory()` pattern. Look at [`src/index.ts`](backend/src/index.ts) for the canonical shape.

3. **Write the handler with `HTTPException` for errors.** `throw new HTTPException(404, { message: '...' })` from `hono/http-exception`. Don't return `c.json({ error: ... }, 404)` — the exception path is consistent across the codebase and easier to test.

4. **Add tests next to the source.** Create `src/routes/<name>.test.ts` (co-located, not in `tests/`). Use `app.request('/api/...', { method, headers, body })` and assert on `res.status` + `await res.json()`. Test setup is auto-loaded via `bunfig.toml` so just import from `bun:test`.

5. **If the handler reads or writes the DB inside a transaction**, the lib functions it calls (like `loadChart`, `findSupplierMatch`) need to accept `DBOrTx`, not `DB`. See "The DBOrTx pattern" below.

## Adding a database column or table

Drizzle workflow with one gotcha:

1. **Edit `backend/src/db/schema.ts`.** Add the column or table. Export inferred types (`type X = typeof xxx.$inferSelect`).

2. **Run `bun run db:generate`.** This diffs the schema against the latest snapshot (in `src/db/migrations/meta/`) and writes a new SQL file.

3. **If the migration needs seed data** (like the BAS chart in 0001), open the generated SQL and append `INSERT … ON CONFLICT DO NOTHING` statements after the `CREATE TABLE`. Drizzle-kit doesn't generate inserts; you do that by hand.

4. **Apply locally.** `bun run db:migrate`. Or `docker compose exec backend bun run db:migrate` if the backend container is up.

5. **NOT NULL on an existing table with rows will fail.** If your migration adds `xxx NOT NULL REFERENCES ...` to a table that already has data:
   - Dev: `docker compose down -v` to nuke the volume and re-apply from scratch.
   - Real production: add it nullable, backfill in a separate migration, then tighten in a third migration.

6. **Update the frontend type if the column flows to the API.** `frontend/lib/types.ts` mirrors the backend response shapes — keep them in sync by hand. No codegen yet.

7. **Update test fixtures and any test that asserts on the row.** The canonical fixture is [`tests/fixtures/proposal.ts`](backend/tests/fixtures/proposal.ts) for LLM proposal shapes.

## Extending the LLM proposal shape

This is the most multi-step change because it touches six files. The order matters (validation gates each step):

1. **Update `proposalSchema` (zod) in [`backend/src/lib/anthropic.ts`](backend/src/lib/anthropic.ts).** Add the new field with the right zod type. If it should be normalized (e.g. number-or-string → string), use `.transform()`.

2. **Update `TOOL_INPUT_SCHEMA` (JSON Schema) in the same file.** Add the field to `required` and `properties`. Be deliberately *more permissive* than zod where you expect Claude to drift (e.g. amounts accept `['string', 'number']`).

3. **Update the system prompt** in `buildSystemPrompt()` to tell Claude how to populate the new field. If the field is sometimes-null, say so explicitly — Claude follows instructions better than schemas.

4. **Update the test fixture** at [`tests/fixtures/proposal.ts`](backend/tests/fixtures/proposal.ts). All three proposals (`balancedProposal`, `unbalancedProposal`, `unknownAccountProposal`) need the new field or zod's `safeParse` will fail in route tests.

5. **If the field should be persisted**, add the column (see "Adding a database column" above) and copy it from `proposal` to the `bills.values(...)` insert in the confirm route handler.

6. **Surface it on the frontend.** Update `frontend/lib/types.ts` and the relevant page (`/bills/[id]` for confirmed bills, `/bills/confirm/[draftId]` for the pre-confirm preview).

Why two schemas at all? See the docstring at the top of `anthropic.ts` — short version: JSON Schema is a *hint* to Claude; zod is the actual gatekeeper. We need both.

## Adding a frontend page

Next.js 16 App Router conventions:

1. **Create `frontend/app/<path>/page.tsx`.** Default export is `async function` for server components. For dynamic segments use `[id]/page.tsx` and accept `params: Promise<{ id: string }>` (Next 16 makes params async).

2. **Fetch data from the API in the server component.** Use `lib/api.ts` helpers like `getBillDetail(id)` or `listBills()`. They handle the `BACKEND_URL` resolution (server-side direct, browser-side via Next rewrites).

3. **Use `notFound()` from `next/navigation` for missing resources** — gives the standard Next 404 page. The lib/api helpers return `null` on 404; convert to `notFound()` at the page level.

4. **Add `'use client'` only for interactive bits.** State, effects, browser APIs, `useRouter()`. Keep client components small and pass server-fetched data in as props. Look at `components/upload-button.tsx` and `components/approve-reject-actions.tsx` for the canonical shape.

5. **After mutations, call `router.refresh()`**. Don't try to update local state and the server in parallel — `refresh()` invalidates the server component cache so the next render sees fresh data.

6. **Use `@theme` tokens from `app/globals.css`** via Tailwind 4's parenthesized color syntax: `text-(--color-foreground)`, `bg-(--color-muted)`. Don't add raw hex colors.

7. **shadcn-style primitives go in `components/ui/`** — currently just `button.tsx`. Match its variant/size cva pattern when adding new ones (Card, Dialog, etc.).

## Adding a test

Tests live next to the source (`foo.ts` and `foo.test.ts` in the same directory). Bun's test runner discovers them recursively.

1. **Pure tests** (no DB, no HTTP) — fastest. See `src/lib/journal.test.ts`. Just import the function and assert. No setup needed.

2. **DB-backed integration tests** — need Postgres running (`docker compose up -d postgres`). Pattern from `src/lib/suppliers.test.ts`:
   - Import `db` from `../db/client.ts`
   - Open a local `sql = postgres(env.DATABASE_URL, { max: 1 })` for `TRUNCATE`
   - `beforeAll`: `await migrate(db, { migrationsFolder: './src/db/migrations' })`
   - `beforeEach`: truncate the transactional tables, NOT `accounts` (the BAS chart seed must stay)
   - `afterAll`: `await sql.end()` — **never** end the shared `queryClient` from a test file (breaks sibling files)

3. **HTTP route tests** — see `src/routes/bills.test.ts`. Use `createApp({ db, generateJournal: stub() })` to inject a stubbed LLM generator. Call `app.request('/api/...', { ... })`. The Anthropic stub is a one-liner: `async () => fixtureProposal`.

4. **Don't mock at the module level.** All injection goes through the `createApp` and route factory `deps` parameters.

## Keeping frontend types in sync with the API

There's no codegen. The flow when you change an API response shape:

1. Update the backend (route handler, DB column, etc.).
2. Run a real upload locally and `curl` the endpoint. Inspect the JSON shape.
3. Update `frontend/lib/types.ts` to match exactly. Pay attention to nullability — `?` (optional) is different from `| null` (always present, can be null). Drizzle returns `null` for nullable columns; use `| null`.
4. Touch the components that render the new field. TypeScript will catch most cases.
5. If you're feeling fancy, look into `drizzle-zod` or generating an OpenAPI spec from Hono and feeding it to a client generator. Out of scope today.

## The DBOrTx pattern

Lib functions like `loadChart(db)` and `findSupplierMatch(db, ...)` accept a union type `DBOrTx` (defined in `src/db/client.ts`) so they work both standalone AND inside a transaction:

```ts
// Standalone (most callers):
const chart = await loadChart(db);

// Inside a transaction (the confirm route):
await db.transaction(async (tx) => {
  const chart = await loadChart(tx);  // same function, tx instead of db
});
```

If you're writing a new lib function that just runs SELECTs or simple INSERT/UPDATE/DELETE, type the db parameter as `DBOrTx`. Reserve plain `DB` for functions that need to *start* their own transaction (`db.transaction(...)`) — that method exists on `DB` but not on a transaction handle.

## The factory / DI seam pattern

The whole backend is built around dependency injection through factories:

- `createApp({ db, generateJournal })` — top-level. Tests pass stubs; production passes real implementations.
- `createBillsRoute({ db, generateJournal })`, `createAccountsRoute(db)`, `createSuppliersRoute(db)` — per-route factories.
- `createAnthropicJournalGenerator({ apiKey, model })` — wraps the SDK. Returns a `JournalGenerator` function.

When you add a new external dependency (database, API client, queue, etc.):

1. Define an interface or a function type capturing what the route actually needs (e.g. `JournalGenerator = (input) => Promise<JournalProposal>`).
2. Write a real factory that returns the interface (`createAnthropicJournalGenerator`).
3. Make the route factory accept it as a dep, with a default that calls the real factory.
4. In tests, pass a stub directly — no `jest.mock`, no module-level monkeypatching.

This is what makes the tests fast (no real API calls), the routes portable (could swap Anthropic for OpenAI by writing a different factory), and the seams obvious.

## The storage seam

All disk I/O for PDFs lives in [`backend/src/lib/storage.ts`](backend/src/lib/storage.ts). It's intentionally tiny (~30 lines): `storePdf`, `readStoredFile`, `resolveStoragePath`, plus the implicit "files live under `UPLOAD_DIR`."

If you need to handle PDFs anywhere else, **import from `storage.ts`**, don't call `Bun.write` / `Bun.file` / `fs.*` directly. The single seam is what makes swapping local disk for S3/R2 a one-file change later.

Draft cleanup (when a PDF should be deleted alongside its `bill_drafts` row) goes through `deleteDraftAndPdf` in `routes/bills.ts` — not direct `unlink` calls scattered around.

## Commit conventions

Conventional commits with optional scope:

- `feat(backend): ...` — new feature in the backend
- `feat(frontend): ...` — new feature in the frontend
- `feat(tooling): ...` — biome/husky/scripts changes
- `fix(backend|frontend): ...` — bug fixes
- `refactor(...): ...` — restructure without behaviour change
- `test(...): ...` — new tests only (no production code change)
- `chore: ...` — version bumps, gitignore, docker config
- `docs: ...` — README, CLAUDE.md, code comments

Pre-commit hook will reformat staged files and run typecheck. Tests aren't in pre-commit — run `bun test` manually before pushing if you've touched runtime code.

## Common gotchas

- **`docker compose down -v`** is the dev reset when a migration that adds NOT NULL fails on stale data.
- **`bun test` runs from `backend/`**, not from the repo root. The `bunfig.toml` preload is relative to `backend/`.
- **`UPLOAD_DIR` differs between docker and local.** `/app/uploads` vs `./uploads`. Don't hardcode either.
- **Anthropic key is empty in some shell envs** (e.g. macOS GUI apps don't get `.env` from your shell). Use `||=` in test setup, not `??=`, so empty-string env vars get overridden.
- **The `tests/` directory only holds shared infra** (setup.ts, fixtures). New tests go next to source.
- **Frontend `next-env.d.ts`** is auto-regenerated by Next.js with double-quoted imports; Biome ignores it via `biome.json` `files.ignore`. Don't try to "fix" it.
- **Drizzle-kit migrations are committed.** Never delete one; write a new migration to revert.
- **Validators don't reject uploads.** A failed `assertBalanced` or `assertAccountsValid` persists the entry with `validation_errors` set and `status='pending'` — by design. Don't move validation into a pre-insert gate without checking first.
