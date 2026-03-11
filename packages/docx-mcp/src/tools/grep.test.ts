import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
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

  test('returns MISSING_PATTERN when patterns array is empty', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof grep>>;

    await given('a session with a simple document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('grep is called with an empty patterns array', async () => {
      result = await grep(opened.mgr, { session_id: opened.sessionId, patterns: [] });
    });

    await then('the result fails with MISSING_PATTERN', () => {
      assertFailure(result, 'MISSING_PATTERN');
    });
  });

  test('returns MISSING_PATTERN when patterns is omitted', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof grep>>;

    await given('a session with a simple document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('grep is called with patterns omitted entirely', async () => {
      result = await grep(opened.mgr, { session_id: opened.sessionId } as any);
    });

    await then('the result fails with MISSING_PATTERN', () => {
      assertFailure(result, 'MISSING_PATTERN');
    });
  });

  test('accepts singular "pattern" string as alias', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof grep>>;

    await given('a session with "The quick brown fox" open', async () => {
      opened = await openSession(['The quick brown fox']);
    });

    await when('grep is called with a singular "pattern" string key', async () => {
      result = await grep(opened.mgr, {
        session_id: opened.sessionId,
        pattern: 'quick',
      } as any);
    });

    await then('one match is returned for the "quick" token', () => {
      assertSuccess(result);
      expect(result.total_matches).toBe(1);
      expect((result.matches as any[])[0].match_text).toBe('quick');
    });
  });

  test('matches with patterns array work normally', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof grep>>;

    await given('a session with two paragraphs each containing "Alpha" open', async () => {
      opened = await openSession(['Alpha Beta Gamma', 'Delta Alpha']);
    });

    await when('grep is called with patterns: ["Alpha"]', async () => {
      result = await grep(opened.mgr, { session_id: opened.sessionId, patterns: ['Alpha'] });
    });

    await then('two total matches across two paragraphs are returned', () => {
      assertSuccess(result);
      expect(result.total_matches).toBe(2);
      expect(result.paragraphs_with_matches).toBe(2);
    });
  });

  test('patterns array takes precedence over singular pattern', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof grep>>;

    await given('a session with "Alpha Beta Gamma" open', async () => {
      opened = await openSession(['Alpha Beta Gamma']);
    });

    await when('grep is called with both patterns:["Beta"] and pattern:"Alpha"', async () => {
      result = await grep(opened.mgr, {
        session_id: opened.sessionId,
        patterns: ['Beta'],
        pattern: 'Alpha',
      } as any);
    });

    await then('patterns array wins and only "Beta" is matched', () => {
      assertSuccess(result);
      expect(result.total_matches).toBe(1);
      expect((result.matches as any[])[0].match_text).toBe('Beta');
    });
  });
});
