import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExplanation, sanitizeLine } from '../src/analysis/postProcess';
import { ExplanationResponse } from '../src/types';

test('renderExplanation preserves source line count and sanitizes newlines', () => {
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 3,
        summary: ' Sets up the file. ',
        lines: [
          { line: 2, text: 'Creates\nvalue' },
          { line: 4, text: 'Clamped to final line' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(3, response);

  assert.equal(rendered.lines.length, 3);
  assert.equal(rendered.lines[0], 'Sets up the file.');
  assert.equal(rendered.lines[1], 'Creates value');
  assert.equal(rendered.lines[2], 'Clamped to final line');
  assert.equal(rendered.text.split('\n').length, 3);
});

test('renderExplanation adds review items to the matching line', () => {
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 1,
        summary: '',
        lines: [],
        review: [
          {
            startLine: 1,
            endLine: 1,
            severity: 'warning',
            category: 'correctness',
            message: 'Possible missing null check.',
            suggestion: 'Guard the value before use.'
          }
        ]
      }
    ]
  };

  const rendered = renderExplanation(1, response);

  assert.equal(rendered.reviewItems.length, 1);
  assert.match(rendered.lines[0], /Review: Possible missing null check/);
});

test('sanitizeLine collapses all whitespace to one physical line', () => {
  assert.equal(sanitizeLine(' one\n two\t three  '), 'one two three');
});

