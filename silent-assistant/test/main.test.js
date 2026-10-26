const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function loadApp(shortcutWorks = true, hasProtectionGetter = true, platform = 'win32', packaged = false, backgroundShortcutWorks = shortcutWorks) {
  const handlers = {};
  const events = {};
  let win;
  let toggle;
  let request;
  const environment = { GEMINI_API_KEY: 'test-placeholder' };
  let configuration = {};
  let audioResult = { transcript: 'What is a binary tree?', question: 'What is a binary tree?', answer: 'A tree whose nodes have at most two children.' };
  const shortcuts = {};
  const dock = { hidden: false, hide() { this.hidden = true; }, show() { this.hidden = false; } };
  const appPaths = { appData: path.join(__dirname, 'app-data') };
  class Window {
    constructor(options) {
      win = this;
      this.options = options;
      if (!hasProtectionGetter) this.isContentProtected = undefined;
      this.visible = false;
      this.windowEvents = {};
      this.webContents = { once() {}, on() {}, send() {} };
    }
    setContentProtection(value) { this.protected = value; }
    isContentProtected() { return this.protected; }
    setMenu() {}
    once() {}
    on(name, handler) { this.windowEvents[name] = handler; }
    loadFile() {}
    show() { this.visible = true; }
    focus() { this.focused = true; }
    hide() { this.visible = false; }
    minimize() { this.minimized = true; }
    isVisible() { return this.visible; }
    setSkipTaskbar(value) { this.options.skipTaskbar = value; }
    setSize(width, height) { this.size = [width, height]; }
  }
  const electron = {
    app: { isPackaged: packaged, dock, getVersion: () => '1.0.5', getPath: key => appPaths[key], setPath: (key, value) => { appPaths[key] = value; }, whenReady: async () => {}, on() {}, quit() {} },
    BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => { handlers[key] = fn; }, on: (key, fn) => { events[key] = fn; } },
    session: { defaultSession: { setDisplayMediaRequestHandler() {} } },
    globalShortcut: { register: (key, fn) => {
      shortcuts[key] = fn;
      if (key.endsWith('+Space')) { toggle = fn; return shortcutWorks; }
      return backgroundShortcutWorks;
    }, unregisterAll() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    __dirname: path.join(__dirname, '..'),
    process: { env: environment, platform },
    console,
    require: name => {
      if (name === 'electron') return electron;
      if (name === 'dotenv') return { config: () => ({ parsed: configuration }) };
      if (name === '@google/genai') return { GoogleGenAI: class {
        constructor() { this.models = { generateContent: async value => {
          request = value;
          return { text: value.config?.responseMimeType === 'application/json'
            ? JSON.stringify(audioResult)
            : ' Example output ' };
        } };
          const generate = this.models.generateContent;
          this.models.generateContentStream = async function* (value) {
            const result = await generate(value);
            const midpoint = Math.floor(result.text.length / 2);
            yield { text: result.text.slice(0, midpoint) };
            yield { text: result.text.slice(midpoint) };
          };
        }
      } };
      if (name === './gemini-retry') return require('../gemini-retry');
      if (name === './streamed-json') return require('../streamed-json');
      if (name === './answer-policy') return require('../answer-policy');
      return require(name);
    }
  });
  await Promise.resolve();
  return { win, handlers, events, toggle, dock, appPaths, shortcuts, environment, getRequest: () => request, setAudioResult: value => { audioResult = value; }, setConfiguration: value => { configuration = value; } };
}

test('capture rereads a newly configured key after an earlier missing-key error', async () => {
  const app = await loadApp();
  app.environment.GEMINI_API_KEY = '';
  assert.throws(() => app.handlers['check-capture-ready'](), /GEMINI_API_KEY is missing/);
  app.setConfiguration({ GEMINI_API_KEY: 'local-test-key' });
  assert.equal(app.handlers['check-capture-ready'](), true);
  assert.equal(app.environment.GEMINI_API_KEY, 'local-test-key');
});

test('a configured environment key takes precedence over the env file', async () => {
  const app = await loadApp();
  app.setConfiguration({ GEMINI_API_KEY: 'different-test-key' });
  assert.equal(app.handlers['check-capture-ready'](), true);
  assert.equal(app.environment.GEMINI_API_KEY, 'test-placeholder');
});

test('live output suppresses invented questions without a transcript and answers without a question', async () => {
  const { handlers, setAudioResult } = await loadApp();
  const event = { sender: { isDestroyed: () => false, send() {} } };
  const audio = { data: 'YXVkaW8=', mimeType: 'audio/webm' };
  setAudioResult({ transcript: '', question: 'Invented question?', answer: 'Invented answer' });
  const silent = await handlers['analyze-audio'](event, audio);
  assert.equal(silent.question, '');
  assert.equal(silent.answer, '');
  setAudioResult({ transcript: 'Hello there.', question: '', answer: 'Unrelated answer' });
  const speech = await handlers['analyze-audio'](event, audio);
  assert.equal(speech.transcript, 'Hello there.');
  assert.equal(speech.answer, '');
});

test('background mode hides and restores the same window without stopping capture', async () => {
  const { win, handlers, shortcuts } = await loadApp();
  win.show();
  assert.equal(await handlers['background-overlay'](), true);
  assert.equal(win.visible, false);
  assert.equal(win.options.webPreferences.backgroundThrottling, false);
  shortcuts['CommandOrControl+Shift+H']();
  assert.equal(win.visible, true);
  assert.equal(win.focused, true);
  assert.equal(win.protected, true);
  shortcuts['CommandOrControl+Shift+H']();
  assert.equal(win.visible, false);
});

test('background shortcut conflict refuses to hide the window', async () => {
  const { win, handlers } = await loadApp(true, true, 'win32', false, false);
  win.show();
  assert.equal(await handlers['background-overlay'](), false);
  assert.equal(win.visible, true);
});

test('packaged branding retains the existing credentials directory', async () => {
  const { win, appPaths } = await loadApp(true, true, 'win32', true);
  assert.equal(win.options.title, 'Desk Notes');
  assert.equal(appPaths.userData, path.join(appPaths.appData, 'Silent Assistant'));
});

test('macOS keeps the Dock hidden even when shortcuts conflict', async () => {
  const normal = await loadApp(true, true, 'darwin');
  assert.equal(normal.dock.hidden, true);
  const conflict = await loadApp(false, true, 'darwin');
  assert.equal(conflict.dock.hidden, true);
  assert.equal(conflict.win.options.skipTaskbar, true);
  assert.throws(() => normal.handlers['check-capture-ready'](), /Windows only/);
});

test('compact overlay keeps answers visible and background audio timers active', async () => {
  const { win, toggle, events } = await loadApp();
  assert.equal(win.protected, true);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.alwaysOnTop, true);
  assert.equal(win.options.skipTaskbar, true);
  assert.equal(win.options.webPreferences.backgroundThrottling, false);
  toggle();
  assert.equal(win.visible, true);
  assert.deepEqual(win.size, [500, 440]);
  events['hide-overlay']();
  assert.equal(win.visible, true);
  assert.deepEqual(win.size, [620, 700]);
});

test('shortcut conflict keeps the taskbar hidden; compact button still works', async () => {
  const { win, events } = await loadApp(false);
  assert.equal(win.options.skipTaskbar, true);
  events['hide-overlay']();
  assert.equal(win.visible, true);
  assert.deepEqual(win.size, [500, 440]);
  win.options.skipTaskbar = false;
  win.windowEvents.show();
  assert.equal(win.options.skipTaskbar, true);
});

test('protection can be checked and is reapplied after restore and layout changes', async () => {
  const { win, handlers, toggle } = await loadApp();
  win.protected = false;
  win.windowEvents.restore();
  assert.equal(win.protected, true);
  win.protected = false;
  toggle();
  assert.equal(win.protected, true);
  assert.equal(await handlers['check-overlay-protection'](), true);
  win.isContentProtected = () => false;
  assert.equal(await handlers['check-overlay-protection'](), false);
});

test('older Electron without the protection getter still applies capture exclusion', async () => {
  const { win, handlers, toggle } = await loadApp(true, false);
  assert.equal(win.protected, true);
  assert.equal(await handlers['check-overlay-protection'](), null);
  win.protected = false;
  win.windowEvents.restore();
  assert.equal(win.protected, true);
  win.protected = false;
  toggle();
  assert.equal(win.protected, true);
});

test('capture protection failure is reported rather than claiming success', async () => {
  const { win, handlers } = await loadApp();
  win.setContentProtection = () => {};
  win.protected = false;
  assert.equal(await handlers['check-overlay-protection'](), false);
});

test('transcription and answer IPC validate inputs and return Gemini output', async () => {
  const { handlers, getRequest } = await loadApp();
  const event = { sender: { isDestroyed: () => false, send() {} } };
  await assert.rejects(handlers['transcribe-audio'](event, { data: '', mimeType: 'audio/webm' }), /empty/);
  assert.equal(await handlers['transcribe-audio'](event, { data: 'YXVkaW8=', mimeType: 'audio/webm' }), 'Example output');
  assert.equal(getRequest().contents[0].parts[1].inlineData.data, 'YXVkaW8=');
  await assert.rejects(handlers['draft-answer'](event, ''), /transcript/);
  assert.equal(await handlers['draft-answer'](event, 'What is a binary tree?'), 'Example output');
  assert.equal(getRequest().contents, 'What is a binary tree?');
  assert.match(getRequest().config.systemInstruction, /English only/);
});

test('live analysis returns transcript and answer together with English instructions', async () => {
  const { handlers, getRequest } = await loadApp();
  const event = { sender: { isDestroyed: () => false, send() {} } };
  await assert.rejects(handlers['analyze-audio'](event, { data: '' }), /empty/);
  const result = await handlers['analyze-audio'](event, { data: 'YXVkaW8=', mimeType: 'audio/webm', context: 'Earlier question fragment' });
  assert.equal(result.answer, 'A tree whose nodes have at most two children.');
  assert.equal(result.transcript, 'What is a binary tree?');
  assert.match(getRequest().contents[0].parts[0].text, /All output fields must be in English/);
  assert.match(getRequest().contents[0].parts[0].text, /Earlier question fragment/);
  assert.equal(getRequest().model, 'gemini-3.5-flash-lite');
});

test('live requests stream partial answers and request programming examples with bounded latency', async () => {
  const { handlers, getRequest } = await loadApp();
  const notifications = [];
  const event = { sender: { isDestroyed: () => false, send: (name, body) => notifications.push({name, body}) } };
  const result = await handlers['analyze-audio'](event, {data:'YXVkaW8=',mimeType:'audio/webm',requestId:7});
  assert.ok(result.answer);
  assert.ok(notifications.some(item => item.name === 'live-answer-partial' && item.body.requestId === 7 && item.body.answer));
  assert.equal(getRequest().config.httpOptions.timeout, 20000);
  assert.equal(getRequest().config.thinkingConfig.thinkingLevel, 'minimal');
  assert.ok(getRequest().config.responseSchema.required.includes('example'));
});

test('programming examples are included in the displayed answer', async () => {
  const { handlers, setAudioResult } = await loadApp();
  setAudioResult({transcript:'Explain TypeScript.',question:'Explain TypeScript.',answer:'TypeScript adds static types.',example:'const n: number = 1; console.log(n); // 1'});
  const result = await handlers['analyze-audio']({sender:{isDestroyed:()=>false,send(){}}},{data:'YXVkaW8=',mimeType:'audio/webm'});
  assert.match(result.answer, /Example:/);
  assert.match(result.answer, /const n: number/);
});

test('skip and wait markers remain exact and are never decorated with examples', async () => {
  const { handlers, setAudioResult, getRequest } = await loadApp();
  const event = {sender:{isDestroyed:()=>false,send(){}}};
  for (const marker of ['[SKIP]', '[WAIT]']) {
    setAudioResult({transcript:'What is JavaScript',question:'',answer:marker,example:'must not be appended'});
    const result = await handlers['analyze-audio'](event,{data:'YXVkaW8=',mimeType:'audio/webm',alreadyAnswered:['What is JavaScript?']});
    assert.equal(result.answer, marker);
    assert.match(getRequest().contents[0].parts[0].text, /already_answered/);
    assert.match(getRequest().contents[0].parts[0].text, /What is JavaScript\?/);
  }
});

test('audio batches keep independent audio parts in chronological order', async () => {
  const { handlers, getRequest } = await loadApp();
  const event = {sender:{isDestroyed:()=>false,send(){}}};
  await handlers['analyze-audio'](event,{chunks:['Zmlyc3Q=','c2Vjb25k'],mimeType:'audio/webm'});
  const audioParts = getRequest().contents[0].parts.filter(part=>part.inlineData);
  assert.deepEqual(Array.from(audioParts, part=>part.inlineData.data), ['Zmlyc3Q=','c2Vjb25k']);
  await handlers['transcribe-audio'](event,{chunks:['Zmlyc3Q=','c2Vjb25k'],mimeType:'audio/webm'});
  assert.equal(getRequest().contents[0].parts.filter(part=>part.inlineData).length, 2);
});

test('malformed and oversized batches are rejected before requesting Gemini', async () => {
  const { handlers, getRequest } = await loadApp();
  const event = {sender:{isDestroyed:()=>false,send(){}}};
  for (const chunks of [[],['valid',null],Array(5).fill('valid'),['x'.repeat(8_000_001)]]) {
    await assert.rejects(handlers['analyze-audio'](event,{chunks,mimeType:'audio/webm'}), /empty|invalid|too large/);
    assert.equal(getRequest(), undefined);
  }
});

test('live timeout overrides are validated instead of accepting an unbounded timeout', async () => {
  const { handlers, environment, getRequest } = await loadApp();
  const event = {sender:{isDestroyed:()=>false,send(){}}};
  environment.GEMINI_LIVE_TIMEOUT_MS = '22000';
  await handlers['analyze-audio'](event,{data:'YXVkaW8=',mimeType:'audio/webm'});
  assert.equal(getRequest().config.httpOptions.timeout, 22000);
  environment.GEMINI_LIVE_TIMEOUT_MS = '0';
  await handlers['analyze-audio'](event,{data:'YXVkaW8=',mimeType:'audio/webm'});
  assert.equal(getRequest().config.httpOptions.timeout, 20000);
});
