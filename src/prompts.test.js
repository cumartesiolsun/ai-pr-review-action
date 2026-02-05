const {
  SYSTEM_PROMPT,
  buildSummaryPrompt,
  buildFilePrompt
} = require('./prompts');

describe('SYSTEM_PROMPT', () => {
  test('is defined and non-empty', () => {
    expect(SYSTEM_PROMPT).toBeDefined();
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test('contains code review context', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('code review');
  });
});

describe('buildSummaryPrompt', () => {
  const baseParams = {
    language: 'English',
    filesSummary: '- file1.js (+10/-5)\n- file2.js (+3/-1)',
    diffText: '+added line\n-removed line'
  };

  test('includes language instruction', () => {
    const result = buildSummaryPrompt(baseParams);
    expect(result).toContain('Reply in English');
  });

  test('includes files summary', () => {
    const result = buildSummaryPrompt(baseParams);
    expect(result).toContain('file1.js (+10/-5)');
    expect(result).toContain('file2.js (+3/-1)');
  });

  test('includes diff text', () => {
    const result = buildSummaryPrompt(baseParams);
    expect(result).toContain('+added line');
    expect(result).toContain('-removed line');
  });

  test('includes extra instructions when provided', () => {
    const result = buildSummaryPrompt({
      ...baseParams,
      extra_instructions: 'Focus on security vulnerabilities'
    });
    expect(result).toContain('Extra instructions: Focus on security vulnerabilities');
  });

  test('excludes extra instructions when not provided', () => {
    const result = buildSummaryPrompt(baseParams);
    expect(result).not.toContain('Extra instructions');
  });

  test('includes review focus areas', () => {
    const result = buildSummaryPrompt(baseParams);
    expect(result).toContain('bugs');
    expect(result).toContain('security');
    expect(result).toContain('performance');
  });

  test('works with different languages', () => {
    const turkishResult = buildSummaryPrompt({ ...baseParams, language: 'Turkish' });
    expect(turkishResult).toContain('Reply in Turkish');

    const spanishResult = buildSummaryPrompt({ ...baseParams, language: 'Spanish' });
    expect(spanishResult).toContain('Reply in Spanish');
  });
});

describe('buildFilePrompt', () => {
  const baseParams = {
    language: 'English',
    filename: 'src/utils.js',
    diffChunk: '+const foo = 1;\n-const bar = 2;'
  };

  test('includes filename', () => {
    const result = buildFilePrompt(baseParams);
    expect(result).toContain('File: src/utils.js');
  });

  test('includes language instruction', () => {
    const result = buildFilePrompt(baseParams);
    expect(result).toContain('Reply in English');
  });

  test('includes diff chunk', () => {
    const result = buildFilePrompt(baseParams);
    expect(result).toContain('+const foo = 1;');
    expect(result).toContain('-const bar = 2;');
  });

  test('includes chunk info when provided', () => {
    const result = buildFilePrompt({
      ...baseParams,
      chunkInfo: 'part 2/3'
    });
    expect(result).toContain('(This is part 2/3)');
  });

  test('excludes chunk info when not provided', () => {
    const result = buildFilePrompt(baseParams);
    expect(result).not.toContain('(This is');
  });

  test('includes extra instructions when provided', () => {
    const result = buildFilePrompt({
      ...baseParams,
      extra_instructions: 'Check for SQL injection'
    });
    expect(result).toContain('Extra instructions: Check for SQL injection');
  });

  test('excludes extra instructions when not provided', () => {
    const result = buildFilePrompt(baseParams);
    expect(result).not.toContain('Extra instructions');
  });

  test('includes review focus areas', () => {
    const result = buildFilePrompt(baseParams);
    expect(result).toContain('Bugs');
    expect(result).toContain('Security issues');
    expect(result).toContain('Performance problems');
    expect(result).toContain('Missing edge cases');
  });

  test('instructs not to repeat diff', () => {
    const result = buildFilePrompt(baseParams);
    expect(result).toContain('Do NOT repeat the diff');
  });

  test('handles null chunkInfo', () => {
    const result = buildFilePrompt({
      ...baseParams,
      chunkInfo: null
    });
    expect(result).not.toContain('(This is');
  });

  test('handles empty extra_instructions', () => {
    const result = buildFilePrompt({
      ...baseParams,
      extra_instructions: ''
    });
    expect(result).not.toContain('Extra instructions');
  });
});
