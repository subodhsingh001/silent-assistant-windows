const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withGeminiRetry, friendlyGeminiError, generateWithFallback } = require('../gemini-retry');

test('503 retries the same request with backoff and returns the recovered result', async () => {
  let calls = 0;
  const delays = [];
  const notifications = [];
  const result = await withGeminiRetry(async () => {
    if (++calls < 4) throw new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}');
    return 'transcript';
  }, { sleep: async ms => delays.push(ms), random: () => 0, onRetry: info => notifications.push(info) });
  assert.equal(result, 'transcript');
  assert.equal(calls, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.deepEqual(notifications.map(info => info.retry), [1, 2, 3]);
});

test('persistent overload stops after four attempts', async () => {
  let calls = 0;
  await assert.rejects(withGeminiRetry(async () => {
    calls++;
    throw Object.assign(new Error('busy'), { status: 503 });
  }, { sleep: async () => {} }), /busy/);
  assert.equal(calls, 4);
});

test('SDK abort timeout retries against the alternate model', async () => {
  const models = [];
  const ai = { models: { generateContent: async request => {
    models.push(request.model);
    if (models.length === 1) throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    return { text: 'recovered' };
  } } };
  const result = await generateWithFallback(ai, { contents: 'Question' }, { sleep: async () => {} });
  assert.equal(result.text, 'recovered');
  assert.deepEqual(models, ['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
});

test('persistent timeout is bounded and gives an actionable error', async () => {
  let calls = 0;
  const error = new Error('This operation was aborted');
  await assert.rejects(withGeminiRetry(async () => { calls++; throw error; }, { sleep: async () => {} }), /aborted/);
  assert.equal(calls, 4);
  assert.match(friendlyGeminiError('live answer', error), /timed out/);
});

test('live requests can cap retries at one alternate model attempt', async () => {
  let calls = 0;
  await assert.rejects(withGeminiRetry(async () => {
    calls++;
    throw Object.assign(new Error('busy'), { status:503 });
  }, { maxRetries:1, sleep:async () => {} }), /busy/);
  assert.equal(calls, 2);
});

test('a failed stream restarts on the fallback without concatenating old partial text', async () => {
  const partials = [];
  const ai = { models: { generateContentStream: async function* ({model}) {
    if (model === 'first') {
      yield {text:'incomplete'};
      throw Object.assign(new Error('busy'),{status:503});
    }
    yield {text:'complete'};
  } } };
  const result = await generateWithFallback(ai, {}, {primary:'first',fallback:'second',stream:true,maxRetries:1,onPartial:text=>partials.push(text),sleep:async()=>{}});
  assert.equal(result.text, 'complete');
  assert.deepEqual(partials, ['', 'incomplete', '', 'complete']);
});

test('invalid credentials and malformed requests are not retried', async () => {
  for (const status of [400, 401, 403]) {
    let calls = 0;
    await assert.rejects(withGeminiRetry(async () => {
      calls++;
      throw Object.assign(new Error('rejected'), { status });
    }), /rejected/);
    assert.equal(calls, 1);
  }
});

test('429 is retried and busy errors have readable messages', async () => {
  let calls = 0;
  assert.equal(await withGeminiRetry(async () => {
    if (++calls === 1) throw { code: 429 };
    return 'ok';
  }, { sleep: async () => {} }), 'ok');
  assert.match(friendlyGeminiError('transcription', { code: 503 }), /temporarily busy/);
});

test('overloaded live model switches to a different model on the first retry', async () => {
  const models = [];
  const ai = { models: { generateContent: async request => {
    models.push(request.model);
    if (models.length === 1) throw { status: 503 };
    return { text: 'answer' };
  } } };
  const result = await generateWithFallback(ai, { contents: 'Question' }, { sleep: async () => {} });
  assert.deepEqual(models, ['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
  assert.equal(result.text, 'answer');
});

test('live thinking configuration is chosen separately for each supported model', async () => {
  const requests = [];
  const ai = {models:{generateContent: async request => {
    requests.push(request);
    if (requests.length === 1) throw {status:503};
    return {text:'ok'};
  }}};
  await generateWithFallback(ai, {}, {lowLatency:true,maxRetries:1,sleep:async()=>{}});
  assert.deepEqual(requests[0].config.thinkingConfig, {thinkingLevel:'minimal'});
  assert.equal(requests[1].config?.thinkingConfig, undefined);
});
