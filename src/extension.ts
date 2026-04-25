import * as path from 'path';
import * as vscode from 'vscode';
import { buildChunks } from './analysis/Chunker';
import { renderExplanation } from './analysis/postProcess';
import { getCodeExplainerConfig, setExplanationLevel, setReviewEnabled } from './config';
import { clearOpenAIKey, resolveOpenAIKey, storeOpenAIKey } from './devEnv';
import { OpenAIClient } from './openai/OpenAIClient';
import { ExplanationDocumentProvider } from './providers/ExplanationDocumentProvider';
import { DiagnosticsController } from './review/DiagnosticsController';
import { ExplanationStore, hashText } from './state/ExplanationStore';
import { ExplanationLevel, FilePayload } from './types';
import { ScrollSyncController } from './sync/ScrollSyncController';

let store: ExplanationStore;
let provider: ExplanationDocumentProvider;
let syncController: ScrollSyncController;
let diagnosticsController: DiagnosticsController;

export function activate(context: vscode.ExtensionContext): void {
  store = new ExplanationStore();
  provider = new ExplanationDocumentProvider(store);
  syncController = new ScrollSyncController();
  diagnosticsController = new DiagnosticsController();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('code-explainer', provider),
    syncController,
    diagnosticsController,
    vscode.commands.registerCommand('codeExplainer.explainCurrentFile', () => explainCurrentFile(context)),
    vscode.commands.registerCommand('codeExplainer.refreshExplanation', () => explainCurrentFile(context, true)),
    vscode.commands.registerCommand('codeExplainer.setExplanationLevel', chooseExplanationLevel),
    vscode.commands.registerCommand('codeExplainer.toggleReviewMode', toggleReviewMode),
    vscode.commands.registerCommand('codeExplainer.setOpenAIKey', () => promptForApiKey(context)),
    vscode.commands.registerCommand('codeExplainer.clearOpenAIKey', () => clearStoredApiKey(context)),
    vscode.workspace.onDidChangeTextDocument((event) => markStaleIfExplained(event.document))
  );
}

export function deactivate(): void {
  syncController?.dispose();
  diagnosticsController?.dispose();
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

      progress.report({ message: `Asking ${config.model} for one file-level explanation...` });
      const response = await new OpenAIClient().generateExplanation(payload, {
        apiKey,
        model: config.model,
        signal: abortController.signal
      });

      progress.report({ message: 'Aligning explanation lines...' });
      const rendered = renderExplanation(document.lineCount, response);
      const stored = store.put(requestKey, document.uri, rendered, config.cacheExplanations);
      provider.refresh(stored.explanationUri);
      diagnosticsController.update(document.uri, rendered.reviewItems);
      await openExplanation(editor, stored);
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
  const selected = await vscode.window.showQuickPick<ExplanationLevel>(['concise', 'medium', 'detailed'], {
    title: 'Code Explainer: Explanation Level',
    placeHolder: 'Choose how much detail to generate'
  });

  if (selected) {
    await setExplanationLevel(selected);
    vscode.window.showInformationMessage(`Code Explainer level set to ${selected}.`);
  }
}

async function toggleReviewMode(): Promise<void> {
  const config = getCodeExplainerConfig();
  const nextValue = !config.reviewEnabled;
  await setReviewEnabled(nextValue);
  vscode.window.showInformationMessage(`Code Explainer review mode ${nextValue ? 'enabled' : 'disabled'}.`);
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
  const normalized = uri.fsPath.replaceAll(path.sep, '/');
  return globs.some((glob) => globMatches(normalized, glob));
}

function globMatches(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(filePath) || new RegExp(`${escaped}$`).test(filePath);
}

