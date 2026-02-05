// ============================================================================
// Configuration Constants
// ============================================================================

const CHARS_PER_TOKEN_ESTIMATE = 4;
const MIN_REVIEW_LENGTH = 20;
const EMPTY_REVIEW_MAX_LENGTH = 100;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parses and clamps an integer value within specified bounds.
 * @param {string|null|undefined} val - The value to parse
 * @param {number} def - Default value if parsing fails
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {number} The clamped integer value
 */
function clampInt(val, def, min, max) {
  const n = Number.parseInt(val ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/**
 * Returns a promise that resolves after the specified delay.
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Estimates the number of tokens in a text string.
 * @param {string|null|undefined} text - The text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Splits a string into chunks of specified size.
 * @param {string|null|undefined} str - The string to split
 * @param {number} size - Maximum size of each chunk
 * @returns {string[]} Array of string chunks
 */
function chunkString(str, size) {
  if (!str || str.length <= size) return [str];
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

/**
 * Trims a diff patch to a maximum character length.
 * @param {string|null|undefined} patch - The diff patch to trim
 * @param {number} maxChars - Maximum allowed characters
 * @returns {string} Trimmed patch with truncation indicator if needed
 */
function trimDiff(patch, maxChars) {
  if (!patch) return "";
  if (patch.length <= maxChars) return patch;
  return patch.slice(0, maxChars) + "\n...[truncated]\n";
}

/**
 * Determines if a review response indicates no issues found.
 * @param {string|null|undefined} content - The review content to check
 * @returns {boolean} True if the review is empty or indicates no issues
 */
function isEmptyReview(content) {
  if (!content || content.trim().length < MIN_REVIEW_LENGTH) return true;
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
  return emptyPhrases.some(phrase => lower.includes(phrase) && content.trim().length < EMPTY_REVIEW_MAX_LENGTH);
}

/**
 * Finds the position of the first actual change in a diff patch.
 * @param {string|null|undefined} patch - The diff patch to analyze
 * @returns {number} Line position of the first hunk (1-indexed)
 */
function getFirstHunkPosition(patch) {
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

module.exports = {
  clampInt,
  sleep,
  estimateTokens,
  chunkString,
  trimDiff,
  isEmptyReview,
  getFirstHunkPosition,
  CHARS_PER_TOKEN_ESTIMATE,
  MIN_REVIEW_LENGTH,
  EMPTY_REVIEW_MAX_LENGTH
};
