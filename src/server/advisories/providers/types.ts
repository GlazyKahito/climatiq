import type { ForecastBundle } from '../schema';

export type ProviderName = 'gemini' | 'anthropic' | 'template';

export type GenerateOptions = {
  /** Aborted by the orchestrator when the time budget (~20 s) is exhausted. */
  signal: AbortSignal;
  timeoutMs: number;
};

/**
 * An advisory provider turns a validated forecast bundle into advisory content.
 * Output is treated as untrusted: the orchestrator re-validates it (Zod + grounding checks) before use.
 */
export interface AdvisoryProvider {
  readonly name: ProviderName;
  readonly modelName: string;
  readonly promptVersion: string;
  generate(bundle: ForecastBundle, opts: GenerateOptions): Promise<unknown>;
}

/** The provider answered, but the answer is unusable (bad JSON, schema mismatch, ungrounded facts, refusal…). */
export class InvalidOutputError extends Error {}
