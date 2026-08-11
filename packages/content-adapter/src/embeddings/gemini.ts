import type { EmbeddingModel, EmbeddingResult } from '@voyage/shared';

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
}

function geminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error('GEMINI_API_KEY required when LLM_PROVIDER=gemini');
  }
  return key;
}

function modelName(): string {
  const configured = process.env.EMBEDDING_MODEL?.trim();
  if (!configured) {
    throw new Error('EMBEDDING_MODEL required when LLM_PROVIDER=gemini');
  }
  return configured.startsWith('models/') ? configured : `models/${configured}`;
}

function apiBase(): string {
  return (
    process.env.GEMINI_API_BASE?.trim() ||
    'https://generativelanguage.googleapis.com/v1beta'
  );
}

async function embedOne(text: string, model: string, apiKey: string): Promise<number[]> {
  const response = await fetch(
    `${apiBase()}/${model}:embedContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        content: { parts: [{ text }] },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini embedding failed: ${response.status}`);
  }

  const json = (await response.json()) as GeminiEmbeddingResponse;
  const values = json.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error('Gemini embedding response did not include vector values');
  }
  return values;
}

export function createGeminiEmbeddingModel(): EmbeddingModel {
  const provider = 'gemini';
  const model = modelName();
  const apiKey = geminiApiKey();

  return {
    async embed(texts: string[]): Promise<EmbeddingResult[]> {
      const vectors: number[][] = [];
      for (const text of texts) {
        vectors.push(await embedOne(text, model, apiKey));
      }
      return vectors.map((vector) => ({
        vector,
        provider,
        model,
        dimensions: vector.length,
      }));
    },
  };
}
