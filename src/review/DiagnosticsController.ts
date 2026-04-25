import * as vscode from 'vscode';
import { ReviewItem } from '../types';

export class DiagnosticsController implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('code-explainer');

  update(sourceUri: vscode.Uri, items: ReviewItem[]): void {
    const diagnostics = items.map((item) => {
      const range = new vscode.Range(
        Math.max(0, item.startLine - 1),
        0,
        Math.max(0, item.endLine - 1),
        Number.MAX_SAFE_INTEGER
      );
      const message = item.suggestion ? `${item.message} Suggestion: ${item.suggestion}` : item.message;
      const diagnostic = new vscode.Diagnostic(range, message, toDiagnosticSeverity(item.severity));
      diagnostic.source = 'Code Explainer';
      diagnostic.code = item.category;
      return diagnostic;
    });

    this.collection.set(sourceUri, diagnostics);
  }

  clear(sourceUri: vscode.Uri): void {
    this.collection.delete(sourceUri);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function toDiagnosticSeverity(severity: ReviewItem['severity']): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

