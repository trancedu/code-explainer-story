import * as vscode from 'vscode';
import { mapSyncTargetLine, SyncDirection } from './lineMapping';

type EditorPair = {
  source: vscode.TextEditor;
  explanation: vscode.TextEditor;
};

export class ScrollSyncController implements vscode.Disposable {
  private readonly pairs = new Map<string, EditorPair>();
  private readonly disposables: vscode.Disposable[] = [];
  private debounceHandle: NodeJS.Timeout | undefined;
  private ignoredEditorUri: string | undefined;
  private ignoreUntil = 0;

  constructor(private readonly getSyncLineOffset: () => number = () => 0) {
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
    if (!match || topLine === undefined || this.shouldIgnore(event.textEditor)) {
      return;
    }

    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }

    this.debounceHandle = setTimeout(() => {
      const targetLine = mapSyncTargetLine(
        topLine,
        match.direction,
        this.getSyncLineOffset(),
        match.other.document.lineCount
      );
      const range = new vscode.Range(targetLine, 0, targetLine, 0);
      this.ignoredEditorUri = match.other.document.uri.toString();
      this.ignoreUntil = Date.now() + 250;
      match.other.revealRange(range, vscode.TextEditorRevealType.AtTop);
    }, 50);
  }

  private findPair(
    editor: vscode.TextEditor
  ): { pair: EditorPair; other: vscode.TextEditor; direction: SyncDirection } | undefined {
    const uri = editor.document.uri.toString();
    for (const pair of this.pairs.values()) {
      if (pair.source.document.uri.toString() === uri) {
        return { pair, other: pair.explanation, direction: 'sourceToExplanation' };
      }
      if (pair.explanation.document.uri.toString() === uri) {
        return { pair, other: pair.source, direction: 'explanationToSource' };
      }
    }

    return undefined;
  }

  private shouldIgnore(editor: vscode.TextEditor): boolean {
    if (Date.now() > this.ignoreUntil) {
      this.ignoredEditorUri = undefined;
      return false;
    }

    return this.ignoredEditorUri === editor.document.uri.toString();
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
