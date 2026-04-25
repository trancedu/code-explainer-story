import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIClient } from '../src/openai/OpenAIClient';
import { FilePayload } from '../src/types';

const payload: FilePayload = {
  fileName: 'example.ts',
  languageId: 'typescript',
  totalLines: 1,
  explanationLevel: 'medium',
  reviewEnabled: false,
  chunks: [
    {
      id: 'chunk-1-1',
      startLine: 1,
      endLine: 1,
      kind: 'function',
      symbolPath: 'main',
      code: '1 | console.log("hi");'
    }
  ]
};

test('OpenAIClient sends one Responses API request and parses structured output', async () => {
  let calls = 0;
  let requestBody: any;
  const client = new OpenAIClient(async (_url, init) => {
    calls += 1;
    requestBody = JSON.parse(String(init.body));
    return jsonResponse({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                fileSummary: 'Logs a greeting.',
                chunks: [
                  {
                    id: 'chunk-1-1',
                    startLine: 1,
                    endLine: 1,
                    summary: 'Writes text to the console.',
                    lines: [{ line: 1, text: 'Logs hi to the console.' }],
                    review: []
                  }
                ]
              })
            }
          ]
        }
      ]
    });
  });

  const result = await client.generateExplanation(payload, {
    apiKey: 'sk-test',
    model: 'gpt-5.4-mini'
  });

  assert.equal(calls, 1);
  assert.equal(requestBody.model, 'gpt-5.4-mini');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(result.fileSummary, 'Logs a greeting.');
  assert.equal(result.chunks[0].lines[0].text, 'Logs hi to the console.');
});

test('OpenAIClient redacts API key from error bodies', async () => {
  const client = new OpenAIClient(async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'bad key sk-secret-value'
  }));

  await assert.rejects(
    () =>
      client.generateExplanation(payload, {
        apiKey: 'sk-secret-value',
        model: 'gpt-5.4-mini'
      }),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /\[redacted\]/);
      assert.doesNotMatch(error.message, /sk-secret-value/);
      return true;
    }
  );
});

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(value)
  };
}

