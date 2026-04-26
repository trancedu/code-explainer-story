import * as path from 'path';
import * as vscode from 'vscode';
import { CodeExplainerConfig, getActiveModel } from '../config';
import { StoredExplanation } from '../state/ExplanationStore';
import { lineToScrollTop } from '../sync/scrollMath';

export type ExplanationWebviewCommand =
  | { command: 'refresh' }
  | { command: 'setModel' }
  | { command: 'setLevel'; level: string }
  | { command: 'toggleInline' }
  | { command: 'toggleReview' }
  | { command: 'clearCache' }
  | { command: 'increaseOffset' }
  | { command: 'decreaseOffset' }
  | { command: 'resetOffset' };

export type ExplanationWebviewCallbacks = {
  onVisibleLineChanged(line: number): void;
  onActiveLineChanged(line: number): void;
  onCommand(message: ExplanationWebviewCommand): void;
  onDispose(): void;
};

export type EditorMetrics = {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
};

type WalkthroughChunkRange = {
  startLine: number;
  endLine: number;
  paragraphStart: number;
  paragraphEnd: number;
};

type WebviewState = {
  fileName: string;
  model: string;
  level: string;
  inlineEnabled: boolean;
  reviewEnabled: boolean;
  syncOffset: number;
  headerHeight: number;
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  walkthrough: boolean;
  lines: string[];
  fileSummary: string;
  reviewCount: number;
  activeLine: number | undefined;
  walkthroughChunks: WalkthroughChunkRange[] | undefined;
};

export class ExplanationWebviewPanel implements vscode.Disposable {
  private initialized = false;
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly panel: vscode.WebviewPanel,
    readonly sourceUri: vscode.Uri,
    private readonly callbacks: ExplanationWebviewCallbacks
  ) {
    this.panel.webview.options = {
      enableScripts: true
    };

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message))
    );
  }

  static create(
    extensionUri: vscode.Uri,
    sourceUri: vscode.Uri,
    callbacks: ExplanationWebviewCallbacks
  ): ExplanationWebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'codeExplainer.explanation',
      `${path.basename(sourceUri.fsPath)} explanation`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    return new ExplanationWebviewPanel(panel, sourceUri, callbacks);
  }

  update(stored: StoredExplanation, config: CodeExplainerConfig, metrics: EditorMetrics): void {
    this.panel.title = `${path.basename(stored.sourceUri.fsPath)} explanation`;
    const state = toWebviewState(stored, config, metrics);

    if (!this.initialized) {
      this.panel.webview.html = renderHtml(this.panel.webview, state);
      this.initialized = true;
      return;
    }

    this.panel.webview.postMessage({
      type: 'setState',
      state
    });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  revealLine(line: number): void {
    this.panel.webview.postMessage({
      type: 'revealLine',
      line,
      scrollTop: lineToScrollTop(line - 1, getEditorMetrics().lineHeight)
    });
  }

  setActiveLine(line: number | undefined): void {
    this.panel.webview.postMessage({
      type: 'setActiveLine',
      line
    });
  }

  matchesSource(uri: vscode.Uri): boolean {
    return this.sourceUri.toString() === uri.toString();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.panel.dispose();
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.callbacks.onDispose();
  }

  private handleMessage(message: unknown): void {
    if (!isObject(message) || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'visibleLineChanged' && typeof message.line === 'number') {
      this.callbacks.onVisibleLineChanged(message.line);
      return;
    }

    if (message.type === 'activeLineChanged' && typeof message.line === 'number') {
      this.callbacks.onActiveLineChanged(message.line);
      return;
    }

    if (message.type === 'command' && isObject(message.payload)) {
      this.callbacks.onCommand(message.payload as ExplanationWebviewCommand);
    }
  }
}

export function getEditorMetrics(): EditorMetrics {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const fontSize = editorConfig.get<number>('fontSize', 14);
  const configuredLineHeight = editorConfig.get<number>('lineHeight', 0);
  const lineHeight = configuredLineHeight > 0 ? configuredLineHeight : Math.round(fontSize * 1.5);
  return {
    fontSize,
    fontFamily: editorConfig.get<string>('fontFamily', 'monospace'),
    lineHeight
  };
}

function toWebviewState(
  stored: StoredExplanation,
  config: CodeExplainerConfig,
  metrics: EditorMetrics
): WebviewState {
  return {
    fileName: path.basename(stored.sourceUri.fsPath),
    model: getActiveModel(config),
    level: config.explanationLevel,
    inlineEnabled: config.inlineEnabled,
    reviewEnabled: config.reviewEnabled,
    syncOffset: config.syncLineOffset,
    headerHeight: config.webviewHeaderHeight,
    lineHeight: metrics.lineHeight,
    fontSize: metrics.fontSize,
    fontFamily: metrics.fontFamily,
    walkthrough: config.explanationLevel === 'walkthrough',
    lines: stored.rendered.lines,
    fileSummary: stored.rendered.fileSummary,
    reviewCount: stored.rendered.reviewItems.length,
    activeLine: undefined,
    walkthroughChunks: stored.rendered.walkthroughChunks
  };
}

function renderHtml(webview: vscode.Webview, state: WebviewState): string {
  const nonce = getNonce();
  const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Code Explainer</title>
  <style>
    :root {
      --header-height: ${state.headerHeight}px;
      --line-height: ${state.lineHeight}px;
      --font-size: ${state.fontSize}px;
      --font-family: ${cssString(state.fontFamily)};
    }

    html,
    body {
      height: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .toolbar {
      box-sizing: border-box;
      height: var(--header-height);
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      background: var(--vscode-editor-background);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      overflow: hidden;
    }

    .toolbar label,
    .toolbar button,
    .toolbar select,
    .toolbar span {
      flex: 0 0 auto;
    }

    button,
    select {
      height: 24px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      padding: 0 8px;
      cursor: pointer;
    }

    select {
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      border-color: var(--vscode-dropdown-border);
    }

    button.secondary {
      color: var(--vscode-foreground);
      background: var(--vscode-editorWidget-background);
      border-color: var(--vscode-editorWidget-border);
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .offset {
      min-width: 48px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .model {
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .content.walkthrough .gutter {
      min-width: 0;
      width: 0;
      padding: 0;
      overflow: hidden;
      color: transparent;
    }

    .content.walkthrough .text {
      min-width: 96ch;
      padding-left: 14px;
    }

    .content.walkthrough .line.active {
      background: transparent;
      outline: none;
      box-shadow: none;
    }

    .content.walkthrough .line.chunk-active {
      background: color-mix(in srgb, var(--vscode-editor-selectionBackground) 50%, transparent);
      box-shadow: inset 3px 0 0 var(--vscode-focusBorder);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .content {
      height: calc(100vh - var(--header-height));
      overflow: auto;
      font-family: var(--font-family);
      font-size: var(--font-size);
      line-height: var(--line-height);
    }

    .lines {
      min-width: max-content;
      padding-bottom: max(40px, calc(100vh - var(--header-height) - var(--line-height)));
    }

    .line {
      box-sizing: border-box;
      display: flex;
      min-height: var(--line-height);
      white-space: pre;
      cursor: default;
    }

    .line.active {
      background: var(--vscode-editor-selectionBackground);
      background: color-mix(in srgb, var(--vscode-editor-selectionBackground) 62%, transparent);
      outline: 1px solid var(--vscode-focusBorder);
      box-shadow: inset 3px 0 0 var(--vscode-focusBorder);
    }

    .line.active .gutter {
      color: var(--vscode-editor-foreground);
      font-weight: 700;
    }

    .gutter {
      flex: 0 0 auto;
      min-width: 5ch;
      padding: 0 12px 0 10px;
      text-align: right;
      user-select: none;
      color: var(--vscode-editorLineNumber-foreground);
    }

    .text {
      flex: 0 0 auto;
      min-width: 80ch;
      padding-right: 32px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="model" class="secondary model" title="Change model"></button>
    <button id="inline" class="secondary"></button>
    <label>Level <select id="level">
      <option value="concise">concise</option>
      <option value="medium">medium</option>
      <option value="detailed">detailed</option>
      <option value="story">story</option>
      <option value="walkthrough">walkthrough</option>
    </select></label>
    <button id="review" class="secondary"></button>
    <button id="refresh">Refresh</button>
    <button id="clear" class="secondary">Clear cache</button>
    <button id="minus" class="secondary">Offset -</button>
    <span class="offset" id="offset"></span>
    <button id="plus" class="secondary">Offset +</button>
    <button id="reset" class="secondary">Reset</button>
  </div>
  <div class="content" id="content">
    <div class="lines" id="lines"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = ${serializedState};
    let measuredLineHeight = state.lineHeight;
    let scrollTimer = undefined;
    let suppressScrollUntil = 0;
    let walkthroughActiveLine = undefined;

    const model = document.getElementById('model');
    const inline = document.getElementById('inline');
    const level = document.getElementById('level');
    const review = document.getElementById('review');
    const refresh = document.getElementById('refresh');
    const clear = document.getElementById('clear');
    const minus = document.getElementById('minus');
    const plus = document.getElementById('plus');
    const reset = document.getElementById('reset');
    const offset = document.getElementById('offset');
    const content = document.getElementById('content');
    const lines = document.getElementById('lines');

    refresh.addEventListener('click', () => postCommand({ command: 'refresh' }));
    model.addEventListener('click', () => postCommand({ command: 'setModel' }));
    inline.addEventListener('click', () => {
      if (!state.walkthrough) {
        postCommand({ command: 'toggleInline' });
      }
    });
    clear.addEventListener('click', () => postCommand({ command: 'clearCache' }));
    review.addEventListener('click', () => postCommand({ command: 'toggleReview' }));
    minus.addEventListener('click', () => postCommand({ command: 'decreaseOffset' }));
    plus.addEventListener('click', () => postCommand({ command: 'increaseOffset' }));
    reset.addEventListener('click', () => postCommand({ command: 'resetOffset' }));
    level.addEventListener('change', () => postCommand({ command: 'setLevel', level: level.value }));

    content.addEventListener('scroll', () => {
      if (state.walkthrough) {
        return;
      }

      if (Date.now() < suppressScrollUntil) {
        return;
      }

      if (scrollTimer) {
        clearTimeout(scrollTimer);
      }

      scrollTimer = setTimeout(() => {
        const line = scrollTopToLine(content.scrollTop, measuredLineHeight, state.lines.length) + 1;
        vscode.postMessage({ type: 'visibleLineChanged', line });
      }, 50);
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message.type !== 'string') {
        return;
      }

      if (message.type === 'setState') {
        state = message.state;
        render();
        return;
      }

      if (message.type === 'revealLine') {
        if (state.walkthrough) {
          return;
        }
        suppressScrollUntil = Date.now() + 250;
        content.scrollTop =
          typeof message.scrollTop === 'number'
            ? message.scrollTop
            : Math.max(0, (message.line - 1) * measuredLineHeight);
        setActiveLine(message.line);
        return;
      }

      if (message.type === 'setActiveLine') {
        if (state.walkthrough) {
          setWalkthroughActiveChunk(message.line, true);
          return;
        }
        setActiveLine(message.line);
      }
    });

    function postCommand(payload) {
      vscode.postMessage({ type: 'command', payload });
    }

    function render() {
      document.documentElement.style.setProperty('--header-height', state.headerHeight + 'px');
      document.documentElement.style.setProperty('--line-height', state.lineHeight + 'px');
      document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
      document.documentElement.style.setProperty('--font-family', state.fontFamily);
      content.classList.toggle('walkthrough', Boolean(state.walkthrough));

      level.value = state.level;
      model.textContent = 'Model ' + state.model;
      model.title = 'Change model: ' + state.model;
      inline.disabled = Boolean(state.walkthrough);
      inline.textContent = state.walkthrough ? 'Inline n/a' : state.inlineEnabled ? 'Inline on' : 'Inline off';
      review.textContent = state.reviewEnabled ? 'Review on' : 'Review off';
      offset.textContent = formatOffset(state.syncOffset);

      const fragment = document.createDocumentFragment();
      state.lines.forEach((lineText, index) => {
        const row = document.createElement('div');
        row.className = 'line';
        row.dataset.line = String(index + 1);
        if (!state.walkthrough && state.activeLine === index + 1) {
          row.classList.add('active');
        }

        const gutter = document.createElement('span');
        gutter.className = 'gutter';
        gutter.textContent = String(index + 1);

        const text = document.createElement('span');
        text.className = 'text';
        text.textContent = lineText || '';

        row.append(gutter, text);
        row.addEventListener('click', () => {
          if (state.walkthrough) {
            return;
          }

          setActiveLine(index + 1);
          vscode.postMessage({ type: 'activeLineChanged', line: index + 1 });
        });
        fragment.append(row);
      });

      lines.replaceChildren(fragment);
      measuredLineHeight = document.querySelector('.line')?.getBoundingClientRect().height || state.lineHeight;

      if (state.walkthrough) {
        setWalkthroughActiveChunk(walkthroughActiveLine, false);
      }
    }

    function formatOffset(value) {
      return value >= 0 ? '+' + value : String(value);
    }

    function setActiveLine(line) {
      state.activeLine = !state.walkthrough && typeof line === 'number' ? line : undefined;
      document.querySelectorAll('.line.active').forEach((node) => node.classList.remove('active'));
      if (state.activeLine === undefined) {
        return;
      }

      const row = document.querySelector('.line[data-line="' + state.activeLine + '"]');
      row?.classList.add('active');
    }

    function setWalkthroughActiveChunk(sourceLine, shouldScroll) {
      walkthroughActiveLine = sourceLine;
      document.querySelectorAll('.line.chunk-active').forEach((node) => node.classList.remove('chunk-active'));
      if (!state.walkthroughChunks || typeof sourceLine !== 'number') {
        return;
      }
      const chunk = state.walkthroughChunks.find((c) => sourceLine >= c.startLine && sourceLine <= c.endLine);
      if (!chunk) {
        return;
      }
      let firstNode = null;
      for (let i = chunk.paragraphStart; i <= chunk.paragraphEnd; i++) {
        const row = document.querySelector('.line[data-line="' + (i + 1) + '"]');
        if (row) {
          row.classList.add('chunk-active');
          if (!firstNode) { firstNode = row; }
        }
      }
      if (shouldScroll && firstNode) {
        firstNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function scrollTopToLine(scrollTop, lineHeight, lineCount) {
      const maxLine = Math.max(0, lineCount - 1);
      const rawLine = Math.round(scrollTop / Math.max(1, lineHeight));
      return Math.max(0, Math.min(maxLine, rawLine));
    }

    render();
  </script>
</body>
</html>`;
}

function cssString(value: string): string {
  return JSON.stringify(value);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let index = 0; index < 32; index += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
