// Runtime configuration from environment variables. Never log key values.
const env = process.env;

function detectProvider() {
  if (env.KOODE_PROVIDER) return env.KOODE_PROVIDER.toLowerCase();
  if (env.GROQ_API_KEY) return 'groq';
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return 'gemini';
  if (env.SARVAM_API_KEY) return 'sarvam';
  return 'mock';
}

const DEFAULT_MODELS = {
  groq: 'openai/gpt-oss-20b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.0-flash',
  sarvam: 'sarvam-m',
  mock: 'mock-test-harness'
};

export function loadConfig() {
  const provider = detectProvider();
  // KOODE_REQUIRE_LLM=1: refuse to start on the mock planner (used for real-model testing).
  if (env.KOODE_REQUIRE_LLM === '1' && provider === 'mock') throw new Error('KOODE_REQUIRE_LLM=1 but no LLM provider key is set');
  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || '127.0.0.1',
    provider,
    model: env.KOODE_MODEL || DEFAULT_MODELS[provider] || 'unknown',
    timeoutMs: Number(env.KOODE_LLM_TIMEOUT_MS || 20000),
    logPayloads: env.KOODE_LOG !== '0',
    keys: {
      groq: env.GROQ_API_KEY,
      openai: env.OPENAI_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
      gemini: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
      sarvam: env.SARVAM_API_KEY
    },
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    groqBaseUrl: env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    reasoningEffort: env.KOODE_REASONING_EFFORT || 'low',
  // Voice (Sarvam): Saaras v4 speech-to-text, Bulbul text-to-speech.
  sttModel: env.KOODE_STT_MODEL || 'saaras:v4',
  sttLanguage: env.KOODE_STT_LANGUAGE || 'ml-IN',
  ttsModel: env.KOODE_TTS_MODEL || 'bulbul:v3',
  ttsSpeaker: env.KOODE_TTS_SPEAKER || '',
  speechTimeoutMs: Number(env.KOODE_SPEECH_TIMEOUT_MS || 20000)
  };
}
