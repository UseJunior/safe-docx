/**
 * Regression tests for w:hyperlink preservation in rebuild reconstruction.
 *
 * Rebuild used to drop `<w:hyperlink>` wrappers entirely (link + r:id lost)
 * and the cross-run punctuation merge absorbed adjacent plain text into the
 * underlined link run. First caught on a real document by the
 * formatting-fidelity check; pinned here with the issue's fixture shape
 * (Common Paper Mutual NDA cover page: `…posted at <hyperlink>URL</hyperlink>.`).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/368
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { DocxArchive } from '../../shared/docx/DocxArchive.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { compareProjectedFormattingFidelity } from './formattingFidelity.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Document Reconstructor Hyperlinks',
    story: 'Hyperlink Wrapper Preservation In Rebuild',
    severity: 'critical',
  })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' });

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Hyperlink-bearing paragraph in the issue-#368 fixture shape. */
function linkParagraph(urlText: string): string {
  return (
    `<w:p><w:r><w:t xml:space="preserve">License terms are posted at </w:t></w:r>` +
    `<w:hyperlink xmlns:r="${R_NS}" r:id="rId7" w:history="1">` +
    `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>${urlText}</w:t></w:r>` +
    `</w:hyperlink>` +
    `<w:r><w:t>.</w:t></w:r></w:p>`
  );
}

function countMatches(xml: string, re: RegExp): number {
  return (xml.match(re) ?? []).length;
}

async function rebuildCompare(originalBody: string, revisedBody: string) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocumentsAtomizer(original, revised, {
    author: 'Hyperlink Test',
    date: new Date('2026-06-10T00:00:00Z'),
    reconstructionMode: 'rebuild',
  });
  expect(result.reconstructionModeUsed).toBe('rebuild');
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

describe('Rebuild reconstruction preserves w:hyperlink wrappers', () => {
  test('edit inside the link text keeps the wrapper, r:id, and revision nesting', async ({ given, when, then, and }: AllureBddContext) => {
    let rebuildXml: string;

    await given('original and revised docs whose only change is inside the hyperlink URL', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      rebuildXml = await rebuildCompare(
        linkParagraph('commonpaper.com/standards/mutual-nda/1.0'),
        linkParagraph('commonpaper.com/standards/reciprocal-nda/1.0'),
      );
    });

    await then('exactly one w:hyperlink with the original r:id survives', () => {
      expect(countMatches(rebuildXml, /<w:hyperlink[\s>]/g)).toBe(1);
      expect(rebuildXml).toContain('r:id="rId7"');
    });

    await and('revision wrappers nest inside the hyperlink, never around it', () => {
      expect(rebuildXml).not.toMatch(/<w:ins[^>]*>\s*<w:hyperlink/);
      expect(rebuildXml).not.toMatch(/<w:del[^>]*>\s*<w:hyperlink/);
      const wrapperInner = /<w:hyperlink[^>]*>([\s\S]*?)<\/w:hyperlink>/.exec(rebuildXml)![1]!;
      expect(wrapperInner).toContain('<w:del');
      expect(wrapperInner).toContain('<w:ins');
    });

    await and('both projections resolve the edit while keeping the link text inside the wrapper', () => {
      const accepted = acceptAllChanges(rebuildXml);
      const rejected = rejectAllChanges(rebuildXml);
      expect(/<w:hyperlink[^>]*>[\s\S]*?reciprocal-nda[\s\S]*?<\/w:hyperlink>/.test(accepted)).toBe(true);
      expect(/<w:hyperlink[^>]*>[\s\S]*?mutual-nda[\s\S]*?<\/w:hyperlink>/.test(rejected)).toBe(true);
    });
  });

  test('the sentence period after the link does not inherit the underline', async ({ given, when, then }: AllureBddContext) => {
    let inplaceXml: string;
    let rebuildXml: string;

    await given('the issue-368 fixture shape with a plain "." run after the underlined URL', () => {});

    await when('inplace and rebuild candidates are produced for the same revision', async () => {
      const original = await buildDocxFromBodyXml(
        linkParagraph('commonpaper.com/standards/mutual-nda/1.0'),
      );
      const revised = await buildDocxFromBodyXml(
        linkParagraph('commonpaper.com/standards/reciprocal-nda/1.0'),
      );
      const options = { author: 'Hyperlink Test', date: new Date('2026-06-10T00:00:00Z') };
      const inplace = await compareDocumentsAtomizer(original, revised, {
        ...options, reconstructionMode: 'inplace',
      });
      const rebuild = await compareDocumentsAtomizer(original, revised, {
        ...options, reconstructionMode: 'rebuild',
      });
      inplaceXml = await (await DocxArchive.load(inplace.document)).getDocumentXml();
      rebuildXml = await (await DocxArchive.load(rebuild.document)).getDocumentXml();
    });

    await then('the fidelity check reports no underline divergence in either projection', () => {
      const result = compareProjectedFormattingFidelity(inplaceXml, rebuildXml);
      const underline = [...result.accept.divergences, ...result.reject.divergences]
        .filter((d) => d.property === 'underline');
      expect(underline).toEqual([]);
    });
  });

  test('an edit elsewhere in the paragraph leaves the untouched link intact', async ({ given, when, then }: AllureBddContext) => {
    let rebuildXml: string;

    await given('a revision that only rewords the plain text before the link', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      rebuildXml = await rebuildCompare(
        linkParagraph('commonpaper.com/standards/mutual-nda/1.0').replace(
          'License terms are posted at ', 'License terms are published at '),
        linkParagraph('commonpaper.com/standards/mutual-nda/1.0'),
      );
    });

    await then('the hyperlink survives whole with its r:id and full URL inside', () => {
      expect(countMatches(rebuildXml, /<w:hyperlink[\s>]/g)).toBe(1);
      expect(
        /<w:hyperlink[^>]*r:id="rId7"[^>]*>[\s\S]*?mutual-nda[\s\S]*?<\/w:hyperlink>/.test(rebuildXml),
      ).toBe(true);
    });
  });

  test('a deleted paragraph keeps its hyperlink with w:del nested inside', async ({ given, when, then }: AllureBddContext) => {
    let rebuildXml: string;

    await given('a revision that removes the entire hyperlink-bearing paragraph', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      rebuildXml = await rebuildCompare(
        `<w:p><w:r><w:t>Kept paragraph</w:t></w:r></w:p>` +
          linkParagraph('commonpaper.com/standards/mutual-nda/1.0'),
        `<w:p><w:r><w:t>Kept paragraph</w:t></w:r></w:p>`,
      );
    });

    await then('the deletion nests inside the wrapper and rejecting restores the link', () => {
      expect(rebuildXml).toMatch(/<w:hyperlink[^>]*r:id="rId7"[^>]*><w:del/);
      expect(rebuildXml).not.toMatch(/<w:del[^>]*>\s*<w:hyperlink/);
      const rejected = rejectAllChanges(rebuildXml);
      expect(/<w:hyperlink[^>]*>[\s\S]*?mutual-nda[\s\S]*?<\/w:hyperlink>/.test(rejected)).toBe(true);
    });
  });

  test('a retargeted link never leaves accepted text on the stale original target', async ({ given, when, then, and }: AllureBddContext) => {
    let rebuildXml: string;

    await given('a revision that changes the link target (r:id) and part of the link text, keeping a text suffix equal', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      const para = (id: string, text: string) =>
        `<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>` +
        `<w:hyperlink xmlns:r="${R_NS}" r:id="${id}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p>`;
      rebuildXml = await rebuildCompare(
        para('rId7', 'alpha target'),
        para('rId99', 'beta target'),
      );
    });

    await then('the accepted projection carries neither the stale rId7 nor the unresolvable rId99', () => {
      const accepted = acceptAllChanges(rebuildXml);
      expect(accepted).not.toContain('rId7');
      expect(accepted).not.toContain('rId99');
      expect(accepted).toContain('beta');
      expect(accepted).toContain('target');
    });

    await and('the rejected projection keeps deleted link text under the original r:id', () => {
      const rejected = rejectAllChanges(rebuildXml);
      expect(/<w:hyperlink[^>]*r:id="rId7"[^>]*>[\s\S]*?alpha[\s\S]*?<\/w:hyperlink>/.test(rejected)).toBe(true);
      expect(rejected).not.toContain('rId99');
    });
  });

  test('an inserted anchor-only hyperlink is wrapped; an inserted r:id hyperlink stays unwrapped', async ({ given, when, then, and }: AllureBddContext) => {
    let anchorXml: string;
    let relIdXml: string;

    await given('revisions that add a new hyperlink paragraph (anchor-only vs r:id)', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      const base = `<w:p><w:r><w:t>Existing text</w:t></w:r></w:p>`;
      anchorXml = await rebuildCompare(
        base,
        base +
          `<w:p><w:hyperlink w:anchor="definitions">` +
          `<w:r><w:t>See definitions</w:t></w:r></w:hyperlink></w:p>`,
      );
      relIdXml = await rebuildCompare(
        base,
        base +
          `<w:p><w:hyperlink xmlns:r="${R_NS}" r:id="rId99">` +
          `<w:r><w:t>brand-new.example.com</w:t></w:r></w:hyperlink></w:p>`,
      );
    });

    await then('the anchor-only insertion re-emits the wrapper with w:ins inside', () => {
      expect(anchorXml).toMatch(/<w:hyperlink[^>]*w:anchor="definitions"[^>]*><w:ins/);
      expect(anchorXml).not.toMatch(/<w:ins[^>]*>\s*<w:hyperlink/);
    });

    await and('the r:id insertion is NOT wrapped — rId99 has no relationship in the original-based package, and a dangling r:id corrupts the document (known boundary, content preserved as plain inserted runs)', () => {
      expect(relIdXml).not.toContain('rId99');
      expect(relIdXml).toContain('brand-new.example.com');
    });
  });
});
