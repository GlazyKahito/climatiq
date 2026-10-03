import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@google/genai';
import { AdvisoryContentSchema, ForecastBundleSchema, type AudienceKey, type ForecastBundle } from '@/server/advisories/schema';
import { templateAdvisory, TemplateProvider } from '@/server/advisories/providers/template';
import { GeminiProvider, type GeminiClient } from '@/server/advisories/providers/gemini';
import { AnthropicProvider, type AnthropicClient } from '@/server/advisories/providers/anthropic';
import { generateAdvisoryContent, providerFromConfig, type AiConfig } from '@/server/advisories/generate';
import { mandatoryLimitations, ungroundedTemperatures } from '@/server/advisories/guardrails';
import type { Severity } from '@/lib/domain';

const AUDIENCES: AudienceKey[] = ['government', 'disaster_mgmt', 'field_team', 'public'];

function day(date: string, h: number, tmax: number, severity: Severity, score: number, normal = 40.4) {
  return {
    targetDate: date,
    horizonDay: h,
    predictedTmaxC: tmax,
    lowerC: Math.round((tmax - 2.5) * 10) / 10,
    upperC: Math.round((tmax + 2.6) * 10) / 10,
    predictedTminC: 30.3,
    normalTmaxC: normal,
    departureC: Math.round((tmax - normal) * 10) / 10,
    severity,
    imdCriteria: severity === 'extreme' ? ('severe_heatwave' as const) : severity === 'high' ? ('heatwave' as const) : ('none' as const),
    confidence: score >= 0.62 ? ('high' as const) : score >= 0.42 ? ('medium' as const) : ('low' as const),
    confidenceScore: score,
    durationDays: severity === 'extreme' || severity === 'high' ? 2 : 0,
  };
}

function makeBundle(audience: AudienceKey, peak: Severity = 'extreme', scenario: 'replay' | 'live' = 'replay'): ForecastBundle {
  const tmax = peak === 'extreme' ? 47.1 : peak === 'high' ? 45.6 : peak === 'moderate' ? 43.2 : 38.4;
  const days = [day('2024-05-27', 1, tmax, peak, 0.75), day('2024-05-28', 2, tmax - 0.6, peak === 'extreme' ? 'high' : peak, 0.64), day('2024-05-29', 3, 41.0, 'low', 0.5)];
  const bundle: ForecastBundle = {
    bundleVersion: 'forecast-bundle-v1',
    builtAt: '2026-10-03T10:00:00.000Z',
    audience,
    run: {
      id: '76344827-7cee-4693-bd24-f251c398549b',
      scenario,
      scenarioLabel: scenario === 'replay' ? 'Historical replay' : 'Live',
      issuedFor: '2024-05-26',
      horizonDays: 7,
      isHindcast: scenario === 'replay',
      modelKey: 'baseline-v1',
      modelName: 'CLIMATIQ Baseline v1',
      createdAt: '2026-10-03T09:00:00.000Z',
      inputs: { nwp: 'Open-Meteo Previous Runs API', history: 'ERA5' },
    },
    window: { from: '2024-05-27', to: '2024-05-29', days: 3 },
    summary: {
      peakSeverity: peak,
      peakRegionCode: 'IN-RJ-CHURU',
      peakDate: '2024-05-27',
      peakTmaxC: tmax,
      maxDepartureC: days[0].departureC,
      maxDurationDays: days[0].durationDays,
      confidence: 'high',
      confidenceScore: 0.75,
      regionsAtOrAboveHigh: peak === 'extreme' || peak === 'high' ? 1 : 0,
    },
    regions: [
      {
        code: 'IN-RJ-CHURU',
        name: 'Churu',
        level: 'district',
        parentName: 'Rajasthan',
        climateZone: 'plains',
        resolution: 'district-centroid (point)',
        peak: days[0],
        days,
        factors: [
          { key: 'classification', label: 'Classification rule', value: peak.toUpperCase(), impact: 'neutral', detail: `Tmax ${tmax.toFixed(1)} °C ≥ 40 °C and above normal` },
          { key: 'departure', label: 'Departure from reference normal', value: `+${days[0].departureC} °C`, impact: 'raises', detail: 'Reference normal for this date is 40.4 °C (5-year ERA5-based climatology).' },
          { key: 'nwp', label: 'Numerical weather guidance', value: '47.6 °C', impact: 'raises', detail: 'Open-Meteo NWP guidance weighted at 85 % for day 1.' },
          { key: 'warm_night', label: 'Warm night', value: '30.3 °C min', impact: 'raises', detail: 'Little night-time relief increases cumulative heat stress.' },
        ],
        inputKinds: ['reanalysis', 'climatology', 'nwp_forecast'],
      },
    ],
    dataSources: [
      { key: 'climatiq-baseline', name: 'CLIMATIQ baseline-v1 model', sourceKind: 'model', dataKind: 'model_forecast', url: '/methodology', attribution: null, role: 'forecast' },
      { key: 'open-meteo-archive', name: 'Open-Meteo Historical Weather API (ERA5 reanalysis)', sourceKind: 'external_api', dataKind: 'reanalysis', url: 'https://open-meteo.com', attribution: null, role: 'history' },
    ],
    officialWarnings: { count: 0, note: 'No verified official warnings.' },
    notes: [],
  };
  return ForecastBundleSchema.parse(bundle);
}

/** A well-formed LLM answer that only uses bundle numbers. */
function goodAnswer() {
  return {
    summary: 'Historical replay: Extreme heat risk is forecast for Churu on 27 May 2024 with a peak of 47.1 °C. This is CLIMATIQ decision support, not an IMD warning.',
    forecastDetails: 'Churu district, Rajasthan: peak 47.1 °C (band 44.6 °C–49.7 °C), +6.7 °C above the reference normal of 40.4 °C; 2-day spell.',
    contributingFactors: ['Departure from reference normal of +6.7 °C', 'Warm nights near 30.3 °C'],
    recommendedActions: [
      { action: 'Activate the heat action plan after checking IMD bulletins.', priority: 'immediate' },
      { action: 'Pre-position ORS and drinking water.', audience: 'Health', priority: 'soon' },
    ],
    uncertainty: 'Confidence is high (heuristic score 0.75 — not a probability); band 44.6–49.7 °C.',
    limitations: ['CLIMATIQ-generated decision support.'],
  };
}

const CFG = (over: Partial<AiConfig>): AiConfig => ({ AI_PROVIDER: 'template', GEMINI_MODEL: 'gemini-3.5-flash-lite', ANTHROPIC_MODEL: 'claude-haiku-4-5', ...over });

describe('template provider', () => {
  for (const audience of AUDIENCES) {
    for (const sev of ['extreme', 'high', 'moderate', 'low'] as Severity[]) {
      it(`produces schema-valid, grounded content for ${audience} / ${sev}`, () => {
        const b = makeBundle(audience, sev);
        const c = templateAdvisory(b);
        expect(AdvisoryContentSchema.safeParse(c).success).toBe(true);
        expect(ungroundedTemperatures(c, b)).toEqual([]);
        expect(c.recommendedActions.length).toBeGreaterThanOrEqual(2);
        for (const l of mandatoryLimitations(b)) expect(c.limitations).toContain(l);
      });
    }
  }

  it('labels replay content as a historical replay and never claims an official warning', () => {
    const c = templateAdvisory(makeBundle('government'));
    expect(c.summary).toMatch(/Historical replay/);
    expect(c.limitations.join(' ')).toMatch(/not an official IMD warning/);
    expect(`${c.summary} ${c.forecastDetails}`).not.toMatch(/IMD (has )?issued|red alert|orange alert/i);
  });

  it('writes audience-specific text', () => {
    const pub = templateAdvisory(makeBundle('public'));
    const field = templateAdvisory(makeBundle('field_team'));
    const gov = templateAdvisory(makeBundle('government'));
    expect(pub.recommendedActions.some((a) => /112/.test(a.action))).toBe(true);
    expect(pub.forecastDetails).not.toMatch(/band|reference normal/); // plain language for the public
    expect(field.recommendedActions.some((a) => /pairs/i.test(a.action))).toBe(true);
    expect(gov.recommendedActions.some((a) => /heat action/i.test(a.action))).toBe(true);
    expect(gov.forecastDetails).toMatch(/47\.1 °C/);
  });

  it('live bundles are not called replays', () => {
    const c = templateAdvisory(makeBundle('disaster_mgmt', 'high', 'live'));
    expect(c.summary).not.toMatch(/replay/i);
    expect(c.limitations.join(' ')).not.toMatch(/Historical replay/);
  });
});

describe('provider selection & fallback', () => {
  it('uses the template provider without a fallback reason when configured', async () => {
    const r = await generateAdvisoryContent(makeBundle('public'), { config: CFG({ AI_PROVIDER: 'template' }) });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toBeNull();
  });

  it('falls back to the template when the Gemini key is missing', async () => {
    expect(providerFromConfig(CFG({ AI_PROVIDER: 'gemini' })).provider).toBeNull();
    const r = await generateAdvisoryContent(makeBundle('public'), { config: CFG({ AI_PROVIDER: 'gemini' }) });
    expect(r.provider).toBe('template');
    expect(r.requestedProvider).toBe('gemini');
    expect(r.fallbackReason).toMatch(/GEMINI_API_KEY is not set/);
  });

  it('falls back to the template when the Anthropic key is missing', async () => {
    const r = await generateAdvisoryContent(makeBundle('field_team'), { config: CFG({ AI_PROVIDER: 'anthropic' }) });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/ANTHROPIC_API_KEY is not set/);
  });

  it('builds real provider instances when keys exist', () => {
    expect(providerFromConfig(CFG({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' })).provider?.name).toBe('gemini');
    expect(providerFromConfig(CFG({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).provider?.modelName).toBe('claude-haiku-4-5');
  });
});

function gemini(impl: GeminiClient['models']['generateContent']) {
  const generateContent = vi.fn(impl);
  return { provider: new GeminiProvider({ apiKey: 'test', model: 'gemini-3.5-flash-lite', client: { models: { generateContent } } }), generateContent };
}

describe('Gemini provider (mocked SDK)', () => {
  it('requests JSON structured output and accepts grounded content', async () => {
    const { provider, generateContent } = gemini(async () => ({ text: JSON.stringify(goodAnswer()) }));
    const b = makeBundle('government');
    const r = await generateAdvisoryContent(b, { provider });
    expect(r.provider).toBe('gemini');
    expect(r.modelName).toBe('gemini-3.5-flash-lite');
    expect(r.fallbackReason).toBeNull();
    const params = generateContent.mock.calls[0][0];
    expect(params.config?.responseMimeType).toBe('application/json');
    expect(params.config?.responseJsonSchema).toBeTruthy();
    expect(String(params.config?.systemInstruction)).toMatch(/Use ONLY the facts/);
    expect(String(params.contents)).toContain('"bundleVersion":"forecast-bundle-v1"');
    // Server-enforced limitations are added even if the model omitted them.
    for (const l of mandatoryLimitations(b)) expect(r.content.limitations).toContain(l);
  });

  it('falls back when the response is not JSON', async () => {
    const { provider } = gemini(async () => ({ text: 'Sure! Here is your advisory…' }));
    const r = await generateAdvisoryContent(makeBundle('public'), { provider });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/gemini .*not valid JSON/);
  });

  it('falls back when the SDK throws (rate limit)', async () => {
    const { provider } = gemini(async () => {
      throw new ApiError({ message: 'quota', status: 429 });
    });
    const r = await generateAdvisoryContent(makeBundle('public'), { provider });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/429/);
  });

  it('falls back on timeout', async () => {
    const { provider } = gemini(() => new Promise(() => {}));
    const r = await generateAdvisoryContent(makeBundle('public'), { provider, timeoutMs: 30 });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/timed out/);
  });

  it('rejects output that fails the schema', async () => {
    const { provider } = gemini(async () => ({ text: JSON.stringify({ ...goodAnswer(), recommendedActions: [] }) }));
    const r = await generateAdvisoryContent(makeBundle('public'), { provider });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/schema validation/);
  });

  it('rejects invented temperatures', async () => {
    const bad = { ...goodAnswer(), forecastDetails: 'Churu may reach 52.3 °C on 27 May 2024, an all-time record.' };
    const { provider } = gemini(async () => ({ text: JSON.stringify(bad) }));
    const r = await generateAdvisoryContent(makeBundle('government'), { provider });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/not present in the forecast bundle \(52\.3/);
  });

  it('rejects claims of official warnings that do not exist', async () => {
    const bad = { ...goodAnswer(), summary: 'IMD has issued a red alert for Churu; extreme heat of 47.1 °C is expected on 27 May 2024.' };
    const { provider } = gemini(async () => ({ text: JSON.stringify(bad) }));
    const r = await generateAdvisoryContent(makeBundle('government'), { provider });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/official warning/);
  });
});

function anthropic(impl: (...args: Parameters<AnthropicClient['messages']['parse']>) => Promise<{ parsed_output?: unknown; stop_reason: string | null }>) {
  const parse = vi.fn(impl);
  return { provider: new AnthropicProvider({ apiKey: 'test', model: 'claude-haiku-4-5', client: { messages: { parse } } }), parse };
}

describe('Anthropic provider (mocked SDK)', () => {
  it('uses structured outputs and accepts parsed content', async () => {
    const { provider, parse } = anthropic(async () => ({ parsed_output: goodAnswer(), stop_reason: 'end_turn' }));
    const r = await generateAdvisoryContent(makeBundle('disaster_mgmt'), { provider });
    expect(r.provider).toBe('anthropic');
    expect(r.modelName).toBe('claude-haiku-4-5');
    const [params, options] = parse.mock.calls[0];
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.output_config?.format).toBeTruthy();
    expect(String(params.system)).toMatch(/not an IMD warning/);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back on refusal', async () => {
    const { provider } = anthropic(async () => ({ parsed_output: null, stop_reason: 'refusal' }));
    const r = await generateAdvisoryContent(makeBundle('public'), { provider });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/anthropic .*refusal/);
  });

  it('falls back when the client throws', async () => {
    const { provider } = anthropic(async () => {
      throw new Error('socket hang up');
    });
    const r = await generateAdvisoryContent(makeBundle('public'), { provider });
    expect(r.provider).toBe('template');
    expect(r.fallbackReason).toMatch(/socket hang up/);
    expect(AdvisoryContentSchema.safeParse(r.content).success).toBe(true);
  });
});

describe('TemplateProvider class', () => {
  it('implements the provider interface', async () => {
    const p = new TemplateProvider();
    const out = await p.generate(makeBundle('public'));
    expect(p.name).toBe('template');
    expect(AdvisoryContentSchema.safeParse(out).success).toBe(true);
  });
});
