import { ExplanationResponse, RenderedExplanation, ReviewItem } from '../types';

export function renderExplanation(lineCount: number, response: ExplanationResponse): RenderedExplanation {
  const lines = Array.from({ length: lineCount }, () => '');
  const reviewItems: ReviewItem[] = [];

  for (const chunk of response.chunks) {
    const start = clamp(chunk.startLine, 1, lineCount);
    const end = clamp(chunk.endLine, 1, lineCount);

    if (chunk.summary.trim() && !hasAnyLineText(lines, start, end)) {
      lines[start - 1] = sanitizeLine(chunk.summary);
    }

    for (const item of chunk.lines) {
      const lineIndex = clamp(item.line, 1, lineCount) - 1;
      const text = sanitizeLine(item.text);
      if (!text) {
        continue;
      }
      lines[lineIndex] = lines[lineIndex] ? `${lines[lineIndex]}  ${text}` : text;
    }

    for (const review of chunk.review) {
      const normalized = normalizeReviewItem(review, lineCount);
      reviewItems.push(normalized);
      const lineIndex = normalized.startLine - 1;
      const reviewText = sanitizeLine(`Review: ${normalized.message}${normalized.suggestion ? ` Suggestion: ${normalized.suggestion}` : ''}`);
      lines[lineIndex] = lines[lineIndex] ? `${lines[lineIndex]}  ${reviewText}` : reviewText;
    }
  }

  return {
    text: lines.join('\n'),
    lines,
    reviewItems,
    fileSummary: sanitizeLine(response.fileSummary)
  };
}

export function sanitizeLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeReviewItem(item: ReviewItem, lineCount: number): ReviewItem {
  const startLine = clamp(item.startLine, 1, lineCount);
  const endLine = clamp(item.endLine, startLine, lineCount);

  return {
    ...item,
    startLine,
    endLine,
    message: sanitizeLine(item.message),
    suggestion: sanitizeLine(item.suggestion)
  };
}

function hasAnyLineText(lines: string[], startLine: number, endLine: number): boolean {
  for (let line = startLine; line <= endLine; line += 1) {
    if (lines[line - 1]) {
      return true;
    }
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

