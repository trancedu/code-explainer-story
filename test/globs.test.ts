import test from 'node:test';
import assert from 'node:assert/strict';
import { globMatches, matchesAnyGlob } from '../src/path/globs';

test('globMatches supports double-star excludes', () => {
  assert.equal(globMatches('/repo/.env', '**/.env'), true);
  assert.equal(globMatches('/repo/src/index.ts', '**/.env'), false);
});

test('globMatches supports nested folder excludes', () => {
  assert.equal(globMatches('/repo/node_modules/pkg/index.js', '**/node_modules/**'), true);
  assert.equal(globMatches('/repo/src/node_modules_like/file.js', '**/node_modules/**'), false);
});

test('matchesAnyGlob returns true for any matching pattern', () => {
  assert.equal(matchesAnyGlob('/repo/dist/app.js', ['**/.env', '**/dist/**']), true);
});

