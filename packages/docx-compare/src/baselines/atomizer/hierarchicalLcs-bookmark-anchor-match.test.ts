/**
 * Anchor-identity paragraph matching in `computeGroupLcs` Pass 1.5 (#846).
 *
 * A dense whole-paragraph rewrite can fall below every text-similarity
 * threshold, so before this pass the pair degraded to whole-paragraph
 * delete + insert and every preservable common token inside it was revised.
 * safe-docx brackets managed paragraphs with uniquely named `_bk_…` bookmarks
 * as immediate siblings (`<w:bookmarkStart/><w:p/><w:bookmarkEnd/>`); when
 * both comparison sides carry the same bracketing anchor name, the paragraphs
 * are the same logical paragraph by construction and are force-matched before
 * similarity heuristics run. Bookmarks inside a paragraph never qualify.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/846
 */
import { describe, expect } from 'vitest';
import { DocxArchive } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { compareDocuments } from '../../index.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Hierarchical LCS' });

const FIXED_DATE = new Date('2026-08-14T12:00:00Z');

// Word overlap between these two sentences is far below the 0.25 paragraph
// similarity threshold, so alignment can only come from the anchor pass.
const DENSE_BEFORE = 'Subject to approval, Northwind, together with its affiliates, will fund the program.';
const DENSE_AFTER = 'Notwithstanding any contrary term, Northwind, acting through its designated subsidiaries, shall exclusively finance every initiative.';

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function anchored(name: string, text: string, id: number): string {
  return `<w:bookmarkStart w:id="${id}" w:name="${name}"/>${paragraph(text)}<w:bookmarkEnd w:id="${id}"/>`;
}

async function compareBodies(originalBody: string, revisedBody: string): Promise<string> {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, { date: FIXED_DATE, detectMoves: false });
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

function paragraphCount(xml: string): number {
  return [...xml.matchAll(/<w:p[ >]/gu)].length;
}

describe('anchor-identity paragraph matching (#846)', () => {
  test.allure({ story: 'shared bracketing anchor keeps a dissimilar rewrite aligned as one paragraph' })('shared bracketing anchor keeps a dissimilar rewrite aligned as one paragraph', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    let xml = '';

    await given('both sides bracket the rewritten paragraph with the same _bk_ anchor', () => {});

    await when('the documents are compared', async () => {
      xml = await compareBodies(
        `${anchored('_bk_000000000001', DENSE_BEFORE, 1)}${paragraph('Context paragraph.')}`,
        `${anchored('_bk_000000000001', DENSE_AFTER, 1)}${paragraph('Context paragraph.')}`,
      );
      await attachPrettyJson('tracked document.xml', xml);
    });

    await then('the rewrite stays inside one physical paragraph instead of delete + insert paragraphs', () => {
      expect(paragraphCount(xml)).toBe(2);
    });

    await and('the shared entity tokens survive as ordinary text', () => {
      // "Northwind" is common to both sides; an aligned pair preserves it
      // outside any revision wrapper, a paragraph split cannot.
      expect(xml).not.toMatch(/<w:delText[^>]*>[^<]*Northwind/u);
      const insertions = [...xml.matchAll(/<w:ins\b[\s\S]*?<\/w:ins>/gu)].map((match) => match[0]);
      expect(insertions.some((block) => block.includes('Northwind'))).toBe(false);
    });
  });

  test.allure({ story: 'without anchors the dissimilar rewrite still splits into delete + insert paragraphs' })('without anchors the dissimilar rewrite still splits into delete + insert paragraphs', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let xml = '';

    await given('the same dense rewrite with no bracketing bookmarks anywhere', () => {});

    await when('the documents are compared', async () => {
      xml = await compareBodies(
        `${paragraph(DENSE_BEFORE)}${paragraph('Context paragraph.')}`,
        `${paragraph(DENSE_AFTER)}${paragraph('Context paragraph.')}`,
      );
      await attachPrettyJson('tracked document.xml', xml);
    });

    await then('similarity heuristics alone leave the pair as separate deleted and inserted paragraphs', () => {
      // Pins the pre-existing generic behavior: the anchor pass changes
      // nothing for ordinary third-party documents.
      expect(paragraphCount(xml)).toBe(2);
    });
  });

  test.allure({ story: 'mismatched anchor names do not force an alignment' })('mismatched anchor names do not force an alignment', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let xml = '';

    await given('each side brackets its paragraph with a different _bk_ anchor name', () => {});

    await when('the documents are compared', async () => {
      xml = await compareBodies(
        `${anchored('_bk_000000000001', DENSE_BEFORE, 1)}${paragraph('Context paragraph.')}`,
        `${anchored('_bk_000000000002', DENSE_AFTER, 2)}${paragraph('Context paragraph.')}`,
      );
      await attachPrettyJson('tracked document.xml', xml);
    });

    await then('the pair still splits into deleted and inserted paragraphs', () => {
      expect(paragraphCount(xml)).toBe(3);
    });
  });

  test.allure({ story: 'a foreign sibling bookmark name never activates the identity pass' })('a foreign sibling bookmark name never activates the identity pass', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let xml = '';

    await given('both sides bracket the dense pair with an identical non-safe-docx bookmark name', () => {});

    await when('the documents are compared', async () => {
      xml = await compareBodies(
        `<w:bookmarkStart w:id="1" w:name="CustomerBookmark"/>${paragraph(DENSE_BEFORE)}<w:bookmarkEnd w:id="1"/>${paragraph('Context paragraph.')}`,
        `<w:bookmarkStart w:id="1" w:name="CustomerBookmark"/>${paragraph(DENSE_AFTER)}<w:bookmarkEnd w:id="1"/>${paragraph('Context paragraph.')}`,
      );
      await attachPrettyJson('tracked document.xml', xml);
    });

    await then('the third-party bookmark does not force an alignment and the pair still splits', () => {
      // Anchor identity is limited to the canonical safe-docx _bk_ + 12-hex
      // name shape; arbitrary customer bookmark names must never change
      // generic comparison behavior.
      expect(paragraphCount(xml)).toBe(2);
    });
  });

  test.allure({ story: 'an orphaned bookmarkStart without its bracketing end is ignored' })('an orphaned bookmarkStart without its bracketing end is ignored', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let xml = '';

    await given('both sides have a _bk_ start before the paragraph but no bookmarkEnd after it', () => {});

    await when('the documents are compared', async () => {
      xml = await compareBodies(
        `<w:bookmarkStart w:id="1" w:name="_bk_00000000000a"/>${paragraph(DENSE_BEFORE)}${paragraph('Context paragraph.')}`,
        `<w:bookmarkStart w:id="1" w:name="_bk_00000000000a"/>${paragraph(DENSE_AFTER)}${paragraph('Context paragraph.')}`,
      );
      await attachPrettyJson('tracked document.xml', xml);
    });

    await then('the incomplete bracket does not qualify and the pair still splits', () => {
      expect(paragraphCount(xml)).toBe(2);
    });
  });

  test.allure({ story: 'a bracket whose start and end ids disagree is ignored' })('a bracket whose start and end ids disagree is ignored', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let xml = '';

    await given('both sides have a _bk_ start and a following bookmarkEnd with a different w:id', () => {});

    await when('the documents are compared', async () => {
      xml = await compareBodies(
        `<w:bookmarkStart w:id="1" w:name="_bk_00000000000b"/>${paragraph(DENSE_BEFORE)}<w:bookmarkEnd w:id="9"/>${paragraph('Context paragraph.')}`,
        `<w:bookmarkStart w:id="1" w:name="_bk_00000000000b"/>${paragraph(DENSE_AFTER)}<w:bookmarkEnd w:id="9"/>${paragraph('Context paragraph.')}`,
      );
      await attachPrettyJson('tracked document.xml', xml);
    });

    await then('the mismatched bracket does not qualify and the pair still splits', () => {
      expect(paragraphCount(xml)).toBe(2);
    });
  });

  test.allure({ story: 'a duplicated anchor name identifies nothing and is ignored' })('a duplicated anchor name identifies nothing and is ignored', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let xml = '';

    await given('the original brackets two different paragraphs with the same anchor name', () => {});

    await when('the documents are compared', async () => {
      xml = await compareBodies(
        `${anchored('_bk_000000000009', DENSE_BEFORE, 1)}${anchored('_bk_000000000009', 'Unrelated second clause.', 2)}`,
        `${anchored('_bk_000000000009', DENSE_AFTER, 1)}${paragraph('Unrelated second clause.')}`,
      );
      await attachPrettyJson('tracked document.xml', xml);
    });

    await then('the ambiguous name is dropped and the dense pair falls back to delete + insert', () => {
      // Exact text still matches "Unrelated second clause."; the dense pair
      // cannot ride the duplicated anchor, so it splits: 3 paragraphs total.
      expect(paragraphCount(xml)).toBe(2);
    });
  });
});
