import * as vscode from 'vscode';
import { CodeExplainerConfig } from '../config';

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
    this.item.text = `$(book) Explain ${config.explanationLevel} • ${review} • offset ${offset}`;
    this.item.tooltip = [
      'Code Explainer settings',
      `Level: ${config.explanationLevel}`,
      `Review: ${config.reviewEnabled ? 'on' : 'off'}`,
      `Sync offset: ${offset}`,
      'Click to change explanation level.'
    ].join('\n');
  }

  dispose(): void {
    this.item.dispose();
  }
}

