import * as path from 'path';
import { ExplanationLevel, LLMProvider } from '../types';

export function snapshotRelativePathForSource(
  workspaceRelativePath: string,
  level: ExplanationLevel,
  reviewEnabled: boolean,
  provider: LLMProvider = 'openai'
): string {
  const normalized = normalizeRelativePath(workspaceRelativePath);
  const dirname = path.posix.dirname(normalized);
  const basename = path.posix.basename(normalized);
  const providerPrefix = provider === 'openai' ? '' : `${provider}.`;
  const suffix = reviewEnabled ? `${providerPrefix}${level}.review.json` : `${providerPrefix}${level}.json`;
  const filename = `${basename}.${suffix}`;
  const snapshotPath = dirname === '.' ? filename : path.posix.join(dirname, filename);
  return path.posix.join('.code-explainer', 'explanations', snapshotPath);
}

export function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/').replace(/^\/+/, '');
}
