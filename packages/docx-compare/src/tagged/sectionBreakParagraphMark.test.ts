/**
 * An added or removed paragraph-level section break is recorded on the
 * paragraph mark that owns the `w:sectPr`, the way Word and Aspose record it,
 * not as a `w:sectPrChange`. The snapshot in `w:sectPrChange` is
 * `CT_SectPrBase`, which cannot carry header/footer references, and an added
 * break restored from an empty snapshot is still a live section, so neither
 * shape could be rejected faithfully (#1144).
 *
 * Every case asserts the round-trip invariant on four appliers: docx-core
 * `acceptChanges`/`rejectChanges` and docx-compare
 * `acceptAllChanges`/`rejectAllChanges` must reproduce the revised and the
 * original document respectively: paragraph text and base properties, the
 * live section count, each section's page setup, and each section's
 * header/footer bindings resolved to the bound part's text.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 * @see https://github.com/UseJunior/safe-docx/issues/1144
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptChanges,
  DocxArchive,
  OOXML,
  parseXml,
  rejectChanges,
  serializeXml,
} from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SCHEMA_GATE = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
const COMPARE_OPTIONS = {
  author: 'Comparison',
  date: new Date('2026-10-07T00:00:00.000Z'),
};

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'DOCX Comparison',
    story: 'Section Break Paragraph-Mark Revisions',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.17' },
  );

interface StoryPart {
  id: string;
  kind: 'header' | 'footer';
  target: string;
  text: string;
}

const HEADER_ONE: StoryPart = { id: 'rIdHeaderOne', kind: 'header', target: 'header1.xml', text: 'HEADER-ONE' };
const FOOTER_ONE: StoryPart = { id: 'rIdFooterOne', kind: 'footer', target: 'footer1.xml', text: 'FOOTER-ONE' };
const HEADER_TWO: StoryPart = { id: 'rIdHeaderTwo', kind: 'header', target: 'header2.xml', text: 'HEADER-TWO' };
const FOOTER_TWO: StoryPart = { id: 'rIdFooterTwo', kind: 'footer', target: 'footer2.xml', text: 'FOOTER-TWO' };

const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/>';
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const NEXT_PAGE = '<w:type w:val="nextPage"/>';

function references(...parts: StoryPart[]): string {
  return parts.map((part) =>
    `<w:${part.kind}Reference w:type="default" r:id="${part.id}"/>`).join('');
}

function section(...contents: string[]): string {
  return `<w:sectPr>${contents.join('')}</w:sectPr>`;
}

function paragraph(text: string, properties = ''): string {
  const pPr = properties ? `<w:pPr>${properties}</w:pPr>` : '';
  const run = text ? `<w:r><w:t>${text}</w:t></w:r>` : '';
  return `<w:p>${pPr}${run}</w:p>`;
}

function table(text: string): string {
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc></w:tr></w:tbl>`;
}

function storyXml(part: StoryPart): string {
  const root = part.kind === 'header' ? 'w:hdr' : 'w:ftr';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<${root} xmlns:w="${W_NS}">${paragraph(part.text)}</${root}>`;
}

/** A package whose final `w:sectPr` and story parts are supplied. */
async function packageWithStories(
  bodyXml: string,
  finalSection: string,
  parts: readonly StoryPart[],
): Promise<Buffer> {
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(bodyXml, [], { namespaces: { r: R_NS } }),
  );
  // Replace the body-level placeholder, never a paragraph's own empty w:sectPr.
  archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:sectPr/></w:body>', `${finalSection}</w:body>`));
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

const serializer = new XMLSerializer();

/** Serialize without namespace declarations or rsid attributes. */
function canonical(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  const strip = (node: Element): void => {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith('xmlns') || attribute.localName?.startsWith('rsid')) {
        node.removeAttribute(attribute.name);
      }
    }
    for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) strip(child as Element);
  };
  strip(clone);
  return serializer.serializeToString(clone);
}

function wChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === W_NS);
}

interface DocumentShape {
  paragraphs: string[];
  sections: string[];
}

/**
 * The document as a reader sees it: every paragraph's text, base properties
 * and paragraph-mark formatting, and every live section's page setup and resolved story
 * bindings (`kind:type=part text`).
 */
async function documentShape(
  archive: DocxArchive,
  documentXml: string,
  projectStory: (xml: string) => string = (xml) => xml,
): Promise<DocumentShape> {
  const document = parseXml(documentXml);
  const relationships = parseXml((await archive.getFile('word/_rels/document.xml.rels'))!);
  const targets = new Map<string, string>();
  for (const relationship of Array.from(relationships.getElementsByTagNameNS(PACKAGE_REL_NS, 'Relationship'))) {
    targets.set(relationship.getAttribute('Id')!, relationship.getAttribute('Target')!);
  }
  const body = document.getElementsByTagNameNS(W_NS, 'body').item(0)!;
  const paragraphs = Array.from(body.getElementsByTagNameNS(W_NS, 'p')).map((p) => {
    const text = Array.from(p.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent ?? '').join('');
    const pPr = wChildren(p).find((child) => child.localName === 'pPr');
    const base = pPr
      ? wChildren(pPr).filter((child) => !['rPr', 'sectPr', 'pPrChange'].includes(child.localName)).map(canonical).join('')
      : '';
    const mark = pPr && wChildren(pPr).find((child) => child.localName === 'rPr');
    const markFormatting = mark
      ? wChildren(mark).filter((child) => !['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'].includes(child.localName))
        .map(canonical).join('')
      : '';
    return `${text}|${base}|${markFormatting}`;
  });
  const sections: string[] = [];
  for (const sectPr of Array.from(body.getElementsByTagNameNS(W_NS, 'sectPr'))) {
    if ((sectPr.parentNode as Element | null)?.localName === 'sectPrChange') continue;
    const bindings: string[] = [];
    const setup: string[] = [];
    for (const child of wChildren(sectPr)) {
      if (child.localName === 'headerReference' || child.localName === 'footerReference') {
        const target = targets.get(child.getAttributeNS(R_NS, 'id') ?? '');
        expect(target, `relationship for ${canonical(child)}`).toBeDefined();
        const story = await archive.getFile(posix.join('word', target!));
        expect(story, `story part ${target}`).not.toBeNull();
        // A story bound only by a removed section is published as deleted
        // content, so it is projected with the same applier as the body.
        const storyText = Array.from(parseXml(projectStory(story!)).getElementsByTagNameNS(W_NS, 't'))
          .map((t) => t.textContent ?? '').join('');
        bindings.push(`${child.localName}:${child.getAttributeNS(W_NS, 'type')}=${storyText}`);
      } else {
        setup.push(canonical(child));
      }
    }
    sections.push(`${setup.join('')} [${bindings.sort().join(', ')}]`);
  }
  return { paragraphs, sections };
}

function nativeProjection(documentXml: string, project: (document: Document) => unknown): string {
  const document = parseXml(documentXml);
  project(document);
  return serializeXml(document);
}

/** Validate the tracked, native Accept and native Reject packages with the repository's schema gate. */
function expectSchemaValid(trackedXml: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-1144-section-break-'));
  try {
    const variants: Array<[string, string]> = [
      ['tracked', trackedXml],
      ['accepted', nativeProjection(trackedXml, acceptChanges)],
      ['rejected', nativeProjection(trackedXml, rejectChanges)],
    ];
    for (const [name, xml] of variants) writeFileSync(join(dir, `${name}.xml`), xml);
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain('3 of 3 document.xml instances validate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Side {
  body: string;
  finalSection: string;
  parts: StoryPart[];
}

interface RoundTripCase {
  label: string;
  /** The OpenSpec scenario this case evidences, if any. */
  openspec?: string;
  original: Side;
  revised: Side;
}

const ONE_SECTION_FINAL = section(references(HEADER_ONE, FOOTER_ONE), PORTRAIT);
const LANDSCAPE_FINAL = section(references(HEADER_TWO, FOOTER_TWO), LANDSCAPE);
const FIRST_SECTION = section(references(HEADER_ONE, FOOTER_ONE), NEXT_PAGE, PORTRAIT);

const SECTION_BREAK_ROUND_TRIP_CASES: readonly RoundTripCase[] = [
  {
    label: 'a removed break whose paragraph survives restores the removed section and its bindings on reject',
    openspec: 'rejecting a removed section break restores its header and footer bindings',
    original: {
      body: paragraph('First section', FIRST_SECTION) + paragraph('Second section'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE, HEADER_TWO, FOOTER_TWO],
    },
    revised: {
      body: paragraph('First section') + paragraph('Second section'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_TWO, FOOTER_TWO],
    },
  },
  {
    label: 'an added non-default break on an existing paragraph leaves the original section count on reject',
    original: {
      body: paragraph('First part') + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
    revised: {
      body: paragraph('First part', section(references(HEADER_ONE, FOOTER_ONE), NEXT_PAGE, LANDSCAPE)) +
        paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
  },
  {
    label: 'an added default break leaves no empty section on reject',
    openspec: 'rejecting an added section break leaves the original section count',
    original: {
      body: paragraph('First part') + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
    revised: {
      body: paragraph('First part', '<w:sectPr/>') + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
  },
  {
    label: 'a removed break on a paragraph whose text and alignment also change',
    original: {
      body: paragraph('First section', `<w:jc w:val="center"/>${FIRST_SECTION}`) + paragraph('Second section'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE, HEADER_TWO, FOOTER_TWO],
    },
    revised: {
      body: paragraph('First section, edited', '<w:jc w:val="right"/>') + paragraph('Second section'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_TWO, FOOTER_TWO],
    },
  },
  {
    label: 'an added break on a paragraph whose mark formatting also changes',
    original: {
      body: paragraph('First part', '<w:rPr><w:b/></w:rPr>') + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
    revised: {
      body: paragraph('First part', `<w:rPr><w:i/></w:rPr>${section(references(HEADER_ONE, FOOTER_ONE), LANDSCAPE)}`) +
        paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
  },
  {
    label: 'a removed break on an empty boundary paragraph is a deleted paragraph mark',
    original: {
      body: paragraph('First section') + paragraph('', FIRST_SECTION) + paragraph('Second section'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE, HEADER_TWO, FOOTER_TWO],
    },
    revised: {
      body: paragraph('First section') + paragraph('Second section'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_TWO, FOOTER_TWO],
    },
  },
  {
    label: 'an added break on a new empty paragraph is an inserted paragraph mark',
    original: {
      body: paragraph('First part') + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
    revised: {
      body: paragraph('First part') +
        paragraph('', section(references(HEADER_ONE, FOOTER_ONE), NEXT_PAGE, LANDSCAPE)) +
        paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE],
    },
  },
  {
    label: 'removing the middle of three breaks keeps the surrounding sections and their bindings',
    original: {
      body: paragraph('Alpha', FIRST_SECTION) +
        paragraph('Bravo', section(references(HEADER_TWO), NEXT_PAGE, LANDSCAPE)) +
        paragraph('Charlie'),
      finalSection: section(references(FOOTER_TWO), PORTRAIT),
      parts: [HEADER_ONE, FOOTER_ONE, HEADER_TWO, FOOTER_TWO],
    },
    revised: {
      body: paragraph('Alpha', FIRST_SECTION) + paragraph('Bravo') + paragraph('Charlie'),
      finalSection: section(references(FOOTER_TWO), PORTRAIT),
      parts: [HEADER_ONE, FOOTER_ONE, FOOTER_TWO],
    },
  },
  {
    label: 'a removed break before a table',
    original: {
      body: paragraph('First section', FIRST_SECTION) + table('Cell') + paragraph('After the table'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE, HEADER_TWO, FOOTER_TWO],
    },
    revised: {
      body: paragraph('First section') + table('Cell') + paragraph('After the table'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_TWO, FOOTER_TWO],
    },
  },
];

async function sidePackage(side: Side): Promise<Buffer> {
  return packageWithStories(side.body, side.finalSection, side.parts);
}

async function sideShape(side: Side): Promise<DocumentShape> {
  const archive = await DocxArchive.load(await sidePackage(side));
  return documentShape(archive, await archive.getDocumentXml());
}

describe('section-break inserts and deletes are paragraph-mark revisions (#1144)', () => {
  for (const scenario of SECTION_BREAK_ROUND_TRIP_CASES) {
    const caseTest = scenario.openspec ? test.openspec(scenario.openspec) : test;
    caseTest(`${scenario.label}: accept-all reproduces the revised and reject-all the original document`, async () => {
      const result = await compareDocumentsAtomizer(
        await sidePackage(scenario.original),
        await sidePackage(scenario.revised),
        COMPARE_OPTIONS,
      );
      const archive = await DocxArchive.load(result.document);
      const trackedXml = await archive.getDocumentXml();

      // The break change is not a section-property change.
      expect(parseXml(trackedXml).getElementsByTagNameNS(W_NS, 'sectPrChange').length).toBe(0);

      const original = await sideShape(scenario.original);
      const revised = await sideShape(scenario.revised);
      expect(original.sections.length).not.toBe(revised.sections.length);
      const appliers: Array<[string, (xml: string) => string, DocumentShape]> = [
        ['docx-core acceptChanges', (xml) => nativeProjection(xml, acceptChanges), revised],
        ['docx-compare acceptAllChanges', acceptAllChanges, revised],
        ['docx-core rejectChanges', (xml) => nativeProjection(xml, rejectChanges), original],
        ['docx-compare rejectAllChanges', rejectAllChanges, original],
      ];
      for (const [applier, project, expected] of appliers) {
        expect(await documentShape(archive, project(trackedXml), project), applier).toEqual(expected);
      }
      expectSchemaValid(trackedXml);
    });
  }

  test('a removed break is published as a deleted mark carrying the full original w:sectPr', async () => {
    const [scenario] = SECTION_BREAK_ROUND_TRIP_CASES;
    const result = await compareDocumentsAtomizer(
      await sidePackage(scenario!.original),
      await sidePackage(scenario!.revised),
      COMPARE_OPTIONS,
    );
    const document = parseXml(await (await DocxArchive.load(result.document)).getDocumentXml());
    const body = document.getElementsByTagNameNS(W_NS, 'body').item(0)!;
    const [content, boundary] = wChildren(body).filter((child) => child.localName === 'p');
    const markOf = (p: Element): Element =>
      wChildren(wChildren(p).find((child) => child.localName === 'pPr')!).find((child) => child.localName === 'rPr')!;
    // The surviving content keeps the revised, inserted mark and no section.
    expect(wChildren(markOf(content!)).map((child) => child.localName)).toEqual(['ins']);
    expect(content!.getElementsByTagNameNS(W_NS, 'sectPr').length).toBe(0);
    // The empty boundary owns the deleted mark and the whole original section.
    expect(boundary!.getElementsByTagNameNS(W_NS, 't').length).toBe(0);
    expect(wChildren(markOf(boundary!)).map((child) => child.localName)).toEqual(['del']);
    const sectPr = boundary!.getElementsByTagNameNS(W_NS, 'sectPr').item(0)!;
    expect(wChildren(sectPr).map((child) => child.localName)).toEqual([
      'headerReference', 'footerReference', 'type', 'pgSz',
    ]);
    // The paragraph base properties did not change, so no pPrChange is emitted.
    expect(document.getElementsByTagNameNS(W_NS, 'pPrChange').length).toBe(0);
    expect(result.stats.formatChanges).toBe(1);
  });

  test('an added break is published as an inserted mark carrying the revised w:sectPr', async () => {
    const scenario = SECTION_BREAK_ROUND_TRIP_CASES[1]!;
    const result = await compareDocumentsAtomizer(
      await sidePackage(scenario.original),
      await sidePackage(scenario.revised),
      COMPARE_OPTIONS,
    );
    const document = parseXml(await (await DocxArchive.load(result.document)).getDocumentXml());
    const body = document.getElementsByTagNameNS(W_NS, 'body').item(0)!;
    const [content, boundary] = wChildren(body).filter((child) => child.localName === 'p');
    const sectPr = content!.getElementsByTagNameNS(W_NS, 'sectPr').item(0)!;
    expect(wChildren(sectPr).map((child) => child.localName)).toEqual([
      'headerReference', 'footerReference', 'type', 'pgSz',
    ]);
    expect(content!.getElementsByTagNameNS(W_NS, 'ins').length).toBe(1);
    expect(boundary!.getElementsByTagNameNS(W_NS, 'sectPr').length).toBe(0);
    expect(boundary!.getElementsByTagNameNS(W_NS, 'del').length).toBe(1);
    expect(boundary!.getElementsByTagNameNS(W_NS, 't').length).toBe(0);
  });

  test.openspec('a page-setup change to an existing section keeps w:sectPrChange')(
    'a page-setup change to a section present on both sides keeps w:sectPrChange', async () => {
    const original: Side = {
      body: paragraph('First section', FIRST_SECTION) + paragraph('Second section'),
      finalSection: LANDSCAPE_FINAL,
      parts: [HEADER_ONE, FOOTER_ONE, HEADER_TWO, FOOTER_TWO],
    };
    const revised: Side = {
      ...original,
      body: paragraph('First section', section(references(HEADER_ONE, FOOTER_ONE), NEXT_PAGE, LANDSCAPE)) +
        paragraph('Second section'),
    };
    const result = await compareDocumentsAtomizer(
      await sidePackage(original),
      await sidePackage(revised),
      COMPARE_OPTIONS,
    );
    const archive = await DocxArchive.load(result.document);
    const trackedXml = await archive.getDocumentXml();
    const document = parseXml(trackedXml);
    expect(document.getElementsByTagNameNS(W_NS, 'sectPrChange').length).toBe(1);
    const body = document.getElementsByTagNameNS(W_NS, 'body').item(0)!;
    expect(wChildren(body).filter((child) => child.localName === 'p')).toHaveLength(2);
    expect(await documentShape(archive, rejectAllChanges(trackedXml), rejectAllChanges))
      .toEqual(await sideShape(original));
    expect(await documentShape(archive, acceptAllChanges(trackedXml), acceptAllChanges))
      .toEqual(await sideShape(revised));
  });
});
