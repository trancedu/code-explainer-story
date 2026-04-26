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

test('renderExplanation lets story overflow stay on the final chunk row', () => {
  const source = [
    'def choose(value):',
    '    if value:',
    '        return "yes"'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 3,
        summary: 'The function starts by receiving a value and then treats that value like a small decision point in the story.',
        lines: [
          { line: 2, text: 'The if statement asks whether the value is truthy, which means Python considers it present or meaningful enough to enter the branch.' },
          { line: 3, text: 'When that branch succeeds, the function immediately returns the yes result to the caller.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(3, response, {
    sourceText: source,
    languageId: 'python',
    level: 'story',
    wrapColumn: 38
  });

  assert.ok(rendered.lines[0].length <= 38);
  assert.ok(rendered.lines[1].length <= 38);
  assert.match(rendered.lines[2], /truthy/);
  assert.match(rendered.lines[2], /yes result/);
  assert.ok(rendered.lines[2].length > 38);
});

test('renderExplanation keeps story prose in narrative order', () => {
  const source = [
    'def _post_json(url, payload):',
    '    body = json.dumps(payload).encode()',
    '    req = urllib.request.Request(url, data=body)',
    '    with urllib.request.urlopen(req) as resp:',
    '        return json.loads(resp.read().decode())'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'Example',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 5,
        summary: 'The helper starts with a URL and payload, then prepares a proper API request before reading the JSON answer.',
        lines: [
          { line: 2, text: 'The payload is encoded into bytes because HTTP bodies travel as raw data.' },
          { line: 3, text: 'The Request object combines the destination URL with the encoded body.' },
          { line: 4, text: 'The network call sends the request and waits for the server reply.' },
          { line: 5, text: 'Finally, the reply body is decoded and parsed back into JSON.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(5, response, {
    sourceText: source,
    languageId: 'python',
    level: 'story',
    wrapColumn: 46
  });
  const narrative = rendered.lines.join(' ');

  assert.ok(narrative.indexOf('proper API request') < narrative.indexOf('encoded into bytes'));
  assert.ok(narrative.indexOf('encoded into bytes') < narrative.indexOf('Request object'));
  assert.ok(narrative.indexOf('Request object') < narrative.indexOf('network call'));
  assert.ok(narrative.indexOf('network call') < narrative.indexOf('Finally'));
});

test('renderExplanation builds smooth walkthrough prose without line-label scaffolding', () => {
  const source = [
    'def choose(value):',
    '    if value > 10:',
    '        return "large"',
    '    else:',
    '        print("small")',
    '    return "done"',
    '# comment that should not be explained'
  ].join('\n');
  const response: ExplanationResponse = {
    fileSummary: 'A tiny decision helper.',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 7,
        summary: 'The helper receives a value, makes a branch decision, and then finishes with a final result.',
        lines: [
          { line: 2, text: 'The if condition asks whether value is greater than ten; when true, Python enters the indented block immediately below it.' },
          { line: 3, text: 'This return exits the function early with the large label, so the later print and final return do not run in that branch.' },
          { line: 4, text: 'The else branch is the fallback path for values that did not satisfy the greater-than-ten test.' },
          { line: 6, text: 'After the fallback work, the function returns the done marker to its caller.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(7, response, {
    sourceText: source,
    languageId: 'python',
    level: 'walkthrough',
    wrapColumn: 72
  });
  const text = rendered.lines.join('\n');

  assert.match(text, /A tiny decision helper/);
  assert.match(text, /The helper receives a value/);
  assert.match(text, /The if condition asks/);
  assert.match(text, /The else branch/);
  assert.doesNotMatch(text, /Line \d+:/);
  assert.doesNotMatch(text, /Lines \d+-\d+:/);
  assert.doesNotMatch(text, /The code here is/);
  assert.doesNotMatch(text, /does not silently skip meaningful code/);
  assert.doesNotMatch(text, /comment that should not be explained/);
});

test('renderExplanation omits streaming progress banner in walkthrough mode', () => {
  const response: ExplanationResponse = {
    fileSummary: 'Generated 9 of 54 chunks...',
    chunks: [
      {
        id: 'chunk-1-1',
        startLine: 1,
        endLine: 2,
        summary: 'The file opens by introducing the SDK and explaining what service it talks to.',
        lines: [
          { line: 1, text: 'This opening sets context before the executable code begins.' }
        ],
        review: []
      }
    ]
  };

  const rendered = renderExplanation(2, response, {
    sourceText: '"""SDK introduction"""',
    languageId: 'python',
    level: 'walkthrough',
    wrapColumn: 80
  });
  const text = rendered.lines.join('\n');

  assert.doesNotMatch(text, /Generated 9 of 54 chunks/);
  assert.match(text, /The file opens by introducing the SDK/);
});

test('sanitizeLine collapses all whitespace to one physical line', () => {
  assert.equal(sanitizeLine(' one\n two\t three  '), 'one two three');
});
