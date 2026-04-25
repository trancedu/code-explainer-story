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

test('renderExplanation clears blank and comment-only source rows even in detailed mode', () => {
  const source = [
    'def convert(value):',
    '    return value',
    '',
    '# Request/response models',
    'class QueryRequest(BaseModel):',
    '    task: str'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 6,
        summary: 'Converts values and defines a request model.',
        lines: [
          { line: 1, text: 'Defines a conversion helper.' },
          { line: 3, text: 'Blank line after the helper function.' },
          { line: 4, text: 'Comment marking the request/response models section.' },
          { line: 5, text: 'Defines the request schema.' },
          { line: 6, text: 'Stores task as a string.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(6, response, {
    sourceText: source,
    languageId: 'python',
    level: 'detailed'
  });

  assert.equal(rendered.lines[2], '');
  assert.equal(rendered.lines[3], '');
  assert.match(rendered.lines[0], /Converts values/);
  assert.match(rendered.lines[4], /Defines the request schema/);
});

test('renderExplanation uses chunk-flow summaries for concise and medium modes', () => {
  const source = [
    'class QueryRequest(BaseModel):',
    '    task: str',
    '    name: str',
    '    query: str'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 4,
        summary: 'Defines the request payload schema for query execution.',
        lines: [
          { line: 2, text: 'Declares task as a string.' },
          { line: 3, text: 'Declares name as a string.' },
          { line: 4, text: 'Declares query as a string.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(4, response, {
    sourceText: source,
    languageId: 'python',
    level: 'medium'
  });

  assert.equal(rendered.lines[0], 'Defines the request payload schema for query execution.');
  assert.equal(rendered.lines[1], '');
  assert.equal(rendered.lines[2], '');
  assert.equal(rendered.lines[3], '');
});

test('renderExplanation includes a few important line notes in medium mode', () => {
  const source = [
    'def choose(value):',
    '    if value > 10:',
    '        return "large"',
    '    if value < 0:',
    '        raise ValueError("negative")',
    '    return "ok"'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 6,
        summary: 'Chooses a label after validating the input range.',
        lines: [
          { line: 2, text: 'Branches when the value is above the high threshold.' },
          { line: 5, text: 'Rejects negative input instead of returning a normal label.' },
          { line: 6, text: 'Falls back to the normal label.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(6, response, {
    sourceText: source,
    languageId: 'python',
    level: 'medium'
  });

  assert.match(rendered.lines[0], /Chooses a label/);
  assert.match(rendered.lines[1], /Branches/);
  assert.match(rendered.lines[4], /Rejects negative/);
  assert.equal(rendered.lines[5], '');
});

test('renderExplanation anchors chunk summaries to the first meaningful line', () => {
  const source = [
    '',
    '# Helpers',
    'def run():',
    '    return 1'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 4,
        summary: 'Runs the helper flow.',
        lines: [],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(4, response, {
    sourceText: source,
    languageId: 'python',
    level: 'concise'
  });

  assert.deepEqual(rendered.lines, ['', '', 'Runs the helper flow.', '']);
});

test('renderExplanation wraps long explanations into empty rows below within the chunk', () => {
  const source = [
    'def run():',
    '    call_one()',
    '    call_two()',
    '    call_three()'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 4,
        summary: 'Coordinates database validation query execution and response shaping for the endpoint.',
        lines: [],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(4, response, {
    sourceText: source,
    languageId: 'python',
    level: 'concise',
    wrapColumn: 34
  });

  assert.equal(rendered.lines.length, 4);
  assert.ok(rendered.lines[0].length <= 34);
  assert.ok(rendered.lines[1].length > 0);
  assert.match(`${rendered.lines[0]} ${rendered.lines[1]}`, /Coordinates database validation query execution/);
});

test('renderExplanation does not wrap text into the next chunk', () => {
  const source = [
    'def first():',
    '    return 1',
    'def second():',
    '    return 2'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 2,
        summary: 'Explains the first helper with enough detail to require wrapping.',
        lines: [],
        review: []
      },
      {
        id: 'chunk-2-1',
        startLine: 3,
        endLine: 4,
        summary: 'Explains the second helper.',
        lines: [],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(4, response, {
    sourceText: source,
    languageId: 'python',
    level: 'concise',
    wrapColumn: 28
  });

  assert.match(rendered.lines[1], /detail/);
  assert.equal(rendered.lines[2], 'Explains the second helper.');
});

test('renderExplanation appends overflow to the chunk tail when no empty rows remain', () => {
  const source = [
    'def choose(value):',
    '    return value'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 2,
        summary: 'Explains the helper behavior with a long enough summary to wrap.',
        lines: [
          { line: 2, text: 'Existing line note.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(2, response, {
    sourceText: source,
    languageId: 'python',
    level: 'detailed',
    wrapColumn: 25
  });

  assert.match(rendered.lines[1], /Existing line note/);
  assert.match(rendered.lines[1], /summary to wrap/);
});

test('sanitizeLine collapses all whitespace to one physical line', () => {
  assert.equal(sanitizeLine(' one\n two\t three  '), 'one two three');
});
