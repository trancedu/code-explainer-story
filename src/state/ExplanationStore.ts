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
  private readonly latestBySource = new Map<string, string>();

  put(
    key: ExplanationRequestKey,
    sourceUri: vscode.Uri,
    rendered: RenderedExplanation,
    useCache: boolean
  ): StoredExplanation {
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
    this.latestBySource.set(sourceUri.toString(), id);
    if (useCache) {
      this.cache.set(stableKey(key), stored);
    }

    return stored;
  }

  getByUri(uri: vscode.Uri): StoredExplanation | undefined {
    const id = new URLSearchParams(uri.query).get('id');
    return id ? this.byId.get(id) : undefined;
  }

  getBySource(sourceUri: vscode.Uri): StoredExplanation | undefined {
    const id = this.latestBySource.get(sourceUri.toString());
    return id ? this.byId.get(id) : undefined;
  }
}

function stableKey(key: ExplanationRequestKey): string {
  return JSON.stringify(key);
}

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
