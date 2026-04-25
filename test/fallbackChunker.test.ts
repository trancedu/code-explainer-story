import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackChunkText } from '../src/analysis/fallbackChunker';

test('fallbackChunkText identifies python classes and functions', () => {
  const chunks = fallbackChunkText(
    [
      'import os',
      '',
      'class Runner:',
      '    pass',
      '',
      'def main():',
      '    return Runner()'
    ].join('\n'),
    'python',
    120
  );

  assert.equal(chunks.length, 3);
  assert.equal(chunks[1].kind, 'class');
  assert.equal(chunks[1].symbolPath, 'Runner');
  assert.equal(chunks[2].kind, 'function');
  assert.equal(chunks[2].symbolPath, 'main');
});

test('fallbackChunkText identifies R function assignments', () => {
  const chunks = fallbackChunkText(
    [
      'library(dplyr)',
      '',
      'clean_data <- function(df) {',
      '  df',
      '}'
    ].join('\n'),
    'r',
    120
  );

  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].kind, 'function');
  assert.equal(chunks[1].symbolPath, 'clean_data');
});

test('fallbackChunkText splits large chunks by maxChunkLines', () => {
  const source = Array.from({ length: 5 }, (_, index) => `line${index + 1}`).join('\n');
  const chunks = fallbackChunkText(source, 'plaintext', 2);

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((chunk) => [chunk.startLine, chunk.endLine]),
    [
      [1, 2],
      [3, 4],
      [5, 5]
    ]
  );
});

