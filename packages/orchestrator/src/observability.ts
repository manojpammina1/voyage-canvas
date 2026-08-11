export interface TraceSpan {
  name: string;
  startMs: number;
  endMs?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface ExperienceTrace {
  traceId: string;
  spans: TraceSpan[];
  provider: string;
  modelTier: string;
  toolCalls: number;
  evidenceIds: string[];
  redacted: boolean;
}

const traces: ExperienceTrace[] = [];

export function startTrace(provider: string, modelTier: string): ExperienceTrace {
  const trace: ExperienceTrace = {
    traceId: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    spans: [],
    provider,
    modelTier,
    toolCalls: 0,
    evidenceIds: [],
    redacted: true,
  };
  traces.push(trace);
  return trace;
}

export function addSpan(
  trace: ExperienceTrace,
  name: string,
  startMs: number,
  attributes?: Record<string, string | number | boolean>,
): TraceSpan {
  const span: TraceSpan = { name, startMs, attributes };
  trace.spans.push(span);
  return span;
}

export function endSpan(span: TraceSpan, endMs: number): void {
  span.endMs = endMs;
}

export function latestTrace(): ExperienceTrace | undefined {
  return traces[traces.length - 1];
}

export function clearTraces(): void {
  traces.length = 0;
}
