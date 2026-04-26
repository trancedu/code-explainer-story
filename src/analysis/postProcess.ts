import { ExplanationLevel, ExplanationResponse, RenderedExplanation, ReviewItem } from '../types';
import { firstMeaningfulLineInRange, isIgnorableSourceLine, splitSourceLines } from './sourceLines';

export type RenderExplanationOptions = {
  sourceText?: string;
  languageId?: string;
  level?: ExplanationLevel;
  wrapColumn?: number;
};

const defaultWrapColumn = 80;

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
  const storyMode = level === 'story';
  const walkthroughMode = level === 'walkthrough';

  if (walkthroughMode) {
    return renderWalkthroughExplanation(
      lineCount,
      response,
      sourceLines,
      languageId,
      options.wrapColumn ?? 104
    );
  }

  for (const chunk of response.chunks) {
    const start = clamp(chunk.startLine, 1, lineCount);
    const end = clamp(chunk.endLine, 1, lineCount);
    const anchor = sourceLines
      ? firstMeaningfulLineInRange(sourceLines, languageId, start, end)
      : start;

    if (storyMode) {
      renderStoryChunk(lines, chunk, sourceLines, languageId, lineCount, anchor);
    } else {
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
  const wrappedLines = wrapChunkedExplanations(
    cleanedLines,
    response,
    lineCount,
    options.wrapColumn ?? defaultWrapColumn
  );

  return {
    text: wrappedLines.join('\n'),
    lines: wrappedLines,
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

function renderStoryChunk(
  lines: string[],
  chunk: ExplanationResponse['chunks'][number],
  sourceLines: string[] | undefined,
  languageId: string,
  lineCount: number,
  anchor: number | undefined
): void {
  if (anchor === undefined) {
    return;
  }

  const parts: string[] = [];
  const summary = sanitizeLine(chunk.summary);
  if (summary && !isBlankOrCommentNarration(summary)) {
    parts.push(summary);
  }

  for (const item of [...chunk.lines].sort((a, b) => a.line - b.line)) {
    const lineNumber = clamp(item.line, 1, lineCount);
    if (isIgnorableLine(sourceLines, languageId, lineNumber)) {
      continue;
    }

    const text = sanitizeLine(item.text);
    if (!text || isBlankOrCommentNarration(text)) {
      continue;
    }

    parts.push(text);
  }

  const narrative = parts.join(' ');
  if (!narrative) {
    return;
  }

  const lineIndex = anchor - 1;
  lines[lineIndex] = lines[lineIndex] ? `${lines[lineIndex]}  ${narrative}` : narrative;
}

function renderWalkthroughExplanation(
  lineCount: number,
  response: ExplanationResponse,
  sourceLines: string[] | undefined,
  languageId: string,
  wrapColumn: number
): RenderedExplanation {
  const lines: string[] = [];
  const reviewItems: ReviewItem[] = [];
  const column = Math.max(48, Math.floor(wrapColumn));
  const fileSummary = sanitizeLine(response.fileSummary);

  if (fileSummary) {
    pushWrappedParagraph(lines, `File walkthrough: ${fileSummary}`, column);
    lines.push('');
  }

  for (const chunk of [...response.chunks].sort((a, b) => a.startLine - b.startLine)) {
    const start = clamp(chunk.startLine, 1, lineCount);
    const end = clamp(chunk.endLine, 1, lineCount);
    const summary = sanitizeLine(chunk.summary);
    const rangePrefix = start === end ? `Line ${start}` : `Lines ${start}-${end}`;

    if (summary && !isBlankOrCommentNarration(summary)) {
      pushWrappedParagraph(lines, `${rangePrefix}: ${summary}`, column);
    } else {
      pushWrappedParagraph(lines, `${rangePrefix}: Walk through this part of the file.`, column);
    }

    const sortedLineNotes = [...chunk.lines].sort((a, b) => a.line - b.line);
    const explainedLineNumbers = new Set<number>();
    for (const item of sortedLineNotes) {
      const lineNumber = clamp(item.line, 1, lineCount);
      if (isIgnorableLine(sourceLines, languageId, lineNumber)) {
        continue;
      }

      const text = sanitizeLine(item.text);
      if (!text || isBlankOrCommentNarration(text)) {
        continue;
      }

      pushWrappedParagraph(lines, `Line ${lineNumber}: ${text}`, column, '  ');
      explainedLineNumbers.add(lineNumber);
    }

    if (sourceLines) {
      for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
        const sourceLine = sourceLines[lineNumber - 1] ?? '';
        if (
          explainedLineNumbers.has(lineNumber) ||
          isIgnorableSourceLine(sourceLine, languageId) ||
          isTrulyUnimportantSourceLine(sourceLine)
        ) {
          continue;
        }

        pushWrappedParagraph(
          lines,
          `Line ${lineNumber}: The code here is \`${sourceSnippet(sourceLine)}\`. Read it as a small continuation of this range; it is included so the walkthrough does not silently skip meaningful code.`,
          column,
          '  '
        );
      }
    }

    for (const review of chunk.review) {
      const normalized = normalizeReviewItem(review, lineCount, sourceLines, languageId);
      reviewItems.push(normalized);
      const reviewText = sanitizeLine(`Review for lines ${normalized.startLine}-${normalized.endLine}: ${normalized.message}${normalized.suggestion ? ` Suggestion: ${normalized.suggestion}` : ''}`);
      pushWrappedParagraph(lines, reviewText, column, '  ');
    }

    if (lines[lines.length - 1] !== '') {
      lines.push('');
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return {
    text: lines.join('\n'),
    lines,
    reviewItems,
    fileSummary
  };
}

function pushWrappedParagraph(lines: string[], text: string, column: number, continuationIndent = ''): void {
  const segments = wrapText(text, column);
  if (segments.length === 0) {
    return;
  }

  lines.push(segments[0]);
  for (const segment of segments.slice(1)) {
    lines.push(`${continuationIndent}${segment}`);
  }
}

function isTrulyUnimportantSourceLine(line: string): boolean {
  const trimmed = line.trim();
  return /^["']{3}$/.test(trimmed) || /^[{}\[\](),;]+$/.test(trimmed) || /^[)\]}]+[),;]*$/.test(trimmed);
}

function sourceSnippet(line: string): string {
  const trimmed = sanitizeLine(line);
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed;
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

function wrapChunkedExplanations(
  lines: string[],
  response: ExplanationResponse,
  lineCount: number,
  wrapColumn: number
): string[] {
  const wrapped = [...lines];
  const column = Math.max(20, Math.floor(wrapColumn));

  for (const chunk of response.chunks) {
    const startIndex = clamp(chunk.startLine, 1, lineCount) - 1;
    const endIndex = clamp(chunk.endLine, 1, lineCount) - 1;
    const initialNonEmptyRows: number[] = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
      if (wrapped[index]?.trim()) {
        initialNonEmptyRows.push(index);
      }
    }

    for (const rowIndex of initialNonEmptyRows) {
      const text = wrapped[rowIndex];
      if (!text || text.length <= column) {
        continue;
      }

      const segments = wrapText(text, column);
      if (segments.length <= 1) {
        continue;
      }

      wrapped[rowIndex] = segments.shift() ?? '';

      while (segments.length > 0) {
        const emptyRow = findNextEmptyRow(wrapped, rowIndex + 1, endIndex);
        if (emptyRow === undefined) {
          const fallbackIndex = endIndex;
          wrapped[fallbackIndex] = appendText(wrapped[fallbackIndex], segments.join(' '));
          break;
        }

        wrapped[emptyRow] = segments.shift() ?? '';
      }
    }
  }

  return wrapped;
}

function findNextEmptyRow(lines: string[], startIndex: number, endIndex: number): number | undefined {
  for (let index = startIndex; index <= endIndex; index += 1) {
    if (!lines[index]?.trim()) {
      return index;
    }
  }

  return undefined;
}

function appendText(existing: string, next: string): string {
  const sanitizedNext = sanitizeLine(next);
  if (!sanitizedNext) {
    return existing;
  }

  return existing ? `${existing} ${sanitizedNext}` : sanitizedNext;
}

function wrapText(text: string, column: number): string[] {
  const words = sanitizeLine(text).split(/\s+/).filter(Boolean);
  const segments: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (current.length + 1 + word.length <= column) {
      current = `${current} ${word}`;
      continue;
    }

    segments.push(current);
    current = word;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}
