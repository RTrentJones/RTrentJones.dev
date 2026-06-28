// Vendor-agnostic generation adapters. The whole point: target many providers' FREE tiers (Gemini,
// Grok, …) — not just Anthropic. Most vendors expose an OpenAI-compatible endpoint, so one `openai`-SDK
// adapter (parameterized by baseURL) covers Gemini/Grok/Groq/Together/OpenAI; Anthropic gets its own
// adapter since it isn't OpenAI-compatible. Each provider is gated on its own env key and fails soft.

export interface GenResult {
  output: string;
  tokensIn: number;
  tokensOut: number;
}

type Kind = 'openai' | 'anthropic';

export interface Provider {
  id: string; // 'gemini' | 'grok' | 'anthropic' | ...
  label: string;
  kind: Kind;
  envKey: string; // env var holding the API key
  defaultModel: string; // the one model /api/run exercises for this provider
  baseURL?: string; // openai-compat endpoint (kind: 'openai')
  rate: { in: number; out: number }; // USD per 1M tokens; {0,0} for free tiers
}

// Registry. `rate` is best-effort for cost display; free tiers are 0. Add a vendor by appending a row.
export const PROVIDERS: Provider[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    rate: { in: 0, out: 0 }, // AI Studio free tier
  },
  {
    id: 'grok',
    label: 'xAI Grok',
    kind: 'openai',
    envKey: 'XAI_API_KEY',
    defaultModel: 'grok-4',
    baseURL: 'https://api.x.ai/v1',
    rate: { in: 0, out: 0 }, // free credits where available; informational only
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-4-8',
    rate: { in: 5, out: 25 },
  },
];

/** Providers whose API key is present in the env — the only ones /api/run will exercise. */
export function enabledProviders(): Provider[] {
  return PROVIDERS.filter((p) => Boolean(process.env[p.envKey]));
}

export function costUsd(p: Provider, tokensIn: number, tokensOut: number): number {
  return (tokensIn * p.rate.in + tokensOut * p.rate.out) / 1_000_000;
}

// Per-call wall-clock cap. /api/run has maxDuration=60 and fans across providers, so a single hung
// vendor must fail SOFT (into errors[]) well before the function is killed — otherwise a partial run
// rides the timeout to a hard kill *after* some providers already committed. 30s leaves headroom.
const GEN_TIMEOUT_MS = 30_000;

/** Generate a completion for `prompt` from `p`'s default model (or an override). */
export async function generate(p: Provider, prompt: string, model = p.defaultModel): Promise<GenResult> {
  const apiKey = process.env[p.envKey] ?? '';
  if (p.kind === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create(
      {
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: AbortSignal.timeout(GEN_TIMEOUT_MS) },
    );
    const output = r.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { output, tokensIn: r.usage.input_tokens, tokensOut: r.usage.output_tokens };
  }
  // openai-compatible
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: p.baseURL });
  const r = await client.chat.completions.create(
    {
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    },
    { signal: AbortSignal.timeout(GEN_TIMEOUT_MS) },
  );
  return {
    output: r.choices[0]?.message?.content ?? '',
    tokensIn: r.usage?.prompt_tokens ?? 0,
    tokensOut: r.usage?.completion_tokens ?? 0,
  };
}

/**
 * Pick a judge: prefer a free OpenAI-compatible provider (Gemini) so the whole eval can cost $0; else
 * any enabled provider. Returns the provider to drive the LLM-judge step, or null when none is enabled.
 *
 * `subjectId` is the provider currently under test: we exclude it so a model doesn't grade its own
 * output (self-grading bias), falling back to the subject only when it's the sole enabled provider.
 */
export function pickJudge(subjectId?: string): Provider | null {
  const enabled = enabledProviders();
  const others = enabled.filter((p) => p.id !== subjectId);
  const pool = others.length > 0 ? others : enabled;
  return (
    pool.find((p) => p.id === 'gemini') ??
    pool.find((p) => p.kind === 'openai') ??
    pool[0] ??
    null
  );
}
