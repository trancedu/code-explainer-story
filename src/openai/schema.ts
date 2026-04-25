import { ExplanationResponse, ReviewCategory, ReviewSeverity } from '../types';

const severities: ReviewSeverity[] = ['info', 'warning', 'error'];
const categories: ReviewCategory[] = [
  'correctness',
  'readability',
  'maintainability',
  'performance',
  'security',
  'typing',
  'style'
];

export const explanationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileSummary', 'chunks'],
  properties: {
    fileSummary: { type: 'string' },
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'startLine', 'endLine', 'summary', 'lines', 'review'],
        properties: {
          id: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          summary: { type: 'string' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['line', 'text'],
              properties: {
                line: { type: 'integer' },
                text: { type: 'string' }
              }
            }
          },
          review: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['startLine', 'endLine', 'severity', 'category', 'message', 'suggestion'],
              properties: {
                startLine: { type: 'integer' },
                endLine: { type: 'integer' },
                severity: { type: 'string', enum: severities },
                category: { type: 'string', enum: categories },
                message: { type: 'string' },
                suggestion: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
} as const;

export function validateExplanationResponse(value: unknown): ExplanationResponse {
  if (!isObject(value)) {
    throw new Error('OpenAI response did not contain a JSON object.');
  }

  if (typeof value.fileSummary !== 'string' || !Array.isArray(value.chunks)) {
    throw new Error('OpenAI response is missing required explanation fields.');
  }

  for (const chunk of value.chunks) {
    validateExplanationChunk(chunk);
  }

  return value as ExplanationResponse;
}

export function validateExplanationChunk(value: unknown): ExplanationResponse['chunks'][number] {
  if (!isObject(value)) {
    throw new Error('OpenAI response contains an invalid chunk.');
  }

  if (
    typeof value.id !== 'string' ||
    !Number.isInteger(value.startLine) ||
    !Number.isInteger(value.endLine) ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.review)
  ) {
    throw new Error('OpenAI response contains a chunk with invalid fields.');
  }

  for (const line of value.lines) {
    if (!isObject(line) || !Number.isInteger(line.line) || typeof line.text !== 'string') {
      throw new Error('OpenAI response contains an invalid line explanation.');
    }
  }

  for (const review of value.review) {
    if (
      !isObject(review) ||
      !Number.isInteger(review.startLine) ||
      !Number.isInteger(review.endLine) ||
      !severities.includes(review.severity as ReviewSeverity) ||
      !categories.includes(review.category as ReviewCategory) ||
      typeof review.message !== 'string' ||
      typeof review.suggestion !== 'string'
    ) {
      throw new Error('OpenAI response contains an invalid review item.');
    }
  }

  return value as ExplanationResponse['chunks'][number];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
