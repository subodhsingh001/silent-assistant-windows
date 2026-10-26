const { test } = require('node:test');
const assert = require('node:assert/strict');
const { partialStringFields } = require('../streamed-json');

test('partial JSON strings decode correctly across every stream boundary', () => {
  const answer = 'Use "x".\nconst copy = {...obj}; \\ \u263a';
  const serialized = JSON.stringify({transcript:'Question?',question:'Question?',answer});
  for (let end = 0; end <= serialized.length; end++) {
    const partial = partialStringFields(serialized.slice(0, end));
    if (partial.answer !== undefined) assert.equal(answer.startsWith(partial.answer), true);
  }
  assert.equal(partialStringFields(serialized).answer, answer);
});

test('text inside a transcript cannot impersonate an answer field', () => {
  const data = JSON.stringify({transcript:'He said {"answer":"fake"}',question:'',answer:''});
  assert.equal(partialStringFields(data).answer, '');
  assert.deepEqual(partialStringFields('not JSON'), {});
});
