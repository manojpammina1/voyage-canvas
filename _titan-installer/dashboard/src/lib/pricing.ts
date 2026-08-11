// Anthropic list prices — June 2026.
// Update quarterly per claude.com/pricing.
// These are LIST RATES. your org's contract rates may differ — confirm with Finance.
// $/1M tokens

export const MODEL_RATES: Record<string, { inputPer1M: number; outputPer1M: number; label: string }> = {
  'claude-opus-4-7':   { inputPer1M: 15.00, outputPer1M: 75.00, label: 'Opus 4.7'   },
  'claude-opus-4-8':   { inputPer1M: 15.00, outputPer1M: 75.00, label: 'Opus 4.8'   },
  'claude-sonnet-4-6': { inputPer1M:  3.00, outputPer1M: 15.00, label: 'Sonnet 4.6' },
  'claude-sonnet-4-7': { inputPer1M:  3.00, outputPer1M: 15.00, label: 'Sonnet 4.7' },
  'claude-haiku-4-5':  { inputPer1M:  0.25, outputPer1M:  1.25, label: 'Haiku 4.5'  },
  'default':           { inputPer1M:  3.00, outputPer1M: 15.00, label: 'Sonnet (default)' },
  'Sonnet (default)':  { inputPer1M:  3.00, outputPer1M: 15.00, label: 'Sonnet (default)' },
  'Sonnet 4.6':        { inputPer1M:  3.00, outputPer1M: 15.00, label: 'Sonnet 4.6' },
  'Opus 4.7':          { inputPer1M: 15.00, outputPer1M: 75.00, label: 'Opus 4.7'   },
  'Haiku 4.5':         { inputPer1M:  0.25, outputPer1M:  1.25, label: 'Haiku 4.5'  },
};

export function getLabel(model: string): string {
  return MODEL_RATES[model]?.label ?? model;
}

export const DISCLAIMER = 'Cost estimates use Anthropic list pricing (June 2026). your org's contract rates may be lower — pending confirmation from Finance.';
