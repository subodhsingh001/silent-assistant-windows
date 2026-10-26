const RETRYABLE_CODES = new Set([408, 429, 500, 502, 503, 504]);

function errorCode(error) {
  const direct = Number(error?.status || error?.code || error?.error?.code);
  if (direct >= 400) return direct;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 408;
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(error?.cause?.code)) return 408;
  const message = String(error?.message || error);
  const match = message.match(/"code"\s*:\s*(\d{3})/);
  if (match) return Number(match[1]);
  if (/operation was aborted|timed?\s*out|timeout/i.test(message)) return 408;
  if (/UNAVAILABLE|high demand/i.test(message)) return 503;
  if (/RESOURCE_EXHAUSTED/i.test(message)) return 429;
  return 0;
}

async function withGeminiRetry(request, {
  onRetry = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random,
  maxRetries = 3
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!RETRYABLE_CODES.has(errorCode(error)) || attempt >= maxRetries) throw error;
      const delayMs = 1000 * (2 ** attempt) + Math.floor(random() * 500);
      onRetry({ retry: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }
}

function friendlyGeminiError(operation, error) {
  const code = errorCode(error);
  if (code === 408) return `Gemini ${operation} timed out. The service did not finish in time; retry the saved audio or check your connection.`;
  if (RETRYABLE_CODES.has(code)) {
    return `Gemini is temporarily busy or rate limited (${code}). ${operation} could not finish after retries. Try again shortly.`;
  }
  if (code === 401 || code === 403) return 'Gemini rejected the API key or its permissions. Check your Gemini API configuration.';
  return `Gemini ${operation} failed: ${error instanceof Error ? error.message : String(error)}`;
}

async function generateWithFallback(ai, request, options = {}) {
  const models = [...new Set([options.primary || 'gemini-3.5-flash-lite', options.fallback || 'gemini-3.5-flash'])];
  let attempt = 0;
  return withGeminiRetry(async () => {
    const model = models[attempt++ % models.length];
    const thinkingConfig = options.lowLatency && /^(?:models\/)?gemini-(?:3\.5-flash-lite|3\.6-flash|3-flash-preview)(?:$|-)/.test(model)
      ? { thinkingLevel: 'minimal' }
      : undefined;
    const modelRequest = thinkingConfig
      ? { ...request, model, config: { ...request.config, thinkingConfig } }
      : { ...request, model };
    if (!options.stream) return ai.models.generateContent(modelRequest);
    let text = '';
    options.onPartial?.(text);
    const response = await ai.models.generateContentStream(modelRequest);
    for await (const chunk of response) {
      text += chunk.text || '';
      options.onPartial?.(text);
    }
    return { text };
  }, options);
}

module.exports = { withGeminiRetry, friendlyGeminiError, generateWithFallback };
