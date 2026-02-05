// ============================================================================
// Prompt Builders
// ============================================================================

const SYSTEM_PROMPT = "You are a senior software engineer doing a careful, strict code review.";

/**
 * Builds a summary prompt for reviewing an entire PR.
 * @param {object} params - Prompt parameters
 * @param {string} params.language - Review language
 * @param {string} [params.extra_instructions] - Additional instructions
 * @param {string} params.filesSummary - Summary of files in PR
 * @param {string} params.diffText - Combined diff text
 * @returns {string} Complete prompt text
 */
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

/**
 * Builds a prompt for reviewing a single file's diff.
 * @param {object} params - Prompt parameters
 * @param {string} params.language - Review language
 * @param {string} [params.extra_instructions] - Additional instructions
 * @param {string} params.filename - Name of the file being reviewed
 * @param {string} params.diffChunk - Diff chunk to review
 * @param {string|null} [params.chunkInfo] - Chunk position info (e.g., "part 1/3")
 * @returns {string} Complete prompt text
 */
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

module.exports = {
  SYSTEM_PROMPT,
  buildSummaryPrompt,
  buildFilePrompt
};
