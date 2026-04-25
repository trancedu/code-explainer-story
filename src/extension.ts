import * as path from 'path';
import * as vscode from 'vscode';
import { buildChunks } from './analysis/Chunker';
import { effectiveMaxChunkLines } from './analysis/chunkLimits';
import { resolveExplanationAnchorLine } from './analysis/explanationAnchors';
import { renderExplanation, renderPendingExplanation } from './analysis/postProcess';
import { getCodeExplainerConfig, setExplanationLevel, setReviewEnabled, setSyncLineOffset } from './config';
import { clearOpenAIKey, resolveOpenAIKey, storeOpenAIKey } from './devEnv';
import { OpenAIClient } from './openai/OpenAIClient';
import { ExplanationDocumentProvider } from './providers/ExplanationDocumentProvider';
import { DiagnosticsController } from './review/DiagnosticsController';
import { ExplanationStore, StoredExplanation, hashText } from './state/ExplanationStore';
import { ExplanationChunk, ExplanationLevel, FilePayload } from './types';
import { mapSyncTargetLine } from './sync/lineMapping';
import { matchesAnyGlob } from './path/globs';
import { StatusBarController } from './ui/StatusBarController';
import {
  ExplanationWebviewCommand,
  ExplanationWebviewPanel,
  getEditorMetrics
} from './webview/ExplanationWebviewPanel';

let store: ExplanationStore;
let provider: ExplanationDocumentProvider;
let diagnosticsController: DiagnosticsController;
let statusBarController: StatusBarController;
let activeExplanationPanel: ExplanationWebviewPanel | undefined;
let activeSourceEditor: vscode.TextEditor | undefined;
let sourceScrollDebounce: NodeJS.Timeout | undefined;
let ignoreSourceScrollUntil = 0;
let ignoreWebviewScrollUntil = 0;
let activeSourceLine: number | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri;
  store = new ExplanationStore();
  provider = new ExplanationDocumentProvider(store);
  diagnosticsController = new DiagnosticsController();
  statusBarController = new StatusBarController(getCodeExplainerConfig());

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('code-explainer', provider),
    diagnosticsController,
    statusBarController,
    vscode.commands.registerCommand('codeExplainer.explainCurrentFile', () => explainCurrentFile(context)),
    vscode.commands.registerCommand('codeExplainer.refreshExplanation', () => explainCurrentFile(context, true)),
    vscode.commands.registerCommand('codeExplainer.setExplanationLevel', chooseExplanationLevel),
    vscode.commands.registerCommand('codeExplainer.toggleReviewMode', toggleReviewMode),
    vscode.commands.registerCommand('codeExplainer.clearCache', clearCache),
    vscode.commands.registerCommand('codeExplainer.increaseSyncOffset', () => adjustSyncOffset(1)),
    vscode.commands.registerCommand('codeExplainer.decreaseSyncOffset', () => adjustSyncOffset(-1)),
    vscode.commands.registerCommand('codeExplainer.resetSyncOffset', () => resetSyncOffset()),
    vscode.commands.registerCommand('codeExplainer.setOpenAIKey', () => promptForApiKey(context)),
    vscode.commands.registerCommand('codeExplainer.clearOpenAIKey', () => clearStoredApiKey(context)),
    vscode.workspace.onDidChangeTextDocument((event) => markStaleIfExplained(event.document)),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => handleSourceVisibleRangesChanged(event)),
    vscode.window.onDidChangeTextEditorSelection((event) => handleSourceSelectionChanged(event)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeExplainer')) {
        refreshSettingsDisplay();
      }
    })
  );
}

export function deactivate(): void {
  diagnosticsController?.dispose();
  statusBarController?.dispose();
  activeExplanationPanel?.dispose();
}

async function explainCurrentFile(context: vscode.ExtensionContext, forceRefresh = false): Promise<void> {
  const editor = getTargetSourceEditor();
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showWarningMessage('Open a file-backed code editor before running Code Explainer.');
    return;
  }

  const document = editor.document;
  const config = getCodeExplainerConfig();

  if (isExcluded(document.uri, config.excludedGlobs)) {
    vscode.window.showWarningMessage('This file matches Code Explainer excludedGlobs.');
    return;
  }

  if (document.lineCount > config.maxFileLines) {
    vscode.window.showWarningMessage(
      `This file has ${document.lineCount} lines, above codeExplainer.maxFileLines (${config.maxFileLines}). Select a smaller file or raise the limit.`
    );
    return;
  }

  const apiKey = await resolveOpenAIKey(context);
  if (!apiKey) {
    const action = await vscode.window.showWarningMessage('Set an OpenAI API key before generating explanations.', 'Set Key');
    if (action === 'Set Key') {
      await promptForApiKey(context);
    }
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Code Explainer',
      cancellable: true
    },
    async (progress, token) => {
      progress.report({ message: 'Chunking file...' });
      const content = document.getText();
      const contentHash = hashText(content);
      const requestKey = {
        sourceUri: document.uri.toString(),
        documentVersion: document.version,
        contentHash,
        level: config.explanationLevel,
        reviewEnabled: config.reviewEnabled,
        model: config.model
      };

      if (!forceRefresh && config.cacheExplanations) {
        const cached = store.getBySource(document.uri);
        if (
          cached &&
          cached.key.contentHash === contentHash &&
          cached.key.level === config.explanationLevel &&
          cached.key.reviewEnabled === config.reviewEnabled &&
          cached.key.model === config.model
        ) {
          await openExplanation(editor, cached);
          return;
        }
      }

      const chunkLineLimit = effectiveMaxChunkLines(config.explanationLevel, config.maxChunkLines);
      const chunks = await buildChunks(document, chunkLineLimit);
      const payload: FilePayload = {
        fileName: config.includeFullPath ? document.uri.fsPath : path.basename(document.uri.fsPath),
        languageId: document.languageId,
        totalLines: document.lineCount,
        explanationLevel: config.explanationLevel,
        reviewEnabled: config.reviewEnabled,
        chunks
      };

      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      const pending = renderPendingExplanation(document.lineCount, `Generating ${chunks.length} explanation chunks with ${config.model}...`);
      const stored = store.put(requestKey, document.uri, pending, false);
      provider.refresh(stored.explanationUri);
      await openExplanation(editor, stored);

      const streamedChunks = new Map<string, ExplanationChunk>();
      const updateFromChunk = (chunk: ExplanationChunk) => {
        streamedChunks.set(chunk.id, chunk);
        const partial = renderExplanation(document.lineCount, {
          fileSummary: `Generated ${streamedChunks.size} of ${chunks.length} chunks...`,
          chunks: [...streamedChunks.values()]
        }, {
          sourceText: content,
          languageId: document.languageId,
          level: config.explanationLevel
        });
        store.update(stored.id, partial, false);
        provider.refresh(stored.explanationUri);
        activeExplanationPanel?.update(stored, getCodeExplainerConfig(), getEditorMetrics());
        diagnosticsController.update(document.uri, partial.reviewItems);
        progress.report({ message: `Received ${streamedChunks.size}/${chunks.length} chunks...` });
      };

      try {
        progress.report({ message: `Streaming one file-level explanation from ${config.model}...` });
        const response = await new OpenAIClient().generateExplanationStream(
          payload,
          {
            apiKey,
            model: config.model,
            signal: abortController.signal
          },
          updateFromChunk
        );

        progress.report({ message: 'Finalizing aligned explanation lines...' });
        const rendered = renderExplanation(document.lineCount, response, {
          sourceText: content,
          languageId: document.languageId,
          level: config.explanationLevel
        });
        store.update(stored.id, rendered, config.cacheExplanations);
        provider.refresh(stored.explanationUri);
        activeExplanationPanel?.update(stored, getCodeExplainerConfig(), getEditorMetrics());
        diagnosticsController.update(document.uri, rendered.reviewItems);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = renderPendingExplanation(document.lineCount, `Code Explainer failed: ${message}`);
        store.update(stored.id, failed, false);
        provider.refresh(stored.explanationUri);
        activeExplanationPanel?.update(stored, getCodeExplainerConfig(), getEditorMetrics());
        vscode.window.showErrorMessage(`Code Explainer failed: ${message}`);
      }
    }
  );
}

async function openExplanation(
  sourceEditor: vscode.TextEditor,
  stored: StoredExplanation
): Promise<void> {
  activeSourceEditor = sourceEditor;

  if (!activeExplanationPanel || !activeExplanationPanel.matchesSource(sourceEditor.document.uri)) {
    activeExplanationPanel?.dispose();
    activeExplanationPanel = ExplanationWebviewPanel.create(contextExtensionUri(), sourceEditor.document.uri, {
      onVisibleLineChanged: (line) => handleWebviewVisibleLineChanged(line),
      onActiveLineChanged: (line) => handleWebviewActiveLineChanged(line),
      onCommand: (message) => handleExplanationPanelCommand(message),
      onDispose: () => {
        activeExplanationPanel = undefined;
      }
    });
  } else {
    activeExplanationPanel.reveal();
  }

  activeExplanationPanel.update(stored, getCodeExplainerConfig(), getEditorMetrics());
  updateActiveLineFromEditor(sourceEditor);
}

async function chooseExplanationLevel(): Promise<void> {
  const levels: ExplanationLevel[] = ['concise', 'medium', 'detailed'];
  const selected = await vscode.window.showQuickPick(levels, {
    title: 'Code Explainer: Explanation Level',
    placeHolder: 'Choose how much detail to generate'
  });

  if (selected && isExplanationLevel(selected)) {
    await setExplanationLevel(selected);
    refreshSettingsDisplay();
    vscode.window.showInformationMessage(`Code Explainer level set to ${selected}.`);
  }
}

async function toggleReviewMode(): Promise<void> {
  const config = getCodeExplainerConfig();
  const nextValue = !config.reviewEnabled;
  await setReviewEnabled(nextValue);
  refreshSettingsDisplay();
  vscode.window.showInformationMessage(`Code Explainer review mode ${nextValue ? 'enabled' : 'disabled'}.`);
}

function clearCache(): void {
  store.clearCache();
  vscode.window.showInformationMessage('Code Explainer cache cleared.');
}

async function adjustSyncOffset(delta: number): Promise<void> {
  const config = getCodeExplainerConfig();
  const nextOffset = config.syncLineOffset + delta;
  await setSyncLineOffset(nextOffset);
  refreshSettingsDisplay();
  const offset = getCodeExplainerConfig().syncLineOffset;
  vscode.window.showInformationMessage(`Code Explainer sync offset set to ${formatOffset(offset)} line${Math.abs(offset) === 1 ? '' : 's'}.`);
}

async function resetSyncOffset(): Promise<void> {
  await setSyncLineOffset(0);
  refreshSettingsDisplay();
  vscode.window.showInformationMessage('Code Explainer sync offset reset to 0.');
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'Code Explainer: OpenAI API Key',
    prompt: 'Stored in VS Code SecretStorage.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (input) => (input.trim() ? undefined : 'Enter a non-empty API key.')
  });

  if (!value) {
    return;
  }

  await storeOpenAIKey(context, value);
  vscode.window.showInformationMessage('OpenAI API key saved for Code Explainer.');
}

async function clearStoredApiKey(context: vscode.ExtensionContext): Promise<void> {
  await clearOpenAIKey(context);
  vscode.window.showInformationMessage('OpenAI API key cleared for Code Explainer.');
}

function markStaleIfExplained(document: vscode.TextDocument): void {
  const existing = store.getBySource(document.uri);
  if (existing && existing.key.documentVersion !== document.version) {
    diagnosticsController.clear(document.uri);
    vscode.window.setStatusBarMessage('Code Explainer: explanation is stale. Run Refresh Explanation.', 6000);
  }
}

function isExcluded(uri: vscode.Uri, globs: string[]): boolean {
  return matchesAnyGlob(uri.fsPath.replaceAll(path.sep, '/'), globs);
}

function isExplanationLevel(value: string): value is ExplanationLevel {
  return value === 'concise' || value === 'medium' || value === 'detailed';
}

function formatOffset(offset: number): string {
  return offset >= 0 ? `+${offset}` : String(offset);
}

let extensionUri: vscode.Uri | undefined;

function contextExtensionUri(): vscode.Uri {
  if (!extensionUri) {
    throw new Error('Extension URI is not initialized.');
  }
  return extensionUri;
}

function getTargetSourceEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active?.document.uri.scheme === 'file') {
    return active;
  }

  return activeSourceEditor;
}

function findVisibleSourceEditor(): vscode.TextEditor | undefined {
  if (activeSourceEditor && vscode.window.visibleTextEditors.includes(activeSourceEditor)) {
    return activeSourceEditor;
  }

  if (!activeExplanationPanel) {
    return undefined;
  }

  return vscode.window.visibleTextEditors.find((editor) => activeExplanationPanel?.matchesSource(editor.document.uri));
}

function handleSourceVisibleRangesChanged(event: vscode.TextEditorVisibleRangesChangeEvent): void {
  if (
    !activeExplanationPanel ||
    !activeExplanationPanel.matchesSource(event.textEditor.document.uri) ||
    Date.now() < ignoreSourceScrollUntil
  ) {
    return;
  }

  const topLine = event.visibleRanges[0]?.start.line;
  if (topLine === undefined) {
    return;
  }

  if (sourceScrollDebounce) {
    clearTimeout(sourceScrollDebounce);
  }

  sourceScrollDebounce = setTimeout(() => {
    const targetLine = mapSyncTargetLine(
      topLine,
      'sourceToExplanation',
      getCodeExplainerConfig().syncLineOffset,
      event.textEditor.document.lineCount
    );
    ignoreWebviewScrollUntil = Date.now() + 250;
    activeExplanationPanel?.revealLine(targetLine + 1);
  }, 50);
}

function handleSourceSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
  if (!activeExplanationPanel || !activeExplanationPanel.matchesSource(event.textEditor.document.uri)) {
    return;
  }

  updateActiveLineFromEditor(event.textEditor);
}

function updateActiveLineFromEditor(editor: vscode.TextEditor): void {
  activeSourceEditor = editor;
  activeSourceLine = editor.selection.active.line + 1;
  activeExplanationPanel?.setActiveLine(resolveRightPanelAnchorLine(activeSourceLine));
}

function handleWebviewVisibleLineChanged(line: number): void {
  if (Date.now() < ignoreWebviewScrollUntil) {
    return;
  }

  const sourceEditor = findVisibleSourceEditor();
  if (!sourceEditor) {
    return;
  }

  const targetLine = mapSyncTargetLine(
    line - 1,
    'explanationToSource',
    getCodeExplainerConfig().syncLineOffset,
    sourceEditor.document.lineCount
  );

  ignoreSourceScrollUntil = Date.now() + 250;
  sourceEditor.revealRange(new vscode.Range(targetLine, 0, targetLine, 0), vscode.TextEditorRevealType.AtTop);
}

function handleWebviewActiveLineChanged(line: number): void {
  const sourceEditor = findVisibleSourceEditor();
  if (!sourceEditor) {
    return;
  }

  activeSourceLine = line;
  activeSourceEditor = sourceEditor;
  const targetLine = Math.max(0, Math.min(sourceEditor.document.lineCount - 1, line - 1));
  ignoreSourceScrollUntil = Date.now() + 250;
  sourceEditor.revealRange(new vscode.Range(targetLine, 0, targetLine, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function handleExplanationPanelCommand(message: ExplanationWebviewCommand): Promise<void> {
  switch (message.command) {
    case 'refresh':
      await vscode.commands.executeCommand('codeExplainer.refreshExplanation');
      break;
    case 'setLevel':
      if (isExplanationLevel(message.level)) {
        await setExplanationLevel(message.level);
        refreshSettingsDisplay();
      }
      break;
    case 'toggleReview':
      await toggleReviewMode();
      break;
    case 'clearCache':
      clearCache();
      break;
    case 'increaseOffset':
      await adjustSyncOffset(1);
      break;
    case 'decreaseOffset':
      await adjustSyncOffset(-1);
      break;
    case 'resetOffset':
      await resetSyncOffset();
      break;
  }
}

function refreshSettingsDisplay(): void {
  const config = getCodeExplainerConfig();
  statusBarController.update(config);
  const stored = activeSourceEditor ? store.getBySource(activeSourceEditor.document.uri) : undefined;
  if (stored) {
    activeExplanationPanel?.update(stored, config, getEditorMetrics());
    activeExplanationPanel?.setActiveLine(resolveRightPanelAnchorLine(activeSourceLine));
  }
}

function resolveRightPanelAnchorLine(sourceLine: number | undefined): number | undefined {
  if (sourceLine === undefined || !activeSourceEditor) {
    return sourceLine;
  }

  const stored = store.getBySource(activeSourceEditor.document.uri);
  if (!stored) {
    return sourceLine;
  }

  return resolveExplanationAnchorLine(stored.rendered.lines, sourceLine);
}
