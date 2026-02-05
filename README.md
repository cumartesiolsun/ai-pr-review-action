# AI PR Review Action

A GitHub Action that automatically reviews pull requests using any OpenAI-compatible API (LM Studio, OpenAI, Ollama, etc.).

## Features

- **Two review modes**: Summary (single PR comment) or Inline (per-file comments)
- Works with any OpenAI-compatible endpoint (LM Studio, OpenAI, Azure OpenAI, Ollama, etc.)
- **Configurable chunking**: Handles large files by splitting diffs into chunks
- **Per-file diff trimming**: Prevents token overflow on large files
- **Smart filtering**: Skips "no issues" responses to avoid noise
- Configurable review language (default: Turkish)
- Sticky comments - updates existing review instead of creating duplicates
- Multi-job support with unique comment markers
- Built-in retry mechanism with exponential backoff (handles 429, 5xx errors)
- Configurable timeout, max tokens, and chunk sizes

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
        uses: cumartesiolsun/ai-pr-review-action@v0.4.1
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
  uses: cumartesiolsun/ai-pr-review-action@v0.4.1
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
  uses: cumartesiolsun/ai-pr-review-action@v0.4.1
  with:
    base_url: "http://localhost:1234/v1"
    api_key: "lm-studio"
    model: "qwen2.5-coder-32b-instruct"
    language: "Turkish"
    review_mode: "inline"
    timeout_ms: "180000"  # 3 minutes for local models
    max_tokens: "2048"
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
        uses: cumartesiolsun/ai-pr-review-action@v0.4.1
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
        uses: cumartesiolsun/ai-pr-review-action@v0.4.1
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
| `max_chars` | No | `120000` | Maximum total diff characters (10k-500k), used in summary mode |
| `timeout_ms` | No | `60000` | Request timeout in milliseconds (5k-600k) |
| `max_tokens` | No | `1024` | Max output tokens for LLM response (50-8000) |
| `chunk_size_chars` | No | `12000` | Chunk size for splitting large diffs (1k-50k) |
| `max_diff_chars_per_file` | No | `50000` | Max diff chars per file before trimming (1k-200k) |
| `fail_on_issues` | No | `false` | Fail workflow if critical issues found |
| `extra_instructions` | No | - | Additional reviewer instructions |
| `comment_marker` | No | `AI_PR_REVIEW_ACTION` | Unique marker for sticky comments (summary mode only) |

## How It Works

### Summary Mode
1. Fetches all PR files and builds a combined diff
2. Trims each file's diff to `max_diff_chars_per_file`
3. Sends entire diff to LLM in a single request
4. Posts one comprehensive review comment on the PR
5. Updates existing comment on re-runs (sticky comment)

### Inline Mode
1. Fetches all PR files with patches
2. For each file:
   - Trims diff to `max_diff_chars_per_file`
   - Chunks into `chunk_size_chars` pieces
   - Sends each chunk to LLM separately
   - Aggregates responses for multi-chunk files
   - Skips files with "no issues" responses
3. Posts inline review comments directly on files
4. Uses GitHub Pull Request Review API

## Advanced Features

### Configurable Chunking
Large files are automatically split into chunks (default 12k chars). Customize with `chunk_size_chars`:

```yaml
chunk_size_chars: "8000"  # Smaller chunks for models with limited context
```

### Per-File Diff Trimming
Each file's diff is trimmed before processing to prevent token overflow:

```yaml
max_diff_chars_per_file: "30000"  # Limit each file to 30k chars
```

### Timeout Configuration
Adjust timeout for slower models or networks:

```yaml
timeout_ms: "180000"  # 3 minutes for local models
```

### Smart Response Filtering
Empty or "looks good" responses are automatically filtered to reduce noise. Phrases like "no issues", "LGTM", "sorun yok" trigger skip.

### Retry & Rate Limit Handling
- Automatic retry on HTTP 429 (rate limit) and 5xx errors
- **No retry on 400 errors** (bad request - fix the request instead)
- Exponential backoff: 1s → 2s → 4s
- Max 3 retries per request

## Environment Variables

- `GITHUB_TOKEN` - Required for GitHub API access. Use `${{ github.token }}` (recommended)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build the action (creates dist/index.js)
npm run build
```

## Versioning

```yaml
# Recommended: use a specific version
uses: cumartesiolsun/ai-pr-review-action@v0.4.1

# Or use major version for automatic minor/patch updates
uses: cumartesiolsun/ai-pr-review-action@v0
```

## Changelog

### v0.4.1
- Modularized codebase: extracted utility functions to separate module
- Added comprehensive JSDoc documentation to all functions
- Extracted magic numbers to named constants for maintainability
- Added Jest testing framework with 24 unit tests
- Added `npm test` script for running tests

### v0.4.0
- Added `timeout_ms`, `max_tokens`, `chunk_size_chars`, `max_diff_chars_per_file` inputs
- Fixed `max_files` enforcement (now correctly limits reviewed files)
- 400 errors no longer trigger retries
- Per-file diff trimming applied before chunking

### v0.3.0
- Added inline review mode with per-file comments
- Added diff chunking for large files
- Added smart response filtering

### v0.2.0
- Added `comment_marker` for multi-job support
- Changed to `github.token` in examples

### v0.1.0
- Initial release with summary mode

## License

MIT
