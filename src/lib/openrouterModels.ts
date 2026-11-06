/**
 * OpenRouter model catalogue.
 *
 * Used by the admin model picker. Only text-output models are exposed; free
 * models are included and flagged so the UI can filter them.
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface OpenRouterTextModel {
  id: string;
  name: string;
  description: string | null;
  contextLength: number | null;
  isFree: boolean;
  promptPrice: string | null;
  completionPrice: string | null;
}

interface CacheEntry {
  fetchedAt: number;
  models: OpenRouterTextModel[];
}

let cache: CacheEntry | null = null;

function isTextOutputModel(model: any): boolean {
  const architecture = model?.architecture || {};
  const outputs = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities
    : [];

  // Prefer models whose output is text-only. Multimodal generators that also
  // emit text (image/video models) are not suitable for the study assistant.
  if (outputs.length > 0) {
    return outputs.includes('text') && outputs.every((modality: unknown) => modality === 'text');
  }

  const modality = typeof architecture.modality === 'string' ? architecture.modality : '';
  if (modality.includes('->')) {
    return modality.split('->').pop()?.trim() === 'text';
  }
  return modality.trim() === 'text';
}

function isFreeModel(model: any): boolean {
  const prompt = Number(model?.pricing?.prompt);
  const completion = Number(model?.pricing?.completion);
  if (Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0) {
    return true;
  }
  return typeof model?.id === 'string' && model.id.endsWith(':free');
}

function normalizeModel(model: any): OpenRouterTextModel | null {
  if (!model || typeof model.id !== 'string' || !model.id) return null;
  const description = typeof model.description === 'string' ? model.description.trim() : '';
  return {
    id: model.id,
    name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : model.id,
    description: description ? description.slice(0, 320) : null,
    contextLength:
      typeof model.context_length === 'number' && Number.isFinite(model.context_length)
        ? model.context_length
        : null,
    isFree: isFreeModel(model),
    promptPrice: model?.pricing?.prompt != null ? String(model.pricing.prompt) : null,
    completionPrice: model?.pricing?.completion != null ? String(model.pricing.completion) : null,
  };
}

/**
 * Fetch and filter the OpenRouter catalogue. Results are cached in-memory for
 * 30 minutes per Worker isolate.
 */
export async function fetchOpenRouterTextModels(apiKey?: string): Promise<OpenRouterTextModel[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(OPENROUTER_MODELS_URL, { headers });
  if (!response.ok) {
    throw new Error(`OpenRouter models request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: any[] };
  const models = (Array.isArray(payload.data) ? payload.data : [])
    .filter(isTextOutputModel)
    .map(normalizeModel)
    .filter((model): model is OpenRouterTextModel => model !== null)
    .sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  cache = { fetchedAt: Date.now(), models };
  return models;
}

/** Exposed for tests / admin responses. */
export function clearOpenRouterModelCache(): void {
  cache = null;
}
