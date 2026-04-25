import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRelativePath, snapshotRelativePathForSource } from '../src/persistence/snapshotPaths';

test('snapshotRelativePathForSource mirrors source folders under .code-explainer', () => {
  assert.equal(
    snapshotRelativePathForSource('backend/main.py', 'medium', false),
    '.code-explainer/explanations/backend/main.py.medium.json'
  );
});

test('snapshotRelativePathForSource includes review mode in the filename', () => {
  assert.equal(
    snapshotRelativePathForSource('src/app.ts', 'detailed', true),
    '.code-explainer/explanations/src/app.ts.detailed.review.json'
  );
});

test('normalizeRelativePath strips leading slashes', () => {
  assert.equal(normalizeRelativePath('/backend/main.py'), 'backend/main.py');
});

