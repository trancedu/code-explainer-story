import { ExplanationLevel } from '../types';

export function effectiveMaxChunkLines(level: ExplanationLevel, configuredMaxChunkLines: number): number {
  const safeConfigured = Math.max(5, Math.floor(configuredMaxChunkLines));

  if (level === 'medium') {
    return Math.min(safeConfigured, 10);
  }

  if (level === 'story') {
    return Math.min(safeConfigured, 8);
  }

  if (level === 'walkthrough') {
    return Math.min(safeConfigured, 5);
  }

  return safeConfigured;
}
