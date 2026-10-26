const { test } = require('node:test');
const assert = require('node:assert/strict');
const { answerRules, isControlAnswer } = require('../answer-policy');

test('the model receives answered questions as data and explicit semantic duplicate rules', () => {
  const rules = answerRules(['What is JavaScript?', '', null]);
  assert.match(rules, /Compare meanings, not just words/);
  assert.match(rules, /\[SKIP\]/);
  assert.match(rules, /\[WAIT\]/);
  assert.match(rules, /\["What is JavaScript\?"\]/);
});

test('control responses match only the exact reserved markers', () => {
  assert.equal(isControlAnswer('[SKIP]'), true);
  assert.equal(isControlAnswer('[WAIT]'), true);
  assert.equal(isControlAnswer('Skip this'), false);
  assert.equal(isControlAnswer('[WAIT] extra text'), false);
});
