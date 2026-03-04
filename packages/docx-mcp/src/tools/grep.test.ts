import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  assertFailure,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { grep } from './grep.js';

const FEATURE = 'grep tool';

describe(FEATURE, () => {
  registerCleanup();
  const test = testAllure.epic('Document Reading').withLabels({ feature: FEATURE });

  test('returns MISSING_PATTERN when patterns array is empty', async () => {
    const { mgr, sessionId } = await openSession(['Hello world']);
    const result = await grep(mgr, { session_id: sessionId, patterns: [] });
    assertFailure(result, 'MISSING_PATTERN');
  });

  test('returns MISSING_PATTERN when patterns is omitted', async () => {
    const { mgr, sessionId } = await openSession(['Hello world']);
    const result = await grep(mgr, { session_id: sessionId } as any);
    assertFailure(result, 'MISSING_PATTERN');
  });

  test('accepts singular "pattern" string as alias', async () => {
    const { mgr, sessionId } = await openSession(['The quick brown fox']);
    const result = await grep(mgr, {
      session_id: sessionId,
      pattern: 'quick',
    } as any);
    assertSuccess(result);
    expect(result.total_matches).toBe(1);
    expect((result.matches as any[])[0].match_text).toBe('quick');
  });

  test('matches with patterns array work normally', async () => {
    const { mgr, sessionId } = await openSession(['Alpha Beta Gamma', 'Delta Alpha']);
    const result = await grep(mgr, {
      session_id: sessionId,
      patterns: ['Alpha'],
    });
    assertSuccess(result);
    expect(result.total_matches).toBe(2);
    expect(result.paragraphs_with_matches).toBe(2);
  });

  test('patterns array takes precedence over singular pattern', async () => {
    const { mgr, sessionId } = await openSession(['Alpha Beta Gamma']);
    const result = await grep(mgr, {
      session_id: sessionId,
      patterns: ['Beta'],
      pattern: 'Alpha',
    } as any);
    assertSuccess(result);
    // patterns array wins — should match "Beta", not "Alpha"
    expect(result.total_matches).toBe(1);
    expect((result.matches as any[])[0].match_text).toBe('Beta');
  });
});
