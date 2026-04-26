export type InlineHint = {
  line: number;
  text: string;
  showAfterCode: boolean;
};

export type InlineHintOptions = {
  maxHints: number;
  maxTextLength: number;
  maxCodeColumns: number;
};

export function buildInlineHints(
  explanationLines: string[],
  sourceLines: string[],
  options: InlineHintOptions
): InlineHint[] {
  const hints: InlineHint[] = [];
  const maxHints = options.maxHints > 0 ? options.maxHints : Number.POSITIVE_INFINITY;

  for (let index = 0; index < explanationLines.length && hints.length < maxHints; index += 1) {
    const sourceLine = sourceLines[index] ?? '';
    if (!sourceLine.trim()) {
      continue;
    }

    const text = truncateInlineText(explanationLines[index]?.trim() ?? '', options.maxTextLength);
    if (!text) {
      continue;
    }

    hints.push({
      line: index + 1,
      text,
      showAfterCode: sourceLine.length <= options.maxCodeColumns
    });
  }

  return hints;
}

export function truncateInlineText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (maxLength <= 0 || normalized.length <= maxLength) {
    return normalized;
  }

  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}
