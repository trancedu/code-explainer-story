# Code Explainer VS Code Extension Plan

Date: 2026-04-25

## Goal

Build a VS Code extension that opens a code file and a synchronized English explanation side by side:

- Left side: the normal source code editor.
- Right side: a read-only explanation document whose line N corresponds to source line N.
- Vertical scrolling is synchronized both ways.
- Explanation levels: `concise`, `medium`, `detailed`.
- Optional review-enabled mode that adds quality notes and suggestions.
- Primary language targets: Python, R, TypeScript, plus graceful fallback for other text files.
- Use one OpenAI API call per file generation, with client-side chunk metadata and structured model output.
- Default model: `gpt-5.4-mini`.

## Recommendation

Use TypeScript. It is the natural choice for VS Code extensions because the VS Code API is TypeScript-first, extension examples and tests are TypeScript-friendly, and it lets us strongly type the chunk model, OpenAI response schema, cache keys, and sync controller.

For the first working version, prefer a native dual-editor design over a custom webview:

1. Keep the source file in the normal VS Code text editor.
2. Render the explanation as a VS Code virtual document via `TextDocumentContentProvider`.
3. Open the explanation beside the source editor.
4. Sync vertical scroll with `window.onDidChangeTextEditorVisibleRanges` and `TextEditor.revealRange`.

This avoids rebuilding an editor in a webview, keeps the font/line height close to the user's actual editor settings, and gives us stable line-number mapping. A webview can be added later for richer review dashboards, but it is not the right first layer for precise line pairing.

## Official API Notes

OpenAI:

- Official model docs currently list `gpt-5.4-mini` as a lower-latency, lower-cost model option with a 400K context window and 128K max output.
- The `gpt-5.4-mini` model page lists Responses API and Structured Outputs support.
- The Responses API supports `text.format` with `json_schema`, which should be used instead of free-form JSON.
- Structured Outputs are intended to make model responses conform to a supplied JSON Schema.

VS Code:

- `TextDocumentContentProvider` supports read-only virtual documents.
- `TextEditor.visibleRanges` exposes the current vertical visible ranges.
- `TextEditor.revealRange(..., TextEditorRevealType.AtTop)` can scroll an editor to a target range.
- Webviews support message passing and custom UI, but `retainContextWhenHidden` has high memory overhead and should be used only when needed.

Source links:

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://code.visualstudio.com/api/extension-guides/virtual-documents
- https://code.visualstudio.com/api/references/vscode-api
- https://code.visualstudio.com/api/extension-guides/webview

## Architecture

### Extension Components

`extension.ts`

- Registers commands.
- Owns activation, configuration, and extension context.
- Wires services together.

`commands/`

- `explainCurrentFile`
- `refreshExplanation`
- `setExplanationLevel`
- `toggleReviewMode`
- `setOpenAIKey`
- `clearOpenAIKey`

`providers/ExplanationDocumentProvider.ts`

- Implements `vscode.TextDocumentContentProvider`.
- Serves `code-explainer:` virtual documents.
- Emits `onDidChange` when generated content changes.

`sync/ScrollSyncController.ts`

- Tracks pairs of source editor and explanation editor.
- Listens to `window.onDidChangeTextEditorVisibleRanges`.
- Reveals the matching top line in the paired editor.
- Uses debounce and a reentrancy guard to avoid scroll ping-pong.

`analysis/Chunker.ts`

- Converts a `TextDocument` into semantic-ish chunks.
- First tries VS Code document symbols.
- Falls back to language-aware and generic line chunking.

`openai/OpenAIClient.ts`

- Wraps the OpenAI JavaScript SDK.
- Uses Responses API with `model: "gpt-5.4-mini"`.
- Sends one request per file generation.
- Requests strict structured JSON.
- Supports cancellation, retry/backoff, and redacted error handling.

`state/ExplanationStore.ts`

- Holds current generated explanations in memory.
- Optional persistent cache later.
- Keyed by file URI, document version/hash, level, review flag, and model.

`review/DiagnosticsController.ts`

- Optional in MVP, useful soon after.
- Converts review items into VS Code diagnostics so suggestions can appear in Problems and editor squiggles.

### URI Design

Use a custom URI scheme:

```text
code-explainer:/absolute/path/to/file.py?level=medium&review=true&hash=...
```

The provider maps that URI back to an `ExplanationDocument` in `ExplanationStore`.

### Line Alignment Model

The explanation document must have exactly the same number of physical lines as the source document:

- Source line 1 maps to explanation line 1.
- Source line 100 maps to explanation line 100.
- Empty explanation rows are allowed.
- Word wrap should be off for the explanation language so long lines scroll horizontally instead of creating extra visual rows.
- No explanation string may contain newline characters; sanitize `\n` to spaces.

This satisfies the "English book beside source code" model and keeps scroll sync simple.

## Rendering Strategy

### MVP: Native Dual Text Editors

Flow:

1. User runs `Code Explainer: Explain Current File`.
2. Extension reads the active `TextDocument`.
3. Extension chunks the file and calls OpenAI once.
4. Provider generates a virtual explanation document with the same number of lines as the source.
5. Extension opens the explanation in `ViewColumn.Beside`.
6. Scroll sync binds both editors.

Explanation document content example:

```text
Imports pandas and numpy for tabular data work.

Defines a helper that normalizes input paths.
Checks whether the file exists before reading.

Builds the dataframe from CSV data.
```

Blank lines intentionally preserve alignment.

### Later: Rich Webview Mode

A later webview mode can add:

- Chunk cards.
- Review summaries.
- Filters by severity.
- Inline accept/copy actions.
- Better visual grouping.

But a webview should not be the first implementation because it would require recreating editor-like layout and scroll behavior. VS Code webviews also communicate by message passing and hidden retained context has memory cost.

## Scroll Sync Design

Use two-way vertical sync:

```ts
vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
  const pair = findPair(event.textEditor);
  if (!pair || syncInProgress) return;

  const topLine = event.visibleRanges[0]?.start.line ?? 0;
  const target = new vscode.Range(topLine, 0, topLine, 0);

  syncInProgress = true;
  pair.otherEditor.revealRange(target, vscode.TextEditorRevealType.AtTop);
  setTimeout(() => { syncInProgress = false; }, 75);
});
```

Important details:

- Debounce scroll events by about 50-100 ms.
- Use a reentrancy guard because `revealRange` triggers visible range changes.
- Only sync paired documents, not every open editor.
- If the source line count changes, mark explanation stale and ask user to refresh.
- Native VS Code API exposes vertical visible ranges, not horizontal scroll positions. Horizontal scrolling should remain independent.

## Chunking Strategy

### Primary Chunking

Use VS Code's built-in symbol pipeline:

```ts
const symbols = await vscode.commands.executeCommand<
  Array<vscode.DocumentSymbol | vscode.SymbolInformation>
>('vscode.executeDocumentSymbolProvider', document.uri);
```

For TypeScript this should usually work well with built-in language support. Python depends on the installed Python/Pylance setup. R depends on the user's R extension support.

### Fallback Chunking

When document symbols are unavailable or too sparse:

- Python: split on top-level `class`, `def`, decorated functions, and large blank-line-separated sections.
- R: split on function assignments like `name <- function(...)`, roxygen blocks, and section comments.
- TypeScript: split on exported declarations, classes, functions, interfaces, enums, and large brace-balanced sections.
- Generic: split by blank lines and cap chunks by line count.

### Chunk Constraints

Suggested defaults:

- Merge tiny chunks under 6 lines with neighbors.
- Split chunks over 120 lines into smaller windows.
- Preserve original 1-based line ranges in the prompt.
- Include line-numbered code in each chunk so the model can map explanations precisely.

## OpenAI Request Design

Use one Responses API request per file generation:

```ts
const response = await client.responses.create({
  model: 'gpt-5.4-mini',
  reasoning: { effort: reviewEnabled ? 'medium' : 'low' },
  input: [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: JSON.stringify(filePayload)
    }
  ],
  text: {
    format: {
      type: 'json_schema',
      name: 'code_explanation',
      strict: true,
      schema: EXPLANATION_SCHEMA
    }
  }
});
```

Notes:

- Use `gpt-5.4-mini` by default.
- Keep the model setting configurable.
- Use `low` reasoning for normal explanations and `medium` for review mode.
- Use structured outputs so the extension can validate and render safely.
- Use `AbortController` so canceling VS Code progress cancels the request.

### Prompt Contract

The model should receive:

- File path hint, not necessarily full private path if privacy mode is enabled.
- Language ID.
- Total line count.
- Explanation level.
- Review-enabled flag.
- Chunks with `id`, `startLine`, `endLine`, `kind`, `symbolPath`, and line-numbered code.

The model must return:

- A chunk result for each known chunk ID.
- Line explanations as 1-based source line numbers.
- No newlines in any explanation text.
- At most one explanation per source line.
- Optional review items if review mode is enabled.

### Response Shape

```ts
type ExplanationResponse = {
  fileSummary: string;
  chunks: Array<{
    id: string;
    startLine: number;
    endLine: number;
    summary: string;
    lines: Array<{
      line: number;
      text: string;
    }>;
    review?: Array<{
      startLine: number;
      endLine: number;
      severity: 'info' | 'warning' | 'error';
      category: 'correctness' | 'readability' | 'maintainability' | 'performance' | 'security' | 'typing' | 'style';
      message: string;
      suggestion?: string;
    }>;
  }>;
};
```

### Post-processing

After the API call:

1. Validate JSON schema.
2. Reject unknown chunk IDs.
3. Clamp line numbers to the document.
4. Replace newlines/tabs in explanations with spaces.
5. Build an array of length `document.lineCount`.
6. Fill blank rows where no explanation is returned.
7. If a chunk has more explanation rows than source rows, compress to fit.
8. If a line explanation is too long, leave it as one line and rely on horizontal scroll.

## Explanation Levels

`concise`

- Sparse, one short note per logical block.
- Prefer chunk summaries on the first meaningful line.
- Best default for experienced developers.

`medium`

- Explain most meaningful lines and branches.
- Avoid restating obvious syntax.
- Good default for learning a new codebase.

`detailed`

- Explain each meaningful line.
- Include inputs, outputs, side effects, and tricky assumptions.
- Still obey one physical explanation line per source line.

## Review Mode

Review mode should use the same one-call-per-file request and ask for both explanations and review items.

Display options:

- Put short review notes on the matching explanation line.
- Add VS Code diagnostics for review items.
- Add commands:
  - `Code Explainer: Toggle Review Mode`
  - `Code Explainer: Next Review Finding`
  - `Code Explainer: Copy Review Summary`

Review should prioritize:

- Correctness bugs.
- Runtime errors.
- Security issues.
- Performance traps.
- Type or API misuse.
- Maintainability issues.

Review should avoid:

- Noisy style-only suggestions unless the code is clearly confusing.
- Claims that require running the code unless marked as assumptions.

## Settings

Proposed configuration:

```json
{
  "codeExplainer.model": "gpt-5.4-mini",
  "codeExplainer.explanationLevel": "medium",
  "codeExplainer.reviewEnabled": false,
  "codeExplainer.maxFileLines": 3000,
  "codeExplainer.maxChunkLines": 120,
  "codeExplainer.autoRefreshOnSave": false,
  "codeExplainer.cacheExplanations": true,
  "codeExplainer.privacy.includeFullPath": false,
  "codeExplainer.excludedGlobs": [
    "**/.env",
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**"
  ]
}
```

Add language defaults for the explanation virtual document:

```json
{
  "contributes": {
    "languages": [
      {
        "id": "code-explainer-output",
        "aliases": ["Code Explainer Output"],
        "extensions": [".code-explainer"]
      }
    ],
    "configurationDefaults": {
      "[code-explainer-output]": {
        "editor.wordWrap": "off",
        "editor.lineNumbers": "on",
        "editor.minimap.enabled": false
      }
    }
  }
}
```

## API Key Handling

Do not rely on committing or packaging `.env`.

Recommended behavior:

- Use VS Code `SecretStorage` for the API key.
- Add `Code Explainer: Set OpenAI API Key`.
- For local development only, load `OPENAI_API_KEY` from the extension repo `.env` if present.
- Never log the key.
- Redact the key from errors.
- Add `.env` to `.gitignore`.

The current project has `/Users/trance/coding/code-explainer/.env`; treat that as local development convenience, not the production storage mechanism.

## Large File Policy

The user preference is one call per file. Keep that as the default contract.

However, very large files can exceed practical token/output limits or become expensive. The extension should:

- Estimate tokens before calling.
- Warn if the file exceeds `codeExplainer.maxFileLines` or token budget.
- Offer:
  - Explain current selection.
  - Explain visible range.
  - Temporarily allow multi-call mode in a future setting.

For MVP, do not silently split one file across multiple OpenAI calls because that violates the product rule.

## Milestones

### Milestone 1: Extension Skeleton

- Create TypeScript VS Code extension.
- Add commands and settings.
- Add `.env` loading for dev and `SecretStorage` for real key storage.
- Add lint/test setup.

Acceptance:

- Extension activates.
- Commands appear in Command Palette.
- API key command stores and retrieves a test value.

### Milestone 2: Virtual Explanation Document

- Implement `TextDocumentContentProvider`.
- Generate placeholder explanation lines equal to source line count.
- Open source and explanation side by side.
- Add language defaults for no word wrap.

Acceptance:

- Explanation opens beside source.
- Line counts match exactly.
- Font and line spacing visually match normal editor behavior.

### Milestone 3: Two-way Scroll Sync

- Implement `ScrollSyncController`.
- Pair editors by source URI and explanation URI.
- Debounced two-way syncing with reentrancy guard.

Acceptance:

- Scrolling source to line 100 reveals line 100 in explanation.
- Scrolling explanation to line 100 reveals line 100 in source.
- No obvious ping-pong or jitter.

### Milestone 4: Chunking

- Implement symbol-based chunker.
- Add Python/R/TypeScript fallback chunkers.
- Add unit tests with fixture files.

Acceptance:

- TypeScript, Python, and R fixtures produce stable chunk ranges.
- Every source line is either covered or intentionally blank.

### Milestone 5: OpenAI Generation

- Add OpenAI SDK wrapper.
- Create prompt and JSON schema.
- Use one call per file.
- Validate and render model output.
- Add progress, cancellation, and redacted errors.

Acceptance:

- Real file produces aligned explanation.
- Invalid model output is handled without corrupting the view.
- Cancel stops the request.

### Milestone 6: Review Mode

- Extend schema for review findings.
- Render review comments in explanation lines.
- Optionally publish diagnostics.

Acceptance:

- Review-enabled mode returns suggestions tied to line ranges.
- Diagnostics clear and refresh with new generations.

### Milestone 7: Polish

- Cache explanations.
- Add stale state handling after source edits.
- Add status bar level selector.
- Add "Refresh Explanation" and "Copy Explanation" commands.
- Add package README and usage screenshots.

Acceptance:

- Extension feels coherent for daily use on real files.

## Testing Plan

Unit tests:

- Chunking for `.py`, `.R`, `.ts`, `.tsx`.
- Response schema validation.
- Post-processing line alignment.
- Cache key generation.
- Secret handling does not log secrets.

Integration tests:

- Use `@vscode/test-electron`.
- Open a source fixture.
- Run explain command with mocked OpenAI client.
- Verify virtual document line count.
- Verify paired editors exist.
- Exercise scroll sync via `revealRange`.

Manual tests:

- Small Python script.
- R analysis script with roxygen comments.
- TypeScript file with classes, interfaces, and nested functions.
- Large file near the configured cap.
- Source edit after explanation generation.
- Dark/light themes.
- Word wrap on/off in user settings.

## Risks And Things To Watch

- Exact pixel-perfect scroll sync is hard with native VS Code APIs. MVP should target line-top sync, which is enough for "line 100 matches line 100."
- Horizontal scroll sync is not exposed for native text editors. Let each pane scroll horizontally on its own.
- If word wrap is enabled, visual rows no longer equal document lines. Use language defaults to turn wrapping off for explanation output.
- R symbol support may depend on installed R extensions. Keep robust fallback chunking.
- Model output can be too verbose. Enforce one physical line per source line in both prompt and post-processing.
- One call per file can be expensive for large files. Add token and line limits.
- Source edits after generation can invalidate line mapping. Mark stale and refresh.
- Do not store API keys in settings or source files.
- Avoid logging code content by default because users may explain private code.

## Clarifying Questions

1. Should generation run only from an explicit command, or should it auto-generate when a file opens?
2. Should explanations be cached on disk, or only in memory for privacy?
3. For files that are too large for one practical call, should the extension refuse, explain only a selection, or allow an optional multi-call mode?
4. Should review findings appear in VS Code Problems/Diagnostics, or only in the right-side explanation?
5. Should the right pane be purely read-only text, or should later versions allow editable personal notes mixed with generated explanations?

## Initial Implementation Choice

Start with:

- TypeScript.
- Native source editor plus virtual explanation editor.
- OpenAI Responses API.
- `gpt-5.4-mini`.
- Strict JSON schema output.
- Document-symbol chunking with language-specific fallbacks.
- One physical explanation line per source line.
- Two-way vertical sync via visible ranges and reveal range.

