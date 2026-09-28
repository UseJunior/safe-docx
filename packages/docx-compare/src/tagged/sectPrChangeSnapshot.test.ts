/**
 * `w:sectPrChange` records the prior section as `CT_SectPrBase`, which holds
 * only `EG_SectPrContents`. Header/footer references belong to the live
 * `CT_SectPr` alone, so the comparison must never copy them into the
 * snapshot, must keep the live ones bound on accept and reject, and must
 * report the binding differences it therefore cannot represent (#944).
 * When the sections differ only in those references, the snapshot would
 * equal the live contents, so no `w:sectPrChange` is emitted and none is
 * counted (#1100).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 * @see https://github.com/UseJunior/safe-docx/issues/944
 * @see https://github.com/UseJunior/safe-docx/issues/1100
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptChanges,
  auditSectPr,
  DocxArchive,
  OOXML,
  parseXml,
  rejectChanges,
  serializeXml,
} from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocumentsAtomizer, sectionDivergenceIsReported } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SCHEMA_GATE = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
const COMPARE_OPTIONS = {
  author: 'Comparison',
  date: new Date('2026-09-25T00:00:00.000Z'),
};

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'DOCX Comparison',
    story: 'Section Property Change Snapshots',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.17' },
  );

interface StoryPart {
  id: string;
  kind: 'header' | 'footer';
  target: string;
  text: string;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function storyXml(part: StoryPart): string {
  const root = part.kind === 'header' ? 'w:hdr' : 'w:ftr';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<${root} xmlns:w="${OOXML.W_NS}">${paragraph(part.text)}</${root}>`;
}

/** Build a package whose trailing `<w:sectPr/>` and story parts are supplied. */
async function packageWithStories(
  bodyXml: string,
  sectPrXml: string,
  parts: readonly StoryPart[],
): Promise<Buffer> {
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(bodyXml, [], { namespaces: { r: R_NS } }),
  );
  archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:sectPr/>', sectPrXml));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PACKAGE_REL_NS}">` +
      parts.map((part) =>
        `<Relationship Id="${part.id}" Type="${R_NS}/${part.kind}" Target="${part.target}"/>`,
      ).join('') +
      `</Relationships>`,
  );
  for (const part of parts) archive.setFile(`word/${part.target}`, storyXml(part));
  return archive.save();
}

function snapshotStoryReferences(documentXml: string): number {
  const document = parseXml(documentXml);
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPrChange')).reduce(
    (count, change) =>
      count +
      change.getElementsByTagNameNS(OOXML.W_NS, 'headerReference').length +
      change.getElementsByTagNameNS(OOXML.W_NS, 'footerReference').length,
    0,
  );
}

function sectPrChangeCount(documentXml: string): number {
  return parseXml(documentXml).getElementsByTagNameNS(OOXML.W_NS, 'sectPrChange').length;
}

function nativeProjection(documentXml: string, project: (document: Document) => unknown): string {
  const document = parseXml(documentXml);
  project(document);
  return serializeXml(document);
}

/** Slot → part path for every section, failing when a relationship does not resolve to a part. */
async function resolvedBindings(archive: DocxArchive, documentXml: string): Promise<string[]> {
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const audit = auditSectPr(documentXml, relationshipsXml);
  return audit.bindings.map((binding) => {
    expect(archive.hasFile(binding.targetPath), binding.targetPath).toBe(true);
    return `${binding.sectionOrdinal}:${binding.kind}:${binding.role}=${binding.targetPath}`;
  });
}

/** Validate the tracked, native Accept and native Reject packages with the repository's schema gate. */
async function expectSchemaValidPackages(result: Buffer): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-944-sectpr-'));
  try {
    const archive = await DocxArchive.load(result);
    const tracked = await archive.getDocumentXml();
    const variants: Array<[string, string]> = [
      ['tracked', tracked],
      ['accepted', nativeProjection(tracked, acceptChanges)],
      ['rejected', nativeProjection(tracked, rejectChanges)],
    ];
    for (const [name, xml] of variants) writeFileSync(join(dir, `${name}.xml`), xml);
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain('3 of 3 document.xml instances validate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEADER: StoryPart = { id: 'rIdHeader', kind: 'header', target: 'header1.xml', text: 'Header' };
const FOOTER: StoryPart = { id: 'rIdFooter', kind: 'footer', target: 'footer1.xml', text: 'Footer' };
const EVEN_FOOTER: StoryPart = { id: 'rIdEven', kind: 'footer', target: 'footer2.xml', text: 'Even footer' };

const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/>';
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const REFERENCES =
  `<w:headerReference w:type="default" r:id="${HEADER.id}"/>` +
  `<w:footerReference w:type="default" r:id="${FOOTER.id}"/>`;

describe('w:sectPrChange snapshots are CT_SectPrBase (#944)', () => {
  test('body section: the snapshot drops header/footer references and the live section keeps them', async () => {
    const original = await packageWithStories(
      paragraph('Body'),
      `<w:sectPr>${REFERENCES}${PORTRAIT}</w:sectPr>`,
      [HEADER, FOOTER],
    );
    const revised = await packageWithStories(
      paragraph('Body'),
      `<w:sectPr>${REFERENCES}${LANDSCAPE}</w:sectPr>`,
      [HEADER, FOOTER],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const archive = await DocxArchive.load(result.document);
    const documentXml = await archive.getDocumentXml();

    expect(sectPrChangeCount(documentXml)).toBe(1);
    expect(snapshotStoryReferences(documentXml)).toBe(0);
    const snapshot = parseXml(documentXml)
      .getElementsByTagNameNS(OOXML.W_NS, 'sectPrChange').item(0)!
      .getElementsByTagNameNS(OOXML.W_NS, 'pgSz').item(0)!;
    expect(snapshot.getAttributeNS(OOXML.W_NS, 'w')).toBe('12240');

    const expected = ['0:footer:default=word/footer1.xml', '0:header:default=word/header1.xml'];
    for (const projection of [
      acceptAllChanges(documentXml),
      rejectAllChanges(documentXml),
      nativeProjection(documentXml, acceptChanges),
      nativeProjection(documentXml, rejectChanges),
    ]) {
      expect((await resolvedBindings(archive, projection)).sort()).toEqual(expected);
    }
    expect(rejectAllChanges(documentXml)).toContain('w:w="12240"');
    expect(acceptAllChanges(documentXml)).toContain('w:orient="landscape"');
    await expectSchemaValidPackages(result.document);
    // Only the page-size property change is listed; no story binding changed.
    expect(result.unrepresentedChanges).toEqual([
      { scope: 'section', kind: 'changed', sectionIndex: 0 },
    ]);
  });

  test('paragraph section break: the pPr sectPr snapshot drops header/footer references', async () => {
    const sectionBreak = (pageSize: string): string =>
      `<w:p><w:pPr><w:sectPr>${REFERENCES}${pageSize}</w:sectPr></w:pPr>` +
      `<w:r><w:t>First section</w:t></w:r></w:p>`;
    const original = await packageWithStories(
      sectionBreak(PORTRAIT) + paragraph('Second section'),
      `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      [HEADER, FOOTER],
    );
    const revised = await packageWithStories(
      sectionBreak(LANDSCAPE) + paragraph('Second section'),
      `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      [HEADER, FOOTER],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const archive = await DocxArchive.load(result.document);
    const documentXml = await archive.getDocumentXml();

    expect(sectPrChangeCount(documentXml)).toBe(1);
    expect(snapshotStoryReferences(documentXml)).toBe(0);
    const expected = ['0:footer:default=word/footer1.xml', '0:header:default=word/header1.xml'];
    for (const projection of [
      acceptAllChanges(documentXml),
      rejectAllChanges(documentXml),
      nativeProjection(documentXml, acceptChanges),
      nativeProjection(documentXml, rejectChanges),
    ]) {
      expect((await resolvedBindings(archive, projection)).sort()).toEqual(expected);
    }
    await expectSchemaValidPackages(result.document);
    // Only the page-size property change is listed; no story binding changed.
    expect(result.unrepresentedChanges).toEqual([
      { scope: 'section', kind: 'changed', sectionIndex: 0 },
    ]);
  });

  test('a dropped reference the snapshot cannot carry is reported through unrepresentedChanges', async () => {
    const original = await packageWithStories(
      paragraph('Body'),
      `<w:sectPr>${REFERENCES}<w:footerReference w:type="even" r:id="${EVEN_FOOTER.id}"/>${PORTRAIT}</w:sectPr>`,
      [HEADER, FOOTER, EVEN_FOOTER],
    );
    const revised = await packageWithStories(
      paragraph('Body'),
      `<w:sectPr>${REFERENCES}${LANDSCAPE}</w:sectPr>`,
      [HEADER, FOOTER],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const archive = await DocxArchive.load(result.document);
    const documentXml = await archive.getDocumentXml();

    expect(snapshotStoryReferences(documentXml)).toBe(0);
    // Both projections keep the revised, relationship-bound references.
    const expected = ['0:footer:default=word/footer1.xml', '0:header:default=word/header1.xml'];
    expect((await resolvedBindings(archive, acceptAllChanges(documentXml))).sort()).toEqual(expected);
    expect((await resolvedBindings(archive, rejectAllChanges(documentXml))).sort()).toEqual(expected);
    expect((await resolvedBindings(archive, nativeProjection(documentXml, rejectChanges))).sort())
      .toEqual(expected);
    await expectSchemaValidPackages(result.document);
    expect(result.unrepresentedChanges).toEqual([
      { scope: 'section', kind: 'changed', sectionIndex: 0 },
      { scope: 'footer', kind: 'removed', sectionIndex: 0, role: 'even' },
    ]);
  });

  test('the publication gate admits a reference divergence only for a reported story on that section', () => {
    const divergence = {
      scope: 'section' as const,
      property: 'w:footerReference',
      kind: 'removed' as const,
      expectedValue: '<w:footerReference/>',
      actualValue: null,
      paragraphIndex: -1,
      textSample: '',
      sectionIndex: 1,
    };
    expect(sectionDivergenceIsReported(divergence, [
      { scope: 'footer', kind: 'removed', sectionIndex: 1, role: 'even' },
    ])).toBe(true);
    // A section-property entry, another section's story, or the other story
    // kind does not disclose a lost footer binding.
    expect(sectionDivergenceIsReported(divergence, [
      { scope: 'section', kind: 'changed', sectionIndex: 1 },
      { scope: 'footer', kind: 'removed', sectionIndex: 0, role: 'even' },
      { scope: 'header', kind: 'removed', sectionIndex: 1, role: 'even' },
    ])).toBe(false);
    expect(sectionDivergenceIsReported({ ...divergence, property: 'w:pgSz' }, [
      { scope: 'section', kind: 'changed', sectionIndex: 1 },
    ])).toBe(true);
    expect(sectionDivergenceIsReported({ ...divergence, property: 'w:pgSz' }, [
      { scope: 'footer', kind: 'removed', sectionIndex: 1, role: 'even' },
    ])).toBe(false);
  });
});

const HEADER_TWO: StoryPart = { id: 'rIdHeader2', kind: 'header', target: 'header2.xml', text: 'Other header' };

/** Live (non-snapshot) `w:sectPr` elements in document order. */
function liveSections(documentXml: string): Element[] {
  return Array.from(parseXml(documentXml).getElementsByTagNameNS(OOXML.W_NS, 'sectPr'))
    .filter((section) => section.parentNode?.nodeName !== 'w:sectPrChange');
}

describe('sections that differ only in header/footer references emit no w:sectPrChange (#1100)', () => {
  const cases: Array<{
    label: string;
    originalSectPr: string;
    revisedSectPr: string;
    originalParts: StoryPart[];
    revisedParts: StoryPart[];
    unrepresentedChanges: unknown;
    liveBindings: string[];
  }> = [
    {
      label: 'footer reference removed',
      originalSectPr: `<w:sectPr><w:footerReference w:type="default" r:id="${FOOTER.id}"/>${PORTRAIT}</w:sectPr>`,
      revisedSectPr: `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      originalParts: [FOOTER],
      revisedParts: [],
      unrepresentedChanges: [{ scope: 'footer', kind: 'removed', sectionIndex: 0, role: 'default' }],
      liveBindings: [],
    },
    {
      label: 'footer reference added',
      originalSectPr: `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      revisedSectPr: `<w:sectPr><w:footerReference w:type="default" r:id="${FOOTER.id}"/>${PORTRAIT}</w:sectPr>`,
      originalParts: [],
      revisedParts: [FOOTER],
      unrepresentedChanges: [{ scope: 'footer', kind: 'added', sectionIndex: 0, role: 'default' }],
      liveBindings: ['0:footer:default=word/footer1.xml'],
    },
    {
      label: 'header reference retargeted to another part',
      originalSectPr: `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER.id}"/>${PORTRAIT}</w:sectPr>`,
      revisedSectPr: `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_TWO.id}"/>${PORTRAIT}</w:sectPr>`,
      originalParts: [HEADER],
      revisedParts: [HEADER_TWO],
      // The retarget is carried as a tracked text change inside the header
      // story, so nothing is left unrepresented.
      unrepresentedChanges: undefined,
      liveBindings: ['0:header:default=word/header2.xml'],
    },
  ];

  for (const scenario of cases) {
    test(`body section, ${scenario.label}: no w:sectPrChange, formatChanges 0, difference still disclosed`, async () => {
      const original = await packageWithStories(paragraph('Body'), scenario.originalSectPr, scenario.originalParts);
      const revised = await packageWithStories(paragraph('Body'), scenario.revisedSectPr, scenario.revisedParts);

      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      const archive = await DocxArchive.load(result.document);
      const documentXml = await archive.getDocumentXml();

      expect(sectPrChangeCount(documentXml)).toBe(0);
      expect(result.stats.formatChanges).toBe(0);
      expect(result.stats.formatChangeAtoms).toBe(0);
      expect(result.unrepresentedChanges).toEqual(scenario.unrepresentedChanges);
      // The live section is the revised one: its references survive whole,
      // and neither is wrapped in w:ins/w:del.
      const [live] = liveSections(documentXml);
      expect(live).toBeDefined();
      expect(new XMLSerializer().serializeToString(live!)).not.toMatch(/<w:(ins|del)\b/);
      for (const projection of [
        acceptAllChanges(documentXml),
        rejectAllChanges(documentXml),
        nativeProjection(documentXml, acceptChanges),
        nativeProjection(documentXml, rejectChanges),
      ]) {
        expect((await resolvedBindings(archive, projection)).sort()).toEqual(scenario.liveBindings);
      }
      await expectSchemaValidPackages(result.document);
    });
  }

  test('paragraph section break that differs only in a footer reference emits no w:sectPrChange', async () => {
    const sectionBreak = (references: string): string =>
      `<w:p><w:pPr><w:sectPr>${references}${PORTRAIT}</w:sectPr></w:pPr>` +
      `<w:r><w:t>First section</w:t></w:r></w:p>`;
    const original = await packageWithStories(
      sectionBreak(`<w:footerReference w:type="default" r:id="${FOOTER.id}"/>`) + paragraph('Second section'),
      `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      [FOOTER],
    );
    const revised = await packageWithStories(
      sectionBreak('') + paragraph('Second section'),
      `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      [],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const archive = await DocxArchive.load(result.document);
    const documentXml = await archive.getDocumentXml();

    expect(sectPrChangeCount(documentXml)).toBe(0);
    expect(result.unrepresentedChanges).toEqual([
      { scope: 'footer', kind: 'removed', sectionIndex: 0, role: 'default' },
    ]);
    expect(await resolvedBindings(archive, nativeProjection(documentXml, rejectChanges))).toEqual([]);
    await expectSchemaValidPackages(result.document);
  });

  test('a prior w:sectPrChange in the revised input is not republished when the sections agree', async () => {
    const original = await packageWithStories(paragraph('Body'), `<w:sectPr>${PORTRAIT}</w:sectPr>`, []);
    const revised = await packageWithStories(
      paragraph('Body'),
      `<w:sectPr>${PORTRAIT}<w:sectPrChange w:id="1" w:author="Reviewer"><w:sectPr>${LANDSCAPE}</w:sectPr></w:sectPrChange></w:sectPr>`,
      [],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const documentXml = await (await DocxArchive.load(result.document)).getDocumentXml();

    expect(sectPrChangeCount(documentXml)).toBe(0);
    expect(result.stats.formatChanges).toBe(0);
    expect(result.unrepresentedChanges).toBeUndefined();
    expect(rejectAllChanges(documentXml)).not.toContain('w:orient="landscape"');
    await expectSchemaValidPackages(result.document);
  });

  test('paragraph section break: a prior w:sectPrChange is dropped when the paragraph properties change but the sections agree', async () => {
    const sectionBreak = (justification: string, priorChange: string): string =>
      `<w:p><w:pPr>${justification}<w:sectPr>${PORTRAIT}${priorChange}</w:sectPr></w:pPr>` +
      `<w:r><w:t>First section</w:t></w:r></w:p>`;
    const original = await packageWithStories(
      sectionBreak('', '') + paragraph('Second section'),
      `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      [],
    );
    const revised = await packageWithStories(
      sectionBreak(
        '<w:jc w:val="center"/>',
        `<w:sectPrChange w:id="1" w:author="Reviewer"><w:sectPr>${LANDSCAPE}</w:sectPr></w:sectPrChange>`,
      ) + paragraph('Second section'),
      `<w:sectPr>${PORTRAIT}</w:sectPr>`,
      [],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const documentXml = await (await DocxArchive.load(result.document)).getDocumentXml();

    expect(sectPrChangeCount(documentXml)).toBe(0);
    // The justification change is the only property revision.
    expect(result.stats.formatChanges).toBe(1);
    expect(parseXml(documentXml).getElementsByTagNameNS(OOXML.W_NS, 'pPrChange').length).toBe(1);
    expect(rejectAllChanges(documentXml)).not.toContain('w:orient="landscape"');
    expect(result.unrepresentedChanges).toBeUndefined();
    await expectSchemaValidPackages(result.document);
  });

  test('control: a section that also changes page size keeps one w:sectPrChange with the prior page setup', async () => {
    const original = await packageWithStories(
      paragraph('Body'),
      `<w:sectPr><w:footerReference w:type="default" r:id="${FOOTER.id}"/>${PORTRAIT}</w:sectPr>`,
      [FOOTER],
    );
    const revised = await packageWithStories(paragraph('Body'), `<w:sectPr>${LANDSCAPE}</w:sectPr>`, []);

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const archive = await DocxArchive.load(result.document);
    const documentXml = await archive.getDocumentXml();

    expect(sectPrChangeCount(documentXml)).toBe(1);
    expect(snapshotStoryReferences(documentXml)).toBe(0);
    expect(result.stats.formatChanges).toBe(1);
    const snapshot = parseXml(documentXml)
      .getElementsByTagNameNS(OOXML.W_NS, 'sectPrChange').item(0)!
      .getElementsByTagNameNS(OOXML.W_NS, 'pgSz').item(0)!;
    expect(snapshot.getAttributeNS(OOXML.W_NS, 'w')).toBe('12240');
    expect(rejectAllChanges(documentXml)).toContain('w:w="12240"');
    expect(acceptAllChanges(documentXml)).toContain('w:orient="landscape"');
    expect(result.unrepresentedChanges).toEqual([
      { scope: 'section', kind: 'changed', sectionIndex: 0 },
      { scope: 'footer', kind: 'removed', sectionIndex: 0, role: 'default' },
    ]);
    await expectSchemaValidPackages(result.document);
  });
});
