import * as path from 'path';
import { ExplanationLevel } from '../types';

export function snapshotRelativePathForSource(
  workspaceRelativePath: string,
  level: ExplanationLevel,
  reviewEnabled: boolean
): string {
  const normalized = normalizeRelativePath(workspaceRelativePath);
  const dirname = path.posix.dirname(normalized);
  const basename = path.posix.basename(normalized);
  const suffix = reviewEnabled ? `${level}.review.json` : `${level}.json`;
  const filename = `${basename}.${suffix}`;
  const snapshotPath = dirname === '.' ? filename : path.posix.join(dirname, filename);
  return path.posix.join('.code-explainer', 'explanations', snapshotPath);
}

export function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/').replace(/^\/+/, '');
}

