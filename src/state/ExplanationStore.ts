import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExplanationRequestKey, RenderedExplanation } from '../types';

export type StoredExplanation = {
  id: string;
  key: ExplanationRequestKey;
  sourceUri: vscode.Uri;
  explanationUri: vscode.Uri;
  rendered: RenderedExplanation;
};

export class ExplanationStore {
  private readonly byId = new Map<string, StoredExplanation>();
  private readonly cache = new Map<string, StoredExplanation>();

  put(
    key: ExplanationRequestKey,
    sourceUri: vscode.Uri,
    rendered: RenderedExplanation,
    useCache: boolean
  ): StoredExplanation {
    const cacheKey = stableKey(key);
    const cached = this.cache.get(cacheKey);
    if (useCache && cached) {
      return cached;
    }

    const id = crypto.randomUUID();
    const sourceBase = path.basename(sourceUri.fsPath || sourceUri.path || 'source');
    const explanationUri = vscode.Uri.from({
      scheme: 'code-explainer',
      path: `/${sourceBase}.code-explainer`,
      query: `id=${encodeURIComponent(id)}`
    });

    const stored: StoredExplanation = {
      id,
      key,
      sourceUri,
      explanationUri,
      rendered
    };

    this.byId.set(id, stored);
    if (useCache) {
      this.cache.set(cacheKey, stored);
    }

    return stored;
  }

  getByUri(uri: vscode.Uri): StoredExplanation | undefined {
    const id = new URLSearchParams(uri.query).get('id');
    return id ? this.byId.get(id) : undefined;
  }

  getBySource(sourceUri: vscode.Uri): StoredExplanation | undefined {
    const source = sourceUri.toString();
    for (const stored of this.byId.values()) {
      if (stored.sourceUri.toString() === source) {
        return stored;
      }
    }

    return undefined;
  }
}

function stableKey(key: ExplanationRequestKey): string {
  return JSON.stringify(key);
}

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

