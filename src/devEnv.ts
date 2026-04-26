import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LLMProvider } from './types';

const providerSecretKeys: Record<LLMProvider, string> = {
  openai: 'openaiApiKey',
  anthropic: 'anthropicApiKey'
};

const providerEnvKeys: Record<LLMProvider, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']
};

export async function resolveOpenAIKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return resolveApiKey(context, 'openai');
}

export async function resolveApiKey(context: vscode.ExtensionContext, provider: LLMProvider): Promise<string | undefined> {
  const stored = await context.secrets.get(providerSecretKeys[provider]);
  if (stored?.trim()) {
    return stored.trim();
  }

  for (const envKey of providerEnvKeys[provider]) {
    if (process.env[envKey]?.trim()) {
      return process.env[envKey]?.trim();
    }
  }

  const envPath = path.join(context.extensionUri.fsPath, '.env');
  const fromEnvFile = readEnvKey(envPath, providerEnvKeys[provider]);
  return fromEnvFile?.trim();
}

export async function storeOpenAIKey(context: vscode.ExtensionContext, value: string): Promise<void> {
  await storeApiKey(context, 'openai', value);
}

export async function storeApiKey(context: vscode.ExtensionContext, provider: LLMProvider, value: string): Promise<void> {
  await context.secrets.store(providerSecretKeys[provider], value.trim());
}

export async function clearOpenAIKey(context: vscode.ExtensionContext): Promise<void> {
  await clearApiKey(context, 'openai');
}

export async function clearApiKey(context: vscode.ExtensionContext, provider: LLMProvider): Promise<void> {
  await context.secrets.delete(providerSecretKeys[provider]);
}

export function readEnvKey(envPath: string, envNames: string[] = ['OPENAI_API_KEY']): string | undefined {
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    if (!envNames.includes(match[1])) {
      continue;
    }

    return stripQuotes(match[2].trim());
  }

  return undefined;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
