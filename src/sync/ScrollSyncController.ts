import * as vscode from 'vscode';

type EditorPair = {
  source: vscode.TextEditor;
  explanation: vscode.TextEditor;
};

export class ScrollSyncController implements vscode.Disposable {
  private readonly pairs = new Map<string, EditorPair>();
  private readonly disposables: vscode.Disposable[] = [];
  private syncInProgress = false;
  private debounceHandle: NodeJS.Timeout | undefined;

  constructor() {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => this.handleVisibleRangesChanged(event)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.prunePairs())
    );
  }

  bind(source: vscode.TextEditor, explanation: vscode.TextEditor): void {
    this.pairs.set(pairKey(source.document.uri, explanation.document.uri), { source, explanation });
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }
    this.pairs.clear();
  }

  private handleVisibleRangesChanged(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    const match = this.findPair(event.textEditor);
    const topLine = event.visibleRanges[0]?.start.line;
    if (!match || topLine === undefined || this.syncInProgress) {
      return;
    }

    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }

    this.debounceHandle = setTimeout(() => {
      this.syncInProgress = true;
      try {
        const range = new vscode.Range(topLine, 0, topLine, 0);
        match.other.revealRange(range, vscode.TextEditorRevealType.AtTop);
      } finally {
        setTimeout(() => {
          this.syncInProgress = false;
        }, 75);
      }
    }, 50);
  }

  private findPair(editor: vscode.TextEditor): { pair: EditorPair; other: vscode.TextEditor } | undefined {
    const uri = editor.document.uri.toString();
    for (const pair of this.pairs.values()) {
      if (pair.source.document.uri.toString() === uri) {
        return { pair, other: pair.explanation };
      }
      if (pair.explanation.document.uri.toString() === uri) {
        return { pair, other: pair.source };
      }
    }

    return undefined;
  }

  private prunePairs(): void {
    const visible = new Set(vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString()));
    for (const [key, pair] of this.pairs) {
      if (!visible.has(pair.source.document.uri.toString()) || !visible.has(pair.explanation.document.uri.toString())) {
        this.pairs.delete(key);
      }
    }
  }
}

function pairKey(sourceUri: vscode.Uri, explanationUri: vscode.Uri): string {
  return `${sourceUri.toString()}::${explanationUri.toString()}`;
}

