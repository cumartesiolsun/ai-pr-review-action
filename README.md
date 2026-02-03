# AI PR Review Action

A GitHub Action that automatically reviews pull requests using any OpenAI-compatible API (LM Studio, OpenAI, Ollama, etc.).

## Features

- **Two review modes**: Summary (single PR comment) or Inline (per-file comments)
- Works with any OpenAI-compatible endpoint (LM Studio, OpenAI, Azure OpenAI, Ollama, etc.)
- **Diff chunking**: Handles large files by splitting into ~12k char chunks
- **Smart filtering**: Skips "no issues" responses to avoid noise
- Configurable review language (default: Turkish)
- Sticky comments - updates existing review instead of creating duplicates
- Multi-job support with unique comment markers
- Built-in retry mechanism with exponential backoff (handles 429, 5xx errors)
- Request timeout handling (60 second default)
- Token estimation and large prompt warnings

## Usage

### Summary Mode (Default)

Posts a single comprehensive review comment on the PR:

```yaml
name: AI PR Review

permissions:
  contents: read
  pull-requests: write

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: AI Code Review
        uses: cumartesiolsun/ai-pr-review-action@v0.3.0
        with:
          base_url: "https://api.openai.com/v1"
          api_key: ${{ secrets.OPENAI_API_KEY }}
          model: "gpt-4o"
          language: "English"
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

### Inline Mode (Per-File Comments)

Posts inline review comments directly on each file in the PR:

```yaml
- name: AI Code Review (Inline)
  uses: cumartesiolsun/ai-pr-review-action@v0.3.0
  with:
    base_url: "https://api.openai.com/v1"
    api_key: ${{ secrets.OPENAI_API_KEY }}
    model: "gpt-4o"
    language: "English"
    review_mode: "inline"
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

### Using with LM Studio (Local)

```yaml
- name: AI Code Review
  uses: cumartesiolsun/ai-pr-review-action@v0.3.0
  with:
    base_url: "http://localhost:1234/v1"
    api_key: "lm-studio"
    model: "qwen2.5-coder-32b-instruct"
    language: "Turkish"
    review_mode: "inline"
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

### Multi-Model Review (Two Jobs)

Use `comment_marker` to prevent jobs from overwriting each other's comments:

```yaml
name: AI PR Review

permissions:
  contents: read
  pull-requests: write

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  general-review:
    runs-on: ubuntu-latest
    steps:
      - name: General Code Review
        uses: cumartesiolsun/ai-pr-review-action@v0.3.0
        with:
          base_url: ${{ secrets.LLM_BASE_URL }}
          api_key: ${{ secrets.LLM_API_KEY }}
          model: "openai/gpt-oss-20b"
          language: "Turkish"
          review_mode: "summary"
          extra_instructions: "Focus on architecture, design patterns, and maintainability."
          comment_marker: "GENERAL_REVIEW"
        env:
          GITHUB_TOKEN: ${{ github.token }}

  code-review:
    runs-on: ubuntu-latest
    steps:
      - name: Code-Focused Review (Inline)
        uses: cumartesiolsun/ai-pr-review-action@v0.3.0
        with:
          base_url: ${{ secrets.LLM_BASE_URL }}
          api_key: ${{ secrets.LLM_API_KEY }}
          model: "qwen3-coder"
          language: "Turkish"
          review_mode: "inline"
          extra_instructions: "Focus on bugs, security issues, and suggest specific code patches."
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `base_url` | Yes | - | OpenAI-compatible base URL |
| `api_key` | Yes | - | API key/token |
| `model` | Yes | - | Model name to use |
| `language` | No | `Turkish` | Review output language |
| `review_mode` | No | `summary` | `summary` for single PR comment, `inline` for per-file comments |
| `max_files` | No | `25` | Maximum files to review (1-200) |
| `max_chars` | No | `120000` | Maximum diff characters (10k-500k), used in summary mode |
| `fail_on_issues` | No | `false` | Fail workflow if critical issues found |
| `extra_instructions` | No | - | Additional reviewer instructions |
| `comment_marker` | No | `AI_PR_REVIEW_ACTION` | Unique marker for sticky comments (summary mode only) |

## How It Works

### Summary Mode
1. Fetches all PR files and builds a combined diff
2. Sends entire diff to LLM in a single request
3. Posts one comprehensive review comment on the PR
4. Updates existing comment on re-runs (sticky comment)

### Inline Mode
1. Fetches all PR files with patches
2. For each file:
   - Chunks large diffs into ~12k char pieces
   - Sends each chunk to LLM separately
   - Aggregates responses for multi-chunk files
   - Skips files with "no issues" responses
3. Posts inline review comments directly on files
4. Uses GitHub Pull Request Review API

## Advanced Features

### Diff Chunking
Large files are automatically split into ~12k character chunks. Each chunk is reviewed separately and responses are combined:

```
**Part 1:**
- Issue in first section...

**Part 2:**
- Issue in second section...
```

### Smart Response Filtering
Empty or "looks good" responses are automatically filtered to reduce noise. Phrases like "no issues", "LGTM", "sorun yok" trigger skip.

### Retry & Rate Limit Handling
- Automatic retry on HTTP 429 (rate limit) and 5xx errors
- Exponential backoff: 1s → 2s → 4s
- 60 second timeout per LLM request
- Max 3 retries per request

## Environment Variables

- `GITHUB_TOKEN` - Required for GitHub API access. Use `${{ github.token }}` (recommended)

## Development

```bash
# Install dependencies
npm install

# Build the action (creates dist/index.js)
npm run build
```

## Versioning

```yaml
# Recommended: use a specific version
uses: cumartesiolsun/ai-pr-review-action@v0.3.0

# Or use major version for automatic minor/patch updates
uses: cumartesiolsun/ai-pr-review-action@v0
```

## License

MIT
