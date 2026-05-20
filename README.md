# Accountio

Invoice-to-journal-entry web app. Upload a Swedish supplier invoice (PDF), Claude generates a balanced double-entry journal entry against the BAS chart of accounts, and an accountant reviews the proposal side-by-side with the PDF and approves or rejects it.

Built as a take-home assignment — see [interview.md](interview.md) for the original spec.

![accountio](https://img.shields.io/badge/built%20with-Bun%20%C2%B7%20Hono%20%C2%B7%20Next%2016-black)

## What it does

1. Accountant uploads a supplier invoice PDF.
2. Backend stores the PDF and sends it natively (as a `document` content block) to **Claude Sonnet 4.6** alongside the BAS chart and the Swedish supplier-invoice booking rules.
3. Claude returns a structured journal entry (via tool use) — typically debit expense at net + debit `2640 Ingående moms` at VAT + credit `2440 Leverantörsskulder` at gross.
4. Backend validates the proposal: balance to the cent, every account number must exist in the chart.
5. Bill + journal entry + postings are persisted in Postgres in a single transaction.
6. Frontend renders the PDF and the proposal side-by-side; the accountant approves or rejects.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun (runs TypeScript natively, no transpile step) |
| Backend | Hono + Drizzle + Postgres 16 |
| LLM | `@anthropic-ai/sdk` — Claude Sonnet 4.6 with native PDF document blocks and tool-use |
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind 4 + minimal shadcn |
| Tests | `bun test` (built-in) — 35 tests, no Jest/Vitest |
| Lint / format | Biome (single binary, no ESLint/Prettier) |
| Pre-commit | Husky + lint-staged — blocks commits with `any`, type errors, or formatting drift |

## Prerequisites

- Docker Desktop (for the postgres container and optional full stack)
- [Bun](https://bun.sh) 1.3+ (for running the apps natively if you prefer)

## Quickstart — Docker (everything in containers)

```bash
# 1. one-time env setup
cp .env.example .env
# Paste the Anthropic key from anthropic_api_key.txt into the ANTHROPIC_API_KEY line.
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 2. start the stack
docker compose up --build
```

Open **http://localhost:3000**. Click **Upload invoice**, pick `simple_invoice.pdf` (in the repo root), wait ~10 s, review the proposal, click **Approve**.

## Quickstart — Local (apps native, just postgres in docker)

```bash
# 1. same env setup as above

# 2. boot just the database
docker compose up -d postgres

# 3. backend in one terminal
cd backend
bun install
bun run db:migrate
bun run dev          # listens on :3001

# 4. frontend in another terminal
cd frontend
bun install
bun run dev          # listens on :3000
```

Open **http://localhost:3000**. Same flow.

The `.env.example` files use `localhost` defaults so both modes work out of the box without further config.

## Architecture

```
 ┌──────────────┐                ┌──────────────────┐               ┌──────────────┐
 │  Browser     │  same-origin   │  Next.js 16      │  HTTP         │  Hono API    │
 │  (React 19)  │ ─────────────▶ │  rewrites /api/* │ ────────────▶ │  (Bun)       │
 └──────────────┘                └──────────────────┘               └────┬─────────┘
                                                                         │
                                          ┌──────────────────────────────┼──────────────────────┐
                                          ▼                              ▼                      ▼
                                   ┌────────────┐               ┌──────────────────┐   ┌────────────────────┐
                                   │ Postgres   │               │  Anthropic API   │   │  Uploads volume    │
                                   │ 16 (drizzle)│              │  Claude Sonnet 4.6│  │  (PDFs, mounted)   │
                                   └────────────┘               └──────────────────┘   └────────────────────┘
```

The browser only ever talks to the Next.js origin. `next.config.ts` `rewrites` proxy `/api/*` to the backend over the docker network — no CORS, no exposed internal URLs in client code.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/bills` | multipart upload → store PDF → call Claude → validate → insert → return detail JSON |
| `GET`  | `/api/bills` | list newest first, with journal-entry status |
| `GET`  | `/api/bills/:id` | full detail (bill + journal entry + postings) |
| `GET`  | `/api/bills/:id/pdf` | streams the stored PDF inline |
| `POST` | `/api/bills/:id/approve` | flip status to `approved` (idempotent) |
| `POST` | `/api/bills/:id/reject`  | flip status to `rejected` (idempotent) |
| `GET`  | `/api/accounts` | returns the 20-row BAS chart |
| `GET`  | `/health` | liveness probe |

## Data model

Three tables (full schema in [`backend/src/db/schema.ts`](backend/src/db/schema.ts)):

- **`bills`** — PDF metadata + parsed header (supplier, dates, net/VAT/gross).
- **`journal_entries`** — 1:1 with bill. `status` enum (`pending`/`approved`/`rejected`), Claude's `llm_reasoning`, and `validation_errors` if any. `decided_at` populated on approve/reject.
- **`postings`** — N postings per entry. Each has `account_number` + `account_name`, `debit` and `credit` as `numeric(14,2)`, plus `description` and `sort_order`.

Cascade deletes from bill → entry → postings.

## Accounting model

For every supplier invoice with Swedish VAT (moms):

- **Debit** one or more expense accounts at the **net** amount, picked by Claude from the BAS chart (e.g. `5010 Lokalhyra`, `6530 IT-tjänster`).
- **Debit** `2640 Ingående moms` at the VAT amount.
- **Credit** `2440 Leverantörsskulder` at the **gross** total.

Sum of all debits must equal sum of all credits to the cent. Validators in [`backend/src/lib/journal.ts`](backend/src/lib/journal.ts) enforce this with integer-cent arithmetic (no float drift) before anything is persisted. If validation fails the entry is still saved with `status='pending'` and `validation_errors` populated so the UI can surface the issue.

## LLM integration

The whole prompt lives in [`backend/src/lib/anthropic.ts`](backend/src/lib/anthropic.ts). One call per upload:

- **System prompt** embeds the BAS chart inline and dictates the supplier-invoice booking pattern (debit expense net + debit `2640` VAT + credit `2440` gross), balance constraint, and ISO date format.
- **User message** is a `document` content block (the PDF, base64-encoded) plus a one-line instruction to call the `record_journal_entry` tool.
- **Tool use** with `tool_choice: { type: 'tool', name: 'record_journal_entry' }` forces structured output.
- The response is parsed through zod, then handed to the validators.

The route accepts the generator as a function dependency (`JournalGenerator`) so tests inject a stub via `createApp({ generateJournal: ... })` — no module-level mocking, no real API calls in tests.

## Tests

```bash
docker compose up -d postgres
cd backend
bun test
```

35 tests, ~450 ms:

- **`journal.test.ts`** (21 tests, pure) — toCents parsing, format round-trips, balance assertion, float-drift trap, negative debit rejection, BAS-chart membership, multi-issue aggregation.
- **`routes.bills.test.ts`** (14 tests, HTTP-level against real Postgres) — upload happy path, validation-error paths (unbalanced + unknown account), 400 / 415 / 502 error paths, list, detail, PDF streaming, approve idempotency, reject, 404s.

The Anthropic client is stubbed via the DI seam — tests don't touch the real API.

## Repository layout

```
backend/
├── src/
│   ├── index.ts                 # Hono app + createApp factory
│   ├── env.ts                   # zod-validated env loading
│   ├── db/
│   │   ├── schema.ts            # bills, journal_entries, postings
│   │   ├── client.ts            # drizzle(postgres.js) instance
│   │   ├── migrate.ts           # standalone migration runner
│   │   └── migrations/          # drizzle-kit generated
│   ├── lib/
│   │   ├── accounts.ts          # BAS chart constant
│   │   ├── journal.ts           # balance + chart validators (pure)
│   │   ├── anthropic.ts         # createAnthropicJournalGenerator + DI seam
│   │   └── storage.ts           # PDF filesystem storage
│   └── routes/
│       ├── accounts.ts
│       └── bills.ts             # all bill CRUD + approve/reject
├── tests/
│   ├── journal.test.ts          # pure validator tests
│   ├── routes.bills.test.ts     # HTTP route tests
│   ├── fixtures/proposal.ts     # canned Claude proposals for stubbing
│   └── setup.ts                 # preloaded via bunfig.toml
├── bunfig.toml
├── drizzle.config.ts
├── tsconfig.json
└── Dockerfile

frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # bills list + upload (server component)
│   ├── bills/[id]/page.tsx      # detail (server component)
│   └── globals.css              # Tailwind 4 @theme tokens
├── components/
│   ├── upload-button.tsx        # 'use client' — file picker + POST
│   ├── status-badge.tsx
│   ├── journal-entry-table.tsx
│   ├── approve-reject-actions.tsx  # 'use client' — POST + router.refresh()
│   └── ui/button.tsx            # minimal shadcn-style primitive
├── lib/
│   ├── api.ts                   # typed fetch helpers
│   ├── format.ts                # sv-SE money/date formatters
│   ├── types.ts                 # API response shapes
│   └── cn.ts                    # clsx + tailwind-merge
├── next.config.ts               # rewrites /api/* → BACKEND_URL
├── postcss.config.mjs           # @tailwindcss/postcss
├── tsconfig.json
└── Dockerfile

docker-compose.yml
biome.json                       # one config for both apps
.husky/pre-commit                # lint-staged + typecheck
scripts/typecheck.ts             # tolerant of missing apps
package.json                     # root: biome + husky + lint-staged
CLAUDE.md                        # engineering guardrails
README.md
```

## Scripts

From the repo root:

```bash
bun run lint           # biome check
bun run lint:fix       # biome check --write (auto-format)
bun run typecheck      # tsc --noEmit in both apps
bun run test           # bun test in backend (needs postgres up)
```

From `backend/`:

```bash
bun run dev            # Hono with hot reload
bun run db:generate    # generate a new migration from schema changes
bun run db:migrate     # apply pending migrations
bun run db:studio      # drizzle-kit studio (DB browser)
bun test               # journal + route tests
```

From `frontend/`:

```bash
bun run dev            # next dev
bun run build          # next build
```

## Pre-commit hook

Every commit goes through:

1. **`lint-staged`** — Biome auto-fixes formatting on staged files. Errors (including `noExplicitAny`) block the commit.
2. **`bun run typecheck`** — `tsc --noEmit` on both apps. Implicit `any` and type errors block the commit.

Tests are not in pre-commit (too slow); they run via CI or manually. Adding them via a `.husky/pre-push` hook is trivial.

## Engineering guardrails

See [CLAUDE.md](CLAUDE.md) — the rules for any human or AI agent contributing to this repo. Highlights:

- **No `any`**, explicit or implicit — both Biome and TypeScript strict block it.
- **Conventional commits**, **merge commits** never rebase.
- **Two run modes** (docker and local) must both stay working; nothing is hardcoded for an environment.
- **No mocked Anthropic in dev/prod** — only via the DI seam in tests.
- **Bun only** as the package manager. Lockfile is `bun.lock`.

## Known limitations / what I'd ship next

- Single LLM call on the upload request blocks for ~5-15 s. A real product would queue this and stream results, but for the interview scope synchronous is fine.
- No authentication — anyone hitting `localhost` can upload and approve.
- No multi-tenant data isolation.
- Currency is whatever Claude reports from the PDF; no FX conversion if the bill is in EUR/USD.
- No audit log of approve/reject decisions beyond the `decided_at` timestamp.
- The reasoning text and validation errors are surfaced but the UI doesn't yet block approval of entries that failed validation — the accountant can override.
