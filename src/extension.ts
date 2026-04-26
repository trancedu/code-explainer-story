import * as path from 'path';
import * as vscode from 'vscode';
import { buildChunks } from './analysis/Chunker';
import { effectiveMaxChunkLines } from './analysis/chunkLimits';
import { resolveExplanationAnchorLine } from './analysis/explanationAnchors';
import { renderExplanation, renderPendingExplanation } from './analysis/postProcess';
import {
  getCodeExplainerConfig,
  setExplanationLevel,
  setInlineEnabled,
  setOpenAIModel,
  setReviewEnabled,
  setSyncLineOffset
} from './config';
import { clearOpenAIKey, resolveOpenAIKey, storeOpenAIKey } from './devEnv';
import { InlineExplanationController } from './inline/InlineExplanationController';
import { OpenAIClient } from './openai/OpenAIClient';
import {
  readSnapshot,
  renderedFromSnapshot,
  snapshotMatches,
  writeSnapshot
} from './persistence/snapshots';
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
let inlineController: InlineExplanationController;
let activeExplanationPanel: ExplanationWebviewPanel | undefined;
let activeSourceEditor: vscode.TextEditor | undefined;
let sourceScrollDebounce: NodeJS.Timeout | undefined;
let ignoreSourceScrollUntil = 0;
let ignoreWebviewScrollUntil = 0;
let activeSourceLine: number | undefined;
const staleSavePromptInFlight = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri;
  store = new ExplanationStore();
  provider = new ExplanationDocumentProvider(store);
  diagnosticsController = new DiagnosticsController();
  statusBarController = new StatusBarController(getCodeExplainerConfig());
  inlineController = new InlineExplanationController(store, getCodeExplainerConfig);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('code-explainer', provider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, inlineController),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, inlineController),
    diagnosticsController,
    statusBarController,
    inlineController,
    vscode.commands.registerCommand('codeExplainer.explainCurrentFile', () => explainCurrentFile(context)),
    vscode.commands.registerCommand('codeExplainer.refreshExplanation', () => explainCurrentFile(context, true)),
    vscode.commands.registerCommand('codeExplainer.showExplanationAtLine', (uri: vscode.Uri, line: number) =>
      showExplanationAtLine(uri, line)
    ),
    vscode.commands.registerCommand('codeExplainer.setModel', chooseOpenAIModel),
    vscode.commands.registerCommand('codeExplainer.setExplanationLevel', chooseExplanationLevel),
    vscode.commands.registerCommand('codeExplainer.toggleInlineExplanations', toggleInlineExplanations),
    vscode.commands.registerCommand('codeExplainer.toggleReviewMode', toggleReviewMode),
    vscode.commands.registerCommand('codeExplainer.clearCache', clearCache),
    vscode.commands.registerCommand('codeExplainer.saveCurrentExplanation', saveCurrentExplanation),
    vscode.commands.registerCommand('codeExplainer.explainFolder', () => explainFolder(context)),
    vscode.commands.registerCommand('codeExplainer.explainWorkspace', () => explainWorkspace(context)),
    vscode.commands.registerCommand('codeExplainer.increaseSyncOffset', () => adjustSyncOffset(1)),
    vscode.commands.registerCommand('codeExplainer.decreaseSyncOffset', () => adjustSyncOffset(-1)),
    vscode.commands.registerCommand('codeExplainer.resetSyncOffset', () => resetSyncOffset()),
    vscode.commands.registerCommand('codeExplainer.setOpenAIKey', () => promptForApiKey(context)),
    vscode.commands.registerCommand('codeExplainer.clearOpenAIKey', () => clearStoredApiKey(context)),
    vscode.workspace.onDidChangeTextDocument((event) => markStaleIfExplained(event.document)),
    vscode.workspace.onDidSaveTextDocument((document) => void handleSavedDocument(context, document)),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => handleSourceVisibleRangesChanged(event)),
    vscode.window.onDidChangeTextEditorSelection((event) => handleSourceSelectionChanged(event)),
    vscode.window.onDidChangeVisibleTextEditors(() => inlineController.updateVisibleEditors()),
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
  inlineController?.dispose();
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

  if (!forceRefresh && config.persistExplanations) {
    const snapshot = await readSnapshot(document.uri, config);
    if (snapshot && snapshotMatches(snapshot, contentHash, config, document.lineCount)) {
      const stored = store.put(requestKey, document.uri, renderedFromSnapshot(snapshot), config.cacheExplanations);
      diagnosticsController.update(document.uri, stored.rendered.reviewItems);
      inlineController.refresh(document.uri);
      await openExplanation(editor, stored);
      return;
    }
  }

  const apiKey = await ensureOpenAIKey(context);
  if (!apiKey) {
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
        inlineController.refresh(document.uri);
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
        const finalStored = store.update(stored.id, rendered, config.cacheExplanations);
        provider.refresh(stored.explanationUri);
        activeExplanationPanel?.update(stored, getCodeExplainerConfig(), getEditorMetrics());
        diagnosticsController.update(document.uri, rendered.reviewItems);
        inlineController.refresh(document.uri);
        if (finalStored && config.persistExplanations) {
          await writeSnapshot(finalStored, config, document.languageId, document.lineCount);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = renderPendingExplanation(document.lineCount, `Code Explainer failed: ${message}`);
        store.update(stored.id, failed, false);
        provider.refresh(stored.explanationUri);
        activeExplanationPanel?.update(stored, getCodeExplainerConfig(), getEditorMetrics());
        inlineController.refresh(document.uri);
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
  inlineController.refresh(sourceEditor.document.uri);
  updateActiveLineFromEditor(sourceEditor);
}

async function showExplanationAtLine(uri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false
  });
  const stored = store.getBySource(uri);
  if (stored) {
    await openExplanation(editor, stored);
  }

  const targetLine = Math.max(0, Math.min(document.lineCount - 1, line - 1));
  editor.selection = new vscode.Selection(targetLine, 0, targetLine, 0);
  editor.revealRange(new vscode.Range(targetLine, 0, targetLine, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  activeExplanationPanel?.setActiveLine(resolveRightPanelAnchorLine(line));
}

async function chooseOpenAIModel(): Promise<void> {
  const config = getCodeExplainerConfig();
  const presetModels = uniqueNonEmpty([config.model, ...config.modelPresets]);
  const customLabel = 'Custom model id...';
  const selected = await vscode.window.showQuickPick(
    [
      ...presetModels.map((model) => ({
        label: model,
        description: model === config.model ? 'current' : model === 'gpt-5.4-mini' ? 'default' : undefined
      })),
      {
        label: customLabel,
        description: 'Enter another OpenAI model name'
      }
    ],
    {
      title: 'Code Explainer: OpenAI Model',
      placeHolder: 'Choose the model used for new explanations'
    }
  );

  if (!selected) {
    return;
  }

  let nextModel = selected.label;
  if (nextModel === customLabel) {
    const custom = await vscode.window.showInputBox({
      title: 'Code Explainer: Custom OpenAI Model',
      prompt: 'Enter an OpenAI model id.',
      value: config.model,
      ignoreFocusOut: true,
      validateInput: (input) => (input.trim() ? undefined : 'Enter a non-empty model id.')
    });
    if (!custom) {
      return;
    }
    nextModel = custom.trim();
  }

  await setOpenAIModel(nextModel);
  refreshSettingsDisplay();
  vscode.window.showInformationMessage(`Code Explainer model set to ${nextModel}.`);
}

async function toggleInlineExplanations(): Promise<void> {
  const config = getCodeExplainerConfig();
  const nextValue = !config.inlineEnabled;
  await setInlineEnabled(nextValue);
  refreshSettingsDisplay();
  vscode.window.showInformationMessage(`Code Explainer inline explanations ${nextValue ? 'enabled' : 'disabled'}.`);
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

async function saveCurrentExplanation(): Promise<void> {
  const sourceEditor = activeSourceEditor ?? getTargetSourceEditor();
  if (!sourceEditor) {
    vscode.window.showWarningMessage('No explained source file is active.');
    return;
  }

  const stored = store.getBySource(sourceEditor.document.uri);
  if (!stored) {
    vscode.window.showWarningMessage('No generated explanation is available to save for this file.');
    return;
  }

  const snapshotUri = await writeSnapshot(stored, getCodeExplainerConfig(), sourceEditor.document.languageId, sourceEditor.document.lineCount);
  if (!snapshotUri) {
    vscode.window.showWarningMessage('Open this file inside a workspace before saving an explanation snapshot.');
    return;
  }

  vscode.window.showInformationMessage(`Saved explanation snapshot: ${vscode.workspace.asRelativePath(snapshotUri)}`);
}

async function explainFolder(context: vscode.ExtensionContext): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Explain Folder'
  });

  const folder = selected?.[0];
  if (!folder) {
    return;
  }

  await explainUriSet(context, await findExplainableFiles(folder));
}

async function explainWorkspace(context: vscode.ExtensionContext): Promise<void> {
  await explainUriSet(context, await findExplainableFiles());
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

async function ensureOpenAIKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const apiKey = await resolveOpenAIKey(context);
  if (apiKey) {
    return apiKey;
  }

  return promptForApiKey(context, {
    title: 'Code Explainer: OpenAI API Key Required',
    prompt: 'Enter your OpenAI API key to generate explanations. It will be stored in VS Code SecretStorage.'
  });
}

async function promptForApiKey(
  context: vscode.ExtensionContext,
  options: { title?: string; prompt?: string } = {}
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: options.title ?? 'Code Explainer: OpenAI API Key',
    prompt: options.prompt ?? 'Stored in VS Code SecretStorage.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (input) => (input.trim() ? undefined : 'Enter a non-empty API key.')
  });

  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  await storeOpenAIKey(context, trimmed);
  vscode.window.showInformationMessage('OpenAI API key saved for Code Explainer.');
  return trimmed;
}

async function clearStoredApiKey(context: vscode.ExtensionContext): Promise<void> {
  await clearOpenAIKey(context);
  vscode.window.showInformationMessage('OpenAI API key cleared for Code Explainer.');
}

function markStaleIfExplained(document: vscode.TextDocument): void {
  const existing = store.getBySource(document.uri);
  if (existing && existing.key.documentVersion !== document.version) {
    diagnosticsController.clear(document.uri);
    inlineController.refresh(document.uri);
    vscode.window.setStatusBarMessage('Code Explainer: explanation is stale. Run Refresh Explanation.', 6000);
  }
}

async function handleSavedDocument(context: vscode.ExtensionContext, document: vscode.TextDocument): Promise<void> {
  if (document.uri.scheme !== 'file') {
    return;
  }

  const config = getCodeExplainerConfig();
  if (isExcluded(document.uri, config.excludedGlobs)) {
    return;
  }

  const existing = store.getBySource(document.uri);
  let snapshot: Awaited<ReturnType<typeof readSnapshot>> | undefined;
  try {
    snapshot = config.persistExplanations ? await readSnapshot(document.uri, config) : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.setStatusBarMessage(`Code Explainer: could not read snapshot (${message}).`, 6000);
  }
  if (!existing && !snapshot) {
    return;
  }

  const contentHash = hashText(document.getText());
  const existingIsFresh = Boolean(
    existing &&
      existing.key.contentHash === contentHash &&
      existing.key.level === config.explanationLevel &&
      existing.key.reviewEnabled === config.reviewEnabled &&
      existing.key.model === config.model
  );
  const snapshotIsFresh = Boolean(snapshot && snapshotMatches(snapshot, contentHash, config, document.lineCount));
  if (existingIsFresh || snapshotIsFresh) {
    return;
  }

  if (config.autoRegenerateOnSave) {
    await revealDocumentForGeneration(document);
    await explainCurrentFile(context, true);
    return;
  }

  const promptKey = document.uri.toString();
  if (staleSavePromptInFlight.has(promptKey)) {
    return;
  }

  staleSavePromptInFlight.add(promptKey);
  try {
    const action = await vscode.window.showInformationMessage(
      `Code Explainer snapshot is stale for ${vscode.workspace.asRelativePath(document.uri)}.`,
      'Regenerate'
    );
    if (action === 'Regenerate') {
      await revealDocumentForGeneration(document);
      await explainCurrentFile(context, true);
    }
  } finally {
    staleSavePromptInFlight.delete(promptKey);
  }
}

async function revealDocumentForGeneration(document: vscode.TextDocument): Promise<void> {
  activeSourceEditor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false
  });
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
    case 'setModel':
      await chooseOpenAIModel();
      break;
    case 'setLevel':
      if (isExplanationLevel(message.level)) {
        await setExplanationLevel(message.level);
        refreshSettingsDisplay();
      }
      break;
    case 'toggleInline':
      await toggleInlineExplanations();
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
  inlineController.refresh();
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

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

async function findExplainableFiles(folder?: vscode.Uri): Promise<vscode.Uri[]> {
  const config = getCodeExplainerConfig();
  const seen = new Set<string>();
  const result: vscode.Uri[] = [];

  for (const includeGlob of config.includeGlobs) {
    const pattern = folder ? new vscode.RelativePattern(folder.fsPath, includeGlob) : includeGlob;
    const matches = await vscode.workspace.findFiles(pattern);
    for (const uri of matches) {
      const key = uri.toString();
      if (seen.has(key) || isExcluded(uri, config.excludedGlobs)) {
        continue;
      }

      seen.add(key);
      result.push(uri);
    }
  }

  return result.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

async function explainUriSet(context: vscode.ExtensionContext, uris: vscode.Uri[]): Promise<void> {
  if (uris.length === 0) {
    vscode.window.showInformationMessage('No explainable files matched the configured includeGlobs.');
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `Explain ${uris.length} file${uris.length === 1 ? '' : 's'}? Fresh snapshots will be reused, but stale or missing snapshots may call the OpenAI API.`,
    { modal: true },
    'Continue'
  );

  if (answer !== 'Continue') {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Code Explainer batch',
      cancellable: true
    },
    async (progress, token) => {
      for (let index = 0; index < uris.length; index += 1) {
        if (token.isCancellationRequested) {
          break;
        }

        const uri = uris[index];
        progress.report({
          message: `${index + 1}/${uris.length}: ${vscode.workspace.asRelativePath(uri)}`
        });
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, {
          preview: false,
          preserveFocus: false
        });
        await explainCurrentFile(context);
        activeSourceEditor = editor;
      }
    }
  );
}
