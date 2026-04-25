import { ExplanationLevel } from '../types';

export function effectiveMaxChunkLines(level: ExplanationLevel, configuredMaxChunkLines: number): number {
  const safeConfigured = Math.max(5, Math.floor(configuredMaxChunkLines));

  if (level === 'medium') {
    return Math.min(safeConfigured, 10);
  }

  return safeConfigured;
}

