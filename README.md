# Code Explainer

Code Explainer opens a source file beside a generated English explanation. The source stays in the normal VS Code editor, while the explanation appears in a right-side panel with a fixed settings header and a scrollable line-by-line explanation. Line 100 on the left maps to line 100 on the right, and vertical scrolling is synchronized both ways.

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

When an explanation panel is open, its top header always shows the current file, explanation level, review mode, sync offset, refresh action, and cache action. The status bar also shows the current level, review mode, and offset.

The fixed header helps compensate for source-editor top content such as breadcrumbs, CodeLens, or blame annotations. Because of that, `codeExplainer.syncLineOffset` now defaults to `0`; use the offset commands only if your right pane is still a line or two high/low.

`codeExplainer.webviewHeaderHeight` controls the fixed header height in pixels. Raise or lower it if your source editor has unusually tall or short top annotations.

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
