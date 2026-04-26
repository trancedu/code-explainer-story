import { explanationJsonSchema, validateExplanationResponse } from '../openai/schema';
import { extractCompletedChunksFromJsonText } from '../openai/OpenAIClient';
import { systemPrompt } from '../llm/prompt';
import { ExplanationChunk, ExplanationResponse, FilePayload } from '../types';

type FetchLike = (input: string, init: RequestInit) => Promise<ResponseLike>;

type ResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

export type AnthropicGenerateOptions = {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
};

const anthropicVersion = '2023-06-01';
const maxOutputTokens = 8192;

export class AnthropicClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async generateExplanation(payload: FilePayload, options: AnthropicGenerateOptions): Promise<ExplanationResponse> {
    const outputText = await this.request(payload, options, false);
    const parsed = parseJson(extractJsonObjectText(outputText), 'Claude output text was not valid JSON.');
    return validateExplanationResponse(parsed);
  }

  async generateExplanationStream(
    payload: FilePayload,
    options: AnthropicGenerateOptions,
    onChunk: (chunk: ExplanationChunk) => void | Promise<void>
  ): Promise<ExplanationResponse> {
    const outputText = await this.request(payload, options, true, onChunk);
    const parsed = parseJson(extractJsonObjectText(outputText), 'Claude output text was not valid JSON.');
    return validateExplanationResponse(parsed);
  }

  private async request(
    payload: FilePayload,
    options: AnthropicGenerateOptions,
    stream: boolean,
    onChunk?: (chunk: ExplanationChunk) => void | Promise<void>
  ): Promise<string> {
    const response = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: options.signal,
      headers: {
        'x-api-key': options.apiKey,
        'anthropic-version': anthropicVersion,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: maxOutputTokens,
        stream,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: buildUserPrompt(payload)
          }
        ]
      })
    });

    if (!response.ok) {
      const rawText = await response.text();
      throw new Error(`Claude request failed (${response.status} ${response.statusText}): ${redact(rawText, options.apiKey)}`);
    }

    if (stream) {
      return readStreamingOutput(response, options.apiKey, onChunk);
    }

    const raw = parseJson(await response.text(), 'Claude API response was not valid JSON.');
    return extractOutputText(raw);
  }
}

function buildUserPrompt(payload: FilePayload): string {
  return [
    'Explain this file payload and return only JSON that matches this JSON Schema.',
    'Do not wrap the JSON in markdown fences.',
    `JSON Schema: ${JSON.stringify(explanationJsonSchema)}`,
    `Payload: ${JSON.stringify(payload)}`
  ].join('\n\n');
}

async function readStreamingOutput(
  response: ResponseLike,
  apiKey: string,
  onChunk?: (chunk: ExplanationChunk) => void | Promise<void>
): Promise<string> {
  if (!response.body) {
    const raw = parseJson(await response.text(), 'Claude API response was not valid JSON.');
    return extractOutputText(raw);
  }

  let outputText = '';
  const emittedChunkIds = new Set<string>();

  for await (const eventData of readServerSentEvents(response.body)) {
    const event = parseJson(eventData, 'Claude stream event was not valid JSON.');
    if (!isObject(event)) {
      continue;
    }

    const delta = event.delta;
    const isTextDelta =
      event.type === 'content_block_delta' &&
      isObject(delta) &&
      delta.type === 'text_delta' &&
      typeof delta.text === 'string';

    if (isTextDelta) {
      outputText += delta.text;
    } else if (event.type === 'error' || isObject(event.error)) {
      throw new Error(`Claude stream failed: ${redact(JSON.stringify(event), apiKey)}`);
    }

    if (!onChunk) {
      continue;
    }

    for (const chunk of extractCompletedChunksFromJsonText(outputText)) {
      if (emittedChunkIds.has(chunk.id)) {
        continue;
      }

      emittedChunkIds.add(chunk.id);
      await onChunk(chunk);
    }
  }

  return outputText;
}

async function* readServerSentEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const data = part
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (data) {
        yield data;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const data = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');

    if (data) {
      yield data;
    }
  }
}

function extractOutputText(raw: unknown): string {
  if (!isObject(raw) || !Array.isArray(raw.content)) {
    throw new Error('Claude response did not include output text.');
  }

  return raw.content
    .filter((item): item is { type: string; text: string } => isObject(item) && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');
}

function extractJsonObjectText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function parseJson(value: string, errorMessage: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(errorMessage);
  }
}

function redact(value: string, apiKey: string): string {
  return value.replaceAll(apiKey, '[redacted]');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
