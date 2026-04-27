import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('extension defaults to medium explanations with inline enabled', () => {
  const raw = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
  const packageJson = JSON.parse(raw);
  const properties = packageJson.contributes.configuration.properties;

  assert.equal(properties['codeExplainer.explanationLevel'].default, 'medium');
  assert.equal(properties['codeExplainer.inline.enabled'].default, true);
});
