# Accountio

Invoice-to-journal-entry web app. Upload a Swedish supplier invoice (PDF), Claude generates a balanced double-entry journal entry against the BAS chart of accounts, and an accountant reviews the proposal side-by-side with the PDF and approves or rejects it.

Built as a take-home assignment — see [interview.md](interview.md) for the original spec.

![accountio](https://img.shields.io/badge/built%20with-Bun%20%C2%B7%20Hono%20%C2%B7%20Next%2016-black)

## What it does

1. Accountant uploads a supplier invoice PDF.
2. Backend stores the PDF and sends it natively (as a `document` content block) to **Claude Sonnet 4.6** alongside the BAS chart and the Swedish supplier-invoice booking rules.
3. Claude returns a structured journal entry (via tool use) — typically debit expense at net + debit `2640 Ingående moms` at VAT + credit `2440 Leverantörsskulder` at gross — plus the supplier's name, org.nr, and VAT number.
4. Backend looks up the supplier by org.nr → VAT number → name and surfaces the best match (or top-N candidates, or none).
5. **Confirmation page**: the user picks the matched supplier or creates a new one from the PDF-extracted fields. Nothing has touched the `bills` table yet — only a short-lived draft row.
6. On confirm, the backend validates the proposal (balance to the cent, every account in the chart), then persists supplier link + bill + journal entry + postings in a single transaction.
7. Frontend renders the PDF and the proposal side-by-side; the accountant approves or rejects.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun (runs TypeScript natively, no transpile step) |
| Backend | Hono + Drizzle + Postgres 18 |
| LLM | `@anthropic-ai/sdk` — Claude Sonnet 4.6 with native PDF document blocks and tool-use |
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind 4 + minimal shadcn |
| Tests | `bun test` (built-in) — 61 tests across 4 files, no Jest/Vitest |
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

Open **http://localhost:3000**. Click **Upload invoice**, pick `sample_invoices/simple_invoice.pdf`, wait ~10 s while Claude extracts the journal entry, then on the confirmation screen pick **Confirm and book** to create the supplier (first time) or use the matched one (subsequent uploads of invoices from the same supplier). Review the proposal on the next page and click **Approve**.

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
                                   │ 18 (drizzle)│              │  Claude Sonnet 4.6│  │  (PDFs, mounted)   │
                                   └────────────┘               └──────────────────┘   └────────────────────┘
```

The browser only ever talks to the Next.js origin. `next.config.ts` `rewrites` proxy `/api/*` to the backend over the docker network — no CORS, no exposed internal URLs in client code.

Upload happens in two stages so each invoice is explicitly tied to a supplier:

```
   Browser                       Backend                      Postgres
      │                             │                            │
      │ POST /api/bills/prepare     │                            │
      │ (PDF)                       │                            │
      │ ───────────────────────────▶│                            │
      │                             │ call Claude                │
      │                             │ ───── ANTHROPIC ─────▶     │
      │                             │ ◀──── proposal ────        │
      │                             │ findSupplierMatch          │
      │                             │ ─────────────────────────▶ │
      │                             │ insert bill_draft          │
      │                             │ ─────────────────────────▶ │
      │ ◀───── { draftId, proposal, match } ─────────────────────│
      │                             │                            │
      │ render confirm page         │                            │
      │ (user picks supplier)       │                            │
      │                             │                            │
      │ POST /api/bills/confirm     │                            │
      │ (draftId, supplier choice)  │                            │
      │ ───────────────────────────▶│                            │
      │                             │ resolve supplier (existing │
      │                             │   id or create new)        │
      │                             │ validate proposal          │
      │                             │ insert bill + entry +      │
      │                             │   postings (transaction)   │
      │                             │ delete draft               │
      │                             │ ─────────────────────────▶ │
      │ ◀───── { bill, journalEntry, postings } ─────────────────│
      │ navigate to /bills/:id      │                            │
```

## API

Upload is a two-stage flow so each bill is explicitly tied to a supplier:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/bills/prepare` | multipart upload → store PDF → call Claude → look up supplier match → return `{ draftId, proposal, match }`. Nothing in `bills` yet. |
| `POST` | `/api/bills/confirm` | body `{ draftId, supplier }` where supplier is `{ kind: 'existing', id }` or `{ kind: 'create', name, orgNumber, vatNumber }`. Resolves the supplier, creates bill + journal entry + postings in one transaction, deletes the draft. |
| `GET`  | `/api/bills/drafts/:id` | JSON shape for the confirm page (`{ proposal, match }` — match is re-computed on each fetch). 410 if expired. |
| `GET`  | `/api/bills/drafts/:id/pdf` | streams the draft PDF for the confirm-page preview. |
| `DELETE` | `/api/bills/drafts/:id` | abandons a draft (deletes the PDF + the row). |

Once a bill is confirmed it shows up via the existing read endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/bills` | list newest first, with journal-entry status |
| `GET`  | `/api/bills/:id` | full detail (bill + journal entry + postings) |
| `GET`  | `/api/bills/:id/pdf` | streams the stored PDF inline |
| `POST` | `/api/bills/:id/approve` | flip status to `approved` (idempotent) |
| `POST` | `/api/bills/:id/reject`  | flip status to `rejected` (idempotent) |
| `GET`  | `/api/suppliers` | list suppliers, optional `?q=<substring>` search |
| `GET`  | `/api/suppliers/:id` | single supplier + count of linked bills |
| `GET`  | `/api/accounts` | returns the 20-row BAS chart |
| `GET`  | `/health` | liveness probe |

## Data model

Six tables (full schema in [`backend/src/db/schema.ts`](backend/src/db/schema.ts)):

- **`accounts`** — BAS chart of accounts (`number` PK, `name`). Seeded by migration 0001 with the 20 rows from the interview spec.
- **`suppliers`** — `name`, `org_number`, `vat_number`, `notes`. Partial unique indexes on `org_number` and `vat_number` so two records can't share the same identifier.
- **`bills`** — PDF metadata + invoice header snapshots (supplier name/org/VAT as captured by Claude) + a NOT NULL `supplier_id` FK to the resolved supplier.
- **`bill_drafts`** — short-lived rows between prepare and confirm. Holds the PDF metadata + the proposal as `jsonb` + the best-match result. 1-hour TTL; swept on each `/prepare` call.
- **`journal_entries`** — 1:1 with bill. `status` enum (`pending`/`approved`/`rejected`), Claude's `llm_reasoning`, and `validation_errors` if any. `decided_at` populated on approve/reject.
- **`postings`** — N postings per entry. Each has `account_number` + `account_name`, `debit` and `credit` as `numeric(14,2)`, plus `description` and `sort_order`.

Cascade deletes from bill → entry → postings.

## Supplier matching

When you upload an invoice, `/prepare` runs a matching lookup against the existing suppliers table. The priority is:

1. **Exact org_number** (Swedish 10-digit `556677-8899`) — highest specificity.
2. **Exact vat_number** (country-prefixed `SE556677889901`).
3. **Exact name** (case-insensitive, whitespace-collapsed). If multiple suppliers share the exact name, all are returned as candidates for the user to disambiguate.
4. **Partial-name candidates** — top 5 ILIKE matches if no exact identifier hit.
5. **No match** — UI offers to create a new supplier pre-filled with the PDF's name/org/VAT.

The matching is **never silent**: even on an exact match, the confirm page shows what was matched and offers a "Create new instead" escape hatch. The user always sees and approves the supplier link before any row is persisted.

Implementation: [`backend/src/lib/suppliers.ts`](backend/src/lib/suppliers.ts) (pure module with 13 tests).

## File storage

Uploaded PDFs are written to a local filesystem directory pointed to by `UPLOAD_DIR` — not stored as bytes in Postgres. Each upload gets a fresh UUID filename (e.g. `f8723a0a-81eb-4c43-89c0-9cd68e0ec515.pdf`); the DB row stores only the relative path in `bills.storage_path`.

- **Docker**: `UPLOAD_DIR=/app/uploads` inside the backend container, backed by the named docker volume `uploads`. Survives `docker compose down`, gone on `down -v`.
- **Local**: `UPLOAD_DIR=./uploads` relative to `backend/`. A plain directory.

The only code that knows about the disk is [`backend/src/lib/storage.ts`](backend/src/lib/storage.ts) — about 30 lines. It exports `storePdf({ bytes, originalName })` and `readStoredFile(storagePath)`. The bills route writes via the first and the PDF stream route reads via the second.

### What scaling to multiple API instances would need

The current shape is single-node by design — a second backend replica wouldn't see PDFs uploaded against the first. To scale horizontally:

1. **Swap `storage.ts` for object storage** (S3, R2, GCS). `storePdf` does `PutObject`; `readStoredFile` either streams via `GetObject` or returns a pre-signed URL. `bills.storage_path` becomes the object key. Everything else (routes, schema, frontend) stays unchanged — the seam is tight on purpose.
2. **Optional: direct browser → object store uploads** via pre-signed PUT URLs. Removes the 2 MB round-trip through the backend; the backend only sees the resulting object key + metadata. Better latency at the cost of a small flow change in `UploadButton`.
3. **Database is already horizontally-safe** — Postgres connection pooling via postgres.js is fine for many backend replicas, and the upload path is wrapped in a transaction.
4. **The LLM call is the long pole** — at ~5–15 s/upload, you'd want to push generation to a queue (BullMQ on Redis, or pg-boss for a one-service-fewer option) and return `202 Accepted` with the bill id; the frontend polls or subscribes to a server-sent event for completion. Same code surface, just async around the boundary.

Order of operations if scaling actually came up: queue the generator first (biggest win, removes a 15-second-blocked request), then move PDFs to object storage (unblocks horizontal scale), then split read replicas if Postgres becomes the bottleneck.

## Accounting model

For every supplier invoice with Swedish VAT (moms):

- **Debit** one or more expense accounts at the **net** amount, picked by Claude from the BAS chart (e.g. `5010 Lokalhyra`, `6530 IT-tjänster`).
- **Debit** `2640 Ingående moms` at the VAT amount.
- **Credit** `2440 Leverantörsskulder` at the **gross** total.

Sum of all debits must equal sum of all credits to the cent. Validators in [`backend/src/lib/journal.ts`](backend/src/lib/journal.ts) enforce this with integer-cent arithmetic (no float drift) before anything is persisted. If validation fails the entry is still saved with `status='pending'` and `validation_errors` populated so the UI can surface the issue.

### What this VAT model doesn't handle

The current setup assumes a Swedish supplier charging standard Swedish VAT. It will likely book the following cases incorrectly:

- **Reverse charge (omvänd skattskyldighet)** — construction services and most EU B2B services. Buyer self-accounts the VAT, which in BAS typically uses `2614` (utgående moms) + `2645` (beräknad ingående moms). Neither account is in the 20-row chart we ship, so even if Claude detects the case it can't book it.
- **Intra-community acquisitions** — goods purchased from a VAT-registered supplier in another EU country. Same self-accounting pattern (`2615` + `2645`), same missing-accounts problem.
- **Non-EU services** — supplier outside the EU charges no VAT on the invoice; buyer applies the reverse-charge rules above.
- **Goods imported from outside the EU** — separate import-VAT scheme via Tullverket, distinct accounts again.
- **VAT-exempt purchases** — financial, healthcare, education — should book net only with no input VAT, which the current prompt may still try to split.

Closing the gap requires both **chart additions** (`2614`, `2615`, `2645`, possibly `2647`) and **prompt updates** (detect supplier country via VAT number prefix, recognize "omvänd skattskyldighet" / "reverse charge" / "0% VAT EU service" text, route to the right account pair). The validators don't need to change — debits and credits still balance, they're just on different accounts.

Storing the supplier's VAT number on the `bills` row would help; today we parse only what Claude returns into the existing fields.

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

63 tests, ~900 ms. **Tests live next to the source they cover** (`foo.ts` and `foo.test.ts` in the same directory) — easier to find, harder to forget when you change the source. Four files today:

- **`src/lib/journal.test.ts`** (22 tests, pure) — toCents parsing, format round-trips, balance assertion, float-drift trap, negative debit rejection (incl. the "negatives cancel out" regression), BAS-chart membership, multi-issue aggregation.
- **`src/lib/suppliers.test.ts`** (13 tests, mostly pure) — normalize helpers, org wins over VAT, VAT falls back to name, candidates path for multiple exact-name matches and for partial-name, empty input → none.
- **`src/routes/bills.test.ts`** (23 tests, HTTP-level against real Postgres) — prepare happy path with match=none vs match=exact-by-org, 400/415/502, confirm with existing supplier vs create-new (and the concurrent-confirm race regression), validation-error paths, 404 on unknown draft, draft delete + draft PDF stream, list/detail/approve/reject for confirmed bills.
- **`src/routes/suppliers.test.ts`** (5 tests) — list empty, list all, ILIKE search, detail with bill count, 404.

The `tests/` directory holds only shared infra: `setup.ts` (preloaded via `bunfig.toml`) and `fixtures/proposal.ts` (canned Claude responses).

The Anthropic client is stubbed via the DI seam — tests don't touch the real API.

## Repository layout

```
backend/
├── src/
│   ├── index.ts                 # Hono app + createApp factory
│   ├── env.ts                   # zod-validated env loading
│   ├── db/
│   │   ├── schema.ts            # accounts, suppliers, bills, bill_drafts,
│   │   │                        # journal_entries, postings
│   │   ├── client.ts            # drizzle(postgres.js) instance
│   │   ├── migrate.ts           # standalone migration runner
│   │   └── migrations/          # drizzle-kit generated (+ chart seed)
│   ├── lib/
│   │   ├── accounts.ts          # BAS chart constant + loadChart(db)
│   │   ├── anthropic.ts         # createAnthropicJournalGenerator + DI seam
│   │   ├── journal.ts           # balance + chart validators (pure)
│   │   ├── journal.test.ts      #   ← co-located test
│   │   ├── storage.ts           # PDF filesystem storage
│   │   ├── suppliers.ts         # normalize helpers + findSupplierMatch
│   │   └── suppliers.test.ts    #   ← co-located test
│   └── routes/
│       ├── accounts.ts
│       ├── bills.ts             # prepare, confirm, draft mgmt, CRUD, approve/reject
│       ├── bills.test.ts        #   ← co-located HTTP test
│       ├── suppliers.ts         # list + detail (read-only)
│       └── suppliers.test.ts    #   ← co-located endpoint test
├── tests/                       # shared test infra only
│   ├── setup.ts                 # preloaded via bunfig.toml (env defaults)
│   └── fixtures/proposal.ts     # canned Claude proposals for stubbing
├── bunfig.toml
├── drizzle.config.ts
├── tsconfig.json
└── Dockerfile

frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                                  # bills list + upload (server)
│   ├── bills/[id]/page.tsx                       # confirmed-bill detail
│   ├── bills/confirm/[draftId]/page.tsx          # supplier confirmation
│   ├── suppliers/[id]/page.tsx                   # supplier detail
│   └── globals.css                               # Tailwind 4 @theme tokens
├── components/
│   ├── upload-button.tsx                         # 'use client' — POSTs to /prepare
│   ├── confirm-supplier-form.tsx                 # 'use client' — match UI + create form
│   ├── status-badge.tsx
│   ├── journal-entry-table.tsx
│   ├── approve-reject-actions.tsx                # 'use client' — POST + router.refresh()
│   └── ui/button.tsx                             # minimal shadcn-style primitive
├── lib/
│   ├── api.ts                                    # typed fetch helpers
│   ├── format.ts                                 # sv-SE money/date formatters
│   ├── types.ts                                  # API response shapes
│   └── cn.ts                                     # clsx + tailwind-merge
├── next.config.ts                                # rewrites /api/* → BACKEND_URL
├── postcss.config.mjs                            # @tailwindcss/postcss
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

- [CLAUDE.md](CLAUDE.md) — the rules (no `any`, conventional commits, accounting invariants, run modes, etc.). Read first.
- [EXTENDING.md](EXTENDING.md) — recipes for common feature work (new endpoint, DB column, LLM proposal field, frontend page, test). Read when adding something.

Highlights from CLAUDE.md:

- **No `any`**, explicit or implicit — both Biome and TypeScript strict block it.
- **Conventional commits**, **merge commits** never rebase.
- **Two run modes** (docker and local) must both stay working; nothing is hardcoded for an environment.
- **No mocked Anthropic in dev/prod** — only via the DI seam in tests.
- **Bun only** as the package manager. Lockfile is `bun.lock`.

## Input handling caveats

What we do today vs. what a production version would need. Honest accounting of where it fails loudly, fails quietly, or doesn't fail at all when it probably should.

- **No file-size limit.** The route reads the whole upload into memory (`file.arrayBuffer()`), writes it to disk, then base64-encodes it for Anthropic. A 200 MB PDF would OOM the backend; even a 50 MB one wastes ~70 MB of base64 RAM before the API call. Anthropic's own per-request PDF limit is 32 MB. **Fix:** enforce e.g. 10 MB in the route (`if (file.size > MAX) throw 413`) and reject early.
- **MIME-type check is advisory.** [`bills.ts`](backend/src/routes/bills.ts) rejects `file.type` if non-empty AND not `application/pdf` — but a client sending `Content-Type:` blank slips through, and `file.type` is just the client's claim. Anthropic will reject the document block, so we fail at 502 instead of 400/415. **Fix:** sniff the magic bytes (`%PDF-` at offset 0) before storing.
- **Non-invoice PDFs (a book, a photo, a manual)** — Claude usually does the right thing here. Two branches:
  1. Claude refuses to call the tool → backend throws "Claude did not return a tool_use block" → **502**. The user gets the message but it's not friendly.
  2. Claude calls the tool with garbage (invented supplier, fabricated amounts). zod requires `postings: min(1)` so empty arrays bounce → **502**. If the garbage *parses*, the validators usually catch it as unbalanced or unknown account → bill persists as `pending` with `validation_errors`. The user has to spot it and reject.
  - **Fix:** add a pre-check tool call ("is this a supplier invoice?") and short-circuit with a 422 if Claude says no. Or add a confidence-score field to the proposal schema and refuse below a threshold.
- **Corrupted, encrypted, password-protected, or scanned-image PDFs.** Anthropic either errors or returns junk. Same 502 path. **Fix:** sniff for encryption flag in the PDF header; for scanned images, route through Claude with an OCR-aware prompt or pre-process with Tesseract.
- **Long invoices (20+ line items).** `max_tokens: 4096` is fine for typical Swedish invoices but a multi-page expense report can produce a truncated tool input that fails zod parse → 502. **Fix:** bump `max_tokens` to e.g. 8192 and/or stream.
- **Wrong amounts that happen to balance.** If Claude misreads `12,500.00` as `12,500.00` for one line and the others align, the validators see balance and persist quietly. The accountant has to compare visually. This is fundamental — no automated check can substitute for a human comparing PDF to postings — but a confidence score per posting could flag low-certainty rows.
- **Missing required-on-the-row fields.** Most header fields (`supplierName`, `invoiceNumber`, dates) are nullable; we render `—` and proceed. Postings descriptions can be empty strings without the zod schema rejecting. **Fix:** tighten `description: z.string().min(1)` and surface the error before persist.
- **Duplicate uploads.** Upload the same invoice twice → two separate bills, two journal entries, double-counted payables. There's no deduplication by file hash, invoice number, or amount. **Fix:** SHA-256 the bytes on upload, store on the bill row, reject prepare if a confirmed bill with the same hash exists (or surface as a candidate to the user).
- **Slow LLM = client retry.** The single sync `/prepare` call takes 5–15 s. A flaky network or impatient user re-clicking creates duplicate drafts (cleaned up by the 1h TTL, but still wasted API calls). **Fix:** see [File storage › scaling to multiple API instances](#what-scaling-to-multiple-api-instances-would-need) for the queue + polling path.

The shape of the fixes is roughly "validate at the edge, give better errors" — none require structural changes to the model.

## Known limitations / what I'd ship next

- Single LLM call on the upload request blocks for ~5-15 s. A real product would queue this and stream results, but for the interview scope synchronous is fine. See [File storage › scaling to multiple API instances](#what-scaling-to-multiple-api-instances-would-need) for the migration path.
- PDFs live on a local volume tied to one backend instance — horizontally scaling the API requires moving to object storage. Same section above covers the swap.
- No authentication — anyone hitting `localhost` can upload and approve.
- No multi-tenant data isolation.
- Supplier UI is intentionally thin for v1. The `/suppliers/[id]` page exists but only shows name + org/VAT + invoice count. Next pass: a `/suppliers` index with search, an inline edit form on the detail page (PATCH `/api/suppliers/:id` doesn't exist yet — the API is read-only), a bill-history list per supplier, and a merge action for the inevitable duplicates that creep in when org/VAT numbers weren't extracted from early invoices. The matching lib already gives us the pieces for surfacing merge candidates.
- Currency is whatever Claude reports from the PDF; no FX conversion if the bill is in EUR/USD.
- VAT handling only covers the standard Swedish-domestic case. Reverse charge, intra-community acquisitions, non-EU services and imports are not modeled — see [Accounting model › What this VAT model doesn't handle](#what-this-vat-model-doesnt-handle).
- No audit log of approve/reject decisions beyond the `decided_at` timestamp.
- The reasoning text and validation errors are surfaced but the UI doesn't yet block approval of entries that failed validation — the accountant can override.
