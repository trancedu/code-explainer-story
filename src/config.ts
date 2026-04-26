import * as vscode from 'vscode';
import { ExplanationLevel, LLMProvider } from './types';

export type CodeExplainerConfig = {
  provider: LLMProvider;
  model: string;
  modelPresets: string[];
  anthropicModel: string;
  anthropicModelPresets: string[];
  explanationLevel: ExplanationLevel;
  reviewEnabled: boolean;
  inlineEnabled: boolean;
  inlineMaxHints: number;
  inlineMaxTextLength: number;
  inlineMaxCodeColumns: number;
  syncLineOffset: number;
  webviewHeaderHeight: number;
  maxFileLines: number;
  maxChunkLines: number;
  cacheExplanations: boolean;
  persistExplanations: boolean;
  autoRegenerateOnSave: boolean;
  includeGlobs: string[];
  includeFullPath: boolean;
  excludedGlobs: string[];
};

const levels = new Set<ExplanationLevel>(['concise', 'medium', 'detailed', 'story']);
const providers = new Set<LLMProvider>(['openai', 'anthropic']);

export function getCodeExplainerConfig(): CodeExplainerConfig {
  const config = vscode.workspace.getConfiguration('codeExplainer');
  const level = config.get<string>('explanationLevel', 'medium');
  const provider = config.get<string>('provider', 'openai');

  return {
    provider: providers.has(provider as LLMProvider) ? (provider as LLMProvider) : 'openai',
    model: config.get<string>('model', 'gpt-5.4-mini'),
    modelPresets: config.get<string[]>('modelPresets', ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2']),
    anthropicModel: config.get<string>('anthropic.model', 'claude-sonnet-4-6'),
    anthropicModelPresets: config.get<string[]>('anthropic.modelPresets', ['claude-sonnet-4-6']),
    explanationLevel: levels.has(level as ExplanationLevel) ? (level as ExplanationLevel) : 'medium',
    reviewEnabled: config.get<boolean>('reviewEnabled', false),
    inlineEnabled: config.get<boolean>('inline.enabled', false),
    inlineMaxHints: config.get<number>('inline.maxHints', 0),
    inlineMaxTextLength: config.get<number>('inline.maxTextLength', 96),
    inlineMaxCodeColumns: config.get<number>('inline.maxCodeColumns', 100),
    syncLineOffset: config.get<number>('syncLineOffset', 0),
    webviewHeaderHeight: config.get<number>('webviewHeaderHeight', 42),
    maxFileLines: config.get<number>('maxFileLines', 3000),
    maxChunkLines: config.get<number>('maxChunkLines', 10),
    cacheExplanations: config.get<boolean>('cacheExplanations', true),
    persistExplanations: config.get<boolean>('persistExplanations', true),
    autoRegenerateOnSave: config.get<boolean>('autoRegenerateOnSave', false),
    includeGlobs: config.get<string[]>('includeGlobs', ['**/*.py', '**/*.R', '**/*.r', '**/*.ts', '**/*.tsx']),
    includeFullPath: config.get<boolean>('privacy.includeFullPath', false),
    excludedGlobs: config.get<string[]>('excludedGlobs', [])
  };
}

export function getActiveModel(config: CodeExplainerConfig): string {
  return config.provider === 'anthropic' ? config.anthropicModel : config.model;
}

export function getActiveModelPresets(config: CodeExplainerConfig): string[] {
  return config.provider === 'anthropic' ? config.anthropicModelPresets : config.modelPresets;
}

export async function setProvider(provider: LLMProvider): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('provider', provider, vscode.ConfigurationTarget.Global);
}

export async function setInlineEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('inline.enabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setOpenAIModel(model: string): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('model', model, vscode.ConfigurationTarget.Global);
}

export async function setAnthropicModel(model: string): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('anthropic.model', model, vscode.ConfigurationTarget.Global);
}

export async function setExplanationLevel(level: ExplanationLevel): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('explanationLevel', level, vscode.ConfigurationTarget.Global);
}

export async function setReviewEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('reviewEnabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setSyncLineOffset(offset: number): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('syncLineOffset', Math.max(-20, Math.min(20, offset)), vscode.ConfigurationTarget.Global);
}
