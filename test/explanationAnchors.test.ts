import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExplanationAnchorLine } from '../src/analysis/explanationAnchors';

test('resolveExplanationAnchorLine returns same line when it has explanation text', () => {
  assert.equal(resolveExplanationAnchorLine(['A', '', 'C'], 3), 3);
});

test('resolveExplanationAnchorLine falls back to the previous nonblank explanation line', () => {
  assert.equal(resolveExplanationAnchorLine(['A', '', '', 'D'], 3), 1);
});

test('resolveExplanationAnchorLine uses next nonblank line when nothing before exists', () => {
  assert.equal(resolveExplanationAnchorLine(['', '', 'C'], 2), 3);
});

test('resolveExplanationAnchorLine returns undefined for empty explanation documents', () => {
  assert.equal(resolveExplanationAnchorLine([], 10), undefined);
});

