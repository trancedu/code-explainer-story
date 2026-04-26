# Code Explainer

Code Explainer opens a source file beside a generated English explanation. The source stays in the normal VS Code editor, while the explanation appears in a right-side panel with a fixed settings header and a scrollable line-by-line explanation. Line 100 on the left maps to line 100 on the right, and vertical scrolling is synchronized both ways.

Repository: https://github.com/trancedu/code-explainer

## Commands

- `Code Explainer: Explain Current File`
- `Code Explainer: Refresh Explanation`
- `Code Explainer: Set Model`
- `Code Explainer: Set Explanation Level`
- `Code Explainer: Toggle Inline Explanations`
- `Code Explainer: Toggle Review Mode`
- `Code Explainer: Clear Cache`
- `Code Explainer: Save Current Explanation Snapshot`
- `Code Explainer: Explain Folder`
- `Code Explainer: Explain Workspace`
- `Code Explainer: Increase Sync Offset`
- `Code Explainer: Decrease Sync Offset`
- `Code Explainer: Reset Sync Offset`
- `Code Explainer: Set OpenAI API Key`
- `Code Explainer: Clear OpenAI API Key`
- `Code Explainer: Set Anthropic API Key`
- `Code Explainer: Clear Anthropic API Key`

You can also right-click any file in the Explorer side bar, or right-click an editor tab in the top bar, and choose `Code Explainer: Explain Current File` to run the explainer for that file.

In the explanation panel, right-click a row and choose `Ask follow-up question` to ask about that source line. In walkthrough mode, right-clicking a paragraph asks about the whole mapped source chunk. The answer streams into a floating card over the explanation panel without changing the line layout or saved explanation, and the card can ask another question about the same focus.

When an explanation panel is open, its top header always shows the current model, inline mode, explanation level, review mode, sync offset, refresh action, and cache action. The status bar also shows the current level and model.

Inline explanations are optional. Turn them on with `Code Explainer: Toggle Inline Explanations` or the `Inline` button in the explanation header. Inline mode shows hover text on nearby code and short end-of-line hints when the source line is not too wide. The right-side panel remains the complete collected view.

The fixed header helps compensate for source-editor top content such as breadcrumbs, CodeLens, or blame annotations. Because of that, `codeExplainer.syncLineOffset` now defaults to `0`; use the offset commands only if your right pane is still a line or two high/low.

`codeExplainer.webviewHeaderHeight` controls the fixed header height in pixels. Raise or lower it if your source editor has unusually tall or short top annotations.

Explanations are streamed into the right pane as chunk objects complete. Tests mock this behavior and never call the OpenAI or Anthropic APIs.

`codeExplainer.maxChunkLines` defaults to `10`, so even a long function receives periodic flow explanations instead of one giant summary. Medium mode is always capped at 10 source lines per chunk and can show a few important line notes per chunk; concise mode stays summary-only. Detailed mode can show line-level explanations, but blank and comment-only source lines are always kept empty. Story mode is capped at 8 source lines per chunk and uses more natural teaching prose for branch behavior, language terms, and success/failure paths. Walkthrough mode is capped at 5 source lines per chunk and turns the right panel into a longer guide for technical readers who may not know the language, framework, or architecture. It explains branches, loops, error paths, framework calls, and important syntax in more detail, and it may use more rows than the source file.

Long explanation rows are wrapped around 80 characters when there are empty explanation rows below them in the same chunk. Wrapping never spills into the next chunk; if no empty row is available, the remaining text is appended to the chunk tail. This lets story explanations become wider at the end of a chunk instead of losing detail.

Walkthrough mode uses chunk-level sync instead of exact line sync. Moving the source-editor cursor onto a line highlights the corresponding explanation paragraph block in the right panel with a blue background and scrolls it into a comfortable reading position near the top. Clicking a paragraph in the right panel scrolls the source editor so the matching chunk's first line sits at the top of the viewport. Plain source-editor scrolling does not move the right panel — only cursor moves do — to keep the chunk-level reading flow stable. Inline hints and per-line active-row highlighting are disabled. Standalone comments and docstrings are skipped as separate explanation topics; they are used only as context when explaining the executable code that follows.

Successful explanations are saved under `.code-explainer/explanations/` by default. The folder mirrors your source tree, for example `backend/main.py` becomes `.code-explainer/explanations/backend/main.py.medium.json` for OpenAI and `.code-explainer/explanations/backend/main.py.anthropic.medium.json` for Anthropic. These JSON snapshots include the source hash, provider, model, level, review mode, line-aligned explanation text, and review findings. Fresh snapshots are loaded before calling the API, so teammates can commit the folder and avoid regenerating unchanged explanations.

`Code Explainer: Explain Folder` and `Code Explainer: Explain Workspace` use `codeExplainer.includeGlobs`, skip `codeExplainer.excludedGlobs`, and ask for confirmation before processing multiple files.

When a saved source file has an existing in-memory explanation or snapshot, Code Explainer detects that the saved content hash no longer matches and prompts to regenerate it. Set `codeExplainer.autoRegenerateOnSave` to `true` if you want that refresh to happen automatically on save; it defaults to `false` to avoid surprise API usage.

## API Key

Use `Code Explainer: Set Model` to choose the generation model. Model ids starting with `claude` use Anthropic; `gpt` and other model ids use OpenAI.

Use `Code Explainer: Set OpenAI API Key` or `Code Explainer: Set Anthropic API Key` to store your key in VS Code SecretStorage. If no key is configured, the first command that needs generation asks for the key required by the chosen model and then continues. For local extension development only, the extension also reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `CLAUDE_API_KEY` from `.env` in the extension folder.

`codeExplainer.model` defaults to `gpt-5.4-mini`, and `codeExplainer.modelPresets` includes `claude-sonnet-4-6`. Use `Code Explainer: Set Model` to pick a preset or enter a custom model id.

The `.env` file is ignored by git.

## Custom Model Providers

Out of the box, model routing is deliberately small: model ids starting with `claude` use Anthropic, and everything else uses OpenAI. To connect another provider or a self-hosted model, update the routing and client code rather than only changing the model name:

1. Add the provider name to `LLMProvider` in `src/types.ts`.
2. Update `providerForModel()` and `providerDisplayName()` in `src/llm/modelRouting.ts` so your model ids route to that provider.
3. Add a client modeled after `src/openai/OpenAIClient.ts` or `src/anthropic/AnthropicClient.ts`. It should expose both `generateExplanationStream()` for file explanations and `askQuestionStream()` for follow-up answers.
4. Branch to that client in `src/extension.ts` wherever the current code chooses between `AnthropicClient` and `OpenAIClient`.
5. If your provider needs a different key, add SecretStorage commands and `.env` lookup support in `src/devEnv.ts`, then add matching command contributions in `package.json`.

For OpenAI-compatible local gateways, the smallest change is usually to adapt `src/openai/OpenAIClient.ts` to your endpoint URL, headers, and response format while keeping the same public methods.

## Release Builds

Build VSIX packages into `release/`:

```sh
npm run package:vsix
```

The generated `.vsix` files are ignored by git and excluded from future extension packages.

## Development

```sh
npm install
npm test
```

Tests mock the OpenAI and Anthropic request paths and do not call either API.

## License

MIT
