export function resolveExplanationAnchorLine(lines: string[], sourceLine: number): number | undefined {
  if (lines.length === 0) {
    return undefined;
  }

  const startIndex = clamp(sourceLine - 1, 0, lines.length - 1);
  for (let index = startIndex; index >= 0; index -= 1) {
    if (lines[index]?.trim()) {
      return index + 1;
    }
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index]?.trim()) {
      return index + 1;
    }
  }

  return sourceLine;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

