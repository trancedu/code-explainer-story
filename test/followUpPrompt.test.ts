import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowUpUserPrompt } from '../src/llm/followUpPrompt';

test('buildFollowUpUserPrompt includes file context, focus location, and question', () => {
  const prompt = buildFollowUpUserPrompt({
    fileName: 'example.ts',
    languageId: 'typescript',
    totalLines: 3,
    focusLine: 2,
    question: 'Why does this return early?',
    sourceText: 'function main() {\n  return 1;\n}'
  });

  assert.match(prompt, /File: example\.ts/);
  assert.match(prompt, /Language: typescript/);
  assert.match(prompt, /Total lines: 3/);
  assert.match(prompt, /Focus line: 2/);
  assert.match(prompt, /Question: Why does this return early\?/);
  assert.match(prompt, /1 \| function main\(\) \{/);
  assert.match(prompt, /2 \|   return 1;/);
  assert.match(prompt, /3 \| \}/);
});
