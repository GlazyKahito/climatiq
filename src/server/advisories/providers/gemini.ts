/**
 * Google Gemini provider (default AI provider; free tier). Uses stateless `models.generateContent` with JSON
 * structured output (`responseMimeType: 'application/json'` + `responseJsonSchema`).
 *
 * Data-use caveat: on the Gemini free tier Google may use prompts/responses to improve its products and human
 * reviewers may read them. CLIMATIQ only ever sends the forecast bundle (public weather/forecast data, region names) —
 * never personal data.
 */
import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from '../prompt';
import type { ForecastBundle } from '../schema';
import { InvalidOutputError, type AdvisoryProvider, type GenerateOptions } from './types';

/** Minimal surface of the SDK client we use (lets tests inject a mock). */
export type GeminiClient = {
  models: { generateContent(params: GenerateContentParameters): Promise<{ text?: string | undefined }> };
};

/** JSON Schema for structured output — kept within the subset Gemini supports (types, enums, required, descriptions). */
export const ADVISORY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2–4 sentence overview for the intended audience.' },
    forecastDetails: { type: 'string', description: 'Region-by-region details using only numbers from the forecast bundle.' },
    contributingFactors: { type: 'array', items: { type: 'string' }, description: 'Why risk is elevated (2–6 items).' },
    recommendedActions: {
      type: 'array',
      description: '4–10 audience-appropriate actions.',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          audience: { type: 'string', description: 'Optional sub-group within the audience.' },
          priority: { type: 'string', enum: ['immediate', 'soon', 'routine'] },
        },
        required: ['action', 'priority'],
      },
    },
    uncertainty: { type: 'string', description: 'Heuristic confidence (not a probability), band and caveats.' },
    limitations: { type: 'array', items: { type: 'string' }, description: '3–6 limitations.' },
  },
  required: ['summary', 'forecastDetails', 'contributingFactors', 'recommendedActions', 'uncertainty', 'limitations'],
} as const;

export class GeminiProvider implements AdvisoryProvider {
  readonly name = 'gemini' as const;
  readonly promptVersion = PROMPT_VERSION;
  readonly modelName: string;
  private readonly client: GeminiClient;

  constructor(opts: { apiKey: string; model: string; client?: GeminiClient }) {
    this.modelName = opts.model;
    this.client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async generate(bundle: ForecastBundle, { signal, timeoutMs }: GenerateOptions): Promise<unknown> {
    const res = await this.client.models.generateContent({
      model: this.modelName,
      contents: buildUserPrompt(bundle),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: ADVISORY_JSON_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 4096,
        abortSignal: signal,
        httpOptions: { timeout: timeoutMs },
      },
    });
    const text = res.text?.trim();
    if (!text) throw new InvalidOutputError('empty response');
    try {
      return JSON.parse(text);
    } catch {
      throw new InvalidOutputError('response was not valid JSON');
    }
  }
}
