#!/usr/bin/env node
/**
 * Codex review fan-out — reads governance/reviewers/orchestration.yaml and
 * prints the review plan + reviewer prompts (stdout). No third-party deps.
 *
 * Usage: node .codex/review.mjs [--diff-file path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const REVIEWERS = path.join(ROOT, 'governance', 'reviewers');
const ORCH = path.join(REVIEWERS, 'orchestration.yaml');

function parseSimpleYaml(text) {
  const result = { always_run: [], conditional: [], post_process: [] };
  let section = null;
  let item = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ') && line.endsWith(':') && !line.includes(': ')) {
      section = line.slice(0, -1);
      if (!result[section]) result[section] = [];
      item = null;
      continue;
    }
    if (line.startsWith('  - file:')) {
      item = { file: line.split(': ')[1].trim() };
      if (section) result[section].push(item);
      continue;
    }
    if (item && line.trim().startsWith('model:')) {
      item.model = line.split(': ')[1].trim();
    }
    if (item && line.trim().startsWith('when:')) {
      item.when = line.split(': ').slice(1).join(': ').trim();
    }
  }
  return result;
}

function main() {
  if (!fs.existsSync(ORCH)) {
    console.error('[review] Missing orchestration.yaml at', ORCH);
    console.error('[review] Deploy governance/ from titan-render --target all first.');
    process.exit(1);
  }
  const orch = parseSimpleYaml(fs.readFileSync(ORCH, 'utf8'));
  console.log('REVIEW PLAN (Codex / Cursor)');
  console.log('Governance pre-check: protected_paths + hard stops (see AGENTS.md)');
  console.log('');
  console.log('Always run:');
  for (const r of orch.always_run || []) {
    const specPath = path.join(REVIEWERS, r.file);
    const spec = fs.existsSync(specPath)
      ? fs.readFileSync(specPath, 'utf8').split('\n')[0]
      : r.file;
    console.log(`  - ${r.file} (${r.model || 'default'}) — ${spec.slice(0, 80)}`);
  }
  console.log('');
  console.log('Conditional:');
  for (const r of orch.conditional || []) {
    console.log(`  - ${r.file} (${r.model || 'default'}) when: ${r.when || 'n/a'}`);
  }
  if (orch.post_process && orch.post_process.length) {
    console.log('');
    console.log('Post-process:');
    for (const r of orch.post_process) {
      console.log(`  - ${r.file} (${r.model || 'default'})`);
    }
  }
  console.log('');
  console.log('GOVERNANCE: Run AI first-pass review; a human is accountable for merged code.');
}

main();
