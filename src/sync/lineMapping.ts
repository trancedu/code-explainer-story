export type SyncDirection = 'sourceToExplanation' | 'explanationToSource';

export function mapSyncTargetLine(
  sourceLine: number,
  direction: SyncDirection,
  syncLineOffset: number,
  targetLineCount: number
): number {
  const mapped =
    direction === 'sourceToExplanation'
      ? sourceLine + syncLineOffset
      : sourceLine - syncLineOffset;

  return clamp(Math.round(mapped), 0, Math.max(0, targetLineCount - 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

