import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDisplayName, providerForModel } from '../src/llm/modelRouting';

test('providerForModel routes Claude models to Anthropic', () => {
  assert.equal(providerForModel('claude-sonnet-4-6'), 'anthropic');
});

test('providerForModel routes GPT and custom non-Claude models to OpenAI', () => {
  assert.equal(providerForModel('gpt-5.4-mini'), 'openai');
  assert.equal(providerForModel('my-custom-model'), 'openai');
});

test('providerDisplayName labels routed providers for UI prompts', () => {
  assert.equal(providerDisplayName('openai'), 'OpenAI');
  assert.equal(providerDisplayName('anthropic'), 'Anthropic');
});
