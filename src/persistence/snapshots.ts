import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodeExplainerConfig } from '../config';
import { StoredExplanation } from '../state/ExplanationStore';
import { ExplanationLevel, RenderedExplanation, ReviewItem } from '../types';
import { normalizeRelativePath, snapshotRelativePathForSource } from './snapshotPaths';

export { snapshotRelativePathForSource } from './snapshotPaths';

export const snapshotSchemaVersion = 1;

export type ExplanationSnapshot = {
  schemaVersion: 1;
  source: {
    workspaceRelativePath: string;
    hash: string;
    languageId: string;
    lineCount: number;
  };
  generation: {
    model: string;
    level: ExplanationLevel;
    reviewEnabled: boolean;
    createdAt: string;
  };
  explanation: {
    fileSummary: string;
    lines: string[];
    reviewItems: ReviewItem[];
  };
};

export type SnapshotLocation = {
  workspaceFolder: vscode.WorkspaceFolder;
  snapshotUri: vscode.Uri;
  workspaceRelativePath: string;
};

export function getSnapshotLocation(sourceUri: vscode.Uri, level: ExplanationLevel, reviewEnabled: boolean): SnapshotLocation | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspaceFolder) {
    return undefined;
  }

  const workspaceRelativePath = normalizeRelativePath(path.relative(workspaceFolder.uri.fsPath, sourceUri.fsPath));
  const snapshotRelativePath = snapshotRelativePathForSource(workspaceRelativePath, level, reviewEnabled);
  return {
    workspaceFolder,
    snapshotUri: vscode.Uri.joinPath(workspaceFolder.uri, snapshotRelativePath),
    workspaceRelativePath
  };
}

export function createSnapshot(
  stored: StoredExplanation,
  config: CodeExplainerConfig,
  workspaceRelativePath: string,
  languageId: string,
  lineCount: number
): ExplanationSnapshot {
  return {
    schemaVersion: snapshotSchemaVersion,
    source: {
      workspaceRelativePath: normalizeRelativePath(workspaceRelativePath),
      hash: stored.key.contentHash,
      languageId,
      lineCount
    },
    generation: {
      model: stored.key.model,
      level: stored.key.level,
      reviewEnabled: stored.key.reviewEnabled,
      createdAt: new Date().toISOString()
    },
    explanation: {
      fileSummary: stored.rendered.fileSummary,
      lines: stored.rendered.lines,
      reviewItems: stored.rendered.reviewItems
    }
  };
}

export function snapshotMatches(
  snapshot: ExplanationSnapshot,
  contentHash: string,
  config: Pick<CodeExplainerConfig, 'model' | 'explanationLevel' | 'reviewEnabled'>,
  lineCount: number
): boolean {
  return (
    snapshot.schemaVersion === snapshotSchemaVersion &&
    snapshot.source.hash === contentHash &&
    snapshot.source.lineCount === lineCount &&
    snapshot.generation.model === config.model &&
    snapshot.generation.level === config.explanationLevel &&
    snapshot.generation.reviewEnabled === config.reviewEnabled &&
    snapshot.explanation.lines.length === lineCount
  );
}

export function renderedFromSnapshot(snapshot: ExplanationSnapshot): RenderedExplanation {
  return {
    text: snapshot.explanation.lines.join('\n'),
    lines: snapshot.explanation.lines,
    reviewItems: snapshot.explanation.reviewItems,
    fileSummary: snapshot.explanation.fileSummary
  };
}

export async function readSnapshot(sourceUri: vscode.Uri, config: CodeExplainerConfig): Promise<ExplanationSnapshot | undefined> {
  const location = getSnapshotLocation(sourceUri, config.explanationLevel, config.reviewEnabled);
  if (!location) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(location.snapshotUri.fsPath, 'utf8');
    return parseSnapshot(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function writeSnapshot(
  stored: StoredExplanation,
  config: CodeExplainerConfig,
  languageId: string,
  lineCount: number
): Promise<vscode.Uri | undefined> {
  const location = getSnapshotLocation(stored.sourceUri, stored.key.level, stored.key.reviewEnabled);
  if (!location) {
    return undefined;
  }

  const snapshot = createSnapshot(stored, config, location.workspaceRelativePath, languageId, lineCount);
  await fs.mkdir(path.dirname(location.snapshotUri.fsPath), { recursive: true });
  await fs.writeFile(location.snapshotUri.fsPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return location.snapshotUri;
}

export function parseSnapshot(value: unknown): ExplanationSnapshot {
  if (!isObject(value) || value.schemaVersion !== snapshotSchemaVersion) {
    throw new Error('Unsupported Code Explainer snapshot schema.');
  }

  const snapshot = value as ExplanationSnapshot;
  if (
    !isObject(snapshot.source) ||
    !isObject(snapshot.generation) ||
    !isObject(snapshot.explanation) ||
    typeof snapshot.source.workspaceRelativePath !== 'string' ||
    typeof snapshot.source.hash !== 'string' ||
    typeof snapshot.source.languageId !== 'string' ||
    !Number.isInteger(snapshot.source.lineCount) ||
    typeof snapshot.generation.model !== 'string' ||
    !['concise', 'medium', 'detailed'].includes(snapshot.generation.level) ||
    typeof snapshot.generation.reviewEnabled !== 'boolean' ||
    typeof snapshot.generation.createdAt !== 'string' ||
    typeof snapshot.explanation.fileSummary !== 'string' ||
    !Array.isArray(snapshot.explanation.lines) ||
    !Array.isArray(snapshot.explanation.reviewItems)
  ) {
    throw new Error('Invalid Code Explainer snapshot.');
  }

  return snapshot;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
