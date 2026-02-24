import { afterEach, beforeEach, describe, expect } from 'vitest';
import {
  itAllure,
  type AllureBddContext,
  type AllureRuntime,
  type AllureStepContext,
} from './allure-test.js';
import { readFileSync } from 'node:fs';

type CapturedAttachment = {
  name: string;
  content: string | Uint8Array;
  contentType?: string;
};

const TEST_FEATURE = 'add-attach-pretty-json-helper';
const test = itAllure.epic('Test Infrastructure').withLabels({ feature: TEST_FEATURE });

describe('OpenSpec traceability: add-attach-pretty-json-helper', () => {
  let attachments: CapturedAttachment[] = [];
  let stepNames: string[] = [];
  let savedRuntime: AllureRuntime | undefined;

  const getAllure = () =>
    (globalThis as typeof globalThis & { allure?: AllureRuntime }).allure;
  const setAllureRuntime = (runtime?: AllureRuntime) => {
    (globalThis as typeof globalThis & { allure?: AllureRuntime }).allure = runtime;
  };

  const noop = async () => {};

  beforeEach(() => {
    attachments = [];
    stepNames = [];
    savedRuntime = getAllure();

    setAllureRuntime({
      epic: noop,
      feature: noop,
      parentSuite: noop,
      suite: noop,
      subSuite: noop,
      severity: noop,
      story: noop,
      id: noop,
      allureId: noop,
      displayName: noop,
      label: async () => {},
      description: noop,
      tags: async () => {},
      tag: noop,
      parameter: async () => {},
      attachment: async (name, content, contentType) => {
        attachments.push({ name, content, contentType });
      },
      step: async (name, body) => {
        stepNames.push(name);
        return body({ parameter: async () => {} } as AllureStepContext);
      },
    });
  });

  afterEach(() => {
    setAllureRuntime(savedRuntime);
    savedRuntime = undefined;
  });

  test
    .openspec('attachPrettyJson renders formatted JSON inline')
    ('Scenario: attachPrettyJson renders formatted JSON inline', async ({ attachPrettyJson }: AllureBddContext) => {
      await attachPrettyJson('Pretty JSON attachment', {
        patch_id: 'patch-001',
        diagnostics: { ok: true },
      });

      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.contentType).toBe('text/html');
      const html = String(attachments[0]?.content ?? '');
      expect(html).toContain('allure-auto-size-root');
      expect(html).toContain('json-source');
      expect(html).toContain('patch-001');
    });

  test
    .openspec('debug JSON final-step label remains neutral')
    ('Scenario: debug JSON final-step label remains neutral', async ({ attachJsonLastStep }: AllureBddContext) => {
      await attachJsonLastStep({
        context: { action: 'validate' },
        result: { ok: true },
        attachAsStep: true,
      });

      expect(stepNames).toContain('Attach debug JSON (context + result)');
      expect(stepNames.every((name) => !name.startsWith('AND:'))).toBe(true);
      expect(attachments).toHaveLength(2);
    });

  test
    .openspec('short HTML attachment auto-fits without vertical scrollbar')
    ('Scenario: short HTML attachment auto-fits without vertical scrollbar', async () => {
      const runtimeTemplate = readFileSync(
        new URL('../../../../scripts/branding/runtime.template.js', import.meta.url),
        'utf-8',
      );
      const themeCss = readFileSync(
        new URL('../../../../scripts/branding/theme.template.css', import.meta.url),
        'utf-8',
      );

      expect(runtimeTemplate).toContain("overflowNeeded ? 'auto' : 'hidden'");
      expect(runtimeTemplate).toContain('contentTarget = Math.max(min, contentHeight + 8)');
      expect(themeCss).toContain('max-height: 72vh');
      expect(themeCss).toContain('overflow-y: hidden');
    });

  test
    .openspec('tall HTML attachment uses single vertical scrollbar')
    ('Scenario: tall HTML attachment uses single vertical scrollbar', async () => {
      const runtimeTemplate = readFileSync(
        new URL('../../../../scripts/branding/runtime.template.js', import.meta.url),
        'utf-8',
      );

      expect(runtimeTemplate).toContain("preview.style.setProperty('overflow-y', overflowNeeded ? 'auto' : 'hidden', 'important')");
      expect(runtimeTemplate).toContain("preview.style.setProperty('overflow-x', 'hidden', 'important')");
      expect(runtimeTemplate).toContain("frame.setAttribute('scrolling', 'no')");
    });
});
