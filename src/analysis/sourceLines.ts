export function splitSourceLines(text: string): string[] {
  if (text.length === 0) {
    return [''];
  }

  return text.split(/\r?\n/);
}

export function isIgnorableSourceLine(line: string, languageId: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  if (languageId === 'python') {
    return trimmed.startsWith('#');
  }

  if (languageId === 'r') {
    return trimmed.startsWith('#');
  }

  if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(languageId)) {
    return (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/')
    );
  }

  return trimmed.startsWith('#') || trimmed.startsWith('//');
}

export function firstMeaningfulLineInRange(
  sourceLines: string[],
  languageId: string,
  startLine: number,
  endLine: number
): number | undefined {
  const start = Math.max(1, startLine);
  const end = Math.min(sourceLines.length, endLine);

  for (let line = start; line <= end; line += 1) {
    if (!isIgnorableSourceLine(sourceLines[line - 1] ?? '', languageId)) {
      return line;
    }
  }

  return undefined;
}

