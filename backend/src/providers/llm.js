// Thin HTTP adapters for LLM providers (Node 20 fetch, no SDKs).
// Each returns the raw text completion for (system, user) messages.

async function post(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

async function openaiCompatible({ baseUrl, key, model, system, user, timeoutMs, jsonMode = true, extraHeaders = {} }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.1
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const data = await post(baseUrl + '/chat/completions', { Authorization: 'Bearer ' + key, ...extraHeaders }, body, timeoutMs);
  return data.choices?.[0]?.message?.content || '';
}

export async function complete(cfg, system, user) {
  const { provider, model, timeoutMs, keys } = cfg;
  switch (provider) {
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
