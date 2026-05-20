# Accountio

Invoice-to-journal-entry web app. Upload a Swedish supplier invoice (PDF), Claude generates a balanced double-entry journal entry against the BAS chart of accounts, and an accountant approves or rejects the proposal side-by-side with the PDF.

This is a take-home assignment — see [interview.md](interview.md) for the original spec.

> **Status:** scaffold in progress. README will be filled in as the build progresses (see step 14 in the build sequence).

## Stack

Bun · Hono · Drizzle · Postgres · Next.js 16 · React 19 · Tailwind · shadcn/ui · Biome · Husky

## Quickstart

Coming once the scaffold lands. Both docker and local modes are supported.

## Repository layout

```
backend/      # Bun + Hono + Drizzle API
frontend/     # Next.js 16 App Router
docker-compose.yml
biome.json
.husky/
```

## Guardrails

See [CLAUDE.md](CLAUDE.md) for the engineering rules (no `any`, conventional commits, run modes, accounting invariants, etc.).
