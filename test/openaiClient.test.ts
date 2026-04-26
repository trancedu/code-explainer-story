import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCompletedChunksFromJsonText, OpenAIClient } from '../src/openai/OpenAIClient';
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
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(result.fileSummary, 'Logs a greeting.');
  assert.equal(result.chunks[0].lines[0].text, 'Logs hi to the console.');
});

test('OpenAIClient streams completed chunks before the final JSON closes', async () => {
  const chunk = {
    id: 'chunk-1-1',
    startLine: 1,
    endLine: 1,
    summary: 'Writes text to the console.',
    lines: [{ line: 1, text: 'Logs hi to the console.' }],
    review: []
  };
  const firstDelta = `{"fileSummary":"Logs a greeting.","chunks":[${JSON.stringify(chunk)}`;
  const secondDelta = ']}';
  let requestBody: any;
  const streamedIds: string[] = [];

  const client = new OpenAIClient(async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return streamResponse([
      { type: 'response.output_text.delta', delta: firstDelta },
      { type: 'response.output_text.delta', delta: secondDelta },
      { type: 'response.completed' }
    ]);
  });

  const result = await client.generateExplanationStream(
    payload,
    {
      apiKey: 'sk-test',
      model: 'gpt-5.4-mini'
    },
    (streamedChunk) => {
      streamedIds.push(streamedChunk.id);
    }
  );

  assert.equal(requestBody.stream, true);
  assert.deepEqual(streamedIds, ['chunk-1-1']);
  assert.equal(result.chunks[0].summary, 'Writes text to the console.');
});

test('OpenAIClient uses medium reasoning effort for story mode', async () => {
  let requestBody: any;
  const client = new OpenAIClient(async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return jsonResponse({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                fileSummary: 'Explains the flow as a story.',
                chunks: [
                  {
                    id: 'chunk-1-1',
                    startLine: 1,
                    endLine: 1,
                    summary: 'The story begins by logging a greeting.',
                    lines: [],
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

  await client.generateExplanation(
    {
      ...payload,
      explanationLevel: 'story'
    },
    {
      apiKey: 'sk-test',
      model: 'gpt-5.4-mini'
    }
  );

  assert.equal(requestBody.reasoning.effort, 'medium');
});

test('extractCompletedChunksFromJsonText ignores incomplete trailing chunks', () => {
  const completeChunk = {
    id: 'chunk-1-1',
    startLine: 1,
    endLine: 1,
    summary: 'Complete chunk.',
    lines: [{ line: 1, text: 'Explains line one.' }],
    review: []
  };
  const text = `{"fileSummary":"Partial","chunks":[${JSON.stringify(completeChunk)},{"id":"chunk-2-1"`;

  const chunks = extractCompletedChunksFromJsonText(text);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].id, 'chunk-1-1');
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

function streamResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    }
  });

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body,
    text: async () => ''
  };
}
