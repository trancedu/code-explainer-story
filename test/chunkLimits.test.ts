import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMaxChunkLines } from '../src/analysis/chunkLimits';

test('effectiveMaxChunkLines caps medium mode at ten lines', () => {
  assert.equal(effectiveMaxChunkLines('medium', 20), 10);
  assert.equal(effectiveMaxChunkLines('medium', 8), 8);
});

test('effectiveMaxChunkLines keeps concise and detailed configurable', () => {
  assert.equal(effectiveMaxChunkLines('concise', 20), 20);
  assert.equal(effectiveMaxChunkLines('detailed', 20), 20);
});

