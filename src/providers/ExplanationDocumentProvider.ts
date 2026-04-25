import * as vscode from 'vscode';
import { ExplanationStore } from '../state/ExplanationStore';

export class ExplanationDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly store: ExplanationStore) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.store.getByUri(uri)?.rendered.text ?? 'No explanation is available for this document.';
  }

  refresh(uri: vscode.Uri): void {
    this.emitter.fire(uri);
  }
}

