import { ExplanationLevel, ExplanationResponse, RenderedExplanation, ReviewItem } from '../types';
import { firstMeaningfulLineInRange, isIgnorableSourceLine, splitSourceLines } from './sourceLines';

export type RenderExplanationOptions = {
  sourceText?: string;
  languageId?: string;
  level?: ExplanationLevel;
};

export function renderExplanation(
  lineCount: number,
  response: ExplanationResponse,
  options: RenderExplanationOptions = {}
): RenderedExplanation {
  const lines = Array.from({ length: lineCount }, () => '');
  const reviewItems: ReviewItem[] = [];
  const sourceLines = options.sourceText === undefined ? undefined : splitSourceLines(options.sourceText);
  const languageId = options.languageId ?? 'plaintext';
  const level = options.level ?? 'detailed';
  const summaryOnlyMode = level === 'concise';
  const mediumMode = level === 'medium';

  for (const chunk of response.chunks) {
    const start = clamp(chunk.startLine, 1, lineCount);
    const end = clamp(chunk.endLine, 1, lineCount);
    const anchor = sourceLines
      ? firstMeaningfulLineInRange(sourceLines, languageId, start, end)
      : start;

    if (chunk.summary.trim() && anchor !== undefined && !hasAnyLineText(lines, start, end)) {
      lines[anchor - 1] = sanitizeLine(chunk.summary);
    }

    const mediumLineNoteLimit = mediumMode ? getMediumLineNoteLimit(start, end) : Number.POSITIVE_INFINITY;
    let mediumLineNotesRendered = 0;

    if (!summaryOnlyMode) {
      for (const item of chunk.lines) {
        const lineNumber = clamp(item.line, 1, lineCount);
        if (isIgnorableLine(sourceLines, languageId, lineNumber)) {
          continue;
        }

        if (mediumMode) {
          if (mediumLineNotesRendered >= mediumLineNoteLimit) {
            continue;
          }
          if (sourceLines && isSimpleGroupedLine(sourceLines[lineNumber - 1] ?? '', languageId)) {
            continue;
          }
        }

        const lineIndex = lineNumber - 1;
        const text = sanitizeLine(item.text);
        if (!text || isBlankOrCommentNarration(text)) {
          continue;
        }
        lines[lineIndex] = lines[lineIndex] ? `${lines[lineIndex]}  ${text}` : text;
        mediumLineNotesRendered += mediumMode ? 1 : 0;
      }
    }

    for (const review of chunk.review) {
      const normalized = normalizeReviewItem(review, lineCount, sourceLines, languageId);
      reviewItems.push(normalized);
      const lineIndex = normalized.startLine - 1;
      const reviewText = sanitizeLine(`Review: ${normalized.message}${normalized.suggestion ? ` Suggestion: ${normalized.suggestion}` : ''}`);
      lines[lineIndex] = lines[lineIndex] ? `${lines[lineIndex]}  ${reviewText}` : reviewText;
    }
  }

  const cleanedLines = sourceLines ? clearIgnorableRows(lines, sourceLines, languageId) : lines;

  return {
    text: cleanedLines.join('\n'),
    lines: cleanedLines,
    reviewItems,
    fileSummary: sanitizeLine(response.fileSummary)
  };
}

export function renderPendingExplanation(lineCount: number, message: string): RenderedExplanation {
  const lines = Array.from({ length: lineCount }, () => '');
  if (lines.length > 0) {
    lines[0] = sanitizeLine(message);
  }

  return {
    text: lines.join('\n'),
    lines,
    reviewItems: [],
    fileSummary: sanitizeLine(message)
  };
}

export function sanitizeLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeReviewItem(
  item: ReviewItem,
  lineCount: number,
  sourceLines: string[] | undefined,
  languageId: string
): ReviewItem {
  const startLine = clamp(item.startLine, 1, lineCount);
  const endLine = clamp(item.endLine, startLine, lineCount);
  const anchor = sourceLines
    ? firstMeaningfulLineInRange(sourceLines, languageId, startLine, endLine) ?? startLine
    : startLine;

  return {
    ...item,
    startLine: anchor,
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

function isIgnorableLine(sourceLines: string[] | undefined, languageId: string, lineNumber: number): boolean {
  return sourceLines ? isIgnorableSourceLine(sourceLines[lineNumber - 1] ?? '', languageId) : false;
}

function clearIgnorableRows(lines: string[], sourceLines: string[], languageId: string): string[] {
  return lines.map((line, index) =>
    isIgnorableSourceLine(sourceLines[index] ?? '', languageId) ? '' : line
  );
}

function isBlankOrCommentNarration(text: string): boolean {
  return /^(blank line|empty line|comment\b|section comment\b|comment marking\b|comment continuing\b)/i.test(text);
}

function getMediumLineNoteLimit(startLine: number, endLine: number): number {
  const chunkLineCount = Math.max(1, endLine - startLine + 1);
  return Math.max(2, Math.min(4, Math.ceil(chunkLineCount / 4)));
}

function isSimpleGroupedLine(line: string, languageId: string): boolean {
  const trimmed = line.trim();

  if (languageId === 'python') {
    return (
      /^from\s+\S+\s+import\s+/.test(trimmed) ||
      /^import\s+\S+/.test(trimmed) ||
      /^\w+\s*:\s*[\w.[\]'"|, ]+$/.test(trimmed) ||
      /^self\.\w+\s*=/.test(trimmed)
    );
  }

  if (languageId === 'r') {
    return /^library\s*\(/.test(trimmed) || /^\w[\w.]*\s*(<-|=)\s*[^({]+$/.test(trimmed);
  }

  if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(languageId)) {
    return (
      /^import\s+/.test(trimmed) ||
      /^(export\s+)?(type|interface)\s+\w+/.test(trimmed) ||
      /^\w+\??:\s*[\w.[\]'"|, <>]+[,;]?$/.test(trimmed) ||
      /^(const|let|var)\s+\w+\s*=/.test(trimmed)
    );
  }

  return false;
}
