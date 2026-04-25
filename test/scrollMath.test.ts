import test from 'node:test';
import assert from 'node:assert/strict';
import { bottomScrollPadding, lineToScrollTop, scrollTopToLine } from '../src/sync/scrollMath';

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

test('bottomScrollPadding lets the final line scroll to the top of the viewport', () => {
  const lineHeight = 20;
  const lineCount = 207;
  const contentHeight = 600;
  const documentHeight = lineCount * lineHeight + bottomScrollPadding(contentHeight, lineHeight);
  const maxScrollTop = documentHeight - contentHeight;

  assert.equal(maxScrollTop, lineToScrollTop(lineCount - 1, lineHeight));
});

test('bottomScrollPadding keeps a minimum spacer for tiny viewports', () => {
  assert.equal(bottomScrollPadding(30, 20), 40);
});
