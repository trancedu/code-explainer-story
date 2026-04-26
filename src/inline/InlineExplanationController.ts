import * as vscode from 'vscode';
import { CodeExplainerConfig, getActiveModel } from '../config';
import { resolveExplanationAnchorLine } from '../analysis/explanationAnchors';
import { ExplanationStore, StoredExplanation, hashText } from '../state/ExplanationStore';
import { buildInlineHints, InlineHint } from './inlineHints';

export class InlineExplanationController implements vscode.HoverProvider, vscode.Disposable {
  private readonly hintDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
      margin: '0 0 0 2ch'
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });

  constructor(
    private readonly store: ExplanationStore,
    private readonly getConfig: () => CodeExplainerConfig
  ) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const config = this.getConfig();
    if (!config.inlineEnabled || config.explanationLevel === 'walkthrough' || document.uri.scheme !== 'file') {
      return undefined;
    }

    const stored = this.getFreshStored(document, config);
    if (!stored) {
      return undefined;
    }

    const anchorLine = resolveExplanationAnchorLine(stored.rendered.lines, position.line + 1);
    if (anchorLine === undefined) {
      return undefined;
    }

    const text = stored.rendered.lines[anchorLine - 1]?.trim();
    if (!text) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString();
    markdown.appendText(text);
    return new vscode.Hover(markdown, document.lineAt(position.line).range);
  }

  refresh(uri?: vscode.Uri): void {
    this.updateVisibleEditors(uri);
  }

  updateVisibleEditors(uri?: vscode.Uri): void {
    const config = this.getConfig();
    for (const editor of vscode.window.visibleTextEditors) {
      if (uri && editor.document.uri.toString() !== uri.toString()) {
        continue;
      }

      this.updateEditor(editor, config);
    }
  }

  dispose(): void {
    this.hintDecorationType.dispose();
  }

  private updateEditor(editor: vscode.TextEditor, config: CodeExplainerConfig): void {
    if (!config.inlineEnabled || config.explanationLevel === 'walkthrough' || editor.document.uri.scheme !== 'file') {
      editor.setDecorations(this.hintDecorationType, []);
      return;
    }

    const stored = this.getFreshStored(editor.document, config);
    if (!stored) {
      editor.setDecorations(this.hintDecorationType, []);
      return;
    }

    const decorations = this.buildHints(editor.document, stored.rendered.lines)
      .filter((hint) => hint.showAfterCode)
      .map((hint) => this.toDecoration(editor.document, hint));
    editor.setDecorations(this.hintDecorationType, decorations);
  }

  private buildHints(document: vscode.TextDocument, explanationLines: string[]): InlineHint[] {
    const config = this.getConfig();
    const sourceLines: string[] = [];
    for (let index = 0; index < document.lineCount; index += 1) {
      sourceLines.push(document.lineAt(index).text);
    }

    return buildInlineHints(explanationLines, sourceLines, {
      maxHints: config.inlineMaxHints,
      maxTextLength: config.inlineMaxTextLength,
      maxCodeColumns: config.inlineMaxCodeColumns
    });
  }

  private getFreshStored(document: vscode.TextDocument, config: CodeExplainerConfig): StoredExplanation | undefined {
    const stored = this.store.getBySource(document.uri);
    if (
      !stored ||
      stored.key.contentHash !== hashText(document.getText()) ||
      stored.key.provider !== config.provider ||
      stored.key.model !== getActiveModel(config) ||
      stored.key.level !== config.explanationLevel ||
      stored.key.reviewEnabled !== config.reviewEnabled
    ) {
      return undefined;
    }

    return stored;
  }

  private toDecoration(document: vscode.TextDocument, hint: InlineHint): vscode.DecorationOptions {
    const line = document.lineAt(hint.line - 1);
    return {
      range: new vscode.Range(line.range.end, line.range.end),
      renderOptions: {
        after: {
          contentText: `  ${hint.text}`
        }
      }
    };
  }
}
