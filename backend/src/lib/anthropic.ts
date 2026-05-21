/**
 * Claude-powered journal entry generator.
 *
 * Sends the invoice PDF as a native document block + a tool-use definition,
 * returning a structured journal proposal. The route layer passes the result
 * through assertBalanced / assertAccountsValid before persisting.
 *
 * The generator is exposed as a function `JournalGenerator` so the bills routes
 * can accept it as an argument — the real implementation calls Anthropic, the
 * test stub returns a fixture. No module-level mocking needed.
 *
 * --- Why two schemas? (proposalSchema + TOOL_INPUT_SCHEMA below) ---
 *
 * `TOOL_INPUT_SCHEMA` is JSON Schema sent to Anthropic in `tools[].input_schema`.
 * `proposalSchema` is the zod schema we re-validate the response with after it
 * comes back. They're related but serve different jobs, on purpose.
 *
 * 1. Anthropic's tool schema is a *hint* to the model, not a hard contract
 *    enforced by the API. Claude follows it most of the time but will
 *    occasionally drop a field, emit a number where we expected a string,
 *    or return fewer postings than `minItems` asks for. Without a second
 *    line of defense, bad LLM output reaches our DB.
 *
 * 2. The split lets us be PERMISSIVE outward and STRICT inward. The canonical
 *    example is the money fields: JSON Schema says `type: ['string', 'number']`
 *    because Claude flips between `"123.45"` and `123.45` depending on context,
 *    and zod then normalizes everything to string via `.transform()`. By the
 *    time the proposal leaves this function every amount is guaranteed to be a
 *    decimal string — which is what the validators and DB inserts expect.
 *
 * 3. zod features we depend on don't round-trip to JSON Schema cleanly:
 *    `.transform()` and `.refine()` are silently dropped by any zod →
 *    JSON-Schema converter. If we generated TOOL_INPUT_SCHEMA from
 *    proposalSchema we'd lose the very normalizations that make zod useful.
 *
 * If/when we want to dedupe, the right direction is "derive JSON Schema from
 * zod, then loosen specific fields by hand" — not the other way around. For
 * ~50 lines of schema, hand-writing both is fine and arguably easier to read.
 *
 * If `proposalSchema.safeParse` fails, the route catches it as a generator
 * failure, unlinks the orphaned PDF, and returns 502 — so bad output never
 * reaches the database.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import type { Account } from './accounts.ts';

// Inner schema (strict — gates what flows into the route layer).
const proposalPostingSchema = z.object({
  accountNumber: z.string(),
  accountName: z.string(),
  debit: z.union([z.string(), z.number()]).transform((v) => String(v)),
  credit: z.union([z.string(), z.number()]).transform((v) => String(v)),
  description: z.string(),
});

const proposalSchema = z.object({
  supplierName: z.string().nullable(),
  supplierOrgNumber: z.string().nullable(),
  supplierVatNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.string().default('SEK'),
  netAmount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  vatAmount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  grossAmount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  postings: z.array(proposalPostingSchema).min(1),
  reasoning: z.string(),
});

export type JournalProposal = z.infer<typeof proposalSchema>;

export type JournalGenerator = (input: {
  pdf: Uint8Array;
  filename: string;
  chart: ReadonlyArray<Account>;
}) => Promise<JournalProposal>;

const TOOL_NAME = 'record_journal_entry';

function buildSystemPrompt(chart: ReadonlyArray<Account>): string {
  return `You are an expert Swedish bookkeeper. Given a supplier invoice (PDF) and the BAS chart of accounts listed below, produce a balanced double-entry journal entry by calling the \`${TOOL_NAME}\` tool.

# Rules

- Use ONLY account numbers from the chart below. Never invent accounts.
- For supplier invoices with Swedish VAT (moms):
  - DEBIT one or more expense accounts at the **net** amount (before VAT). Choose the account whose name best matches the line item.
  - DEBIT \`2640 Ingående moms\` for the total VAT amount (if any VAT is shown).
  - CREDIT \`2440 Leverantörsskulder\` for the **gross** total — what we owe the supplier.
- The sum of all debits MUST equal the sum of all credits, exactly, to the cent.
- All amounts must be in the invoice's currency (do not convert).
- Each posting must have a non-empty \`description\`. Set the side that doesn't apply to "0".
- Dates must be ISO format YYYY-MM-DD.
- Capture the supplier's tax identifiers in two separate fields:
  - \`supplierOrgNumber\` — Swedish 10-digit organisationsnummer in the format "556677-8899". Null if not Swedish or not printed.
  - \`supplierVatNumber\` — country-prefixed VAT registration number, e.g. "SE556677889901" or "DE123456789". Null if not printed.
  - Some invoices print both, some print only one. Capture each in its own field — never put a VAT number in the org-number field or vice versa.
- Provide a one-paragraph \`reasoning\` explaining the account choices.

# BAS chart of accounts

${chart.map((a) => `- ${a.number} ${a.name}`).join('\n')}
`;
}

const USER_PROMPT_TEXT =
  'Generate a balanced double-entry journal entry for this invoice using the provided BAS chart of accounts. Call the record_journal_entry tool exactly once.';

// Outer schema (permissive — hint to Claude). Numbers/strings unions on amounts
// are deliberate; proposalSchema's `.transform()` normalizes them to string.
const TOOL_INPUT_SCHEMA: Tool.InputSchema = {
  type: 'object',
  required: [
    'supplierName',
    'supplierOrgNumber',
    'supplierVatNumber',
    'invoiceNumber',
    'invoiceDate',
    'dueDate',
    'currency',
    'netAmount',
    'vatAmount',
    'grossAmount',
    'postings',
    'reasoning',
  ],
  properties: {
    supplierName: { type: ['string', 'null'] },
    supplierOrgNumber: {
      type: ['string', 'null'],
      description:
        'Swedish 10-digit organisationsnummer, e.g. "556677-8899". Null if not Swedish or not printed.',
    },
    supplierVatNumber: {
      type: ['string', 'null'],
      description:
        'Country-prefixed VAT registration number, e.g. "SE556677889901". Null if not printed.',
    },
    invoiceNumber: { type: ['string', 'null'] },
    invoiceDate: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD or null.' },
    dueDate: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD or null.' },
    currency: { type: 'string', description: 'ISO currency code, e.g. SEK.' },
    netAmount: { type: ['string', 'number'], description: 'Net amount before VAT.' },
    vatAmount: { type: ['string', 'number'], description: 'VAT amount, 0 if none.' },
    grossAmount: { type: ['string', 'number'], description: 'Gross total.' },
    postings: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        required: ['accountNumber', 'accountName', 'debit', 'credit', 'description'],
        properties: {
          accountNumber: { type: 'string', description: 'BAS account number.' },
          accountName: { type: 'string' },
          debit: {
            type: ['string', 'number'],
            description: 'Amount as decimal string or number. 0 if this side does not apply.',
          },
          credit: { type: ['string', 'number'] },
          description: { type: 'string' },
        },
      },
    },
    reasoning: { type: 'string' },
  },
};

export type CreateAnthropicGeneratorOpts = {
  apiKey: string;
  model: string;
};

export function createAnthropicJournalGenerator(
  opts: CreateAnthropicGeneratorOpts,
): JournalGenerator {
  const client = new Anthropic({ apiKey: opts.apiKey });

  return async ({ pdf, chart }) => {
    const base64 = Buffer.from(pdf).toString('base64');

    const response = await client.messages.create({
      model: opts.model,
      max_tokens: 4096,
      system: buildSystemPrompt(chart),
      tools: [
        {
          name: TOOL_NAME,
          description: 'Record a balanced double-entry journal entry for the invoice.',
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            { type: 'text', text: USER_PROMPT_TEXT },
          ],
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Claude did not return a tool_use block for record_journal_entry');
    }

    const parsed = proposalSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(`Claude tool input failed schema validation: ${parsed.error.message}`);
    }
    return parsed.data;
  };
}
