import { afterEach, beforeEach, describe, expect } from 'vitest';
import {
  itAllure as it,
  type AllureBddContext,
  type AllureRuntime,
  type AllureStepContext,
} from './allure-test.js';

type CapturedAttachment = {
  name: string;
  content: string | Uint8Array;
  contentType?: string;
};

const test = it.epic('Document Editing').withLabels({ feature: 'Allure Preview Rendering' });

describe('allure preview rendering', () => {
  let attachments: CapturedAttachment[] = [];

  const setAllureRuntime = (runtime?: AllureRuntime) => {
    (globalThis as typeof globalThis & { allure?: AllureRuntime }).allure = runtime;
  };

  beforeEach(() => {
    attachments = [];
    setAllureRuntime({
      epic: async () => {},
      feature: async () => {},
      parentSuite: async () => {},
      suite: async () => {},
      severity: async () => {},
      story: async () => {},
      step: async (_name, body) => body({ parameter: async () => {} } as AllureStepContext),
      attachment: async (name, content, contentType) => {
        attachments.push({ name, content, contentType });
      },
    });
  });

  afterEach(() => {
    setAllureRuntime(undefined);
  });

  test(
    'Scenario: Word-like preview preserves multi-paragraph base text',
    async ({ attachWordLikePreview }: AllureBddContext) => {
      await attachWordLikePreview('word-like-preview', {
        baseText: 'Hi world\nSecond paragraph',
      });

      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.contentType).toBe('text/html');

      const html = String(attachments[0]?.content ?? '');
      expect(html).toContain('Hi world');
      expect(html).toContain('Second paragraph');
      expect(html).toContain('white-space:pre-line;');
      expect(html).toMatch(/Hi world[\s\S]*Second paragraph/);
    },
  );
});
