// ============================================================================
// HTTP Client with Retry
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Returns a promise that resolves after the specified delay.
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely parses a JSON string.
 * @param {string} text - The JSON string to parse
 * @returns {object|null} Parsed object or null if parsing fails
 */
function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Creates an HTTP error with status and body information.
 * @param {object|null} json - Parsed JSON response
 * @param {string} text - Raw response text
 * @param {number} status - HTTP status code
 * @returns {Error} Error object with status and body properties
 */
function createHttpError(json, text, status) {
  const msg = json?.error?.message || json?.error || text || `HTTP ${status}`;
  const err = new Error(msg);
  err.status = status;
  err.body = text;
  return err;
}

/**
 * Determines if an HTTP error should trigger a retry.
 * Retries: timeout (408), rate limit (429), server errors (5xx)
 * No retry: 400 (bad request) or other 4xx client errors
 * @param {number} status - HTTP status code
 * @returns {boolean} True if the error is retryable
 */
function isRetryableError(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Calculates exponential backoff delay for retry attempts.
 * @param {number} attempt - Current attempt number (1-indexed)
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt, baseDelay = RETRY_DELAY_MS) {
  return baseDelay * Math.pow(2, attempt - 1);
}

/**
 * Fetches JSON from a URL with timeout and retry support.
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options (method, headers, body)
 * @param {object} config - Configuration object
 * @param {number} config.timeoutMs - Request timeout in milliseconds
 * @param {number} [config.maxRetries=3] - Maximum retry attempts
 * @param {Function} [config.onRetry] - Callback for retry events
 * @returns {Promise<object>} Parsed JSON response
 * @throws {Error} If all retries fail
 */
async function fetchJson(url, options, { timeoutMs, maxRetries = MAX_RETRIES, onRetry } = {}) {
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

      // Don't retry 4xx errors except 408 and 429
      if (!isRetryableError(res.status)) throw err;
      if (attempt >= maxRetries) throw err;

      const delay = calculateBackoff(attempt);
      if (onRetry) onRetry({ status: res.status, attempt, delay });
      await sleep(delay);
      lastError = err;

    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === "AbortError") {
        const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
        timeoutErr.status = 408;
        if (attempt >= maxRetries) throw timeoutErr;
        if (onRetry) onRetry({ status: 408, attempt, delay: 0, timeout: true });
        lastError = timeoutErr;
        continue;
      }

      // Network errors (no status) are retryable
      if (!err.status && attempt < maxRetries) {
        const delay = calculateBackoff(attempt);
        if (onRetry) onRetry({ status: 0, attempt, delay, network: true });
        await sleep(delay);
        lastError = err;
        continue;
      }

      throw err;
    }
  }
  throw lastError;
}

module.exports = {
  sleep,
  parseResponse,
  createHttpError,
  isRetryableError,
  calculateBackoff,
  fetchJson,
  MAX_RETRIES,
  RETRY_DELAY_MS
};
