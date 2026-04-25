import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSyncTargetLine } from '../src/sync/lineMapping';

test('mapSyncTargetLine applies positive offset from source to explanation', () => {
  assert.equal(mapSyncTargetLine(50, 'sourceToExplanation', 2, 200), 52);
});

test('mapSyncTargetLine reverses offset from explanation to source', () => {
  assert.equal(mapSyncTargetLine(52, 'explanationToSource', 2, 200), 50);
});

test('mapSyncTargetLine clamps to target document bounds', () => {
  assert.equal(mapSyncTargetLine(1, 'explanationToSource', 5, 200), 0);
  assert.equal(mapSyncTargetLine(100, 'sourceToExplanation', 5, 103), 102);
});

