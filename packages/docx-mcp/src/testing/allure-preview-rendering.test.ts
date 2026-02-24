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

const test = it.epic('Test Infrastructure').withLabels({ feature: 'Allure Preview Rendering' });

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

    // Build a delegating mock: forward all calls to the real runtime for
    // proper Allure report labels/attachments, while also capturing
    // attachments locally for test assertions.
    const delegate = <T extends unknown[]>(
      method: string,
      ...args: T
    ): Promise<void> => {
      const real = savedRuntime as Record<string, Function> | undefined;
      if (real && typeof real[method] === 'function') {
        return real[method](...args);
      }
      return Promise.resolve();
    };

    setAllureRuntime({
      epic: async (name) => delegate('epic', name),
      feature: async (name) => delegate('feature', name),
      parentSuite: async (name) => delegate('parentSuite', name),
      suite: async (name) => delegate('suite', name),
      subSuite: async (name) => delegate('subSuite', name),
      severity: async (level) => delegate('severity', level),
      story: async (name) => delegate('story', name),
      id: async (id) => delegate('id', id),
      allureId: async (id) => delegate('allureId', id),
      displayName: async (value) => delegate('displayName', value),
      label: async (name, value) => delegate('label', name, value),
      description: async (value) => delegate('description', value),
      tags: async (...values) => delegate('tags', ...values),
      tag: async (value) => delegate('tag', value),
      parameter: async (name, value) => delegate('parameter', name, value),
      step: async (_name, body) => {
        if (savedRuntime && typeof savedRuntime.step === 'function') {
          return savedRuntime.step(_name, body);
        }
        return body({ parameter: async () => {} } as AllureStepContext);
      },
      attachment: async (name, content, contentType) => {
        attachments.push({ name, content, contentType });
        await delegate('attachment', name, content, contentType);
      },
    });
  });

  afterEach(() => {
    setAllureRuntime(savedRuntime);
    savedRuntime = undefined;
  });

  // -----------------------------------------------------------------------
  // Helpers
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

  // -----------------------------------------------------------------------
  // Word-like preview (legacy)
  // -----------------------------------------------------------------------

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
  // Doc preview: plain text
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders plain text runs',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The parties agree to the terms set forth in this Agreement, ' },
          { text: 'including all schedules and exhibits attached hereto.' },
        ],
      });

      expect(html).toContain('The parties agree to the terms');
      expect(html).toContain('including all schedules');
      expect(html).toContain('<p class="doc-line">');
      expect(html).not.toContain('<span');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: HTML escaping
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview escapes HTML in text',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The condition x < y && z > 0 must hold. ' },
          { text: '<script>alert("xss")</script> is escaped.' },
        ],
      });

      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('x &lt; y &amp;&amp; z &gt; 0');
      expect(html).not.toContain('<script>alert');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: bold, italic, underline (individual + combinations)
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders bold, italic, and underline with combinations',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'plain ' },
          { text: 'bold', bold: true },
          { text: ' ' },
          { text: 'italic', italic: true },
          { text: ' ' },
          { text: 'underlined', underline: true },
          { text: ' ' },
          { text: 'bold and italic', bold: true, italic: true },
          { text: ' ' },
          { text: 'bold and underlined', bold: true, underline: true },
          { text: ' ' },
          { text: 'all three styles', bold: true, italic: true, underline: true },
        ],
      });

      expect(html).toContain('plain ');
      expect(html).toContain('<b>bold</b>');
      expect(html).toContain('<i>italic</i>');
      expect(html).toContain('<u>underlined</u>');
      expect(html).toContain('<b><i>bold and italic</i></b>');
      expect(html).toContain('<b><u>bold and underlined</u></b>');
      expect(html).toContain('<b><i><u>all three styles</u></i></b>');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: superscript with context
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders superscript after base text',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The parties agree to the terms' },
          { text: '1', script: 'superscript' },
          { text: ' set forth herein.' },
        ],
        footnotes: [
          { marker: '1', text: 'As defined in Section 2.1 of the Master Agreement.' },
        ],
      });

      expect(html).toContain('The parties agree to the terms');
      expect(html).toContain('<sup>1</sup>');
      expect(html).toContain(' set forth herein.');
      expect(html).toContain('<hr class="doc-footnote-sep">');
      expect(html).toContain('<p class="doc-footnote"><sup>1</sup> As defined in Section 2.1');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: subscript with context
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders subscript after base text',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'H' },
          { text: '2', script: 'subscript' },
          { text: 'O is the chemical formula for water.' },
        ],
      });

      expect(html).toContain('H');
      expect(html).toContain('<sub>2</sub>');
      expect(html).toContain('O is the chemical formula');
      expect(html).not.toContain('<sup>');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: position offset
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders position offset (double-elevation defect)',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The parties agree to the terms' },
          { text: '1', script: 'superscript', positionHpt: 12 },
          { text: ' set forth herein.' },
        ],
        label: 'Before normalization (double-elevation defect)',
        footnotes: [
          { marker: '1', text: 'As defined in Section 2.1.' },
        ],
      });

      expect(html).toContain('style="position:relative;top:-6pt"');
      expect(html).toContain('<sup>1</sup>');
      expect(html).toContain('doc-preview-label');
      expect(html).toContain('Before normalization');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: insertion revision
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders insertion revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The Seller shall deliver the goods ' },
          { text: 'within thirty (30) calendar days', revision: 'insertion', revisionAuthor: 'Jane Smith' },
          { text: ' of the Effective Date.' },
        ],
      });

      expect(html).toContain('The Seller shall deliver the goods ');
      expect(html).toContain('<span class="doc-ins"');
      expect(html).toContain('within thirty (30) calendar days</span>');
      expect(html).toContain(' of the Effective Date.');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: deletion revision
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders deletion revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'Payment is due ' },
          { text: 'immediately upon receipt', revision: 'deletion', revisionAuthor: 'Legal Review' },
          { text: ' ' },
          { text: 'within 30 days of invoice', revision: 'insertion' },
          { text: '.' },
        ],
      });

      expect(html).toContain('<span class="doc-del"');
      expect(html).toContain('immediately upon receipt</span>');
      expect(html).toContain('<span class="doc-ins">within 30 days of invoice</span>');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: move-from revision (green + double strikethrough)
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders move-from revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'Section 3.1: ' },
          { text: 'The indemnification clause shall apply to all parties.', revision: 'move-from', revisionAuthor: 'Editor' },
          { text: ' [moved to Section 5.2]' },
        ],
      });

      expect(html).toContain('<span class="doc-move-from"');
      expect(html).toContain('The indemnification clause shall apply to all parties.</span>');
      expect(html).toContain('[moved to Section 5.2]');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: move-to revision (green + double underline)
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders move-to revision',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'Section 5.2: ' },
          { text: 'The indemnification clause shall apply to all parties.', revision: 'move-to', revisionAuthor: 'Editor' },
          { text: ' [moved from Section 3.1]' },
        ],
      });

      expect(html).toContain('<span class="doc-move-to"');
      expect(html).toContain('The indemnification clause shall apply to all parties.</span>');
      expect(html).toContain('[moved from Section 3.1]');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: revision author as tooltip
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders revision author as tooltip',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'Original text ' },
          { text: 'added by Jane', revision: 'insertion', revisionAuthor: 'Jane Doe' },
          { text: ' and ' },
          { text: 'removed by John', revision: 'deletion', revisionAuthor: 'John Smith' },
          { text: '.' },
        ],
      });

      expect(html).toContain('title="Jane Doe"');
      expect(html).toContain('title="John Smith"');
      expect(html).toContain('class="doc-ins"');
      expect(html).toContain('class="doc-del"');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: footnotes with separator
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders footnotes with separator and markers',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The Buyer' },
          { text: '1', script: 'superscript' },
          { text: ' shall pay the Seller' },
          { text: '2', script: 'superscript' },
          { text: ' the agreed consideration.' },
        ],
        footnotes: [
          { marker: '1', text: 'As defined in Section 1.1 ("Buyer" means the purchasing entity).' },
          { marker: '2', text: 'As defined in Section 1.2 ("Seller" means the supplying entity).' },
        ],
      });

      expect(html).toContain('<hr class="doc-footnote-sep">');
      expect(html).toContain('<p class="doc-footnote"><sup>1</sup> As defined in Section 1.1');
      expect(html).toContain('<p class="doc-footnote"><sup>2</sup> As defined in Section 1.2');
      // Verify superscript markers in body
      expect(html).toMatch(/The Buyer[\s\S]*<sup>1<\/sup>[\s\S]*shall pay the Seller[\s\S]*<sup>2<\/sup>/);
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: label
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview renders label',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The parties agree to the terms' },
          { text: '1', script: 'superscript' },
          { text: ' set forth herein.' },
        ],
        label: 'After normalization',
        footnotes: [
          { marker: '1', text: 'As defined in Section 2.1.' },
        ],
      });

      expect(html).toContain('<p class="doc-preview-label">After normalization</p>');
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: empty runs skipped
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview skips empty runs',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: '' },
          { text: 'This agreement is binding upon the parties.' },
          { text: '' },
        ],
      });

      expect(html).toContain('This agreement is binding upon the parties.');
      expect(html).not.toMatch(/<span[^>]*><\/span>/);
    },
  );

  // -----------------------------------------------------------------------
  // Doc preview: combined formatting + revision + position
  // -----------------------------------------------------------------------

  test(
    'Scenario: Doc preview composes formatting with revision and position',
    async (ctx: AllureBddContext) => {
      const html = await renderDocPreview(ctx, {
        runs: [
          { text: 'The parties agree to the terms' },
          {
            text: '1',
            bold: true,
            script: 'superscript',
            positionHpt: 12,
            revision: 'insertion',
            revisionAuthor: 'Author',
          },
          { text: ' set forth in this ' },
          { text: 'Agreement', bold: true, italic: true },
          { text: '.' },
        ],
        label: 'Before normalization',
        footnotes: [
          { marker: '1', text: 'As defined in Section 2.1 of the Master Agreement.' },
        ],
      });

      // Combined run: bold superscript with position and revision
      expect(html).toContain('<sup>');
      expect(html).toContain('<b>');
      expect(html).toContain('class="doc-ins"');
      expect(html).toContain('style="position:relative;top:-6pt"');
      expect(html).toContain('title="Author"');
      // Bold+italic run
      expect(html).toContain('<b><i>Agreement</i></b>');
      // Label and footnotes
      expect(html).toContain('doc-preview-label');
      expect(html).toContain('doc-footnote-sep');
    },
  );
});
