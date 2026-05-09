import { describe, expect, beforeEach, afterEach } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { resolveCliAiAuthor } from './tool_runner.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'CLI Tracked Author' });

describe('resolveCliAiAuthor', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.SAFE_DOCX_AI_AUTHOR;
    delete process.env.SAFE_DOCX_AI_AUTHOR;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.SAFE_DOCX_AI_AUTHOR;
    } else {
      process.env.SAFE_DOCX_AI_AUTHOR = savedEnv;
    }
  });

  test('defaults to "SafeDocX" when env var is unset', () => {
    expect(resolveCliAiAuthor()).toBe('SafeDocX');
  });

  test('uses configured value when env var is set', () => {
    process.env.SAFE_DOCX_AI_AUTHOR = 'Acme Reviewer';
    expect(resolveCliAiAuthor()).toBe('Acme Reviewer');
  });

  test('returns null (legacy untracked behavior) when env var is empty string', () => {
    // Empty string is the explicit opt-out: caller wants a SessionManager with
    // no default AI author, which makes primitives skip canonical write-time
    // tracked-change emission. Symmetric with server.ts handling.
    process.env.SAFE_DOCX_AI_AUTHOR = '';
    expect(resolveCliAiAuthor()).toBeNull();
  });
});
