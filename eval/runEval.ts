import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  createMemoryRetrievalAdapter,
  ingestPolicyCorpus,
} from '@voyage/content-adapter';
import { quotePrice } from '@voyage/commerce';
import { HERO_INTENT, runExperience } from '@voyage/orchestrator';
import { GoldenEvalCaseSchema } from '@voyage/shared';
import { parseCriteria } from '../packages/orchestrator/src/criteriaParser.js';
import { sanitizeForModel } from '../packages/orchestrator/src/guardrails.js';
import { validateCommerceClaimsInText } from '../packages/orchestrator/src/grounding.js';
import { invokeTool } from '../packages/orchestrator/src/tools.js';
import { resolveDataDir } from '../scripts/lib/paths.ts';

interface CaseOutcome {
  id: string;
  pass: boolean;
  notes: string[];
}

async function main(): Promise<void> {
  const lines = readFileSync(join(process.cwd(), 'eval/golden.jsonl'), 'utf8')
    .trim()
    .split('\n');
  const outcomes: CaseOutcome[] = [];

  const { adapter, store } = createMemoryRetrievalAdapter();
  await ingestPolicyCorpus(join(resolveDataDir(), 'policies'), store);
  const toolCtx = { retrieval: adapter };
  const holdQuote = quotePrice('sail-serenade-2027-03-06', 'balcony', {
    adults: 2,
    children: 2,
  });

  for (const line of lines) {
    const evalCase = GoldenEvalCaseSchema.parse(JSON.parse(line));
    const notes: string[] = [];
    let pass = true;

    if (evalCase.id === 'hero-search-001') {
      const criteria = parseCriteria(evalCase.input);
      const expect = evalCase.expect as { criteria: Record<string, unknown> };
      for (const [k, v] of Object.entries(expect.criteria)) {
        if ((criteria as Record<string, unknown>)[k] !== v) {
          pass = false;
          notes.push(`criteria.${k} mismatch`);
        }
      }
    }

    if (evalCase.id === 'policy-docs-004') {
      const result = await invokeTool(
        'get_policy_content',
        { question: evalCase.input },
        toolCtx,
      );
      const sources = (
        (result.result.data as { passages?: Array<{ metadata: { sourceId: string } }> })
          .passages ?? []
      ).map((p) => p.metadata.sourceId);
      const expected = (evalCase.expect as { expectedSourceIds: string[] }).expectedSourceIds;
      if (!expected.some((id) => sources.includes(id))) {
        pass = false;
        notes.push('expected policy source missing');
      }
    }

    if (evalCase.id === 'hold-anon-006') {
      const result = await invokeTool(
        'create_hold',
          {
            sailingId: 'sail-serenade-2027-03-06',
            cabinId: 'cabin-sail-serenade-2027-03-06-balcony',
            cabinType: 'balcony',
            quoteId: holdQuote.quoteId,
            occupancy: holdQuote.occupancy,
            quotedTotalUsd: holdQuote.totalUsd,
            idempotencyKey: 'eval-anon',
            guestConfirmed: true,
          guestAuthCtx: {
            guestId: 'anon-1',
            sessionId: 'anon-1',
            authenticationState: 'anonymous',
          },
        },
        toolCtx,
      );
      if (result.result.ok) {
        pass = false;
        notes.push('anonymous hold should be denied');
      }
    }

    if (evalCase.id === 'fake-price-010') {
      const grounding = validateCommerceClaimsInText('The price is $3,999 today', []);
      if (grounding.ok) {
        pass = false;
        notes.push('unsupported price accepted');
      }
    }

    if (evalCase.id === 'fallback-009') {
      const result = await runExperience({
        intent: HERO_INTENT,
        retrieval: adapter,
      });
      if (result.options.length === 0) {
        pass = false;
        notes.push('deterministic search unavailable after fallback setup');
      }
    }

    if (evalCase.id === 'clarify-005') {
      const criteria = parseCriteria(evalCase.input);
      if (criteria.month && criteria.destination) {
        pass = false;
        notes.push('ambiguous input over-parsed');
      }
    }

    outcomes.push({ id: evalCase.id, pass, notes });
  }

  const failed = outcomes.filter((o) => !o.pass);
  console.log(JSON.stringify({ total: outcomes.length, failed: failed.length, outcomes }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
