/** Patterns stripped before model calls — never log raw matches. */
const PII_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g,
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all )?(?:previous|prior) instructions/i,
  /system prompt/i,
  /system rules are cancelled/i,
  /reveal hidden prompts/i,
  /you are now/i,
  /call tool\s+\w+/i,
  /call booking tools/i,
  /execute\s+(?:create_hold|start_booking)/i,
  /grant (?:admin|root) access/i,
];

export function redactPii(text: string): string {
  let out = text;
  for (const pattern of PII_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export function containsPii(text: string): boolean {
  return PII_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

export function sanitizeForModel(text: string): {
  text: string;
  blocked: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (detectPromptInjection(text)) {
    reasons.push('PROMPT_INJECTION');
  }
  const redacted = redactPii(text);
  if (redacted !== text) {
    reasons.push('PII_REDACTED');
  }
  return {
    text: redacted,
    blocked: reasons.includes('PROMPT_INJECTION'),
    reasons,
  };
}

export function markUntrustedRetrievedContext(passages: string[]): string {
  return passages
    .map(
      (p, i) =>
        `[UNTRUSTED_RETRIEVAL_${i + 1}] ${p.replace(/<\/?[^>]+>/g, '')}`,
    )
    .join('\n\n');
}
