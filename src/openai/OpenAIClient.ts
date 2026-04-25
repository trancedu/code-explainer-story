import { FilePayload, ExplanationResponse } from '../types';
import { explanationJsonSchema, validateExplanationResponse } from './schema';

type FetchLike = (input: string, init: RequestInit) => Promise<ResponseLike>;

type ResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
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
  'Do not invent code behavior. State uncertainty briefly when needed.',
  'For concise level, explain only meaningful blocks.',
  'For medium level, explain important lines and branches.',
  'For detailed level, explain nearly every meaningful line.',
  'If reviewEnabled is false, return empty review arrays.',
  'If reviewEnabled is true, focus review findings on correctness, security, performance, typing, and maintainability.'
].join(' ');

export class OpenAIClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async generateExplanation(payload: FilePayload, options: GenerateOptions): Promise<ExplanationResponse> {
    const body = {
      model: options.model,
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

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status} ${response.statusText}): ${redact(rawText, options.apiKey)}`);
    }

    const raw = parseJson(rawText, 'OpenAI API response was not valid JSON.');
    const outputText = extractOutputText(raw);
    const parsed = parseJson(outputText, 'OpenAI output text was not valid JSON.');
    return validateExplanationResponse(parsed);
  }
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

