const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function loadApp(shortcutWorks = true, hasProtectionGetter = true) {
  const handlers = {};
  const events = {};
  let win;
  let toggle;
  let request;
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
    hide() { this.visible = false; }
    minimize() { this.minimized = true; }
    isVisible() { return this.visible; }
    setSkipTaskbar(value) { this.options.skipTaskbar = value; }
    setSize(width, height) { this.size = [width, height]; }
  }
  const electron = {
    app: { whenReady: async () => {}, on() {}, quit() {} },
    BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => { handlers[key] = fn; }, on: (key, fn) => { events[key] = fn; } },
    session: { defaultSession: { setDisplayMediaRequestHandler() {} } },
    globalShortcut: { register: (key, fn) => { toggle = fn; return shortcutWorks; }, unregisterAll() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    __dirname: path.join(__dirname, '..'),
    process: { env: { GEMINI_API_KEY: 'test-placeholder' }, platform: 'win32' },
    console,
    require: name => {
      if (name === 'electron') return electron;
      if (name === 'dotenv') return { config: () => ({}) };
      if (name === '@google/genai') return { GoogleGenAI: class {
        constructor() { this.models = { generateContent: async value => {
          request = value;
          return { text: value.config?.responseMimeType === 'application/json'
            ? JSON.stringify({ transcript: 'What is a binary tree?', question: 'What is a binary tree?', answer: 'A tree whose nodes have at most two children.' })
            : ' Example output ' };
        } }; }
      } };
      if (name === './gemini-retry') return require('../gemini-retry');
      return require(name);
    }
  });
  await Promise.resolve();
  return { win, handlers, events, toggle, getRequest: () => request };
}

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

test('shortcut conflict preserves taskbar access; compact button still works', async () => {
  const { win, events } = await loadApp(false);
  assert.equal(win.options.skipTaskbar, false);
  events['hide-overlay']();
  assert.equal(win.visible, true);
  assert.deepEqual(win.size, [500, 440]);
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
  assert.match(getRequest().contents[0].parts[0].text, /All three output fields must be in English/);
  assert.match(getRequest().contents[0].parts[0].text, /Earlier question fragment/);
  assert.equal(getRequest().model, 'gemini-3.5-flash-lite');
});
