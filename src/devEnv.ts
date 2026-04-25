import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const secretKey = 'openaiApiKey';

export async function resolveOpenAIKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await context.secrets.get(secretKey);
  if (stored?.trim()) {
    return stored.trim();
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    return process.env.OPENAI_API_KEY.trim();
  }

  const envPath = path.join(context.extensionUri.fsPath, '.env');
  const fromEnvFile = readEnvKey(envPath);
  return fromEnvFile?.trim();
}

export async function storeOpenAIKey(context: vscode.ExtensionContext, value: string): Promise<void> {
  await context.secrets.store(secretKey, value.trim());
}

export async function clearOpenAIKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(secretKey);
}

export function readEnvKey(envPath: string): string | undefined {
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = /^OPENAI_API_KEY\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    return stripQuotes(match[1].trim());
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

