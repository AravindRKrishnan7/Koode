// Thin HTTP adapters for LLM providers (Node 20 fetch, no SDKs).
// Each returns the raw text completion for (system, user) messages.

const MAX_RATE_LIMIT_RETRIES = 4;
// Keep the total back-off well under the browser-side planner request lifetime (~30 s).
const MAX_RATE_LIMIT_WAIT_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Seconds to wait from a 429: Retry-After header, else "try again in 3.9s" / "720ms" in the body.
function retryAfterMs(res, text) {
  const h = Number(res.headers.get('retry-after'));
  if (h > 0) return h * 1000;
  const m = text.match(/try again in ([\d.]+)(ms|s)/);
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : 2000;
}

// meta.rateLimitWaitMs accumulates time spent backing off on 429s (reported separately from model latency).
async function post(url, headers, body, timeoutMs, meta = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
      const text = await res.text();
      const wait = res.status === 429 ? retryAfterMs(res, text) + 250 : 0;
      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES && (meta.rateLimitWaitMs || 0) + wait <= MAX_RATE_LIMIT_WAIT_MS) {
        meta.rateLimitWaitMs = (meta.rateLimitWaitMs || 0) + wait;
        await sleep(wait);
        continue;
      }
      if (res.status === 429) {
        // Out of back-off budget: tell the client how long to wait instead of a raw provider error.
        const err = new Error('model rate limit reached');
        err.code = 'rate_limited';
        err.retryAfterMs = wait;
        throw err;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    } finally {
      clearTimeout(t);
    }
  }
}

async function openaiCompatible({ baseUrl, key, model, system, user, timeoutMs, jsonMode = true, extraHeaders = {}, extraBody = {}, meta }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.1,
    ...extraBody
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const data = await post(baseUrl + '/chat/completions', { Authorization: 'Bearer ' + key, ...extraHeaders }, body, timeoutMs, meta);
  if (meta && data.usage) {
    meta.tokens = meta.tokens || { prompt: 0, completion: 0 };
    meta.tokens.prompt += data.usage.prompt_tokens || 0;
    meta.tokens.completion += data.usage.completion_tokens || 0;
  }
  return data.choices?.[0]?.message?.content || '';
}

export async function complete(cfg, system, user, meta = {}) {
  const { provider, model, timeoutMs, keys } = cfg;
  switch (provider) {
    case 'groq':
      // gpt-oss models are reasoning models; low effort keeps per-step latency down.
      return openaiCompatible({ baseUrl: cfg.groqBaseUrl, key: keys.groq, model, system, user, timeoutMs, meta,
        extraBody: /gpt-oss/.test(model) ? { reasoning_effort: cfg.reasoningEffort } : {} });
    case 'openai':
      return openaiCompatible({ baseUrl: cfg.openaiBaseUrl, key: keys.openai, model, system, user, timeoutMs });
    case 'sarvam':
      return openaiCompatible({ baseUrl: 'https://api.sarvam.ai/v1', key: keys.sarvam, model, system, user, timeoutMs, jsonMode: false,
        extraHeaders: { 'api-subscription-key': keys.sarvam } });
    case 'anthropic': {
      const data = await post('https://api.anthropic.com/v1/messages',
        { 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 600, temperature: 0.1, system, messages: [{ role: 'user', content: user }] }, timeoutMs);
      return (data.content || []).map((c) => c.text || '').join('');
    }
    case 'gemini': {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const data = await post(url, { 'x-goog-api-key': keys.gemini }, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      }, timeoutMs);
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    }
    default:
      throw new Error('unknown provider ' + provider);
  }
}
