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
import { parseXml } from '@usejunior/docx-core';
import { DocxArchive } from '@usejunior/docx-core';
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
    comparisonStrategy: 'legacy',
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
        comparisonStrategy: 'legacy',
        ...options, reconstructionMode: 'inplace',
      });
      const rebuild = await compareDocumentsAtomizer(original, revised, {
        comparisonStrategy: 'legacy',
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

  test('a retargeted link with no shippable relationship (empty rels) drops the insert wrapper rather than pinning it to the stale target', async ({ given, when, then, and }: AllureBddContext) => {
    let rebuildXml: string;

    await given('a revision that retargets the link (r:id rId7 -> rId99) where neither package declares the relationship', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      const para = (id: string, text: string) =>
        `<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>` +
        `<w:hyperlink xmlns:r="${R_NS}" r:id="${id}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p>`;
      // Fixtures ship an empty document.xml.rels, so the revised r:id has no
      // relationship to merge — the destination salt still splits this into
      // delete-old-link + insert-new-link, but the insert stays unwrapped
      // because there is nothing resolvable to ship (contrast the real-rels
      // cases below, which do wrap and ship).
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

    await and('the r:id insertion is NOT wrapped — the fixture ships an empty rels so rId99 has no relationship to merge, and a dangling r:id would corrupt the package (the real-rels case below DOES wrap and ship the relationship — #376)', () => {
      expect(relIdXml).not.toContain('rId99');
      expect(relIdXml).toContain('brand-new.example.com');
    });
  });
});

/**
 * Faithful retarget representation (issue #376): when packages declare real
 * hyperlink relationships, a changed link target compares as delete-old-link +
 * insert-new-link, and rebuild output ships a resolvable relationship for the
 * inserted/retargeted link. Every r:id in the output must resolve.
 */
describe('Retargeted / inserted hyperlinks ship a resolvable relationship', () => {
  const linkPara = (id: string, text: string) =>
    `<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>` +
    `<w:hyperlink xmlns:r="${R_NS}" r:id="${id}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p>`;

  async function rebuildWithRels(
    originalBody: string,
    originalRels: Array<{ id: string; target: string }>,
    revisedBody: string,
    revisedRels: Array<{ id: string; target: string }>,
  ): Promise<{ documentXml: string; relsXml: string }> {
    const original = await buildDocxFromBodyXml(originalBody, originalRels);
    const revised = await buildDocxFromBodyXml(revisedBody, revisedRels);
    const result = await compareDocumentsAtomizer(original, revised, {
      author: 'Hyperlink Test',
      date: new Date('2026-06-10T00:00:00Z'),
      reconstructionMode: 'rebuild',
    });
    expect(result.reconstructionModeUsed).toBe('rebuild');
    const archive = await DocxArchive.load(result.document);
    const documentXml = await archive.getDocumentXml();
    const relsXml = (await archive.getFile('word/_rels/document.xml.rels')) ?? '';
    return { documentXml, relsXml };
  }

  /** Resolve an r:id to its rels Target, or null when unresolvable. */
  function relTarget(relsXml: string, id: string): string | null {
    const re = new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*\\bTarget="([^"]*)"`);
    return re.exec(relsXml)?.[1] ?? null;
  }

  /** Assert every w:hyperlink r:id in the XML resolves against the rels part. */
  function expectNoDanglingHyperlinkRids(xml: string, relsXml: string): void {
    const re = /<w:hyperlink[^>]*\br:id="(rId\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      expect(relTarget(relsXml, m[1]!)).not.toBeNull();
    }
  }

  test('an in-place retarget (same r:id, new target) becomes delete-old-link + insert-new-link, each with a resolvable relationship', async ({ given, when, then, and }: AllureBddContext) => {
    let documentXml: string;
    let relsXml: string;

    await given('the link keeps r:id="rId7" but its rels Target changes from alpha to beta — Word\'s in-place target edit', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      ({ documentXml, relsXml } = await rebuildWithRels(
        linkPara('rId7', 'alpha target'),
        [{ id: 'rId7', target: 'https://alpha.example.com' }],
        linkPara('rId7', 'beta target'),
        [{ id: 'rId7', target: 'https://beta.example.com' }],
      ));
    });

    await then('the candidate carries distinct old and new resolvable link relationships', () => {
      expect(documentXml).toMatch(/<w:del[\s\S]*?<w:hyperlink[^>]*r:id="rId7"[\s\S]*?alpha target/);
      const insMatch = /<w:ins[\s\S]*?<w:hyperlink[^>]*r:id="(rId\d+)"[\s\S]*?beta target/.exec(documentXml);
      expect(insMatch).not.toBeNull();
      const insId = insMatch![1]!;
      expect(insId).not.toBe('rId7');
      expect(relTarget(relsXml, 'rId7')).toBe('https://alpha.example.com');
      expect(relTarget(relsXml, insId)).toBe('https://beta.example.com');
      expectNoDanglingHyperlinkRids(documentXml, relsXml);
    });

    await and('accept yields the new link only and reject the old link only', () => {
      const accepted = acceptAllChanges(documentXml);
      const rejected = rejectAllChanges(documentXml);

      const acceptId = /<w:hyperlink[^>]*r:id="(rId\d+)"[^>]*>[\s\S]*?beta target[\s\S]*?<\/w:hyperlink>/.exec(accepted)?.[1];
      expect(acceptId).toBeDefined();
      expect(relTarget(relsXml, acceptId!)).toBe('https://beta.example.com');
      expect(accepted).not.toContain('alpha');

      expect(rejected).toMatch(/<w:hyperlink[^>]*r:id="rId7"[^>]*>[\s\S]*?alpha target[\s\S]*?<\/w:hyperlink>/);
      expect(relTarget(relsXml, 'rId7')).toBe('https://alpha.example.com');
      expect(rejected).not.toContain('beta');
    });
  });

  test('a same-text hyperlink retarget projects each relationship target under the tagged default', async () => {
    const { documentXml, relsXml } = await rebuildWithRels(
      linkPara('rId7', 'unchanged label'),
      [{ id: 'rId7', target: 'https://old.example.com' }],
      linkPara('rId7', 'unchanged label'),
      [{ id: 'rId7', target: 'https://new.example.com' }],
    );
    const accepted = acceptAllChanges(documentXml);
    const rejected = rejectAllChanges(documentXml);
    const acceptedId = /<w:hyperlink[^>]*r:id="([^"]+)"/.exec(accepted)?.[1];
    const rejectedId = /<w:hyperlink[^>]*r:id="([^"]+)"/.exec(rejected)?.[1];

    expect(acceptedId).toBeDefined();
    expect(rejectedId).toBeDefined();
    expect(relTarget(relsXml, acceptedId!)).toBe('https://new.example.com');
    expect(relTarget(relsXml, rejectedId!)).toBe('https://old.example.com');
    expect(accepted).toContain('unchanged label');
    expect(rejected).toContain('unchanged label');
  });

  test('a retarget to a fresh r:id allocates a collision-free relationship id in the original-based package', async ({ given, when, then }: AllureBddContext) => {
    let documentXml: string;
    let relsXml: string;

    await given('original links via rId7 and revised via a brand-new rId99', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      ({ documentXml, relsXml } = await rebuildWithRels(
        linkPara('rId7', 'alpha target'),
        [{ id: 'rId7', target: 'https://alpha.example.com' }],
        linkPara('rId99', 'beta target'),
        [{ id: 'rId99', target: 'https://beta.example.com' }],
      ));
    });

    await then('the inserted link ships a freshly-allocated id (not rId99, which never existed in the base) resolving to beta, with no dangling references', () => {
      const insId = /<w:ins[\s\S]*?<w:hyperlink[^>]*r:id="(rId\d+)"[\s\S]*?beta target/.exec(documentXml)?.[1];
      expect(insId).toBeDefined();
      expect(relTarget(relsXml, insId!)).toBe('https://beta.example.com');
      expect(relTarget(relsXml, 'rId7')).toBe('https://alpha.example.com');
      expectNoDanglingHyperlinkRids(documentXml, relsXml);
    });
  });

  test('a bare r:id reshuffle (same URL, new id) stays Equal — no spurious delete/insert', async ({ given, when, then }: AllureBddContext) => {
    let documentXml: string;
    let relsXml: string;

    await given('the link text and destination are identical; only the relationship id differs (rId7 -> rId3)', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      ({ documentXml, relsXml } = await rebuildWithRels(
        linkPara('rId7', 'alpha target'),
        [{ id: 'rId7', target: 'https://alpha.example.com' }],
        linkPara('rId3', 'alpha target'),
        [{ id: 'rId3', target: 'https://alpha.example.com' }],
      ));
    });

    await then('the link survives whole with no revision markup, resolving to the unchanged target', () => {
      expect(documentXml).not.toContain('<w:del');
      expect(documentXml).not.toContain('<w:ins');
      expect(documentXml).toMatch(/<w:hyperlink[^>]*r:id="rId7"[^>]*>[\s\S]*?alpha target[\s\S]*?<\/w:hyperlink>/);
      expect(relTarget(relsXml, 'rId7')).toBe('https://alpha.example.com');
      expectNoDanglingHyperlinkRids(documentXml, relsXml);
    });
  });

  test('a purely inserted r:id hyperlink is wrapped and its relationship shipped when the revised package declares it', async ({ given, when, then, and }: AllureBddContext) => {
    let documentXml: string;
    let relsXml: string;

    await given('a revision that adds a new hyperlink paragraph whose r:id has a real relationship', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      const base = `<w:p><w:r><w:t>Existing text</w:t></w:r></w:p>`;
      ({ documentXml, relsXml } = await rebuildWithRels(
        base,
        [],
        base + linkPara('rId5', 'brand-new.example.com'),
        [{ id: 'rId5', target: 'https://brand-new.example.com' }],
      ));
    });

    await then('the insertion is wrapped in a hyperlink whose id resolves to the new target', () => {
      const insId = /<w:ins[\s\S]*?<w:hyperlink[^>]*r:id="(rId\d+)"[\s\S]*?brand-new\.example\.com/.exec(documentXml)?.[1];
      expect(insId).toBeDefined();
      expect(relTarget(relsXml, insId!)).toBe('https://brand-new.example.com');
      expectNoDanglingHyperlinkRids(documentXml, relsXml);
    });

    await and('accepting keeps the wrapped link and rejecting drops it entirely', () => {
      const accepted = acceptAllChanges(documentXml);
      const rejected = rejectAllChanges(documentXml);
      expect(accepted).toMatch(/<w:hyperlink[^>]*>[\s\S]*?brand-new\.example\.com[\s\S]*?<\/w:hyperlink>/);
      expect(rejected).not.toContain('brand-new.example.com');
    });
  });

  test('a shipped Target with XML-sensitive characters is escaped and round-trips', async ({ given, when, then }: AllureBddContext) => {
    let relsXml: string;
    const url = 'https://ex.com/search?a=1&b=2&tag=<x>';

    await given('a retarget whose new URL contains & and < >', () => {});

    await when('compared with reconstructionMode rebuild', async () => {
      ({ relsXml } = await rebuildWithRels(
        linkPara('rId7', 'alpha'),
        [{ id: 'rId7', target: 'https://alpha.example.com' }],
        linkPara('rId7', 'beta'),
        [{ id: 'rId7', target: url }],
      ));
    });

    await then('the appended relationship is well-formed (escaped) and parses back to the exact URL', () => {
      expect(relsXml).toContain('&amp;');
      expect(relsXml).not.toMatch(/Target="[^"]*<x>/);
      // Parsing the rels and reading the Target attribute yields the raw URL.
      const doc = parseXml(relsXml);
      const rels = doc.getElementsByTagName('Relationship');
      const targets = Array.from({ length: rels.length }, (_, i) => rels.item(i)!.getAttribute('Target'));
      expect(targets).toContain(url);
    });
  });
});
