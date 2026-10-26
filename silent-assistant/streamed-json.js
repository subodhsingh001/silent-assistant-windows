// Read only string fields from a flat, possibly incomplete JSON object.
// Incomplete escapes are withheld until the following stream chunk arrives.
function partialStringFields(input) {
  const fields = {};
  let index = input.indexOf('{');
  if (index < 0) return fields;
  index++;
  const whitespace = () => { while (/\s/.test(input[index] || '') && index < input.length) index++; };
  function stringAt(start) {
    if (input[start] !== '"') return null;
    let raw = '';
    let cursor = start + 1;
    while (cursor < input.length) {
      const char = input[cursor];
      if (char === '"') return { value: JSON.parse(`"${raw}"`), complete: true, end: cursor + 1 };
      if (char === '\\') {
        const size = input[cursor + 1] === 'u' ? 6 : 2;
        if (cursor + size > input.length) break;
        raw += input.slice(cursor, cursor + size);
        cursor += size;
      } else {
        raw += char;
        cursor++;
      }
    }
    return { value: JSON.parse(`"${raw}"`), complete: false, end: cursor };
  }
  try {
    while (index < input.length) {
      whitespace();
      const key = stringAt(index);
      if (!key?.complete) break;
      index = key.end;
      whitespace();
      if (input[index++] !== ':') break;
      whitespace();
      const value = stringAt(index);
      if (!value) break;
      if (['transcript', 'question', 'answer', 'example'].includes(key.value)) fields[key.value] = value.value;
      if (!value.complete) break;
      index = value.end;
      whitespace();
      if (input[index++] !== ',') break;
    }
  } catch {
    // The final response is still validated with JSON.parse by the caller.
  }
  return fields;
}

module.exports = { partialStringFields };
