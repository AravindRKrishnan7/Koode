// Runtime configuration from environment variables. Never log key values.
const env = process.env;

function detectProvider() {
  if (env.KOODE_PROVIDER) return env.KOODE_PROVIDER.toLowerCase();
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return 'gemini';
  if (env.SARVAM_API_KEY) return 'sarvam';
  return 'mock';
}

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.0-flash',
  sarvam: 'sarvam-m',
  mock: 'mock-test-harness'
};

export function loadConfig() {
  const provider = detectProvider();
  return {
    port: Number(env.PORT || 8787),
    provider,
    model: env.KOODE_MODEL || DEFAULT_MODELS[provider] || 'unknown',
    timeoutMs: Number(env.KOODE_LLM_TIMEOUT_MS || 20000),
    logPayloads: env.KOODE_LOG !== '0',
    keys: {
      openai: env.OPENAI_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
      gemini: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
      sarvam: env.SARVAM_API_KEY
    },
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  };
}
