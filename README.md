# AI PR Review Action

A GitHub Action that automatically reviews pull requests using any OpenAI-compatible API (LM Studio, OpenAI, Ollama, etc.).

## Features

- Works with any OpenAI-compatible endpoint (LM Studio, OpenAI, Azure OpenAI, Ollama, etc.)
- Configurable review language (default: Turkish)
- Sticky comments - updates existing review instead of creating duplicates
- Configurable file and diff size limits
- Optional workflow failure on critical issues detected
- Custom reviewer instructions support
- Built-in retry mechanism with exponential backoff
- Request timeout handling (2 minute default)
- Token estimation and large prompt warnings

## Usage

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: AI Code Review
        uses: cumartesiolsun/ai-pr-review-action@v0.1.0
        with:
          base_url: "https://api.openai.com/v1"
          api_key: ${{ secrets.OPENAI_API_KEY }}
          model: "gpt-4o"
          language: "English"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Using with LM Studio (Local)

```yaml
- name: AI Code Review
  uses: cumartesiolsun/ai-pr-review-action@v0.1.0
  with:
    base_url: "http://localhost:1234/v1"
    api_key: "lm-studio"
    model: "qwen2.5-coder-32b-instruct"
    language: "Turkish"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Multi-Model Review (Two Jobs)

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  general-review:
    runs-on: ubuntu-latest
    steps:
      - name: General Code Review
        uses: cumartesiolsun/ai-pr-review-action@v0.1.0
        with:
          base_url: ${{ secrets.LLM_BASE_URL }}
          api_key: ${{ secrets.LLM_API_KEY }}
          model: "openai/gpt-oss-20b"
          language: "Turkish"
          extra_instructions: "Focus on architecture, design patterns, and maintainability."
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  code-review:
    runs-on: ubuntu-latest
    steps:
      - name: Code-Focused Review
        uses: cumartesiolsun/ai-pr-review-action@v0.1.0
        with:
          base_url: ${{ secrets.LLM_BASE_URL }}
          api_key: ${{ secrets.LLM_API_KEY }}
          model: "qwen3-coder"
          language: "Turkish"
          extra_instructions: "Focus on bugs, security issues, and suggest specific code patches."
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `base_url` | Yes | - | OpenAI-compatible base URL |
| `api_key` | Yes | - | API key/token |
| `model` | Yes | - | Model name to use |
| `language` | No | `Turkish` | Review output language |
| `max_files` | No | `25` | Maximum files to review (1-200) |
| `max_chars` | No | `120000` | Maximum diff characters (10k-500k) |
| `fail_on_issues` | No | `false` | Fail workflow if critical issues found |
| `extra_instructions` | No | - | Additional reviewer instructions |

## How It Works

1. Triggered on pull request events (open, sync, reopen)
2. Fetches PR diff and file list from GitHub API
3. Estimates token count and warns if exceeding limits
4. Builds a review prompt with file changes and diff content
5. Sends to configured OpenAI-compatible endpoint (with retry on failure)
6. Posts review as a PR comment (updates existing if re-run)
7. Optionally fails workflow if critical issues detected

## Environment Variables

- `GITHUB_TOKEN` - Required for GitHub API access (automatically provided by GitHub Actions)

## Development

```bash
# Install dependencies
npm install

# Build the action (creates dist/index.js)
npm run build
```

## Versioning

Use semantic versioning tags for stable references:

```yaml
# Recommended: use a specific version
uses: cumartesiolsun/ai-pr-review-action@v0.1.0

# Or use major version for automatic minor/patch updates
uses: cumartesiolsun/ai-pr-review-action@v0
```

## License

MIT
