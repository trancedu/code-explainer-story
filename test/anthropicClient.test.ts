import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicClient } from '../src/anthropic/AnthropicClient';
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

test('AnthropicClient sends one Messages API request and parses Claude output JSON', async () => {
  let calls = 0;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  let requestBody: Record<string, any> | undefined;

  const client = new AnthropicClient(async (url, init) => {
    calls += 1;
    requestUrl = url;
    requestInit = init;
    requestBody = JSON.parse(String(init.body));
    return jsonResponse({
      content: [
        {
          type: 'text',
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
    });
  });

  const result = await client.generateExplanation(payload, {
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-4-6'
  });

  assert.equal(calls, 1);
  assert.equal(requestUrl, 'https://api.anthropic.com/v1/messages');
  assert(requestInit);
  const headers = requestInit.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'sk-ant-test');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert(requestBody);
  assert.equal(requestBody.model, 'claude-sonnet-4-6');
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.max_tokens, 8192);
  assert.equal(typeof requestBody.system, 'string');
  assert.match(requestBody.messages[0].content, /JSON Schema:/);
  assert.match(requestBody.messages[0].content, /Payload:/);
  assert.equal(result.fileSummary, 'Logs a greeting.');
  assert.equal(result.chunks[0].lines[0].text, 'Logs hi to the console.');
});

test('AnthropicClient streams completed chunks before the final JSON closes', async () => {
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
  let requestBody: Record<string, any> | undefined;
  const streamedIds: string[] = [];

  const client = new AnthropicClient(async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return streamResponse([
      { type: 'message_start', message: { id: 'msg_1' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: firstDelta }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: secondDelta }
      },
      { type: 'message_stop' }
    ]);
  });

  const result = await client.generateExplanationStream(
    payload,
    {
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6'
    },
    (streamedChunk) => {
      streamedIds.push(streamedChunk.id);
    }
  );

  assert(requestBody);
  assert.equal(requestBody.stream, true);
  assert.deepEqual(streamedIds, ['chunk-1-1']);
  assert.equal(result.chunks[0].summary, 'Writes text to the console.');
});

test('AnthropicClient redacts API key from error bodies', async () => {
  const client = new AnthropicClient(async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'bad key sk-ant-secret-value'
  }));

  await assert.rejects(
    () =>
      client.generateExplanation(payload, {
        apiKey: 'sk-ant-secret-value',
        model: 'claude-sonnet-4-6'
      }),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /\[redacted\]/);
      assert.doesNotMatch(error.message, /sk-ant-secret-value/);
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
