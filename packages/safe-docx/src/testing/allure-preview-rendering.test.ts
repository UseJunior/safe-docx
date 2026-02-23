import { afterEach, beforeEach, describe, expect } from 'vitest';
import {
  itAllure as it,
  type AllureBddContext,
  type AllureRuntime,
  type AllureStepContext,
  type DocPreviewOptions,
} from './allure-test.js';

type CapturedAttachment = {
  name: string;
  content: string | Uint8Array;
  contentType?: string;
};

const test = it.epic('Document Editing').withLabels({ feature: 'Allure Preview Rendering' });

describe('allure preview rendering', () => {
  let attachments: CapturedAttachment[] = [];
  let savedRuntime: AllureRuntime | undefined;

  const getAllure = () =>
    (globalThis as typeof globalThis & { allure?: AllureRuntime }).allure;
  const setAllureRuntime = (runtime?: AllureRuntime) => {
    (globalThis as typeof globalThis & { allure?: AllureRuntime }).allure = runtime;
  };

  beforeEach(() => {
    attachments = [];
    savedRuntime = getAllure();
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
        // Forward to real Allure runtime so attachments appear in the report
        if (savedRuntime && typeof savedRuntime.attachment === 'function') {
          await savedRuntime.attachment(name, content, contentType);
        }
      },
    });
  });

  afterEach(() => {
    setAllureRuntime(savedRuntime);
    savedRuntime = undefined;
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

  // -----------------------------------------------------------------------
  // Doc preview helper tests
  // -----------------------------------------------------------------------

  function getHtml(): string {
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.contentType).toBe('text/html');
    return String(attachments[0]?.content ?? '');
  }

  async function renderDocPreview(
    ctx: AllureBddContext,
    options: DocPreviewOptions,
  ): Promise<string> {
    await ctx.attachDocPreview('doc-preview', options);
    return getHtml();
  }

  test(
    'Scenario: Doc preview renders plain text runs',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'Hello world' }],
      });

      expect(html).toContain('<p class="doc-line">Hello world</p>');
      expect(html).not.toContain('<span');
    },
  );

  test(
    'Scenario: Doc preview escapes HTML in text',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: '<script>alert("xss")</script>' }],
      });

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    },
  );

  test(
    'Scenario: Doc preview renders bold, italic, and underline',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'styled', bold: true, italic: true, underline: true }],
      });

      // Nesting order: <b><i><u>text</u></i></b>
      expect(html).toContain('<b><i><u>styled</u></i></b>');
    },
  );

  test(
    'Scenario: Doc preview renders superscript',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: '1', script: 'superscript' }],
      });

      expect(html).toContain('<sup>1</sup>');
      expect(html).not.toContain('<sub>');
    },
  );

  test(
    'Scenario: Doc preview renders subscript',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: '2', script: 'subscript' }],
      });

      expect(html).toContain('<sub>2</sub>');
      expect(html).not.toContain('<sup>');
    },
  );

  test(
    'Scenario: Doc preview renders position offset',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'raised', positionHpt: 12 }],
      });

      expect(html).toContain('style="position:relative;top:-6pt"');
      expect(html).toContain('>raised</span>');
    },
  );

  test(
    'Scenario: Doc preview renders insertion revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'added', revision: 'insertion' }],
      });

      expect(html).toContain('<span class="doc-ins">added</span>');
    },
  );

  test(
    'Scenario: Doc preview renders deletion revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'removed', revision: 'deletion' }],
      });

      expect(html).toContain('<span class="doc-del">removed</span>');
    },
  );

  test(
    'Scenario: Doc preview renders move-from revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'source', revision: 'move-from' }],
      });

      expect(html).toContain('<span class="doc-move-from">source</span>');
    },
  );

  test(
    'Scenario: Doc preview renders move-to revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'destination', revision: 'move-to' }],
      });

      expect(html).toContain('<span class="doc-move-to">destination</span>');
    },
  );

  test(
    'Scenario: Doc preview renders revision author as tooltip',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'tracked', revision: 'insertion', revisionAuthor: 'Jane Doe' }],
      });

      expect(html).toContain('title="Jane Doe"');
      expect(html).toContain('class="doc-ins"');
    },
  );

  test(
    'Scenario: Doc preview renders footnotes',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'Body text' }],
        footnotes: [
          { marker: '1', text: 'First footnote.' },
          { marker: '2', text: 'Second footnote.' },
        ],
      });

      expect(html).toContain('<hr class="doc-footnote-sep">');
      expect(html).toContain('<p class="doc-footnote"><sup>1</sup> First footnote.</p>');
      expect(html).toContain('<p class="doc-footnote"><sup>2</sup> Second footnote.</p>');
    },
  );

  test(
    'Scenario: Doc preview renders label',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{ text: 'content' }],
        label: 'Before normalization',
      });

      expect(html).toContain('<p class="doc-preview-label">Before normalization</p>');
    },
  );

  test(
    'Scenario: Doc preview skips empty runs',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: '' },
          { text: 'visible' },
          { text: '' },
        ],
      });

      expect(html).toContain('>visible</');
      // The doc-line should contain only the non-empty run
      expect(html).not.toMatch(/<span[^>]*><\/span>/);
    },
  );

  test(
    'Scenario: Doc preview composes formatting with revision and position',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [{
          text: '1',
          bold: true,
          script: 'superscript',
          positionHpt: 12,
          revision: 'insertion',
          revisionAuthor: 'Author',
        }],
      });

      // All features should be present: <b>, <sup>, span with class+style+title
      expect(html).toContain('<sup>');
      expect(html).toContain('<b>');
      expect(html).toContain('class="doc-ins"');
      expect(html).toContain('style="position:relative;top:-6pt"');
      expect(html).toContain('title="Author"');
    },
  );
});
