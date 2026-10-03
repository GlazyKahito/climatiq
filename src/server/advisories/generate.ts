/**
 * Advisory generation orchestrator.
 *
 * Provider = AI_PROVIDER env (`gemini` | `anthropic` | `template`). Whatever is configured, the result is validated:
 *   1. missing API key            → template, fallbackReason recorded
 *   2. provider error / ~20 s timeout → template, fallbackReason recorded
 *   3. output fails the Zod schema, mentions temperatures not in the bundle, or claims official warnings
 *                                  → template, fallbackReason recorded
 * Mandatory limitations (CLIMATIQ-generated, not IMD; replay notice …) are enforced on every advisory.
 */
import { ApiError as GeminiApiError } from '@google/genai';
import type { AdvisoryContent } from '../db/schema';
import { env } from '../config/env';
import { ungroundedTemperatures, unsupportedOfficialClaims, withMandatoryLimitations } from './guardrails';
import { AdvisoryContentSchema, type ForecastBundle } from './schema';
import { AnthropicProvider, describeAnthropicError } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { TemplateProvider, templateAdvisory } from './providers/template';
import { InvalidOutputError, type AdvisoryProvider, type ProviderName } from './providers/types';

export const DEFAULT_TIMEOUT_MS = 20_000;

export type GenerationResult = {
  content: AdvisoryContent;
  provider: ProviderName;
  modelName: string;
  promptVersion: string;
  /** Why the configured AI provider was not used (null when it was, or when the template is configured). */
  fallbackReason: string | null;
  /** The provider that was configured/attempted (equals `provider` unless a fallback happened). */
  requestedProvider: ProviderName;
  durationMs: number;
};

export type AiConfig = {
  AI_PROVIDER: ProviderName;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
};

/** Resolves the configured provider. Returns `provider: null` with a reason when it cannot be constructed. */
export function providerFromConfig(cfg: AiConfig = env()): { requested: ProviderName; provider: AdvisoryProvider | null; reason: string | null } {
  switch (cfg.AI_PROVIDER) {
    case 'gemini':
      return cfg.GEMINI_API_KEY
        ? { requested: 'gemini', provider: new GeminiProvider({ apiKey: cfg.GEMINI_API_KEY, model: cfg.GEMINI_MODEL }), reason: null }
        : { requested: 'gemini', provider: null, reason: 'AI_PROVIDER=gemini but GEMINI_API_KEY is not set' };
    case 'anthropic':
      return cfg.ANTHROPIC_API_KEY
        ? { requested: 'anthropic', provider: new AnthropicProvider({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.ANTHROPIC_MODEL }), reason: null }
        : { requested: 'anthropic', provider: null, reason: 'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set' };
    default:
      return { requested: 'template', provider: new TemplateProvider(), reason: null };
  }
}

class TimeoutError extends Error {}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError(`timed out after ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctrl.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function describeError(e: unknown): string {
  if (e instanceof TimeoutError || e instanceof InvalidOutputError) return e.message;
  const anthropic = describeAnthropicError(e);
  if (anthropic) return anthropic;
  if (e instanceof GeminiApiError) {
    if (e.status === 401 || e.status === 403) return `authentication/permission error (${e.status}) — check GEMINI_API_KEY`;
    if (e.status === 404) return 'model not found (check GEMINI_MODEL)';
    if (e.status === 429) return 'rate limited / free-tier quota exhausted (429)';
    return `API error ${e.status}`;
  }
  if (e instanceof Error && e.name === 'AbortError') return 'request aborted (timeout)';
  return e instanceof Error ? `error: ${e.message.slice(0, 160)}` : 'unknown error';
}

function templateResult(bundle: ForecastBundle, requested: ProviderName, reason: string | null, started: number): GenerationResult {
  const template = new TemplateProvider();
  return {
    content: AdvisoryContentSchema.parse(templateAdvisory(bundle)),
    provider: 'template',
    modelName: template.modelName,
    promptVersion: template.promptVersion,
    fallbackReason: reason,
    requestedProvider: requested,
    durationMs: Date.now() - started,
  };
}

export async function generateAdvisoryContent(
  bundle: ForecastBundle,
  opts: { provider?: AdvisoryProvider | null; unavailableReason?: string; timeoutMs?: number; config?: AiConfig } = {},
): Promise<GenerationResult> {
  const started = Date.now();
  const resolved =
    opts.provider !== undefined
      ? { requested: (opts.provider?.name ?? 'template') as ProviderName, provider: opts.provider, reason: opts.unavailableReason ?? null }
      : providerFromConfig(opts.config ?? env());

  if (!resolved.provider) {
    console.warn(`[advisories] ${resolved.reason ?? 'AI provider unavailable'} — using deterministic template`);
    return templateResult(bundle, resolved.requested, `${resolved.reason ?? 'AI provider unavailable'}; deterministic template used instead`, started);
  }
  if (resolved.provider.name === 'template') return templateResult(bundle, 'template', null, started);

  const provider = resolved.provider;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const raw = await withTimeout((signal) => provider.generate(bundle, { signal, timeoutMs }), timeoutMs);
    const parsed = AdvisoryContentSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new InvalidOutputError(`output failed schema validation (${first?.path.join('.') || 'root'}: ${first?.message ?? 'invalid'})`);
    }
    const ungrounded = ungroundedTemperatures(parsed.data, bundle);
    if (ungrounded.length) {
      throw new InvalidOutputError(`output mentioned temperatures not present in the forecast bundle (${ungrounded.slice(0, 5).join(', ')} °C)`);
    }
    const claims = unsupportedOfficialClaims(parsed.data, bundle);
    if (claims.length) throw new InvalidOutputError(`output implied an official warning that does not exist ("${claims[0]}")`);
    const content = AdvisoryContentSchema.parse(withMandatoryLimitations(parsed.data, bundle));
    return {
      content,
      provider: provider.name,
      modelName: provider.modelName,
      promptVersion: provider.promptVersion,
      fallbackReason: null,
      requestedProvider: provider.name,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const reason = `${provider.name} (${provider.modelName}) ${describeError(e)}; deterministic template used instead`;
    console.warn(`[advisories] ${reason}`);
    return templateResult(bundle, provider.name, reason, started);
  }
}
