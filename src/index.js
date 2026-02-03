const core = require("@actions/core");
const github = require("@actions/github");

// Configuration constants
const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const CHARS_PER_TOKEN_ESTIMATE = 4; // Rough estimate: ~4 chars per token

function clampInt(val, def, min, max) {
  const n = Number.parseInt(val ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function cut(str, max) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, max) + "\n...[truncated]\n";
}

function estimateTokens(text) {
  // Rough estimation: ~4 characters per token for English/code
  return Math.ceil((text?.length || 0) / CHARS_PER_TOKEN_ESTIMATE);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(status) {
  // Retry on rate limit (429), server errors (5xx), and network issues
  return status === 429 || (status >= 500 && status < 600);
}

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

function createTimeoutError(timeoutMs) {
  const err = new Error(`Request timed out after ${timeoutMs}ms`);
  err.status = 408;
  return err;
}

function calculateBackoff(attempt) {
  return RETRY_DELAY_MS * Math.pow(2, attempt - 1);
}

async function executeRequest(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    const text = await res.text();
    const json = parseResponse(text);
    return { res, text, json };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function handleRetry(message, attempt, maxRetries, delayMs = null) {
  if (delayMs) {
    core.warning(`${message}, retrying in ${delayMs}ms... (attempt ${attempt}/${maxRetries})`);
    await sleep(delayMs);
  } else {
    core.warning(`${message}, retrying... (attempt ${attempt}/${maxRetries})`);
  }
}

async function handleHttpError(err, res, attempt, maxRetries) {
  const shouldRetry = isRetryableError(res.status) && attempt < maxRetries;
  if (!shouldRetry) throw err;
  await handleRetry(`API error (${res.status})`, attempt, maxRetries, calculateBackoff(attempt));
  return err;
}

async function handleCatchError(err, attempt, maxRetries, timeoutMs) {
  const isTimeout = err.name === "AbortError";
  const canRetry = attempt < maxRetries;

  if (isTimeout) {
    const timeoutErr = createTimeoutError(timeoutMs);
    if (!canRetry) throw timeoutErr;
    await handleRetry("Request timeout", attempt, maxRetries);
    return timeoutErr;
  }

  const isNetworkError = !err.status;
  if (isNetworkError && canRetry) {
    await handleRetry(`Network error: ${err.message}`, attempt, maxRetries, calculateBackoff(attempt));
    return err;
  }

  throw err;
}

async function fetchJson(url, options, { timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = MAX_RETRIES } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { res, text, json } = await executeRequest(url, options, timeoutMs);
      if (res.ok) return json;

      const err = createHttpError(json, text, res.status);
      lastError = await handleHttpError(err, res, attempt, maxRetries);
    } catch (err) {
      lastError = await handleCatchError(err, attempt, maxRetries, timeoutMs);
    }
  }
  throw lastError;
}

async function createOrUpdateComment(octokit, repo, issue_number, body, commentMarker) {
  // Sticky comment: updates existing comment when action re-runs
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

function buildPrompt({ language, extra_instructions, filesSummary, diffText }) {
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

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");

  const baseUrlInput = core.getInput("base_url", { required: true }).trim().replace(/\/+$/, "");
  const apiKey = core.getInput("api_key", { required: true }).trim();
  const model = core.getInput("model", { required: true }).trim();
  const language = core.getInput("language") || "Turkish";
  const maxFiles = clampInt(core.getInput("max_files"), 25, 1, 200);
  const maxChars = clampInt(core.getInput("max_chars"), 120000, 10000, 500000);
  const failOnIssues = (core.getInput("fail_on_issues") || "false").toLowerCase() === "true";
  const extra = core.getInput("extra_instructions") || "";
  const commentMarker = core.getInput("comment_marker") || "AI_PR_REVIEW";

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

  // 1) PR files
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

  const sliced = files.slice(0, maxFiles);
  const filesSummary = sliced
    .map(f => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");

  // 2) Build diff
  // GitHub "patch" field may be empty for binary/large files. Only include available patches.
  const diffParts = [];
  for (const f of sliced) {
    if (!f.patch) continue;
    diffParts.push(`--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}\n`);
  }
  let diffText = diffParts.join("\n");
  diffText = cut(diffText, maxChars);

  // 3) Estimate tokens and warn if potentially exceeding limits
  const prompt = buildPrompt({ language, extra_instructions: extra, filesSummary, diffText });
  const estimatedInputTokens = estimateTokens(prompt);
  const TOKEN_WARNING_THRESHOLD = 25000; // Warn if input exceeds ~25k tokens

  if (estimatedInputTokens > TOKEN_WARNING_THRESHOLD) {
    core.warning(
      `Large prompt detected: ~${estimatedInputTokens} tokens estimated. ` +
      `This may exceed model context limits. Consider reducing max_files or max_chars.`
    );
  }
  core.info(`Estimated input tokens: ~${estimatedInputTokens}`);

  // 4) Call OpenAI-compatible chat/completions
  const url = `${baseUrlInput}/chat/completions`;

  // Use response_format=text for LM Studio compatibility.
  // Cloud endpoints also accept this format.
  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: "You are a careful, strict code reviewer." },
      { role: "user", content: prompt }
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

  const content =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.text ??
    "";

  if (!content) throw new Error("Model returned empty response");

  // 5) Post comment
  const header = [
    `## 🤖 AI PR Review`,
    `- Model: \`${model}\``,
    `- Endpoint: \`${baseUrlInput}\``,
    ``,
  ].join("\n");

  await createOrUpdateComment(octokit, repo, pr.number, header + content, commentMarker);

  // 6) Optional fail on critical issues (simple heuristic)
  if (failOnIssues) {
    const lowered = content.toLowerCase();
    const hasCritical = ["kritik", "critical", "security", "rce", "sql injection", "auth bypass"].some(k => lowered.includes(k));
    if (hasCritical) {
      core.setFailed("Critical issues detected by AI review (fail_on_issues=true).");
    }
  }

  core.info("AI review posted successfully.");
}

main().catch(err => {
  core.setFailed(`${err.message}${err.status ? ` (HTTP ${err.status})` : ""}`);
});