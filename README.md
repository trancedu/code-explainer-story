# Code Explainer

Code Explainer opens a source file beside a generated English explanation. The source stays in the normal VS Code editor, while the explanation is a read-only virtual document with the same number of physical lines as the source. Line 100 on the left maps to line 100 on the right, and vertical scrolling is synchronized both ways.

## Commands

- `Code Explainer: Explain Current File`
- `Code Explainer: Refresh Explanation`
- `Code Explainer: Set Explanation Level`
- `Code Explainer: Toggle Review Mode`
- `Code Explainer: Clear Cache`
- `Code Explainer: Increase Sync Offset`
- `Code Explainer: Decrease Sync Offset`
- `Code Explainer: Reset Sync Offset`
- `Code Explainer: Set OpenAI API Key`
- `Code Explainer: Clear OpenAI API Key`

When an explanation document is open, the editor title bar also shows quick actions for refresh, level, review, cache, and sync offset. The status bar shows the current level, review mode, and offset.

`codeExplainer.syncLineOffset` calibrates visual scroll alignment when the source editor has extra top content such as breadcrumbs, CodeLens, or blame annotations. The default is `+2`; use the offset commands if your right pane is still a line or two high/low.

Explanations are streamed into the right pane as chunk objects complete. Tests mock this behavior and never call the OpenAI API.

## API Key

Use `Code Explainer: Set OpenAI API Key` to store your key in VS Code SecretStorage. For local extension development only, the extension also reads `OPENAI_API_KEY` from `.env` in the extension folder.

The `.env` file is ignored by git.

## Development

```sh
npm install
npm test
```

Tests mock the OpenAI request path and do not call the API.
