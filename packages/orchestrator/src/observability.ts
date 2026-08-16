export interface TraceSpan {
  name: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface TraceError {
  code: string;
  recoverable: boolean;
  span?: string;
}

export interface TraceControls {
  aiEnabled: boolean;
  maxToolSteps: number;
  retrievalTopK: number;
  llmTimeoutMs: number;
  maxModelPromptChars: number;
  maxModelOutputTokens: number;
}

export interface ExperienceTrace {
  traceId: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  spans: TraceSpan[];
  provider: string;
  modelTier: string;
  modelCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  toolCalls: number;
  toolNames: string[];
  evidenceIds: string[];
  fallbackReason?: string;
  errors: TraceError[];
  controls: TraceControls;
  redacted: boolean;
}

const traces: ExperienceTrace[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function controlNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function traceControlsFromEnv(maxToolSteps: number): TraceControls {
  return {
    aiEnabled: (process.env.FEATURE_AI_ENABLED ?? 'true').toLowerCase() !== 'false',
    maxToolSteps,
    retrievalTopK: controlNumber('RETRIEVAL_TOP_K', 3),
    llmTimeoutMs: controlNumber('LLM_TIMEOUT_MS', 20_000),
    maxModelPromptChars: controlNumber('LLM_MAX_PROMPT_CHARS', 12_000),
    maxModelOutputTokens: controlNumber('LLM_MAX_OUTPUT_TOKENS', 512),
  };
}

export function startTrace(
  provider: string,
  modelTier: string,
  controls: TraceControls = traceControlsFromEnv(
    Number(process.env.MAX_TOOL_STEPS ?? 4),
  ),
): ExperienceTrace {
  const start = Date.now();
  const trace: ExperienceTrace = {
    traceId: `tr-${start}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date(start).toISOString(),
    spans: [],
    provider,
    modelTier,
    modelCalls: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
    toolCalls: 0,
    toolNames: [],
    evidenceIds: [],
    errors: [],
    controls,
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
  span.durationMs = Math.max(0, endMs - span.startMs);
}

export function finishTrace(trace: ExperienceTrace, endMs = Date.now()): void {
  trace.endedAt = new Date(endMs).toISOString();
  trace.durationMs = Math.max(0, endMs - Date.parse(trace.startedAt));
}

export function recordToolCall(trace: ExperienceTrace, toolName: string): void {
  trace.toolCalls += 1;
  trace.toolNames.push(toolName);
}

export function recordEvidence(trace: ExperienceTrace, evidenceId: string): void {
  trace.evidenceIds.push(evidenceId);
}

export function recordFallback(trace: ExperienceTrace, reason: string): void {
  trace.fallbackReason = reason;
}

export function recordError(
  trace: ExperienceTrace,
  code: string,
  recoverable: boolean,
  span?: string,
): void {
  trace.errors.push({ code, recoverable, span });
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function modelRatePer1k(provider: string): number {
  const configured = Number(process.env.LLM_ESTIMATED_COST_PER_1K_TOKENS_USD);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  if (provider.toLowerCase() === 'gemini') return 0.00035;
  return 0;
}

export function recordModelUsage(
  trace: ExperienceTrace,
  inputText: string,
  outputText = '',
): void {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = outputText ? estimateTokens(outputText) : 0;
  trace.modelCalls += 1;
  trace.estimatedInputTokens += inputTokens;
  trace.estimatedOutputTokens += outputTokens;
  const totalTokens = trace.estimatedInputTokens + trace.estimatedOutputTokens;
  trace.estimatedCostUsd =
    Math.round(totalTokens * modelRatePer1k(trace.provider) * 1000000) /
    1000000000;
}

export function latestTrace(): ExperienceTrace | undefined {
  return traces[traces.length - 1];
}

export function clearTraces(): void {
  traces.length = 0;
}
