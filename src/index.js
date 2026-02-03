const core = require("@actions/core");
const github = require("@actions/github");

// Configuration constants
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds for LLM calls
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const CHUNK_SIZE = 12000; // ~12k chars per chunk
const CHARS_PER_TOKEN_ESTIMATE = 4;

// ============================================================================
// Utility Functions
// ============================================================================

function clampInt(val, def, min, max) {
  const n = Number.parseInt(val ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / CHARS_PER_TOKEN_ESTIMATE);
}

function chunkString(str, size = CHUNK_SIZE) {
  if (!str || str.length <= size) return [str];
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

function isEmptyReview(content) {
  if (!content || content.trim().length < 20) return true;
  const lower = content.toLowerCase();
  const emptyPhrases = [
    "no issues",
    "looks good",
    "lgtm",
    "no problems",
    "no concerns",
    "sorun yok",
    "problem yok",
    "iyi görünüyor",
    "nothing to report",
    "no suggestions"
  ];
  return emptyPhrases.some(phrase => lower.includes(phrase) && content.trim().length < 100);
}

function getFirstHunkPosition(patch) {
  // Get position of first actual change line in the diff
  // Position is 1-indexed from the start of the diff
  if (!patch) return 1;
  const lines = patch.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("+") || lines[i].startsWith("-")) {
      if (!lines[i].startsWith("+++") && !lines[i].startsWith("---")) {
        return i + 1;
      }
    }
  }
  return 1;
}

// ============================================================================
// HTTP Client with Retry
// ============================================================================

function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createHttpError(json, text, status) {
  const msg = json?.error?.message || json?.error || text || `HTTP ${status}`;
  const err = new Error(msg);
  err.status = status;
  err.body = text;
  return err;
}

function isRetryableError(status) {
  return status === 429 || (status >= 500 && status < 600);
}

function calculateBackoff(attempt) {
  return RETRY_DELAY_MS * Math.pow(2, attempt - 1);
}

async function fetchJson(url, options, { timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = MAX_RETRIES } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      const text = await res.text();
      const json = parseResponse(text);

      if (res.ok) return json;

      const err = createHttpError(json, text, res.status);
      if (!isRetryableError(res.status) || attempt >= maxRetries) throw err;

      const delay = calculateBackoff(attempt);
      core.warning(`API error (${res.status}), retrying in ${delay}ms... (${attempt}/${maxRetries})`);
      await sleep(delay);
      lastError = err;

    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === "AbortError") {
        const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
        timeoutErr.status = 408;
        if (attempt >= maxRetries) throw timeoutErr;
        core.warning(`Timeout, retrying... (${attempt}/${maxRetries})`);
        lastError = timeoutErr;
        continue;
      }

      if (!err.status && attempt < maxRetries) {
        const delay = calculateBackoff(attempt);
        core.warning(`Network error: ${err.message}, retrying in ${delay}ms... (${attempt}/${maxRetries})`);
        await sleep(delay);
        lastError = err;
        continue;
      }

      throw err;
    }
  }
  throw lastError;
}

// ============================================================================
// LLM Integration
// ============================================================================

async function callLLM(baseUrl, apiKey, model, systemPrompt, userPrompt) {
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "text" }
  };

  const json = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  return json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? "";
}

// ============================================================================
// Prompt Builders
// ============================================================================

function buildSummaryPrompt({ language, extra_instructions, filesSummary, diffText }) {
  return [
    `You are a senior software engineer doing a pull request code review.`,
    `Reply in ${language}.`,
    `Be concise but specific. Prefer bullet points.`,
    `Focus on: bugs, security, correctness, performance, DX, and test gaps.`,
    `If you suggest changes, show small code snippets or exact lines (file:line if possible).`,
    extra_instructions ? `Extra instructions: ${extra_instructions}` : ``,
    ``,
    `Files in PR (with additions/deletions):`,
    filesSummary,
    ``,
    `Unified diff (may be truncated):`,
    diffText
  ].filter(Boolean).join("\n");
}

function buildFilePrompt({ language, extra_instructions, filename, diffChunk, chunkInfo }) {
  const chunkNote = chunkInfo ? `\n(This is ${chunkInfo})` : "";
  return [
    `Review the following file diff.${chunkNote}`,
    ``,
    `File: ${filename}`,
    ``,
    `Focus on:`,
    `- Bugs`,
    `- Security issues`,
    `- Incorrect logic`,
    `- Performance problems`,
    `- Missing edge cases`,
    `- Concrete improvement suggestions`,
    ``,
    `If possible, suggest small code snippets or exact fixes.`,
    `Reply in ${language}.`,
    `Be concise. Prefer bullet points.`,
    `Do NOT repeat the diff.`,
    extra_instructions ? `\nExtra instructions: ${extra_instructions}` : ``,
    ``,
    `Diff:`,
    diffChunk
  ].filter(Boolean).join("\n");
}

const SYSTEM_PROMPT = "You are a senior software engineer doing a careful, strict code review.";

// ============================================================================
// Review Functions
// ============================================================================

async function reviewFile(baseUrl, apiKey, model, language, extra, file) {
  const chunks = chunkString(file.patch, CHUNK_SIZE);
  const responses = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkInfo = chunks.length > 1 ? `part ${i + 1}/${chunks.length}` : null;
    const prompt = buildFilePrompt({
      language,
      extra_instructions: extra,
      filename: file.filename,
      diffChunk: chunks[i],
      chunkInfo
    });

    core.info(`  Reviewing ${file.filename}${chunkInfo ? ` (${chunkInfo})` : ""}...`);

    const response = await callLLM(baseUrl, apiKey, model, SYSTEM_PROMPT, prompt);
    if (response && !isEmptyReview(response)) {
      responses.push(response);
    }
  }

  if (responses.length === 0) return null;
  if (responses.length === 1) return responses[0];

  // Combine multiple chunk responses
  return responses.map((r, i) => `**Part ${i + 1}:**\n${r}`).join("\n\n");
}

async function postInlineReview(octokit, repo, prNumber, file, reviewBody, model) {
  const position = getFirstHunkPosition(file.patch);

  try {
    await octokit.rest.pulls.createReview({
      ...repo,
      pull_number: prNumber,
      event: "COMMENT",
      comments: [
        {
          path: file.filename,
          position,
          body: `🤖 **AI Review** (${model})\n\n${reviewBody}`
        }
      ]
    });
    core.info(`  Posted inline review for ${file.filename}`);
  } catch (err) {
    // Fallback: if inline comment fails, log warning but don't fail
    core.warning(`Failed to post inline comment for ${file.filename}: ${err.message}`);
    return false;
  }
  return true;
}

async function createOrUpdateComment(octokit, repo, issue_number, body, commentMarker) {
  const marker = `<!-- ${commentMarker} -->`;
  const finalBody = `${marker}\n${body}`;

  const comments = await octokit.rest.issues.listComments({
    ...repo,
    issue_number,
    per_page: 100
  });

  const existing = comments.data.find(c => (c.body || "").includes(marker));
  if (existing) {
    await octokit.rest.issues.updateComment({
      ...repo,
      comment_id: existing.id,
      body: finalBody
    });
  } else {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number,
      body: finalBody
    });
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");

  // Read inputs
  const baseUrlInput = core.getInput("base_url", { required: true }).trim().replace(/\/+$/, "");
  const apiKey = core.getInput("api_key", { required: true }).trim();
  const model = core.getInput("model", { required: true }).trim();
  const language = core.getInput("language") || "Turkish";
  const maxFiles = clampInt(core.getInput("max_files"), 25, 1, 200);
  const maxChars = clampInt(core.getInput("max_chars"), 120000, 10000, 500000);
  const failOnIssues = (core.getInput("fail_on_issues") || "false").toLowerCase() === "true";
  const extra = core.getInput("extra_instructions") || "";
  const commentMarker = core.getInput("comment_marker") || "AI_PR_REVIEW_ACTION";
  const reviewMode = core.getInput("review_mode") || "summary"; // "summary" or "inline"

  const ctx = github.context;
  if (!ctx.payload.pull_request) {
    core.info("Not a pull_request event; skipping.");
    return;
  }

  const pr = ctx.payload.pull_request;
  const owner = ctx.repo.owner;
  const repoName = ctx.repo.repo;
  const repo = { owner, repo: repoName };
  const octokit = github.getOctokit(token);

  core.info(`Starting AI PR Review for PR #${pr.number}`);
  core.info(`Mode: ${reviewMode}, Model: ${model}`);

  // 1) Fetch PR files
  const files = [];
  let page = 1;
  while (true) {
    const resp = await octokit.rest.pulls.listFiles({
      ...repo,
      pull_number: pr.number,
      per_page: 100,
      page
    });
    files.push(...resp.data);
    if (resp.data.length < 100) break;
    page++;
  }

  // Filter files with patches (skip binary/large files)
  const reviewableFiles = files
    .slice(0, maxFiles)
    .filter(f => f.patch && f.patch.length > 0);

  core.info(`Found ${files.length} files, reviewing ${reviewableFiles.length} with patches`);

  if (reviewableFiles.length === 0) {
    core.info("No reviewable files found (all binary or too large). Skipping.");
    return;
  }

  // 2) Execute review based on mode
  if (reviewMode === "inline") {
    // Inline mode: review each file separately and post inline comments
    let successCount = 0;
    let skipCount = 0;

    for (const file of reviewableFiles) {
      try {
        const reviewBody = await reviewFile(baseUrlInput, apiKey, model, language, extra, file);

        if (reviewBody) {
          const posted = await postInlineReview(octokit, repo, pr.number, file, reviewBody, model);
          if (posted) successCount++;
        } else {
          skipCount++;
          core.info(`  Skipped ${file.filename} (no issues found)`);
        }
      } catch (err) {
        core.warning(`Failed to review ${file.filename}: ${err.message}`);
      }
    }

    core.info(`Inline review complete: ${successCount} comments posted, ${skipCount} files skipped`);

  } else {
    // Summary mode: single PR comment with all files (original behavior)
    const filesSummary = reviewableFiles
      .map(f => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
      .join("\n");

    // Build combined diff
    const diffParts = [];
    let totalChars = 0;
    for (const f of reviewableFiles) {
      const fileDiff = `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}\n`;
      if (totalChars + fileDiff.length > maxChars) {
        diffParts.push(`...[${reviewableFiles.length - diffParts.length} more files truncated]\n`);
        break;
      }
      diffParts.push(fileDiff);
      totalChars += fileDiff.length;
    }
    const diffText = diffParts.join("\n");

    // Estimate tokens
    const prompt = buildSummaryPrompt({ language, extra_instructions: extra, filesSummary, diffText });
    const estimatedTokens = estimateTokens(prompt);
    core.info(`Estimated input tokens: ~${estimatedTokens}`);

    if (estimatedTokens > 25000) {
      core.warning(`Large prompt detected (~${estimatedTokens} tokens). Consider using inline mode or reducing max_files.`);
    }

    // Call LLM
    const content = await callLLM(baseUrlInput, apiKey, model, SYSTEM_PROMPT, prompt);

    if (!content) throw new Error("Model returned empty response");

    // Post summary comment
    const header = [
      `## 🤖 AI PR Review`,
      `- Model: \`${model}\``,
      `- Files reviewed: ${reviewableFiles.length}`,
      ``,
    ].join("\n");

    await createOrUpdateComment(octokit, repo, pr.number, header + content, commentMarker);
    core.info("Summary review posted successfully.");

    // Check for critical issues
    if (failOnIssues) {
      const lowered = content.toLowerCase();
      const criticalKeywords = ["kritik", "critical", "security", "rce", "sql injection", "auth bypass", "vulnerability"];
      if (criticalKeywords.some(k => lowered.includes(k))) {
        core.setFailed("Critical issues detected by AI review (fail_on_issues=true).");
      }
    }
  }

  core.info("AI PR Review completed.");
}

main().catch(err => {
  core.setFailed(`${err.message}${err.status ? ` (HTTP ${err.status})` : ""}`);
});
