/**
 * Anthropic Claude provider (optional paid fallback; model from ANTHROPIC_MODEL, default `claude-haiku-4-5`).
 * Uses structured outputs via `client.messages.parse` + `zodOutputFormat`, so the response is parsed and validated
 * against the advisory schema by the SDK; the orchestrator re-validates and applies grounding checks anyway.
 *
 * No sampling or thinking parameters are sent, so the request stays valid if ANTHROPIC_MODEL is switched to a newer
 * model that rejects them.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from '../prompt';
import { AdvisoryContentSchema, type ForecastBundle } from '../schema';
import { InvalidOutputError, type AdvisoryProvider, type GenerateOptions } from './types';

type ParseParams = Parameters<Anthropic['messages']['parse']>[0];

/** Minimal surface of the SDK client we use (lets tests inject a mock). */
export type AnthropicClient = {
  messages: {
    parse(
      params: ParseParams,
      options?: { signal?: AbortSignal; timeout?: number },
    ): PromiseLike<{ parsed_output?: unknown; stop_reason: string | null }>;
  };
};

export class AnthropicProvider implements AdvisoryProvider {
  readonly name = 'anthropic' as const;
  readonly promptVersion = PROMPT_VERSION;
  readonly modelName: string;
  private readonly client: AnthropicClient;

  constructor(opts: { apiKey: string; model: string; client?: AnthropicClient }) {
    this.modelName = opts.model;
    // One SDK retry at most: the orchestrator owns the overall ~20 s budget and falls back to the template.
    this.client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey, maxRetries: 1 }) as unknown as AnthropicClient);
  }

  async generate(bundle: ForecastBundle, { signal, timeoutMs }: GenerateOptions): Promise<unknown> {
    const msg = await this.client.messages.parse(
      {
        model: this.modelName,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(bundle) }],
        output_config: { format: zodOutputFormat(AdvisoryContentSchema) },
      },
      { signal, timeout: timeoutMs },
    );
    if (msg.stop_reason === 'refusal') throw new InvalidOutputError('model declined the request (refusal)');
    if (msg.stop_reason === 'max_tokens') throw new InvalidOutputError('response truncated at max_tokens');
    if (msg.parsed_output == null) throw new InvalidOutputError('no structured output returned');
    return msg.parsed_output;
  }
}

/** Human-readable reason for an Anthropic SDK failure (typed errors, most specific first). */
export function describeAnthropicError(e: unknown): string | null {
  if (e instanceof Anthropic.AuthenticationError) return 'authentication failed (check ANTHROPIC_API_KEY)';
  if (e instanceof Anthropic.PermissionDeniedError) return 'permission denied for this model';
  if (e instanceof Anthropic.NotFoundError) return 'model not found (check ANTHROPIC_MODEL)';
  if (e instanceof Anthropic.RateLimitError) return 'rate limited (429)';
  if (e instanceof Anthropic.BadRequestError) return `request rejected (400): ${e.message.slice(0, 160)}`;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'request timed out';
  if (e instanceof Anthropic.APIConnectionError) return 'network error reaching the Anthropic API';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''}`.trim();
  return null;
}
