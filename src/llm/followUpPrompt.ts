export type FollowUpPromptInput = {
  fileName: string;
  languageId: string;
  totalLines: number;
  focusLine: number;
  focusEndLine?: number;
  question: string;
  sourceText: string;
};

export function buildFollowUpUserPrompt(input: FollowUpPromptInput): string {
  return [
    `File: ${input.fileName}`,
    `Language: ${input.languageId}`,
    `Total lines: ${input.totalLines}`,
    formatFocus(input),
    `Question: ${input.question}`,
    'Full source file with 1-based line numbers:',
    numberSourceLines(input.sourceText)
  ].join('\n\n');
}

function formatFocus(input: FollowUpPromptInput): string {
  if (typeof input.focusEndLine === 'number' && input.focusEndLine > input.focusLine) {
    return `Focus lines: ${input.focusLine}-${input.focusEndLine}`;
  }

  return `Focus line: ${input.focusLine}`;
}

function numberSourceLines(sourceText: string): string {
  return sourceText
    .split(/\r?\n/)
    .map((line, index) => `${index + 1} | ${line}`)
    .join('\n');
}
