import * as vscode from 'vscode';
import { CodeChunk } from '../types';
import { fallbackChunkText, lineNumberedCode, splitLines } from './fallbackChunker';

type ChunkRange = {
  startLine: number;
  endLine: number;
  kind: string;
  symbolPath: string;
};

export async function buildChunks(document: vscode.TextDocument, maxChunkLines: number): Promise<CodeChunk[]> {
  const symbolRanges = await getDocumentSymbolRanges(document);
  const lines = splitLines(document.getText());

  if (symbolRanges.length === 0) {
    return fallbackChunkText(document.getText(), document.languageId, maxChunkLines);
  }

  const ranges = fillGaps(normalizeRanges(symbolRanges, document.lineCount), document.lineCount);
  return ranges.flatMap((range, index) => splitRange(range, lines, maxChunkLines, index));
}

async function getDocumentSymbolRanges(document: vscode.TextDocument): Promise<ChunkRange[]> {
  try {
    const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );

    if (!symbols?.length) {
      return [];
    }

    return symbols.flatMap((symbol) => symbolToRanges(symbol, []));
  } catch {
    return [];
  }
}

function symbolToRanges(symbol: vscode.DocumentSymbol | vscode.SymbolInformation, parents: string[]): ChunkRange[] {
  if ('selectionRange' in symbol && 'children' in symbol) {
    const name = symbol.name || 'symbol';
    const currentPath = [...parents, name];
    const topLevel = parents.length === 0;
    const current = topLevel
      ? [
          {
            startLine: symbol.range.start.line + 1,
            endLine: symbol.range.end.line + 1,
            kind: vscode.SymbolKind[symbol.kind] ?? 'symbol',
            symbolPath: currentPath.join('.')
          }
        ]
      : [];
    return [...current, ...symbol.children.flatMap((child) => symbolToRanges(child, currentPath))];
  }

  const info = symbol as vscode.SymbolInformation;
  const name = info.name || 'symbol';
  return [
    {
      startLine: info.location.range.start.line + 1,
      endLine: info.location.range.end.line + 1,
      kind: vscode.SymbolKind[info.kind] ?? 'symbol',
      symbolPath: [...parents, name].join('.')
    }
  ];
}

function normalizeRanges(ranges: ChunkRange[], lineCount: number): ChunkRange[] {
  const sorted = ranges
    .map((range) => ({
      ...range,
      startLine: clamp(range.startLine, 1, lineCount),
      endLine: clamp(range.endLine, 1, lineCount)
    }))
    .filter((range) => range.startLine <= range.endLine)
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);

  const result: ChunkRange[] = [];
  for (const range of sorted) {
    const previous = result[result.length - 1];
    if (!previous || range.startLine > previous.endLine) {
      result.push(range);
      continue;
    }

    if (range.endLine > previous.endLine) {
      previous.endLine = range.endLine;
    }
  }

  return result;
}

function fillGaps(ranges: ChunkRange[], lineCount: number): ChunkRange[] {
  const filled: ChunkRange[] = [];
  let cursor = 1;

  for (const range of ranges) {
    if (cursor < range.startLine) {
      filled.push({
        startLine: cursor,
        endLine: range.startLine - 1,
        kind: 'section',
        symbolPath: 'top-level'
      });
    }

    filled.push(range);
    cursor = range.endLine + 1;
  }

  if (cursor <= lineCount) {
    filled.push({
      startLine: cursor,
      endLine: lineCount,
      kind: 'section',
      symbolPath: 'top-level'
    });
  }

  return filled;
}

function splitRange(range: ChunkRange, lines: string[], maxChunkLines: number, rangeIndex: number): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  let startLine = range.startLine;
  let part = 1;

  while (startLine <= range.endLine) {
    const endLine = Math.min(range.endLine, startLine + maxChunkLines - 1);
    chunks.push({
      id: `chunk-${rangeIndex + 1}-${part}`,
      startLine,
      endLine,
      kind: range.kind,
      symbolPath: part === 1 ? range.symbolPath : `${range.symbolPath} part ${part}`,
      code: lineNumberedCode(lines, startLine, endLine)
    });
    startLine = endLine + 1;
    part += 1;
  }

  return chunks;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

