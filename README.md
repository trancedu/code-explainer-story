# Code Explainer

Code Explainer opens a source file beside a generated English explanation. The source stays in the normal VS Code editor, while the explanation is a read-only virtual document with the same number of physical lines as the source. Line 100 on the left maps to line 100 on the right, and vertical scrolling is synchronized both ways.

## Commands

- `Code Explainer: Explain Current File`
- `Code Explainer: Refresh Explanation`
- `Code Explainer: Set Explanation Level`
- `Code Explainer: Toggle Review Mode`
- `Code Explainer: Set OpenAI API Key`
- `Code Explainer: Clear OpenAI API Key`

## API Key

Use `Code Explainer: Set OpenAI API Key` to store your key in VS Code SecretStorage. For local extension development only, the extension also reads `OPENAI_API_KEY` from `.env` in the extension folder.

The `.env` file is ignored by git.

## Development

```sh
npm install
npm test
```

Tests mock the OpenAI request path and do not call the API.

