import { LLMProvider } from '../types';

export const defaultModel = 'gpt-5.4-mini';

export const defaultModelPresets = [
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2',
  'claude-sonnet-4-6'
];

export function providerForModel(model: string): LLMProvider {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('claude') ? 'anthropic' : 'openai';
}

export function providerDisplayName(provider: LLMProvider): string {
  return provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
}
