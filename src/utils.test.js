const {
  clampInt,
  estimateTokens,
  chunkString,
  trimDiff,
  isEmptyReview,
  getFirstHunkPosition
} = require('./utils');

describe('clampInt', () => {
  test('returns default for null/undefined', () => {
    expect(clampInt(null, 10, 0, 100)).toBe(10);
    expect(clampInt(undefined, 10, 0, 100)).toBe(10);
    expect(clampInt('', 10, 0, 100)).toBe(10);
  });

  test('returns default for non-numeric strings', () => {
    expect(clampInt('abc', 10, 0, 100)).toBe(10);
    expect(clampInt('hello', 25, 1, 50)).toBe(25);
  });

  test('parses valid integers', () => {
    expect(clampInt('50', 10, 0, 100)).toBe(50);
    expect(clampInt('25', 10, 0, 100)).toBe(25);
  });

  test('clamps to minimum', () => {
    expect(clampInt('-10', 10, 0, 100)).toBe(0);
    expect(clampInt('5', 10, 10, 100)).toBe(10);
  });

  test('clamps to maximum', () => {
    expect(clampInt('150', 10, 0, 100)).toBe(100);
    expect(clampInt('500', 10, 0, 50)).toBe(50);
  });
});

describe('estimateTokens', () => {
  test('returns 0 for null/undefined/empty', () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens('')).toBe(0);
  });

  test('estimates tokens based on character count', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('chunkString', () => {
  test('returns array with original string if smaller than chunk size', () => {
    expect(chunkString('hello', 10)).toEqual(['hello']);
    expect(chunkString('test', 100)).toEqual(['test']);
  });

  test('returns array with null/undefined as-is', () => {
    expect(chunkString(null, 10)).toEqual([null]);
    expect(chunkString(undefined, 10)).toEqual([undefined]);
  });

  test('splits string into chunks', () => {
    expect(chunkString('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
    expect(chunkString('123456', 2)).toEqual(['12', '34', '56']);
  });

  test('handles exact chunk size divisions', () => {
    expect(chunkString('abcdef', 3)).toEqual(['abc', 'def']);
    expect(chunkString('1234', 2)).toEqual(['12', '34']);
  });
});

describe('trimDiff', () => {
  test('returns empty string for null/undefined', () => {
    expect(trimDiff(null, 100)).toBe('');
    expect(trimDiff(undefined, 100)).toBe('');
  });

  test('returns original if within limit', () => {
    expect(trimDiff('short diff', 100)).toBe('short diff');
    expect(trimDiff('a'.repeat(50), 50)).toBe('a'.repeat(50));
  });

  test('truncates and adds indicator', () => {
    const result = trimDiff('a'.repeat(100), 50);
    expect(result).toBe('a'.repeat(50) + '\n...[truncated]\n');
  });
});

describe('isEmptyReview', () => {
  test('returns true for null/undefined/empty', () => {
    expect(isEmptyReview(null)).toBe(true);
    expect(isEmptyReview(undefined)).toBe(true);
    expect(isEmptyReview('')).toBe(true);
  });

  test('returns true for very short content', () => {
    expect(isEmptyReview('ok')).toBe(true);
    expect(isEmptyReview('good')).toBe(true);
  });

  test('returns true for "no issues" phrases (short content)', () => {
    expect(isEmptyReview('No issues found here.')).toBe(true);
    expect(isEmptyReview('Looks good to me!')).toBe(true);
    expect(isEmptyReview('LGTM')).toBe(true);
    expect(isEmptyReview('Sorun yok')).toBe(true);
    expect(isEmptyReview('İyi görünüyor')).toBe(true);
  });

  test('returns false for substantial review content', () => {
    const longReview = 'This code has a potential null pointer exception on line 42. ' +
      'Consider adding a null check before accessing the property. ' +
      'Also, the variable naming could be improved for clarity.';
    expect(isEmptyReview(longReview)).toBe(false);
  });

  test('returns false for content with issues even if contains "looks good"', () => {
    const mixedReview = 'The overall structure looks good but there are some issues: ' +
      '1. Missing error handling on line 15 ' +
      '2. Potential memory leak in the event listener ' +
      '3. Type mismatch between expected and actual values';
    expect(isEmptyReview(mixedReview)).toBe(false);
  });
});

describe('getFirstHunkPosition', () => {
  test('returns 1 for null/undefined', () => {
    expect(getFirstHunkPosition(null)).toBe(1);
    expect(getFirstHunkPosition(undefined)).toBe(1);
  });

  test('returns 1 for empty patch', () => {
    expect(getFirstHunkPosition('')).toBe(1);
  });

  test('finds first actual change line', () => {
    const patch = `--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 unchanged line
+added line
 another unchanged`;
    expect(getFirstHunkPosition(patch)).toBe(5);
  });

  test('skips --- and +++ lines', () => {
    const patch = `--- a/test.js
+++ b/test.js
-removed line`;
    expect(getFirstHunkPosition(patch)).toBe(3);
  });

  test('returns 1 if no changes found', () => {
    const patch = `@@ -1,3 +1,3 @@
 line 1
 line 2
 line 3`;
    expect(getFirstHunkPosition(patch)).toBe(1);
  });
});
