import { CodeChunk } from '../types';

export function fallbackChunkText(text: string, languageId: string, maxChunkLines: number): CodeChunk[] {
  const lines = splitLines(text);
  if (lines.length === 0) {
    return [];
  }

  const boundaries = collectBoundaries(lines, languageId);
  boundaries.add(1);
  boundaries.add(lines.length + 1);

  const sorted = [...boundaries].sort((a, b) => a - b);
  const chunks: Array<{ startLine: number; endLine: number; kind: string; symbolPath: string }> = [];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const startLine = sorted[index];
    const endLine = sorted[index + 1] - 1;
    if (startLine <= endLine) {
      chunks.push({
        startLine,
        endLine,
        kind: inferKind(lines[startLine - 1] ?? '', languageId),
        symbolPath: inferSymbolPath(lines[startLine - 1] ?? '')
      });
    }
  }

  return chunks.flatMap((chunk, index) => splitChunk(chunk, lines, maxChunkLines, index));
}

export function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [''];
  }
  return text.split(/\r?\n/);
}

function collectBoundaries(lines: string[], languageId: string): Set<number> {
  const boundaries = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (isLanguageBoundary(line, lines[index - 1], languageId)) {
      boundaries.add(lineNumber);
      continue;
    }

    if (/^\s*#{2,}\s+\S/.test(line) || /^\s*\/\/\s*#{2,}\s+\S/.test(line)) {
      boundaries.add(lineNumber);
    }
  }

  return boundaries;
}

function isLanguageBoundary(line: string, previousLine: string | undefined, languageId: string): boolean {
  if (languageId === 'python') {
    return /^(@\w|class\s+\w|def\s+\w|async\s+def\s+\w)/.test(line.trim());
  }

  if (languageId === 'r') {
    return /^\w[\w.]*\s*(<-|=)\s*function\s*\(/.test(line.trim()) || /^#'\s+@/.test(line.trim());
  }

  if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(languageId)) {
    const trimmed = line.trim();
    const declaration =
      /^(export\s+)?(async\s+)?function\s+\w/.test(trimmed) ||
      /^(export\s+)?(abstract\s+)?class\s+\w/.test(trimmed) ||
      /^(export\s+)?interface\s+\w/.test(trimmed) ||
      /^(export\s+)?type\s+\w/.test(trimmed) ||
      /^(export\s+)?enum\s+\w/.test(trimmed);
    const decoratedClass = previousLine?.trim().startsWith('@') && /^(export\s+)?class\s+\w/.test(trimmed);
    return declaration || Boolean(decoratedClass);
  }

  return /^\S/.test(line) && previousLine !== undefined && previousLine.trim() === '';
}

function inferKind(line: string, languageId: string): string {
  const trimmed = line.trim();
  if (/^class\s+|^export\s+class\s+/.test(trimmed)) {
    return 'class';
  }
  if (/^(async\s+)?def\s+|^(export\s+)?(async\s+)?function\s+/.test(trimmed)) {
    return 'function';
  }
  if (languageId === 'r' && /^\w[\w.]*\s*(<-|=)\s*function\s*\(/.test(trimmed)) {
    return 'function';
  }
  if (/^(export\s+)?interface\s+/.test(trimmed)) {
    return 'interface';
  }
  if (/^(export\s+)?type\s+/.test(trimmed)) {
    return 'type';
  }
  return 'section';
}

function inferSymbolPath(line: string): string {
  const trimmed = line.trim();
  const patterns = [
    /^(?:export\s+)?(?:abstract\s+)?class\s+([\w$]+)/,
    /^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/,
    /^(?:async\s+)?def\s+([\w_]+)/,
    /^class\s+([\w_]+)/,
    /^([\w.]+)\s*(?:<-|=)\s*function\s*\(/,
    /^(?:export\s+)?interface\s+([\w$]+)/,
    /^(?:export\s+)?type\s+([\w$]+)/
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match) {
      return match[1];
    }
  }

  return 'top-level';
}

function splitChunk(
  chunk: { startLine: number; endLine: number; kind: string; symbolPath: string },
  lines: string[],
  maxChunkLines: number,
  chunkIndex: number
): CodeChunk[] {
  const result: CodeChunk[] = [];
  let startLine = chunk.startLine;
  let part = 1;

  while (startLine <= chunk.endLine) {
    const endLine = Math.min(chunk.endLine, startLine + maxChunkLines - 1);
    result.push({
      id: `chunk-${chunkIndex + 1}-${part}`,
      startLine,
      endLine,
      kind: chunk.kind,
      symbolPath: part === 1 ? chunk.symbolPath : `${chunk.symbolPath} part ${part}`,
      code: lineNumberedCode(lines, startLine, endLine)
    });
    startLine = endLine + 1;
    part += 1;
  }

  return result;
}

export function lineNumberedCode(lines: string[], startLine: number, endLine: number): string {
  const width = String(endLine).length;
  const selected = lines.slice(startLine - 1, endLine);
  return selected
    .map((line, index) => `${String(startLine + index).padStart(width, ' ')} | ${line}`)
    .join('\n');
}

