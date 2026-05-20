# Engineering Interview: Invoice-to-Journal Entry

---

## Candidate Instructions

### Terminology

- **Bill** — a bill (invoice) from a supplier for goods or services (the PDF you'll parse).
- **Line item** — a single row on an invoice (e.g. "10 hours consulting @ 1,500 kr").
- **Journal entry** — the accounting record created from an invoice, consisting of postings.
- **Posting** — a single debit or credit line in a journal entry (e.g. "Debit 5010 Lokalhyra 10,000 kr").
- **Debit & Credit** — every journal entry must have equal total debits and credits (double-entry bookkeeping).
- **Chart of Accounts** — a numbered list of accounts used to categorize transactions (e.g. 5010 = Rent, 6530 = IT Services).
- **Account mapping** — deciding which account each invoice line item should be posted to.

### Take-Home Assignment

**Use AI tools.** We expect you to use Cursor, Copilot, Claude, or any AI coding assistants you prefer, on the level you are comfortable with.

#### The Task

Build a web app that:

1. Lets the user (an accountant) **upload a PDF invoice** through the frontend.
2. Uses an **LLM** to generate a **journal entry** from the bill — each posting should reference an account from the provided Chart of Accounts.
3. Stores the journal entry in a database.
4. Displays the bill and the journal entry in a UI where the user (an accountant) can **approve or decline** the journal entry.

#### What You Receive

- **1 sample PDF invoice** — a clean, single-page invoice with a few line items.
- **An Anthropic API key** — we'll provide one for you to use during the assignment. Use it for the LLM-based account mapping.
- **A Chart of Accounts** (BAS kontoplan):

| Konto | Namn                        |
| ----- | --------------------------- |
| 1930  | Företagskonto               |
| 2440  | Leverantörsskulder          |
| 2640  | Ingående moms               |
| 4010  | Inköp material & varor      |
| 5010  | Lokalhyra                   |
| 5060  | Driftskostnader lokal       |
| 5220  | Hyra inventarier            |
| 5410  | Förbrukningsinventarier     |
| 5460  | Förbrukningsmaterial        |
| 5610  | Kontorsmaterial             |
| 5690  | Övriga kontorskostnader     |
| 6110  | Kontorsförnödenheter        |
| 6211  | Fast telefoni               |
| 6230  | Datakommunikation           |
| 6310  | Företagsförsäkringar        |
| 6530  | IT-tjänster                 |
| 6540  | IT-drift & hosting          |
| 6570  | Programvara, licenser       |
| 6910  | Licensavgifter & medlemskap |
| 7631  | Personalmat & fika          |

#### Requirements

- Backend can be any stack you're comfortable with. Frontend should be **React with TypeScript**.
- The accountant must be able to approve or reject a suggested journal entry in the UI.
- Debits and credits in the journal entry must balance.
- The exact shape of the journal entry (which accounts to debit/credit, how to handle VAT, etc.) is up to you — we care more about the product experience than accounting perfection.

#### Deliverable

- A GitHub repo (or zip) with instructions to run locally.

### Live Interview

- We'll spend about 1-1.5 hour together.
- You'll walk us through your take-home.
- We'll give you a harder PDF and a new feature to implement live.
- It's fine if things break — we'll iterate together.
- Come with your project running locally and your IDE ready.
