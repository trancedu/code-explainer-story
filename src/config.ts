import * as vscode from 'vscode';
import { ExplanationLevel } from './types';

export type CodeExplainerConfig = {
  model: string;
  explanationLevel: ExplanationLevel;
  reviewEnabled: boolean;
  syncLineOffset: number;
  webviewHeaderHeight: number;
  maxFileLines: number;
  maxChunkLines: number;
  cacheExplanations: boolean;
  includeFullPath: boolean;
  excludedGlobs: string[];
};

const levels = new Set<ExplanationLevel>(['concise', 'medium', 'detailed']);

export function getCodeExplainerConfig(): CodeExplainerConfig {
  const config = vscode.workspace.getConfiguration('codeExplainer');
  const level = config.get<string>('explanationLevel', 'medium');

  return {
    model: config.get<string>('model', 'gpt-5.4-mini'),
    explanationLevel: levels.has(level as ExplanationLevel) ? (level as ExplanationLevel) : 'medium',
    reviewEnabled: config.get<boolean>('reviewEnabled', false),
    syncLineOffset: config.get<number>('syncLineOffset', 0),
    webviewHeaderHeight: config.get<number>('webviewHeaderHeight', 42),
    maxFileLines: config.get<number>('maxFileLines', 3000),
    maxChunkLines: config.get<number>('maxChunkLines', 10),
    cacheExplanations: config.get<boolean>('cacheExplanations', true),
    includeFullPath: config.get<boolean>('privacy.includeFullPath', false),
    excludedGlobs: config.get<string[]>('excludedGlobs', [])
  };
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
