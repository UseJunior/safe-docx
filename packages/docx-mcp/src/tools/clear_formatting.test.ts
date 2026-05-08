import { describe, expect } from 'vitest';
import {
  OOXML,
  W,
  createRevisionContext,
  createRevisionIdState,
} from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { clearFormatting } from './clear_formatting.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Clear Formatting' });
const W_NS = OOXML.W_NS;

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function directChildren(parent: Element): Element[] {
  const children: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes.item(i);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
}

function directChildrenByName(parent: Element, localName: string): Element[] {
  return directChildren(parent).filter(
    (child) => child.namespaceURI === W_NS && child.localName === localName,
  );
}

function firstDirectChild(parent: Element, localName: string): Element {
  const child = directChildrenByName(parent, localName)[0];
  if (!child) throw new Error(`Expected ${localName} under ${parent.localName}`);
  return child;
}

function wordAttr(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(W_NS, localName) ??
    element.getAttribute(`w:${localName}`) ??
    element.getAttribute(localName)
  );
}

function runText(run: Element): string {
  return Array.from(run.getElementsByTagNameNS(W_NS, W.t))
    .map((t) => t.textContent ?? '')
    .join('');
}

async function getParagraph(
  opened: Awaited<ReturnType<typeof openSession>>,
  paragraphId: string = opened.firstParaId,
): Promise<Element> {
  const session = await opened.mgr.getSessionByFilePath(opened.filePath);
  if (!session) throw new Error('Expected open session');

  const paragraph = session.doc.getParagraphElementById(paragraphId);
  if (!paragraph) throw new Error(`Expected paragraph ${paragraphId}`);
  return paragraph;
}

function getRunByText(paragraph: Element, text: string): Element {
  const run = Array.from(paragraph.getElementsByTagNameNS(W_NS, W.r)).find(
    (candidate) => runText(candidate as Element) === text,
  ) as Element | undefined;

  if (!run) throw new Error(`Expected run with text "${text}"`);
  return run;
}

function createCtx(author: string = 'SafeDocX AI') {
  return createRevisionContext({
    author,
    date: '2026-05-06T15:30:00Z',
    idState: createRevisionIdState(),
  });
}

describe('clear_formatting tracked run-property changes', () => {
  registerCleanup();

  test('emits rPrChange with the prior run properties snapshot for tracked clears', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let cleared: Awaited<ReturnType<typeof clearFormatting>>;
    let rPr: Element;
    let rPrChange: Element;
    let previousRPr: Element;

    await given('a run whose bold formatting will be cleared while italic remains', async () => {
      const xml = makeDocXml(
        `<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Tracked</w:t></w:r></w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-' });
    });

    await when('clearFormatting clears bold with a revision context', async () => {
      cleared = await clearFormatting(
        opened.mgr,
        {
          file_path: opened.inputPath,
          paragraph_ids: [opened.firstParaId],
          clear_bold: true,
        },
        createCtx(),
      );
      assertSuccess(cleared, 'tracked clear_formatting');

      const paragraph = await getParagraph(opened);
      const run = getRunByText(paragraph, 'Tracked');
      rPr = firstDirectChild(run, W.rPr);
      rPrChange = firstDirectChild(rPr, 'rPrChange');
      previousRPr = firstDirectChild(rPrChange, W.rPr);
    });

    await then('the live run properties remove bold but keep italic', () => {
      expect(cleared.paragraphs_modified).toBe(1);
      expect(directChildrenByName(rPr, W.b)).toHaveLength(0);
      expect(directChildrenByName(rPr, W.i)).toHaveLength(1);
    });

    await and('the appended rPrChange is last and snapshots the prior bold+italic state', () => {
      expect(wordAttr(rPrChange, 'id')).toBe('1');
      expect(wordAttr(rPrChange, 'author')).toBe('SafeDocX AI');
      expect(wordAttr(rPrChange, 'date')).toBe('2026-05-06T15:30:00Z');
      expect(directChildren(rPr).at(-1)?.localName).toBe('rPrChange');
      expect(directChildrenByName(previousRPr, W.b)).toHaveLength(1);
      expect(directChildrenByName(previousRPr, W.i)).toHaveLength(1);
    });
  });

  test('preserves legacy direct-clear behavior when no revision context is provided', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let rPr: Element;

    await given('a run with bold and italic formatting', async () => {
      const xml = makeDocXml(
        `<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Legacy</w:t></w:r></w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-legacy-' });
    });

    await when('clearFormatting clears bold without a revision context', async () => {
      const cleared = await clearFormatting(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_ids: [opened.firstParaId],
        clear_bold: true,
      });
      assertSuccess(cleared, 'legacy clear_formatting');

      const paragraph = await getParagraph(opened);
      const run = getRunByText(paragraph, 'Legacy');
      rPr = firstDirectChild(run, W.rPr);
    });

    await then('the bold is removed without emitting any rPrChange wrapper', () => {
      expect(directChildrenByName(rPr, W.b)).toHaveLength(0);
      expect(directChildrenByName(rPr, W.i)).toHaveLength(1);
      expect(directChildrenByName(rPr, 'rPrChange')).toHaveLength(0);
    });
  });

  test('replaces a stale rPrChange instead of stacking multiple wrappers', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let rPr: Element;
    let rPrChange: Element;
    let previousRPr: Element;

    await given('a run that already carries a prior rPrChange marker', async () => {
      const xml = makeDocXml(
        `<w:p>` +
          `<w:r>` +
            `<w:rPr>` +
              `<w:b/>` +
              `<w:rPrChange w:id="77" w:author="Old Author" w:date="2026-01-01T00:00:00Z">` +
                `<w:rPr><w:i/></w:rPr>` +
              `</w:rPrChange>` +
            `</w:rPr>` +
            `<w:t>Replace</w:t>` +
          `</w:r>` +
        `</w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-stale-' });
    });

    await when('a new tracked clear runs on the same run properties', async () => {
      const cleared = await clearFormatting(
        opened.mgr,
        {
          file_path: opened.inputPath,
          paragraph_ids: [opened.firstParaId],
          clear_bold: true,
        },
        createCtx('Fresh Author'),
      );
      assertSuccess(cleared, 'replace stale rPrChange');

      const paragraph = await getParagraph(opened);
      const run = getRunByText(paragraph, 'Replace');
      rPr = firstDirectChild(run, W.rPr);
      [rPrChange] = directChildrenByName(rPr, 'rPrChange');
      previousRPr = firstDirectChild(rPrChange, W.rPr);
    });

    await then('exactly one rPrChange remains and it belongs to the latest author', () => {
      expect(directChildrenByName(rPr, 'rPrChange')).toHaveLength(1);
      expect(wordAttr(rPrChange, 'author')).toBe('Fresh Author');
      expect(wordAttr(rPrChange, 'date')).toBe('2026-05-06T15:30:00Z');
      expect(wordAttr(rPrChange, 'id')).toBe('1');
    });

    await and('the new snapshot contains only the prior live run properties', () => {
      expect(directChildrenByName(rPr, W.b)).toHaveLength(0);
      expect(directChildrenByName(previousRPr, W.b)).toHaveLength(1);
      expect(directChildrenByName(previousRPr, 'rPrChange')).toHaveLength(0);
      expect(directChildren(rPr).at(-1)?.localName).toBe('rPrChange');
    });
  });

  test('does not add rPrChange to runs that were not modified', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let cleared: Awaited<ReturnType<typeof clearFormatting>>;
    let rPr: Element;

    await given('a run that has font metadata but no bold formatting to clear', async () => {
      const xml = makeDocXml(
        `<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>NoOp</w:t></w:r></w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-noop-' });
    });

    await when('clearFormatting is asked to clear bold with a revision context', async () => {
      cleared = await clearFormatting(
        opened.mgr,
        {
          file_path: opened.inputPath,
          paragraph_ids: [opened.firstParaId],
          clear_bold: true,
        },
        createCtx(),
      );
      assertSuccess(cleared, 'no-op clear_formatting');

      const paragraph = await getParagraph(opened);
      const run = getRunByText(paragraph, 'NoOp');
      rPr = firstDirectChild(run, W.rPr);
    });

    await then('the run remains unchanged and receives no tracked wrapper', () => {
      expect(cleared.paragraphs_modified).toBe(0);
      expect(directChildrenByName(rPr, W.rFonts)).toHaveLength(1);
      expect(directChildrenByName(rPr, 'rPrChange')).toHaveLength(0);
    });
  });

  test('allocates unique revision IDs across multiple affected runs sharing one context', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let emittedIds: string[];
    let plainRunRPr: Element;

    await given('a paragraph with multiple runs where only some are bold', async () => {
      const xml = makeDocXml(
        `<w:p>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>One</w:t></w:r>` +
          `<w:r><w:rPr><w:i/></w:rPr><w:t>Two</w:t></w:r>` +
          `<w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>Three</w:t></w:r>` +
        `</w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-ids-' });
    });

    await when('clearFormatting clears bold across the paragraph with one shared context', async () => {
      const cleared = await clearFormatting(
        opened.mgr,
        {
          file_path: opened.inputPath,
          paragraph_ids: [opened.firstParaId],
          clear_bold: true,
        },
        createCtx(),
      );
      assertSuccess(cleared, 'multi-run tracked clear_formatting');

      const paragraph = await getParagraph(opened);
      emittedIds = Array.from(paragraph.getElementsByTagNameNS(W_NS, W.r))
        .map((run) => firstDirectChild(run as Element, W.rPr))
        .flatMap((rPr) => directChildrenByName(rPr, 'rPrChange'))
        .map((change) => wordAttr(change, 'id') ?? '');
      plainRunRPr = firstDirectChild(getRunByText(paragraph, 'Two'), W.rPr);
    });

    await then('each affected run gets a distinct tracked-change ID while unaffected runs get none', () => {
      expect(emittedIds).toEqual(['1', '2']);
      expect(new Set(emittedIds).size).toBe(2);
      expect(directChildrenByName(plainRunRPr, 'rPrChange')).toHaveLength(0);
    });
  });

  test('emits a single rPrChange snapshot when multiple formatting flags are cleared together', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let rPr: Element;
    let previousRPr: Element;

    await given('a run with bold, italic, highlight, and color formatting', async () => {
      const xml = makeDocXml(
        `<w:p>` +
          `<w:r>` +
            `<w:rPr>` +
              `<w:b/>` +
              `<w:i/>` +
              `<w:highlight w:val="yellow"/>` +
              `<w:color w:val="FF0000"/>` +
            `</w:rPr>` +
            `<w:t>Multi</w:t>` +
          `</w:r>` +
        `</w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-multi-' });
    });

    await when('clearFormatting clears several run properties in one call', async () => {
      const cleared = await clearFormatting(
        opened.mgr,
        {
          file_path: opened.inputPath,
          paragraph_ids: [opened.firstParaId],
          clear_bold: true,
          clear_italic: true,
          clear_highlight: true,
        },
        createCtx(),
      );
      assertSuccess(cleared, 'multi-flag clear_formatting');

      const paragraph = await getParagraph(opened);
      const run = getRunByText(paragraph, 'Multi');
      rPr = firstDirectChild(run, W.rPr);
      previousRPr = firstDirectChild(firstDirectChild(rPr, 'rPrChange'), W.rPr);
    });

    await then('the live run keeps uncleared properties and gets only one rPrChange child', () => {
      expect(directChildrenByName(rPr, W.b)).toHaveLength(0);
      expect(directChildrenByName(rPr, W.i)).toHaveLength(0);
      expect(directChildrenByName(rPr, W.highlight)).toHaveLength(0);
      expect(directChildrenByName(rPr, W.color)).toHaveLength(1);
      expect(directChildrenByName(rPr, 'rPrChange')).toHaveLength(1);
    });

    await and('the prior snapshot captures every cleared property together', () => {
      expect(directChildrenByName(previousRPr, W.b)).toHaveLength(1);
      expect(directChildrenByName(previousRPr, W.i)).toHaveLength(1);
      expect(directChildrenByName(previousRPr, W.highlight)).toHaveLength(1);
      expect(directChildrenByName(previousRPr, W.color)).toHaveLength(1);
    });
  });

  test('legacy path (no ctx) removes property descendants recursively, including those nested inside an existing rPrChange', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let rPr: Element;
    let staleRPrChange: Element | undefined;

    await given('a run whose rPr already carries a prior rPrChange snapshot containing bold', async () => {
      // The current bold AND a historical bold inside a prior rPrChange both exist.
      // The legacy (recursive) path is expected to remove BOTH; this test locks that in
      // so the tracked path's switch to direct-only removal is provably distinct.
      const xml = makeDocXml(
        `<w:p>` +
          `<w:r>` +
            `<w:rPr>` +
              `<w:b/>` +
              `<w:rPrChange w:id="900" w:author="OldAuthor" w:date="2024-01-01T00:00:00Z">` +
                `<w:rPr><w:b/></w:rPr>` +
              `</w:rPrChange>` +
            `</w:rPr>` +
            `<w:t>NestedHistory</w:t>` +
          `</w:r>` +
        `</w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-legacy-nested-' });
    });

    await when('clearFormatting clears bold without a revision context', async () => {
      const cleared = await clearFormatting(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_ids: [opened.firstParaId],
        clear_bold: true,
      });
      assertSuccess(cleared, 'legacy clear_formatting with nested rPrChange');

      const paragraph = await getParagraph(opened);
      const run = getRunByText(paragraph, 'NestedHistory');
      rPr = firstDirectChild(run, W.rPr);
      staleRPrChange = directChildrenByName(rPr, 'rPrChange')[0];
    });

    await then('both the live and the historical (snapshot-nested) bold tags are removed; the legacy recursive behavior is preserved', () => {
      // No <w:b> survives anywhere in the rPr subtree (including inside the inner rPrChange).
      const allBolds = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.b));
      expect(allBolds).toHaveLength(0);
      // The stale rPrChange wrapper itself remains (legacy path only removes target tags,
      // not the wrapper).
      expect(staleRPrChange).toBeDefined();
    });
  });

  test('tracked clear_font with a stale rPrChange replaces the wrapper and snapshots the multi-name prior properties (rFonts/sz/szCs)', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let rPr: Element;
    let rPrChange: Element;
    let previousRPr: Element;

    await given('a run with rFonts/sz/szCs and a stale rPrChange from a prior tracked edit', async () => {
      const xml = makeDocXml(
        `<w:p>` +
          `<w:r>` +
            `<w:rPr>` +
              `<w:rFonts w:ascii="Arial"/>` +
              `<w:sz w:val="22"/>` +
              `<w:szCs w:val="22"/>` +
              `<w:rPrChange w:id="901" w:author="OldAuthor" w:date="2024-01-01T00:00:00Z">` +
                `<w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr>` +
              `</w:rPrChange>` +
            `</w:rPr>` +
            `<w:t>FontMulti</w:t>` +
          `</w:r>` +
        `</w:p>`,
      );
      opened = await openSession([], { xml, prefix: 'safe-docx-clear-formatting-font-stale-' });
    });

    await when('clearFormatting clears font with a fresh revision context', async () => {
      const cleared = await clearFormatting(
        opened.mgr,
        {
          file_path: opened.inputPath,
          paragraph_ids: [opened.firstParaId],
          clear_font: true,
        },
        createCtx('Fresh Author'),
      );
      assertSuccess(cleared, 'tracked clear_font with stale rPrChange');

      const paragraph = await getParagraph(opened);
      const run = getRunByText(paragraph, 'FontMulti');
      rPr = firstDirectChild(run, W.rPr);
      const wrappers = directChildrenByName(rPr, 'rPrChange');
      expect(wrappers).toHaveLength(1);
      rPrChange = wrappers[0]!;
      previousRPr = firstDirectChild(rPrChange, W.rPr);
    });

    await then('all three font tags are removed from the live rPr', () => {
      expect(directChildrenByName(rPr, W.rFonts)).toHaveLength(0);
      expect(directChildrenByName(rPr, W.sz)).toHaveLength(0);
      expect(directChildrenByName(rPr, W.szCs)).toHaveLength(0);
    });

    await and('the new rPrChange is attributed to the fresh author and snapshots all three prior tags; the stale wrapper is gone', () => {
      expect(rPrChange.getAttribute('w:author')).toBe('Fresh Author');
      // The new snapshot captures the LIVE prior state (rFonts/sz/szCs that existed
      // before this clear), not the stale rPrChange's older snapshot.
      const ascii = directChildrenByName(previousRPr, W.rFonts)[0];
      expect(ascii?.getAttribute('w:ascii')).toBe('Arial');
      expect(directChildrenByName(previousRPr, W.sz)).toHaveLength(1);
      expect(directChildrenByName(previousRPr, W.szCs)).toHaveLength(1);
    });
  });
});
