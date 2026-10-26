const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderer(invoke) {
  const elements = new Map();
  const listeners = {};
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', value: '', checked: true, disabled: false,
      classList: { toggle() {} }, addEventListener() {}, querySelector: () => null,
      children: [], appendChild(child) { this.children.push(child); }, scrollHeight: 0, scrollTop: 0
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    require: () => ({ ipcRenderer: { on: (name, callback) => { listeners[name] = callback; }, invoke } }),
    document: { getElementById: get, createElement: () => ({ textContent: '' }), body: get('body') },
    console, Uint8Array, Blob, Date,
    btoa: data => Buffer.from(data, 'binary').toString('base64')
  });
  const script = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);
  return { get, run: code => vm.runInContext(code, context), emit: (name, body) => listeners[name]?.({}, body) };
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

test('silence preserves the last completed question and answer with a clear status', async () => {
  const app = loadRenderer(async () => ({ transcript: '', question: '', answer: '' }));
  app.run("showCompletedAnswer('Previous question', 'Previous answer', '0:01')");
  await app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:0})");
  assert.equal(app.get('answer').textContent, 'Previous answer');
  assert.equal(app.get('question').textContent, 'Previous question');
  assert.match(app.get('answer-status').textContent, /No intelligible speech/);
});

test('filler speech does not erase an answered question', async () => {
  const app = loadRenderer(async () => ({ transcript: 'Let me explain the next topic.', question: '', answer: '' }));
  app.run("showCompletedAnswer('Previous question', 'Answer to the previous question', '0:01')");
  await app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:12})");
  assert.equal(app.get('question').textContent, 'Previous question');
  assert.equal(app.get('answer').textContent, 'Answer to the previous question');
  assert.equal(app.get('answer-history').children.length, 1);
});

test('a clear transcript question is answered when the model omits question and answer fields', async () => {
  const calls = [];
  const question = 'What is the difference between deep copy and shallow copy?';
  const app = loadRenderer(async (channel, input) => {
    calls.push({channel, input});
    if (channel === 'analyze-audio') return { transcript: question, question: '', answer: '' };
    return 'A deep copy copies nested objects; a shallow copy shares nested object references.';
  });
  await app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:7})");
  await app.run('fallbackAnswerPromise');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].channel, 'draft-answer');
  assert.equal(calls[1].input, question);
  assert.match(app.get('answer').textContent, /nested objects/);
  assert.equal(app.get('question').textContent, question);
  assert.equal(app.get('answer-history').children.length, 1);
});

test('new processing keeps completed answers visible and history retains both questions', async () => {
  let finish;
  const app = loadRenderer(() => new Promise(resolve => { finish = resolve; }));
  app.run("showCompletedAnswer('Deep copy?', 'Copies nested objects.', '0:07')");
  const pending = app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:173})");
  // Let blob conversion and the IPC request start.
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.get('answer').textContent, 'Copies nested objects.');
  assert.equal(app.get('question').textContent, 'Deep copy?');
  finish({transcript:'What is TypeScript?',question:'What is TypeScript?',answer:'JavaScript with static types.'});
  await pending;
  assert.equal(app.get('answer').textContent, 'JavaScript with static types.');
  assert.equal(app.get('answer-history').children.length, 2);
});

test('streamed answers display before the request completes and stale streams are ignored', async () => {
  let finish;
  let requestId;
  const app = loadRenderer((_channel, request) => {
    requestId = request.requestId;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:0})");
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  app.emit('live-answer-partial', {requestId,transcript:'Explain TypeScript.',question:'Explain TypeScript.',answer:'TypeScript adds types.'});
  assert.equal(app.get('answer').textContent, 'TypeScript adds types.');
  assert.match(app.get('answer-status').textContent, /arriving/);
  app.emit('live-answer-partial', {requestId:requestId-1,transcript:'Old',question:'Old?',answer:'Stale'});
  assert.notEqual(app.get('answer').textContent, 'Stale');
  finish({transcript:'Explain TypeScript.',question:'Explain TypeScript.',answer:'TypeScript adds types. const n: number = 1;'});
  await pending;
  assert.match(app.get('answer').textContent, /const n/);
});

test('an answer without matching new speech and a detected question is not displayed', async () => {
  const app = loadRenderer(async () => ({ transcript: '', question: 'Invented question?', answer: 'Unrelated answer' }));
  await app.run("transcribeChunk({blob:new Blob(['audio']), elapsedSeconds:0})");
  assert.notEqual(app.get('answer').textContent, 'Unrelated answer');
});

test('speech sends after a pause without waiting for the old six-second block', () => {
  const app = loadRenderer(async () => {});
  assert.equal(app.run('speechPauseReady(1700, 0, 400, 10)'), false);
  assert.equal(app.run('speechPauseReady(2400, 0, 1400, 10)'), false);
  assert.equal(app.run('speechPauseReady(2500, 0, 1400, 10)'), true);
  assert.equal(app.run('speechPauseReady(2500, 0, 1400, 1)'), false);
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

test('manual answer never invents a question from an old transcript', async () => {
  const calls = [];
  const app = loadRenderer(async (...args) => { calls.push(args); return 'Answer'; });
  app.run("transcriptText = 'An old unrelated topic';");
  await app.run('draftAnswer()');
  assert.equal(calls.length, 0);
  assert.match(app.get('answer-status').textContent, /complete question/);
});

test('a failed request clears the old question and answer while keeping retry audio', async () => {
  const app = loadRenderer(async () => { throw new Error('timed out'); });
  app.get('question').textContent = 'Old question';
  app.get('answer').textContent = 'Old answer';
  app.run("queueChunk({blob:new Blob(['audio']), elapsedSeconds:1})");
  await app.run('transcriptionQueue');
  assert.equal(app.get('question').textContent, '');
  assert.match(app.get('answer').textContent, /No answer received/);
  assert.equal(app.run('failedChunks.length'), 1);
});

test('a semantic duplicate marked SKIP preserves the current answer and its history', async () => {
  let payload;
  const app = loadRenderer(async (_channel, data) => {
    payload = data;
    return {transcript:'Can you describe JavaScript?',question:'Can you describe JavaScript?',answer:'[SKIP]'};
  });
  app.run("showCompletedAnswer('What is JavaScript?', 'A programming language.', '0:01')");
  await app.run("transcribeChunk({blob:new Blob(['audio']),elapsedSeconds:2})");
  assert.equal(payload.alreadyAnswered[0], 'What is JavaScript?');
  assert.equal(app.get('answer').textContent, 'A programming language.');
  assert.equal(app.get('answer-history').children.length, 1);
});

test('WAIT never triggers the question-mark fallback or enters answer history', async () => {
  const calls = [];
  const app = loadRenderer(async (...args) => {
    calls.push(args);
    return {transcript:'What is the difference?',question:'',answer:'[WAIT]'};
  });
  await app.run("transcribeChunk({blob:new Blob(['audio']),elapsedSeconds:0})");
  assert.equal(calls.length, 1);
  assert.equal(app.get('answer-history').children.length, 0);
  assert.notEqual(app.get('answer').textContent, '[WAIT]');
});

test('filler and stutters do not create an exact duplicate, and a substantive follow-up stays new', async () => {
  const app = loadRenderer(async () => ({transcript:'Uh what what is JavaScript?',question:'Uh what what is JavaScript?',answer:'Repeated answer'}));
  app.run("showCompletedAnswer('What is JavaScript?', 'A programming language.', '0:01')");
  await app.run("transcribeChunk({blob:new Blob(['audio']),elapsedSeconds:2})");
  assert.equal(app.get('answer-history').children.length, 1);
  assert.equal(app.run("alreadyAnswered('How does JavaScript differ from TypeScript?')"), false);
});

test('streaming control markers are withheld even across partial token boundaries', async () => {
  let finish;
  let requestId;
  const app = loadRenderer((_channel, data) => {requestId=data.requestId;return new Promise(resolve=>{finish=resolve;});});
  const request = app.run("transcribeChunk({blob:new Blob(['audio']),elapsedSeconds:0})");
  while (!finish) await new Promise(resolve=>setImmediate(resolve));
  for (const answer of ['[', '[W', '[WAIT]']) app.emit('live-answer-partial',{requestId,transcript:'What is',question:'What is',answer});
  assert.equal(app.get('answer').textContent, '');
  finish({transcript:'What is',question:'',answer:'[WAIT]'});
  await request;
  assert.equal(app.get('answer-history').children.length, 0);
});

test('chunks arriving during a request are sent together in the next request', async () => {
  let finishFirst;
  const requests = [];
  const empty = {transcript:'',question:'',answer:''};
  const app = loadRenderer((_channel, payload) => {
    requests.push(payload);
    return requests.length === 1 ? new Promise(resolve=>{finishFirst=resolve;}) : Promise.resolve(empty);
  });
  app.run("queueChunk({blob:new Blob(['first']),elapsedSeconds:0})");
  while (!finishFirst) await new Promise(resolve=>setImmediate(resolve));
  app.run("queueChunk({blob:new Blob(['second']),elapsedSeconds:2}); queueChunk({blob:new Blob(['third']),elapsedSeconds:4})");
  finishFirst(empty);
  await app.run('waitForTranscription()');
  assert.equal(requests.length, 2);
  assert.deepEqual(Array.from(requests[1].chunks), [Buffer.from('second').toString('base64'),Buffer.from('third').toString('base64')]);
  assert.equal(app.run('pendingChunks'), 0);
  app.run("queueChunk({blob:new Blob(['after idle']),elapsedSeconds:6})");
  await app.run('waitForTranscription()');
  assert.equal(requests.length, 3);
});

test('a failed batch retains every original recording and retries them together', async () => {
  let count = 0;
  const requests = [];
  const app = loadRenderer(async (_channel, payload) => {
    requests.push(payload);
    if (++count === 1) throw new Error('busy');
    return {transcript:'',question:'',answer:''};
  });
  app.run("queueChunk({blob:new Blob(['one']),elapsedSeconds:0}); queueChunk({blob:new Blob(['two']),elapsedSeconds:2})");
  await app.run('waitForTranscription()');
  assert.equal(app.run('failedChunks.length'), 2);
  await app.run('retryFailedChunks()');
  assert.equal(app.run('failedChunks.length'), 0);
  assert.equal(requests[0].chunks.length, 2);
  assert.deepEqual(Array.from(requests[1].chunks), Array.from(requests[0].chunks));
});

test('fallback text requests do not block audio and cannot overwrite a newer answered question', async () => {
  let finishOldAnswer;
  let audioCalls = 0;
  const app = loadRenderer((channel) => {
    if (channel === 'draft-answer') return new Promise(resolve=>{finishOldAnswer=resolve;});
    if (++audioCalls === 1) return Promise.resolve({transcript:'What is JavaScript?',question:'What is JavaScript?',answer:''});
    return Promise.resolve({transcript:'What is Python?',question:'What is Python?',answer:'A different programming language.'});
  });
  app.run("queueChunk({blob:new Blob(['one']),elapsedSeconds:0})");
  await app.run('waitForTranscription()');
  assert.ok(finishOldAnswer);
  app.run("queueChunk({blob:new Blob(['two']),elapsedSeconds:2})");
  await app.run('waitForTranscription()');
  assert.equal(audioCalls, 2);
  finishOldAnswer('An older JavaScript answer.');
  await app.run('fallbackAnswerPromise');
  assert.equal(app.get('question').textContent, 'What is Python?');
  assert.equal(app.get('answer').textContent, 'A different programming language.');
});

test('an older text answer finishing does not discard a newer audio result already in flight', async () => {
  let finishOldAnswer;
  let finishNewAudio;
  let audioCalls = 0;
  const app = loadRenderer(channel => {
    if (channel === 'draft-answer') return new Promise(resolve=>{finishOldAnswer=resolve;});
    if (++audioCalls === 1) return Promise.resolve({transcript:'What is JavaScript?',question:'What is JavaScript?',answer:''});
    return new Promise(resolve=>{finishNewAudio=resolve;});
  });
  await app.run("transcribeChunk({blob:new Blob(['one']),elapsedSeconds:0})");
  const newer = app.run("transcribeChunk({blob:new Blob(['two']),elapsedSeconds:2})");
  while (!finishNewAudio) await new Promise(resolve=>setImmediate(resolve));
  finishOldAnswer('JavaScript answer.');
  await app.run('fallbackAnswerPromise');
  finishNewAudio({transcript:'What is Python?',question:'What is Python?',answer:'Python answer.'});
  await newer;
  assert.equal(app.get('answer').textContent, 'Python answer.');
  assert.equal(app.get('answer-history').children.length, 2);
});

test('batches respect both clip-count and payload-size limits without dropping clips', async () => {
  const requests = [];
  const app = loadRenderer(async (_channel, payload) => {
    requests.push(payload);
    return {transcript:'',question:'',answer:''};
  });
  app.run("for (let i=0;i<6;i++) queueChunk({blob:new Blob([String(i)]),elapsedSeconds:i})");
  await app.run('waitForTranscription()');
  assert.deepEqual(requests.map(request=>request.chunks?.length || 1), [4,2]);
  requests.length = 0;
  app.run("for (let i=0;i<3;i++) queueChunk({blob:{size:2500000,arrayBuffer:async()=>new Uint8Array([i]).buffer},elapsedSeconds:i})");
  await app.run('waitForTranscription()');
  assert.equal(requests.length, 3);
  assert.equal(app.run('pendingChunks'), 0);
});
