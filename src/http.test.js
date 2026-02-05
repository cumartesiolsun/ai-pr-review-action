const {
  parseResponse,
  createHttpError,
  isRetryableError,
  calculateBackoff,
  MAX_RETRIES,
  RETRY_DELAY_MS
} = require('./http');

describe('parseResponse', () => {
  test('parses valid JSON', () => {
    expect(parseResponse('{"key": "value"}')).toEqual({ key: 'value' });
    expect(parseResponse('{"a": 1, "b": 2}')).toEqual({ a: 1, b: 2 });
    expect(parseResponse('[]')).toEqual([]);
    expect(parseResponse('null')).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    expect(parseResponse('not json')).toBeNull();
    expect(parseResponse('{invalid}')).toBeNull();
    expect(parseResponse('')).toBeNull();
    expect(parseResponse('undefined')).toBeNull();
  });

  test('handles nested objects', () => {
    const nested = '{"outer": {"inner": {"deep": "value"}}}';
    expect(parseResponse(nested)).toEqual({ outer: { inner: { deep: 'value' } } });
  });
});

describe('createHttpError', () => {
  test('uses json.error.message when available', () => {
    const json = { error: { message: 'Rate limit exceeded' } };
    const err = createHttpError(json, 'raw text', 429);
    expect(err.message).toBe('Rate limit exceeded');
    expect(err.status).toBe(429);
    expect(err.body).toBe('raw text');
  });

  test('uses json.error string when message not available', () => {
    const json = { error: 'Simple error string' };
    const err = createHttpError(json, 'raw text', 400);
    expect(err.message).toBe('Simple error string');
    expect(err.status).toBe(400);
  });

  test('falls back to raw text when json has no error', () => {
    const err = createHttpError({}, 'Raw error text', 500);
    expect(err.message).toBe('Raw error text');
    expect(err.status).toBe(500);
  });

  test('falls back to HTTP status when no other info', () => {
    const err = createHttpError(null, '', 404);
    expect(err.message).toBe('HTTP 404');
    expect(err.status).toBe(404);
  });

  test('attaches body to error', () => {
    const err = createHttpError(null, 'response body', 500);
    expect(err.body).toBe('response body');
  });
});

describe('isRetryableError', () => {
  test('returns true for timeout (408)', () => {
    expect(isRetryableError(408)).toBe(true);
  });

  test('returns true for rate limit (429)', () => {
    expect(isRetryableError(429)).toBe(true);
  });

  test('returns true for server errors (5xx)', () => {
    expect(isRetryableError(500)).toBe(true);
    expect(isRetryableError(502)).toBe(true);
    expect(isRetryableError(503)).toBe(true);
    expect(isRetryableError(504)).toBe(true);
    expect(isRetryableError(599)).toBe(true);
  });

  test('returns false for 400 bad request', () => {
    expect(isRetryableError(400)).toBe(false);
  });

  test('returns false for other 4xx client errors', () => {
    expect(isRetryableError(401)).toBe(false);
    expect(isRetryableError(403)).toBe(false);
    expect(isRetryableError(404)).toBe(false);
    expect(isRetryableError(422)).toBe(false);
  });

  test('returns false for success codes', () => {
    expect(isRetryableError(200)).toBe(false);
    expect(isRetryableError(201)).toBe(false);
    expect(isRetryableError(204)).toBe(false);
  });

  test('returns false for redirect codes', () => {
    expect(isRetryableError(301)).toBe(false);
    expect(isRetryableError(302)).toBe(false);
    expect(isRetryableError(304)).toBe(false);
  });
});

describe('calculateBackoff', () => {
  test('calculates exponential backoff correctly', () => {
    expect(calculateBackoff(1)).toBe(RETRY_DELAY_MS);
    expect(calculateBackoff(2)).toBe(RETRY_DELAY_MS * 2);
    expect(calculateBackoff(3)).toBe(RETRY_DELAY_MS * 4);
    expect(calculateBackoff(4)).toBe(RETRY_DELAY_MS * 8);
  });

  test('uses custom base delay', () => {
    expect(calculateBackoff(1, 500)).toBe(500);
    expect(calculateBackoff(2, 500)).toBe(1000);
    expect(calculateBackoff(3, 500)).toBe(2000);
  });

  test('handles first attempt correctly', () => {
    // First attempt should have no multiplier (2^0 = 1)
    expect(calculateBackoff(1, 1000)).toBe(1000);
  });
});

describe('constants', () => {
  test('MAX_RETRIES is defined and reasonable', () => {
    expect(MAX_RETRIES).toBeDefined();
    expect(MAX_RETRIES).toBeGreaterThanOrEqual(1);
    expect(MAX_RETRIES).toBeLessThanOrEqual(10);
  });

  test('RETRY_DELAY_MS is defined and reasonable', () => {
    expect(RETRY_DELAY_MS).toBeDefined();
    expect(RETRY_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(RETRY_DELAY_MS).toBeLessThanOrEqual(10000);
  });
});
