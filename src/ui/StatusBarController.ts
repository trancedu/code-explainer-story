import * as vscode from 'vscode';
import { CodeExplainerConfig, getActiveModel } from '../config';
import { providerDisplayName } from '../llm/modelRouting';

export class StatusBarController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);

  constructor(config: CodeExplainerConfig) {
    this.item.command = 'codeExplainer.setExplanationLevel';
    this.update(config);
    this.item.show();
  }

  update(config: CodeExplainerConfig): void {
    const review = config.reviewEnabled ? 'review on' : 'review off';
    const offset = config.syncLineOffset >= 0 ? `+${config.syncLineOffset}` : String(config.syncLineOffset);
    const activeModel = getActiveModel(config);
    this.item.text = `$(book) Explain ${config.explanationLevel} • ${activeModel}`;
    this.item.tooltip = [
      'Code Explainer settings',
      `Model: ${activeModel}`,
      `API: ${providerDisplayName(config.provider)} (inferred from model)`,
      `Level: ${config.explanationLevel}`,
      `Inline: ${config.inlineEnabled ? 'on' : 'off'}`,
      `Review: ${config.reviewEnabled ? 'on' : 'off'}`,
      `Sync offset: ${offset}`,
      'Click to change explanation level. Use Code Explainer: Set Model to change generation.'
    ].join('\n');
  }

  dispose(): void {
    this.item.dispose();
  }
}
