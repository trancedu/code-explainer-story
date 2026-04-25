import { FilePayload, ExplanationChunk, ExplanationResponse } from '../types';
import { explanationJsonSchema, validateExplanationChunk, validateExplanationResponse } from './schema';

type FetchLike = (input: string, init: RequestInit) => Promise<ResponseLike>;

type ResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

export type GenerateOptions = {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
};

const systemPrompt = [
  'You explain code in a side-by-side reader.',
  'Return JSON only, matching the supplied schema.',
  'Each explanation line maps to a physical source line.',
  'Never include newline characters inside explanation strings.',
  'Never explain blank lines or comment-only lines. Leave those lines without explanation.',
  'Never write text such as "blank line", "empty line", "comment marking", or "comment continuing".',
  'Do not invent code behavior. State uncertainty briefly when needed.',
  'For concise level, write a compact flow summary in each chunk summary and keep lines sparse or empty.',
  'For medium level, explain the chunk flow and important decisions; do not narrate every field, import, or simple assignment line.',
  'For detailed level, explain meaningful executable or declarative code lines, but still skip blank and comment-only lines.',
  'Treat adjacent class fields, schema fields, object properties, imports, and constant declarations as a group when possible.',
  'If reviewEnabled is false, return empty review arrays.',
  'If reviewEnabled is true, focus review findings on correctness, security, performance, typing, and maintainability.'
].join(' ');

export class OpenAIClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async generateExplanation(payload: FilePayload, options: GenerateOptions): Promise<ExplanationResponse> {
    const rawText = await this.request(payload, options, false);
    const raw = parseJson(rawText, 'OpenAI API response was not valid JSON.');
    const outputText = extractOutputText(raw);
    const parsed = parseJson(outputText, 'OpenAI output text was not valid JSON.');
    return validateExplanationResponse(parsed);
  }

  async generateExplanationStream(
    payload: FilePayload,
    options: GenerateOptions,
    onChunk: (chunk: ExplanationChunk) => void | Promise<void>
  ): Promise<ExplanationResponse> {
    const outputText = await this.request(payload, options, true, onChunk);
    const parsed = parseJson(outputText, 'OpenAI output text was not valid JSON.');
    return validateExplanationResponse(parsed);
  }

  private async request(
    payload: FilePayload,
    options: GenerateOptions,
    stream: boolean,
    onChunk?: (chunk: ExplanationChunk) => void | Promise<void>
  ): Promise<string> {
    const body = {
      model: options.model,
      stream,
      reasoning: {
        effort: payload.reviewEnabled ? 'medium' : 'low'
      },
      input: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'code_explanation',
          strict: true,
          schema: explanationJsonSchema
        }
      }
    };

    const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const rawText = await response.text();
      throw new Error(`OpenAI request failed (${response.status} ${response.statusText}): ${redact(rawText, options.apiKey)}`);
    }

    if (stream) {
      return readStreamingOutput(response, options.apiKey, onChunk);
    }

    return response.text();
  }
}

export function extractCompletedChunksFromJsonText(text: string): ExplanationChunk[] {
  const arrayStart = findChunksArrayStart(text);
  if (arrayStart === -1) {
    return [];
  }

  const chunks: ExplanationChunk[] = [];
  let inString = false;
  let escaping = false;
  let objectStart = -1;
  let objectDepth = 0;

  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const char = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      if (objectDepth === 0) {
        objectStart = index;
      }
      objectDepth += 1;
      continue;
    }

    if (char === '}') {
      objectDepth -= 1;
      if (objectDepth === 0 && objectStart !== -1) {
        const rawChunk = text.slice(objectStart, index + 1);
        chunks.push(validateExplanationChunk(parseJson(rawChunk, 'OpenAI streamed chunk was not valid JSON.')));
        objectStart = -1;
      }
      continue;
    }

    if (char === ']' && objectDepth === 0) {
      break;
    }
  }

  return chunks;
}

async function readStreamingOutput(
  response: ResponseLike,
  apiKey: string,
  onChunk?: (chunk: ExplanationChunk) => void | Promise<void>
): Promise<string> {
  if (!response.body) {
    const raw = parseJson(await response.text(), 'OpenAI API response was not valid JSON.');
    return extractOutputText(raw);
  }

  let outputText = '';
  const emittedChunkIds = new Set<string>();

  for await (const eventData of readServerSentEvents(response.body)) {
    if (eventData === '[DONE]') {
      continue;
    }

    const event = parseJson(eventData, 'OpenAI stream event was not valid JSON.');
    if (!isObject(event)) {
      continue;
    }

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      outputText += event.delta;
    } else if (event.type === 'response.output_text.done' && typeof event.text === 'string') {
      outputText = event.text;
    } else if (event.type === 'error' || isObject(event.error)) {
      throw new Error(`OpenAI stream failed: ${redact(JSON.stringify(event), apiKey)}`);
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

function findChunksArrayStart(text: string): number {
  const propertyIndex = text.indexOf('"chunks"');
  if (propertyIndex === -1) {
    return -1;
  }

  for (let index = propertyIndex + '"chunks"'.length; index < text.length; index += 1) {
    if (text[index] === '[') {
      return index;
    }
  }

  return -1;
}

function extractOutputText(raw: unknown): string {
  if (isObject(raw) && typeof raw.output_text === 'string') {
    return raw.output_text;
  }

  if (!isObject(raw) || !Array.isArray(raw.output)) {
    throw new Error('OpenAI response did not include output text.');
  }

  for (const item of raw.output) {
    if (!isObject(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (isObject(content) && content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  throw new Error('OpenAI response did not include output text.');
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
