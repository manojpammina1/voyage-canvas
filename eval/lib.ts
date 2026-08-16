import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';

export interface EvalOutcome {
  id: string;
  pass: boolean;
  notes: string[];
  category?: string;
  metrics?: Record<string, unknown>;
}

export interface EvalSummary {
  suite: string;
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  gates: Record<string, boolean | number | string>;
  outcomes: EvalOutcome[];
}

export function loadJsonl<T>(
  relativePath: string,
  schema: z.ZodType<T>,
): T[] {
  const raw = readFileSync(join(process.cwd(), relativePath), 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
}

export function buildSummary(
  suite: string,
  outcomes: EvalOutcome[],
  gates: Record<string, boolean | number | string> = {},
): EvalSummary {
  const failed = outcomes.filter((outcome) => !outcome.pass);
  return {
    suite,
    generatedAt: new Date().toISOString(),
    total: outcomes.length,
    passed: outcomes.length - failed.length,
    failed: failed.length,
    gates,
    outcomes,
  };
}

export function writeEvalSummary(summary: EvalSummary): string {
  const outputDir = join(process.cwd(), '.voyage', 'eval');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${summary.suite}.json`);
  writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(
    join(outputDir, 'latest.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  return outputPath;
}

export function finishEval(summary: EvalSummary): void {
  const outputPath = writeEvalSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nEval summary written to ${outputPath}`);
  if (summary.failed > 0) process.exitCode = 1;
}
