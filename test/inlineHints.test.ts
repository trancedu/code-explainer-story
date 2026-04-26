import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInlineHints, truncateInlineText } from '../src/inline/inlineHints';

test('buildInlineHints creates hints only for nonblank explanation lines', () => {
  const hints = buildInlineHints(
    ['Explains imports.', '', 'Builds the request model.'],
    ['import x', '', 'class Request:'],
    {
      maxHints: 10,
      maxTextLength: 80,
      maxCodeColumns: 100
    }
  );

  assert.deepEqual(
    hints.map((hint) => ({ line: hint.line, text: hint.text })),
    [
      { line: 1, text: 'Explains imports.' },
      { line: 3, text: 'Builds the request model.' }
    ]
  );
});

test('buildInlineHints hides end-of-line text for wide source rows', () => {
  const hints = buildInlineHints(
    ['Explains a wide expression.'],
    ['x'.repeat(120)],
    {
      maxHints: 10,
      maxTextLength: 80,
      maxCodeColumns: 100
    }
  );

  assert.equal(hints[0].showAfterCode, false);
});

test('buildInlineHints skips blank source rows used for wrapped explanation overflow', () => {
  const hints = buildInlineHints(
    ['Starts a long explanation.', 'overflow continuation fragment.', 'Next real line.'],
    ['value = compute()', '   ', 'return value'],
    {
      maxHints: 10,
      maxTextLength: 80,
      maxCodeColumns: 100
    }
  );

  assert.deepEqual(
    hints.map((hint) => ({ line: hint.line, text: hint.text })),
    [
      { line: 1, text: 'Starts a long explanation.' },
      { line: 3, text: 'Next real line.' }
    ]
  );
});

test('buildInlineHints limits and truncates inline text', () => {
  const hints = buildInlineHints(
    ['A '.repeat(20), 'Second hint.'],
    ['short', 'short'],
    {
      maxHints: 1,
      maxTextLength: 12,
      maxCodeColumns: 100
    }
  );

  assert.equal(hints.length, 1);
  assert.equal(hints[0].text, 'A A A A A...');
});

test('buildInlineHints treats zero maxHints as unlimited', () => {
  const hints = buildInlineHints(
    ['First hint.', 'Second hint.'],
    ['short', 'short'],
    {
      maxHints: 0,
      maxTextLength: 80,
      maxCodeColumns: 100
    }
  );

  assert.equal(hints.length, 2);
});

test('truncateInlineText normalizes whitespace', () => {
  assert.equal(truncateInlineText('  Explains\n\nthis\tline.  ', 80), 'Explains this line.');
});
