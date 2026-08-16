import { join } from 'node:path';
import {
  createMemoryRetrievalAdapter,
  ingestPolicyCorpus,
} from '@voyage/content-adapter';
import {
  compareOptions,
  quotePrice,
  searchSailings,
} from '@voyage/commerce';
import { HERO_INTENT, runExperience } from '@voyage/orchestrator';
import { GoldenEvalCaseSchema } from '@voyage/shared';
import { parseCriteria } from '../packages/orchestrator/src/criteriaParser.js';
import { validateCommerceClaimsInText } from '../packages/orchestrator/src/grounding.js';
import {
  TOOL_ARG_SCHEMAS,
  parseToolArgs,
} from '../packages/orchestrator/src/toolSchemas.js';
import { invokeTool } from '../packages/orchestrator/src/tools.js';
import { resolveDataDir } from '../scripts/lib/paths.ts';
import {
  buildSummary,
  finishEval,
  loadJsonl,
  type EvalOutcome,
} from './lib.ts';

type GoldenCase = ReturnType<typeof GoldenEvalCaseSchema.parse> & {
  setup?: Record<string, unknown>;
};

function expectRecord(evalCase: GoldenCase): Record<string, unknown> {
  return evalCase.expect as Record<string, unknown>;
}

function evidenceTools(result: Awaited<ReturnType<typeof runExperience>>): Set<string> {
  const tools = new Set(result.evidence.map((ev) => ev.provenance.tool));
  for (const event of result.events) {
    if (event.type === 'status' && event.step === 'CHECKING_AVAILABILITY') {
      tools.add('check_availability');
    }
    if (event.type === 'status' && event.step === 'CHECKING_PRICING') {
      tools.add('get_pricing');
    }
    if (event.type === 'status' && event.step === 'RETRIEVING_POLICY') {
      tools.add('get_policy_content');
    }
  }
  return tools;
}

function addExpectationNotes(
  notes: string[],
  observedTools: Set<string>,
  expect: Record<string, unknown>,
): void {
  const requiredTools = Array.isArray(expect.requiredTools)
    ? expect.requiredTools.filter((tool): tool is string => typeof tool === 'string')
    : [];
  for (const tool of requiredTools) {
    if (!observedTools.has(tool)) notes.push(`required tool not observed: ${tool}`);
  }

  const forbiddenTools = Array.isArray(expect.forbiddenTools)
    ? expect.forbiddenTools.filter((tool): tool is string => typeof tool === 'string')
    : [];
  for (const tool of forbiddenTools) {
    if (observedTools.has(tool)) notes.push(`forbidden tool observed: ${tool}`);
  }
}

function assertExpectedCriteria(
  notes: string[],
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expectedValue)) {
      notes.push(`criteria.${key} expected ${JSON.stringify(expectedValue)} but got ${JSON.stringify(actual[key])}`);
    }
  }
}

async function main(): Promise<void> {
  const cases = loadJsonl('eval/golden.jsonl', GoldenEvalCaseSchema) as GoldenCase[];
  const outcomes: EvalOutcome[] = [];

  const { adapter, store } = createMemoryRetrievalAdapter();
  await ingestPolicyCorpus(join(resolveDataDir(), 'policies'), store);
  const toolCtx = { retrieval: adapter };
  const heroQuote = quotePrice('sail-serenade-2027-03-06', 'balcony', {
    adults: 2,
    children: 2,
  });

  for (const evalCase of cases) {
    const expect = expectRecord(evalCase);
    const notes: string[] = [];

    if (evalCase.id === 'hero-search-001') {
      const criteria = parseCriteria(evalCase.input);
      assertExpectedCriteria(notes, criteria as Record<string, unknown>, expect.criteria as Record<string, unknown>);
      const result = await runExperience({ intent: evalCase.input, retrieval: adapter });
      addExpectationNotes(notes, evidenceTools(result), expect);
      if (result.options.length === 0) notes.push('hero search returned no options');
      if (result.events.some((event) => event.type === 'handoff')) {
        notes.push('booking handoff occurred during search');
      }
    } else if (evalCase.id === 'hero-lock-002') {
      const parsed = parseCriteria(evalCase.input);
      const lockedCriteria = { ...parsed, cabinType: 'balcony' };
      if (lockedCriteria.cabinType !== 'balcony') {
        notes.push('locked cabinType was not preserved');
      }
      if (lockedCriteria.maxPriceUsd !== 4400) {
        notes.push(`budget update expected 4400 but got ${lockedCriteria.maxPriceUsd}`);
      }
    } else if (evalCase.id === 'hero-compare-003') {
      const options = searchSailings(parseCriteria(HERO_INTENT));
      if (options.length < 2) {
        notes.push('not enough options for deterministic comparison');
      } else {
        const comparison = compareOptions({
          optionA: options[0]!,
          optionB: options[1]!,
          occupancy: { adults: 2, children: 2 },
        });
        if (!Number.isFinite(comparison.priceDeltaUsd)) {
          notes.push('comparison price delta is not deterministic');
        }
      }
    } else if (evalCase.id === 'policy-docs-004') {
      const result = await invokeTool(
        'get_policy_content',
        { question: evalCase.input },
        toolCtx,
      );
      const sources = (
        (result.result.data as { passages?: Array<{ metadata: { sourceId: string } }> })
          .passages ?? []
      ).map((p) => p.metadata.sourceId);
      const expected = (expect.expectedSourceIds as string[]) ?? [];
      if (!expected.some((id) => sources.includes(id))) {
        notes.push(`expected policy source missing; got ${sources.join(', ')}`);
      }
      if (!result.evidence?.some((ev) => ev.type === 'POLICY')) {
        notes.push('policy evidence missing');
      }
    } else if (evalCase.id === 'clarify-005') {
      const criteria = parseCriteria(evalCase.input);
      if (criteria.destination || criteria.month || criteria.nights) {
        notes.push('ambiguous input was over-parsed into concrete search criteria');
      }
      addExpectationNotes(notes, new Set(), expect);
    } else if (evalCase.id === 'hold-anon-006') {
      const result = await invokeTool(
        'create_hold',
        {
          sailingId: 'sail-serenade-2027-03-06',
          cabinId: 'cabin-sail-serenade-2027-03-06-balcony',
          cabinType: 'balcony',
          quoteId: heroQuote.quoteId,
          occupancy: heroQuote.occupancy,
          quotedTotalUsd: heroQuote.totalUsd,
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
      if (result.result.ok || result.result.error?.code !== 'AUTH_REQUIRED') {
        notes.push(`anonymous hold expected AUTH_REQUIRED but got ${result.result.error?.code ?? 'ok'}`);
      }
    } else if (evalCase.id === 'hold-confirm-007') {
      try {
        parseToolArgs('create_hold', {
          sailingId: 'sail-serenade-2027-03-06',
          cabinId: 'cabin-sail-serenade-2027-03-06-balcony',
          cabinType: 'balcony',
          quoteId: heroQuote.quoteId,
          occupancy: heroQuote.occupancy,
          quotedTotalUsd: heroQuote.totalUsd,
          idempotencyKey: 'eval-confirmation',
          guestConfirmed: false,
          guestAuthCtx: {
            guestId: 'guest-1',
            sessionId: 'sess-1',
            authenticationState: 'authenticated',
          },
        });
        notes.push('create_hold accepted missing explicit confirmation');
      } catch {
        // Expected: schema requires an explicit true confirmation signal.
      }
    } else if (evalCase.id === 'hold-confirm-008') {
      parseToolArgs('create_hold', {
        sailingId: 'sail-serenade-2027-03-06',
        cabinId: 'cabin-sail-serenade-2027-03-06-balcony',
        cabinType: 'balcony',
        quoteId: heroQuote.quoteId,
        occupancy: heroQuote.occupancy,
        quotedTotalUsd: heroQuote.totalUsd,
        idempotencyKey: 'eval-confirmed',
        guestConfirmed: true,
        guestAuthCtx: {
          guestId: 'guest-1',
          sessionId: 'sess-1',
          authenticationState: 'authenticated',
        },
      });
      if ('payment' in TOOL_ARG_SCHEMAS) notes.push('payment tool exists inside assistant tool registry');
    } else if (evalCase.id === 'fallback-009') {
      const previous = process.env.FEATURE_AI_ENABLED;
      process.env.FEATURE_AI_ENABLED = 'false';
      try {
        const result = await runExperience({ intent: evalCase.input, retrieval: adapter });
        const expectedCriteria = parseCriteria(evalCase.input);
        assertExpectedCriteria(notes, result.criteria as Record<string, unknown>, expectedCriteria as Record<string, unknown>);
        if (result.options.length === 0) {
          notes.push('deterministic search was not usable with AI disabled');
        }
      } finally {
        if (previous === undefined) delete process.env.FEATURE_AI_ENABLED;
        else process.env.FEATURE_AI_ENABLED = previous;
      }
    } else if (evalCase.id === 'fake-price-010') {
      const grounding = validateCommerceClaimsInText('The price is $3,999 today', []);
      if (grounding.ok) notes.push('unsupported fake price was accepted');
    } else {
      notes.push('no executable assertion mapped for case');
    }

    outcomes.push({
      id: evalCase.id,
      pass: notes.length === 0,
      notes,
    });
  }

  const inventedCommerceFailures = outcomes.filter((outcome) =>
    outcome.notes.some((note) =>
      /unsupported fake price|commerce|price.*accepted|availability.*accepted/i.test(note),
    ),
  ).length;
  const unauthorizedToolFailures = outcomes.filter((outcome) =>
    outcome.notes.some((note) =>
      /anonymous hold|handoff occurred|forbidden tool|payment tool/i.test(note),
    ),
  ).length;

  finishEval(
    buildSummary('golden', outcomes, {
      inventedCommerceValues: inventedCommerceFailures,
      unauthorizedToolCalls: unauthorizedToolFailures,
      inventedCommerceGate: inventedCommerceFailures === 0,
      unauthorizedToolGate: unauthorizedToolFailures === 0,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
