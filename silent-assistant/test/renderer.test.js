const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderer(invoke) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', value: '', checked: true, disabled: false,
      classList: { toggle() {} }, addEventListener() {}, querySelector: () => null,
      appendChild() {}, scrollHeight: 0, scrollTop: 0
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    require: () => ({ ipcRenderer: { on() {}, invoke } }),
    document: { getElementById: get, createElement: () => ({ textContent: '' }), body: get('body') },
    console, Uint8Array, Blob, Date,
    btoa: data => Buffer.from(data, 'binary').toString('base64')
  });
  const script = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);
  return { get, run: code => vm.runInContext(code, context) };
}

test('older Electron protection status explains the unavailable getter without claiming verification', () => {
  const app = loadRenderer(async () => {});
  app.run('displayProtectionStatus(null)');
  assert.match(app.get('privacy-status').textContent, /requested/);
  assert.match(app.get('privacy-status').textContent, /cannot query its status/);
  app.run('displayProtectionStatus(false)');
  assert.match(app.get('privacy-status').textContent, /could not be confirmed/);
  app.run('displayProtectionStatus(true)');
  assert.match(app.get('privacy-status').textContent, /is enabled/);
});

test('captured questions automatically display an answer without a button click', async () => {
  const calls = [];
  const app = loadRenderer(async (channel, payload) => {
    calls.push({ channel, payload });
    return { transcript: 'What is a binary tree?', question: 'What is a binary tree?', answer: 'Each node has at most two children.' };
  });
  await app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:0})");
  assert.equal(calls[0].channel, 'analyze-audio');
  assert.equal(app.get('answer').textContent, 'Each node has at most two children.');
  assert.equal(app.get('question').textContent, 'What is a binary tree?');
});

test('silence leaves the last answer visible and explains why no new answer appeared', async () => {
  const app = loadRenderer(async () => ({ transcript: '', question: '', answer: '' }));
  app.get('answer').textContent = 'Previous answer';
  await app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:0})");
  assert.equal(app.get('answer').textContent, 'Previous answer');
  assert.match(app.get('answer-status').textContent, /No intelligible speech/);
});

test('failed live audio stays available and retry displays a recovered answer', async () => {
  let calls = 0;
  const app = loadRenderer(async () => {
    if (++calls === 1) throw new Error('Gemini busy');
    return { transcript: 'Question?', question: 'Question?', answer: 'Recovered answer' };
  });
  app.run("queueChunk({blob:new Blob(['audio']), elapsedSeconds:0})");
  await app.run('transcriptionQueue');
  assert.equal(app.run('failedChunks.length'), 1);
  assert.match(app.get('answer-status').textContent, /saved for retry/);
  await app.run('retryFailedChunks()');
  assert.equal(app.run('failedChunks.length'), 0);
  assert.equal(app.get('answer').textContent, 'Recovered answer');
});

test('typed questions work without starting audio capture', async () => {
  const calls = [];
  const app = loadRenderer(async (channel, input) => {
    calls.push({ channel, input });
    return 'English response';
  });
  await app.run("draftAnswer('Explain binary trees')");
  assert.deepEqual(calls, [{ channel: 'draft-answer', input: 'Explain binary trees' }]);
  assert.equal(app.get('answer').textContent, 'English response');
  assert.equal(app.get('ask-button').disabled, false);
});
