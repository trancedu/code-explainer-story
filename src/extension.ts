import * as path from 'path';
import * as vscode from 'vscode';
import { buildChunks } from './analysis/Chunker';
import { renderExplanation, renderPendingExplanation } from './analysis/postProcess';
import { getCodeExplainerConfig, setExplanationLevel, setReviewEnabled, setSyncLineOffset } from './config';
import { clearOpenAIKey, resolveOpenAIKey, storeOpenAIKey } from './devEnv';
import { OpenAIClient } from './openai/OpenAIClient';
import { ExplanationDocumentProvider } from './providers/ExplanationDocumentProvider';
import { DiagnosticsController } from './review/DiagnosticsController';
import { ExplanationStore, hashText } from './state/ExplanationStore';
import { ExplanationChunk, ExplanationLevel, FilePayload } from './types';
import { ScrollSyncController } from './sync/ScrollSyncController';
import { matchesAnyGlob } from './path/globs';
import { StatusBarController } from './ui/StatusBarController';

let store: ExplanationStore;
let provider: ExplanationDocumentProvider;
let syncController: ScrollSyncController;
let diagnosticsController: DiagnosticsController;
let statusBarController: StatusBarController;

export function activate(context: vscode.ExtensionContext): void {
  store = new ExplanationStore();
  provider = new ExplanationDocumentProvider(store);
  syncController = new ScrollSyncController(() => getCodeExplainerConfig().syncLineOffset);
  diagnosticsController = new DiagnosticsController();
  statusBarController = new StatusBarController(getCodeExplainerConfig());

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('code-explainer', provider),
    syncController,
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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeExplainer')) {
        statusBarController.update(getCodeExplainerConfig());
      }
    })
  );
}

export function deactivate(): void {
  syncController?.dispose();
  diagnosticsController?.dispose();
  statusBarController?.dispose();
}

async function explainCurrentFile(context: vscode.ExtensionContext, forceRefresh = false): Promise<void> {
  const editor = vscode.window.activeTextEditor;
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

      const chunks = await buildChunks(document, config.maxChunkLines);
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
        });
        store.update(stored.id, partial, false);
        provider.refresh(stored.explanationUri);
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
        const rendered = renderExplanation(document.lineCount, response);
        store.update(stored.id, rendered, config.cacheExplanations);
        provider.refresh(stored.explanationUri);
        diagnosticsController.update(document.uri, rendered.reviewItems);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = renderPendingExplanation(document.lineCount, `Code Explainer failed: ${message}`);
        store.update(stored.id, failed, false);
        provider.refresh(stored.explanationUri);
        vscode.window.showErrorMessage(`Code Explainer failed: ${message}`);
      }
    }
  );
}

async function openExplanation(
  sourceEditor: vscode.TextEditor,
  stored: { explanationUri: vscode.Uri }
): Promise<void> {
  const explanationDocument = await vscode.workspace.openTextDocument(stored.explanationUri);
  const explanationEditor = await vscode.window.showTextDocument(explanationDocument, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
    preserveFocus: false
  });
  syncController.bind(sourceEditor, explanationEditor);
}

async function chooseExplanationLevel(): Promise<void> {
  const levels: ExplanationLevel[] = ['concise', 'medium', 'detailed'];
  const selected = await vscode.window.showQuickPick(levels, {
    title: 'Code Explainer: Explanation Level',
    placeHolder: 'Choose how much detail to generate'
  });

  if (selected && isExplanationLevel(selected)) {
    await setExplanationLevel(selected);
    statusBarController.update(getCodeExplainerConfig());
    vscode.window.showInformationMessage(`Code Explainer level set to ${selected}.`);
  }
}

async function toggleReviewMode(): Promise<void> {
  const config = getCodeExplainerConfig();
  const nextValue = !config.reviewEnabled;
  await setReviewEnabled(nextValue);
  statusBarController.update(getCodeExplainerConfig());
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
  statusBarController.update(getCodeExplainerConfig());
  const offset = getCodeExplainerConfig().syncLineOffset;
  vscode.window.showInformationMessage(`Code Explainer sync offset set to ${formatOffset(offset)} line${Math.abs(offset) === 1 ? '' : 's'}.`);
}

async function resetSyncOffset(): Promise<void> {
  await setSyncLineOffset(0);
  statusBarController.update(getCodeExplainerConfig());
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
