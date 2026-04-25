import test from 'node:test';
import assert from 'node:assert/strict';
import { lineToScrollTop, scrollTopToLine } from '../src/sync/scrollMath';

test('scrollTopToLine rounds to the nearest logical line', () => {
  assert.equal(scrollTopToLine(0, 20, 100), 0);
  assert.equal(scrollTopToLine(29, 20, 100), 1);
  assert.equal(scrollTopToLine(31, 20, 100), 2);
});

test('scrollTopToLine clamps to source bounds', () => {
  assert.equal(scrollTopToLine(-50, 20, 100), 0);
  assert.equal(scrollTopToLine(5000, 20, 100), 99);
});

test('lineToScrollTop maps zero-based lines to pixel positions', () => {
  assert.equal(lineToScrollTop(52, 20), 1040);
});

