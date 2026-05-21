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
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import type { Account } from './accounts.ts';

const proposalPostingSchema = z.object({
  accountNumber: z.string(),
  accountName: z.string(),
  debit: z.union([z.string(), z.number()]).transform((v) => String(v)),
  credit: z.union([z.string(), z.number()]).transform((v) => String(v)),
  description: z.string(),
});

const proposalSchema = z.object({
  supplierName: z.string().nullable(),
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
- Provide a one-paragraph \`reasoning\` explaining the account choices.

# BAS chart of accounts

${chart.map((a) => `- ${a.number} ${a.name}`).join('\n')}
`;
}

const USER_PROMPT_TEXT =
  'Generate a balanced double-entry journal entry for this invoice using the provided BAS chart of accounts. Call the record_journal_entry tool exactly once.';

const TOOL_INPUT_SCHEMA: Tool.InputSchema = {
  type: 'object',
  required: [
    'supplierName',
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
