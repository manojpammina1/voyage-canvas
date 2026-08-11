import { randomUUID } from 'node:crypto';
import {
  loadCatalog,
  quotePrice,
  searchSailings,
} from '@voyage/commerce';
import { policyEvidenceFromPassages } from '@voyage/content-adapter';
import { createHold, getAvailability, startBooking } from '@voyage/inventory';
import type {
  Evidence,
  GuestAuthCtx,
  RetrievalAdapter,
  SearchCriteria,
  ToolResult,
  VoyageOption,
} from '@voyage/shared';
import {
  parseToolArgs,
  type ToolName,
} from './toolSchemas.js';

export interface ToolContext {
  retrieval: RetrievalAdapter;
  requestId?: string;
}

function provenance(tool: ToolName, requestId: string, sourceId?: string) {
  return { tool, requestId, sourceId };
}

export async function invokeTool(
  tool: ToolName,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<{ result: ToolResult<unknown>; evidence?: Evidence[] }> {
  const requestId = ctx.requestId ?? randomUUID();

  switch (tool) {
    case 'search_sailings': {
      const args = parseToolArgs(tool, rawArgs);
      const options = searchSailings(args.criteria);
      return {
        result: {
          ok: true,
          data: options,
          asOf: new Date().toISOString(),
          provenance: provenance(tool, requestId),
        },
      };
    }
    case 'check_availability': {
      const args = parseToolArgs(tool, rawArgs);
      const rows = await getAvailability(args.sailingId, args.cabinType);
      const evidence: Evidence[] = rows.map((row) => ({
        id: `ev-avail-${args.sailingId}-${row.cabinType}`,
        type: 'AVAILABILITY',
        source: 'deterministic',
        data: row,
        asOf: row.asOf,
        provenance: provenance(tool, requestId, row.cabinId),
      }));
      return {
        result: {
          ok: true,
          data: rows,
          asOf: new Date().toISOString(),
          provenance: provenance(tool, requestId, args.sailingId),
        },
        evidence,
      };
    }
    case 'get_pricing': {
      const args = parseToolArgs(tool, rawArgs);
      const catalog = loadCatalog();
      const quote = quotePrice(
        args.sailingId,
        args.cabinType,
        args.occupancy,
        catalog,
      );
      const evidence: Evidence = {
        id: `ev-price-${quote.quoteId}`,
        type: 'PRICE',
        source: 'deterministic',
        data: quote,
        asOf: quote.asOf,
        validUntil: quote.validUntil,
        provenance: provenance(tool, requestId, quote.quoteId),
      };
      return {
        result: {
          ok: true,
          data: quote,
          asOf: quote.asOf,
          validUntil: quote.validUntil,
          provenance: provenance(tool, requestId, quote.quoteId),
        },
        evidence: [evidence],
      };
    }
    case 'get_policy_content': {
      const args = parseToolArgs(tool, rawArgs);
      const topK = args.topK ?? Number(process.env.RETRIEVAL_TOP_K ?? 3);
      const passages = await ctx.retrieval.search(args.question, topK, args.topic);
      const evidence = policyEvidenceFromPassages(passages, requestId);
      return {
        result: {
          ok: true,
          data: { passages, citations: evidence.data },
          asOf: new Date().toISOString(),
          provenance: provenance(tool, requestId, passages[0]?.metadata.sourceId),
        },
        evidence: [evidence],
      };
    }
    case 'create_hold': {
      const args = parseToolArgs(tool, rawArgs);
      const result = await createHold({
        sailingId: args.sailingId,
        cabinId: args.cabinId,
        cabinType: args.cabinType,
        quoteId: args.quoteId,
        occupancy: args.occupancy,
        quotedTotalUsd: args.quotedTotalUsd,
        guestAuthCtx: args.guestAuthCtx,
        idempotencyKey: args.idempotencyKey,
        guestConfirmed: args.guestConfirmed,
      });
      return { result: result as ToolResult<unknown> };
    }
    case 'start_booking': {
      const args = parseToolArgs(tool, rawArgs);
      const result = await startBooking(args.holdId, args.guestAuthCtx);
      return { result: result as ToolResult<unknown> };
    }
    default: {
      const _exhaustive: never = tool;
      throw new Error(`Unknown tool: ${_exhaustive}`);
    }
  }
}

export function buildSearchPlan(criteria: SearchCriteria): Array<{
  tool: ToolName;
  args: unknown;
}> {
  return [{ tool: 'search_sailings', args: { criteria } }];
}

export async function enrichOptionsWithCommerceEvidence(
  options: VoyageOption[],
  criteria: SearchCriteria,
  ctx: ToolContext,
): Promise<Evidence[]> {
  const catalog = loadCatalog();
  const cabinType = criteria.cabinType ?? catalog.pricing.heroCabinType;
  const occupancy = criteria.occupancy ?? catalog.pricing.heroOccupancy;
  const evidence: Evidence[] = [];

  for (const opt of options.slice(0, 3)) {
    try {
      const avail = await invokeTool(
        'check_availability',
        { sailingId: opt.sailing.id, cabinType },
        ctx,
      );
      if (avail.evidence) evidence.push(...avail.evidence);
    } catch {
      // Mongo may be unavailable in offline unit tests — skip availability evidence.
    }

    const price = await invokeTool(
      'get_pricing',
      { sailingId: opt.sailing.id, cabinType, occupancy },
      ctx,
    );
    if (price.evidence) evidence.push(...price.evidence);
  }

  return evidence;
}

export type { GuestAuthCtx };
