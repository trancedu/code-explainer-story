import * as vscode from 'vscode';
import { ExplanationLevel, LLMProvider } from './types';
import { defaultModel, defaultModelPresets, providerForModel } from './llm/modelRouting';

export type CodeExplainerConfig = {
  provider: LLMProvider;
  model: string;
  modelPresets: string[];
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

const levels = new Set<ExplanationLevel>(['concise', 'medium', 'detailed', 'story', 'walkthrough']);

export function getCodeExplainerConfig(): CodeExplainerConfig {
  const config = vscode.workspace.getConfiguration('codeExplainer');
  const level = config.get<string>('explanationLevel', 'medium');
  const model = config.get<string>('model', defaultModel).trim() || defaultModel;

  return {
    provider: providerForModel(model),
    model,
    modelPresets: config.get<string[]>('modelPresets', defaultModelPresets),
    explanationLevel: levels.has(level as ExplanationLevel) ? (level as ExplanationLevel) : 'medium',
    reviewEnabled: config.get<boolean>('reviewEnabled', false),
    inlineEnabled: config.get<boolean>('inline.enabled', true),
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
  return config.model;
}

export function getActiveModelPresets(config: CodeExplainerConfig): string[] {
  return config.modelPresets;
}

export async function setInlineEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('inline.enabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setModel(model: string): Promise<void> {
  await vscode.workspace
    .getConfiguration('codeExplainer')
    .update('model', model, vscode.ConfigurationTarget.Global);
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
