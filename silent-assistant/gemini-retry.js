const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

function errorCode(error) {
  const direct = Number(error?.status || error?.code || error?.error?.code);
  if (direct >= 400) return direct;
  const message = String(error?.message || error);
  const match = message.match(/"code"\s*:\s*(\d{3})/);
  if (match) return Number(match[1]);
  if (/UNAVAILABLE|high demand/i.test(message)) return 503;
  if (/RESOURCE_EXHAUSTED/i.test(message)) return 429;
  return 0;
}

async function withGeminiRetry(request, {
  onRetry = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!RETRYABLE_CODES.has(errorCode(error)) || attempt >= 3) throw error;
      const delayMs = 1000 * (2 ** attempt) + Math.floor(random() * 500);
      onRetry({ retry: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }
}

function friendlyGeminiError(operation, error) {
  const code = errorCode(error);
  if (RETRYABLE_CODES.has(code)) {
    return `Gemini is temporarily busy or rate limited (${code}). ${operation} could not finish after retries. Try again shortly.`;
  }
  if (code === 401 || code === 403) return 'Gemini rejected the API key or its permissions. Check your Gemini API configuration.';
  return `Gemini ${operation} failed: ${error instanceof Error ? error.message : String(error)}`;
}

async function generateWithFallback(ai, request, options = {}) {
  const models = [...new Set([options.primary || 'gemini-3.5-flash-lite', options.fallback || 'gemini-3.5-flash'])];
  let attempt = 0;
  return withGeminiRetry(() => {
    const model = models[attempt++ % models.length];
    return ai.models.generateContent({ ...request, model });
  }, options);
}

module.exports = { withGeminiRetry, friendlyGeminiError, generateWithFallback };
