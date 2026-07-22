import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { childElements } from '../primitives/dom-helpers.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { auditSectPr } from '../primitives/sectPrAudit.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec, HeaderFooterSpec } from './types.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function header(text: string): HeaderFooterSpec {
  return { blocks: [{ kind: 'paragraph', alignment: 'center', runs: [{ kind: 'text', text }] }] };
}

function pageXofYFooter(): HeaderFooterSpec {
  return {
    blocks: [
      {
        kind: 'paragraph',
        alignment: 'center',
        runs: [
          { kind: 'text', text: 'Page ' },
          { kind: 'field', field: 'PAGE', cachedResult: '1' },
          { kind: 'text', text: ' of ' },
          { kind: 'field', field: 'NUMPAGES', cachedResult: '2' },
        ],
      },
    ],
  };
}

/** Cover page (distinct first header, no footer) flowing into body pages. */
function coverBodySpec(): DocumentSpec {
  return {
    meta: { title: 'Cover-body acceptance', createdIso: '2026-06-10T00:00:00Z' },
    sections: [
      {
        headers: { first: header('CONFIDENTIAL — DRAFT'), default: header('Acme / Northeast — Mutual NDA') },
        footers: { default: pageXofYFooter() },
        pageNumbering: { start: 1, format: 'decimal' },
        blocks: [
          { kind: 'paragraph', alignment: 'center', runs: [{ kind: 'text', text: 'MUTUAL NONDISCLOSURE AGREEMENT', bold: true, sizePt: 16 }] },
          { kind: 'paragraph', runs: [{ kind: 'break', breakType: 'page' }, { kind: 'text', text: 'Body text after the cover page.' }] },
        ],
      },
    ],
  };
}

function twoSectionSpec(): DocumentSpec {
  return {
    sections: [
      {
        page: { sizeTwips: { w: 12240, h: 15840 } },
        blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Portrait section.' }] }],
      },
      {
        breakType: 'nextPage',
        page: { sizeTwips: { w: 12240, h: 15840 }, orientation: 'landscape' },
        blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Landscape section.' }] }],
      },
    ],
  };
}

async function loadPart(buffer: Buffer, part: string): Promise<Document> {
  const xml = await readZipText(buffer, part);
  expect(xml, `${part} missing from package`).not.toBeNull();
  return parseXml(xml!);
}

async function mutatePackage(buffer: Buffer, mutate: (zip: JSZip) => void | Promise<void>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  await mutate(zip);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

describe('Traceability: multi-section documents, headers/footers, and fields', () => {
  test
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    )(
    'validates expanded names, explicit roles, absolute targets, and unique relationship ids',
    async ({ then }: AllureBddContext) => {
      const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const pr = 'http://schemas.openxmlformats.org/package/2006/relationships';
      const documentXml = `<wp:document xmlns:wp="${w}" xmlns:rel="${r}"><wp:body><wp:sectPr><wp:headerReference wp:type="default" rel:id="rId1"/></wp:sectPr></wp:body></wp:document>`;
      const relationships = `<Relationships xmlns="${pr}"><Relationship Id="rId1" Type="${r}/header" Target="header1.xml"/></Relationships>`;

      await then('valid alternate prefixes are accepted by namespace URI and local name', () => {
        const result = auditSectPr(documentXml, relationships, new Map([
          ['word/header1.xml', `<alt:hdr xmlns:alt="${w}"/>`],
        ]));
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
        expect(result.stats.referenceCount).toBe(1);
      });

      await then('prefixed package relationships are matched by namespace URI and local name', () => {
        const prefixedRelationships = `<pr:Relationships xmlns:pr="${pr}"><pr:Relationship Id="rId1" Type="${r}/header" Target="header1.xml"/></pr:Relationships>`;
        const result = auditSectPr(documentXml, prefixedRelationships, new Map([
          ['word/header1.xml', `<wp:hdr xmlns:wp="${w}"/>`],
        ]));
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
        expect(result.stats.referenceCount).toBe(1);
      });

      await then('a package Relationship prefix bound to the wrong namespace is ignored', () => {
        const spoofedRelationships = `<pr:Relationships xmlns:pr="urn:not-package-relationships"><pr:Relationship Id="rId1" Type="${r}/header" Target="header1.xml"/></pr:Relationships>`;
        const result = auditSectPr(documentXml, spoofedRelationships, new Map([
          ['word/header1.xml', `<wp:hdr xmlns:wp="${w}"/>`],
        ]));
        expect(result.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'sectpr_reference_dangling_rid', rid: 'rId1' })]),
        );
      });

      await then('a familiar prefix bound to the wrong namespace is rejected', () => {
        const result = auditSectPr(documentXml, relationships, new Map([
          ['word/header1.xml', '<w:hdr xmlns:w="urn:not-wordprocessingml"/>'],
        ]));
        expect(result.issues.map((issue) => issue.type)).toContain('sectpr_reference_wrong_target_root');
      });

      await then('missing and invalid reference roles are rejected', () => {
        for (const typeAttribute of ['', ' wp:type="odd"']) {
          const invalidDocument = documentXml.replace(' wp:type="default"', typeAttribute);
          const result = auditSectPr(invalidDocument, relationships);
          expect(result.issues.map((issue) => issue.type)).toContain('sectpr_reference_invalid_type');
        }
      });

      await then('missing and invalid footer roles are rejected', () => {
        const footerDocument = documentXml.replace('headerReference', 'footerReference');
        const footerRelationships = relationships.replace(`${r}/header`, `${r}/footer`).replace('header1.xml', 'footer1.xml');
        for (const typeAttribute of ['', ' wp:type="odd"']) {
          const invalidDocument = footerDocument.replace(' wp:type="default"', typeAttribute);
          const result = auditSectPr(invalidDocument, footerRelationships);
          expect(result.issues).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: 'sectpr_reference_invalid_type' })]),
          );
        }
      });

      await then('external header and footer relationship targets are rejected', () => {
        for (const kind of ['header', 'footer']) {
          const referenceDocument = documentXml.replace('headerReference', `${kind}Reference`);
          const externalRelationships = relationships
            .replace(`${r}/header`, `${r}/${kind}`)
            .replace('Target="header1.xml"', 'Target="https://example.test/story.xml" TargetMode="External"');
          const result = auditSectPr(referenceDocument, externalRelationships);
          expect(result.issues).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: 'sectpr_reference_wrong_relationship_type', rid: 'rId1' })]),
          );
        }
      });

      await then('a package-absolute relationship target resolves from the package root', () => {
        const absoluteRelationships = relationships.replace('Target="header1.xml"', 'Target="/word/header1.xml"');
        const result = auditSectPr(documentXml, absoluteRelationships, new Map([
          ['word/header1.xml', `<wp:hdr xmlns:wp="${w}"/>`],
        ]));
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      });

      await then('duplicate relationship ids are rejected deterministically', () => {
        const duplicateRelationships = relationships.replace(
          '</Relationships>',
          `<Relationship Id="rId1" Type="${r}/footer" Target="footer1.xml"/></Relationships>`,
        );
        const result = auditSectPr(documentXml, duplicateRelationships);
        expect(result.issues.filter((issue) => issue.type === 'sectpr_duplicate_relationship_id')).toEqual([
          expect.objectContaining({ rid: 'rId1' }),
        ]);

        const reversed = duplicateRelationships.replace(
          /(<Relationship Id="rId1"[^>]+\/>)(<Relationship Id="rId1"[^>]+\/>)/,
          '$2$1',
        );
        expect(auditSectPr(documentXml, reversed).issues.filter(
          (issue) => issue.type === 'sectpr_duplicate_relationship_id',
        )).toEqual([expect.objectContaining({ rid: 'rId1' })]);
      });

      await then('duplicate header and footer roles within one section are rejected', () => {
        for (const kind of ['header', 'footer']) {
          const duplicateDocument = documentXml.replace(
            /<wp:headerReference[^>]+\/>/,
            `<wp:${kind}Reference wp:type="default" rel:id="rId1"/><wp:${kind}Reference wp:type="default" rel:id="rId1"/>`,
          );
          expect(auditSectPr(duplicateDocument, relationships).issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: 'sectpr_duplicate_reference_type' }),
            ]),
          );
        }
      });

      await then('relative and package-absolute targets normalize dot segments without escaping the package', () => {
        const parts = new Map([['word/header1.xml', `<wp:hdr xmlns:wp="${w}"/>`]]);
        for (const target of ['./headers/../header1.xml', '/word/./headers/../header1.xml']) {
          const normalizedRelationships = relationships.replace('header1.xml', target);
          expect(auditSectPr(documentXml, normalizedRelationships, parts).ok).toBe(true);
        }

        const escapingRelationships = relationships.replace('header1.xml', '/../../header1.xml');
        expect(auditSectPr(documentXml, escapingRelationships, parts).issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'sectpr_reference_invalid_target' })]),
        );
      });

      await then('fragment-bearing targets are rejected as outside the supported OPC target model', () => {
        const fragmentRelationships = relationships.replace('header1.xml', 'header1.xml#section');
        const result = auditSectPr(documentXml, fragmentRelationships, new Map([
          ['word/header1.xml', `<wp:hdr xmlns:wp="${w}"/>`],
        ]));
        expect(result.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'sectpr_reference_invalid_target' })]),
        );
      });
    },
  );
  test
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    )(
    'resolves header and footer roles through document relationships and target parts',
    async ({ given, when, then }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('two sections using all roles, including a relationship reused by both sections', async () => {
        const repeated = header('Shared default header');
        buffer = await generateDocx({
          sections: [
            {
              headers: { first: header('First A'), default: repeated, even: header('Even A') },
              footers: { first: header('First footer A'), default: header('Default footer A'), even: header('Even footer A') },
              blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Section A' }] }],
            },
            {
              headers: { default: repeated },
              blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Section B' }] }],
            },
          ],
        });
        buffer = await mutatePackage(buffer, async (zip) => {
          const xml = await zip.file('word/document.xml')!.async('text');
          const defaults = [...xml.matchAll(/<w:headerReference[^>]*w:type="default"[^>]*r:id="([^"]+)"[^>]*\/>/g)];
          expect(defaults).toHaveLength(2);
          zip.file('word/document.xml', xml.replace(defaults[1]![0], defaults[1]![0].replace(defaults[1]![1]!, defaults[0]![1]!)));
        });
      });

      await when('the intact package is checked', async () => {
        const result = await checkGeneratedPackage(buffer);
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      });

      await then('missing optional first/even roles remain valid', async () => {
        const result = await checkGeneratedPackage(await generateDocx(coverBodySpec()));
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      });

      await then('a header reference bound to a footer relationship is rejected', async () => {
        const tampered = await mutatePackage(buffer, async (zip) => {
          const xml = await zip.file('word/_rels/document.xml.rels')!.async('text');
          zip.file('word/_rels/document.xml.rels', xml.replace('/relationships/header', '/relationships/footer'));
        });
        const result = await checkGeneratedPackage(tampered);
        expect(result.issues.some((issue) => issue.message.includes('sectpr_reference_wrong_relationship_type'))).toBe(true);
      });

      await then('a footer reference bound to a header relationship is rejected', async () => {
        const tampered = await mutatePackage(buffer, async (zip) => {
          const xml = await zip.file('word/_rels/document.xml.rels')!.async('text');
          zip.file('word/_rels/document.xml.rels', xml.replace('/relationships/footer', '/relationships/header'));
        });
        const result = await checkGeneratedPackage(tampered);
        expect(result.issues.some((issue) => issue.message.includes('sectpr_reference_wrong_relationship_type'))).toBe(true);
      });

      await then('a reference whose relationship id is absent is rejected', async () => {
        const tampered = await mutatePackage(buffer, async (zip) => {
          const xml = await zip.file('word/document.xml')!.async('text');
          zip.file('word/document.xml', xml.replace(/r:id="rId\d+"/, 'r:id="rIdMissing"'));
        });
        const result = await checkGeneratedPackage(tampered);
        expect(result.issues.some((issue) => issue.message.includes('sectpr_reference_dangling_rid'))).toBe(true);
      });

      await then('missing and wrong-root target parts are rejected', async () => {
        const zip = await JSZip.loadAsync(buffer);
        const headerXml = await zip.file('word/header1.xml')!.async('text');
        zip.file('word/header1.xml', headerXml.replace('<w:hdr', '<w:ftr').replace('</w:hdr>', '</w:ftr>'));
        let result = await checkGeneratedPackage((await zip.generateAsync({ type: 'nodebuffer' })) as Buffer);
        expect(result.issues.some((issue) => issue.message.includes('sectpr_reference_wrong_target_root'))).toBe(true);

        zip.remove('word/header1.xml');
        result = await checkGeneratedPackage((await zip.generateAsync({ type: 'nodebuffer' })) as Buffer);
        expect(result.issues.some((issue) => issue.message.includes('sectpr_reference_missing_target_part'))).toBe(true);
      });
    },
  );
  test
    .openspec('[SDX-GEN-021] non-final sections end with a dedicated break paragraph')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.17' },
    )(
    'Scenario: non-final sections end with a dedicated break paragraph',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a spec with two sections', async () => {
        buffer = await generateDocx(twoSectionSpec());
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
      });

      let bodyKids!: Element[];
      await when('the document body is parsed', async () => {
        const doc = await loadPart(buffer, 'word/document.xml');
        bodyKids = childElements(doc.getElementsByTagName('w:body').item(0)!);
      });

      await then('the first section ends with a paragraph whose pPr contains only its sectPr', async () => {
        const breakParagraph = bodyKids[1]!;
        expect(breakParagraph.tagName).toBe('w:p');
        const pPrKids = childElements(childElements(breakParagraph)[0]!);
        await attachPrettyJson('break-paragraph-ppr-children', pPrKids.map((k) => k.tagName));
        expect(childElements(breakParagraph)).toHaveLength(1);
        expect(pPrKids.map((k) => k.tagName)).toEqual(['w:sectPr']);
        const pgSz = pPrKids[0]!.getElementsByTagName('w:pgSz').item(0)!;
        expect(pgSz.getAttribute('w:orient')).toBeNull();
      });

      await then('the final section keeps its sectPr as the body last child, carrying the landscape setup', async () => {
        const last = bodyKids[bodyKids.length - 1]!;
        expect(last.tagName).toBe('w:sectPr');
        const pgSz = last.getElementsByTagName('w:pgSz').item(0)!;
        expect(pgSz.getAttribute('w:orient')).toBe('landscape');
        const type = last.getElementsByTagName('w:type').item(0)!;
        expect(type.getAttribute('w:val')).toBe('nextPage');
      });
    },
  );

  test
    .openspec('[SDX-GEN-022] a distinct cover-page header uses the title-page switch')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.6' })(
    'Scenario: a distinct cover-page header uses the title-page switch',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a section with a first header differing from its default header', async () => {
        buffer = await generateDocx(coverBodySpec());
      });

      let sectPr!: Element;
      await when('the section properties are parsed', async () => {
        const doc = await loadPart(buffer, 'word/document.xml');
        sectPr = doc.getElementsByTagName('w:sectPr').item(0)!;
      });

      await then('w:titlePg is present alongside first and default header references', async () => {
        expect(sectPr.getElementsByTagName('w:titlePg')).toHaveLength(1);
        const refs = Array.from(sectPr.getElementsByTagName('w:headerReference')).map((r) => r.getAttribute('w:type'));
        await attachPrettyJson('header-reference-types', refs);
        expect(refs).toContain('first');
        expect(refs).toContain('default');
      });
    },
  );

  test
    .openspec('[SDX-GEN-023] header and footer parts are fully wired')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.4' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.3' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    )(
    'Scenario: header and footer parts are fully wired',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a section declaring headers and a footer', async () => {
        buffer = await generateDocx(coverBodySpec());
      });

      let zipNames!: string[];
      await when('the package contents are listed', async () => {
        const zip = await JSZip.loadAsync(buffer);
        zipNames = Object.keys(zip.files);
        await attachPrettyJson('package-parts', zipNames.sort());
      });

      await then('each declared header/footer exists as its own part with a content-type override', async () => {
        expect(zipNames).toContain('word/header1.xml');
        expect(zipNames).toContain('word/header2.xml');
        expect(zipNames).toContain('word/footer1.xml');
        const contentTypes = (await readZipText(buffer, '[Content_Types].xml'))!;
        expect(contentTypes).toContain('/word/header1.xml');
        expect(contentTypes).toContain('wordprocessingml.footer+xml');
      });

      await then('every reference r:id resolves and the structural checks pass', async () => {
        const result = await checkGeneratedPackage(buffer);
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      });
    },
  );

  test
    .openspec('[SDX-GEN-024] page numbering format and start are honored')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.12' })(
    'Scenario: page numbering format and start are honored',
    async ({ given, when, then }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a section specifying a page-number format and start value', async () => {
        const spec = twoSectionSpec();
        spec.sections[1]!.pageNumbering = { start: 5, format: 'lowerRoman' };
        buffer = await generateDocx(spec);
      });

      let finalSectPr!: Element;
      await when('the final section properties are parsed', async () => {
        const doc = await loadPart(buffer, 'word/document.xml');
        const body = doc.getElementsByTagName('w:body').item(0)!;
        const kids = childElements(body);
        finalSectPr = kids[kids.length - 1]!;
      });

      await then('w:pgNumType carries the requested start and format', async () => {
        const pgNumType = finalSectPr.getElementsByTagName('w:pgNumType').item(0)!;
        expect(pgNumType.getAttribute('w:start')).toBe('5');
        expect(pgNumType.getAttribute('w:fmt')).toBe('lowerRoman');
      });
    },
  );

  test
    .openspec('[SDX-GEN-030] a PAGE field is structurally complete')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.44' },
    )(
    'Scenario: a PAGE field is structurally complete',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let footerXml!: string;
      await given('a footer paragraph containing a PAGE field with cached result "1"', async () => {
        const buffer = await generateDocx(coverBodySpec());
        footerXml = (await readZipText(buffer, 'word/footer1.xml'))!;
        await attachPrettyXml('word/footer1.xml', footerXml);
      });

      let sequence!: string[];
      await when('the footer run sequence is flattened', async () => {
        const doc = parseXml(footerXml);
        sequence = Array.from(doc.getElementsByTagName('*'))
          .filter((el) => el.tagName === 'w:fldChar' || el.tagName === 'w:instrText' || el.tagName === 'w:t')
          .map((el) =>
            el.tagName === 'w:fldChar' ? `fldChar:${el.getAttribute('w:fldCharType')}` : `${el.tagName}:${el.textContent}`,
          );
      });

      await then('the PAGE field appears as begin → instruction → separate → cached result → end', async () => {
        const pageStart = sequence.indexOf('w:instrText: PAGE ');
        expect(pageStart).toBeGreaterThan(0);
        expect(sequence[pageStart - 1]).toBe('fldChar:begin');
        expect(sequence.slice(pageStart + 1, pageStart + 4)).toEqual(['fldChar:separate', 'w:t:1', 'fldChar:end']);
      });
    },
  );

  test
    .openspec('[SDX-GEN-031] a NUMPAGES field carries its cached result')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.42' })(
    'Scenario: a NUMPAGES field carries its cached result',
    async ({ given, when, then }: AllureBddContext) => {
      let sequence!: string[];
      await given('a footer composed of PAGE and NUMPAGES fields with cached results', async () => {
        const buffer = await generateDocx(coverBodySpec());
        const doc = parseXml((await readZipText(buffer, 'word/footer1.xml'))!);
        sequence = Array.from(doc.getElementsByTagName('*'))
          .filter((el) => el.tagName === 'w:fldChar' || el.tagName === 'w:instrText' || el.tagName === 'w:t')
          .map((el) =>
            el.tagName === 'w:fldChar' ? `fldChar:${el.getAttribute('w:fldCharType')}` : `${el.tagName}:${el.textContent}`,
          );
      });

      let numpagesStart!: number;
      await when('the NUMPAGES instruction is located', async () => {
        numpagesStart = sequence.indexOf('w:instrText: NUMPAGES ');
        expect(numpagesStart).toBeGreaterThan(0);
      });

      await then('both fields are complete five-part sequences rendering the cached text', async () => {
        expect(sequence[numpagesStart - 1]).toBe('fldChar:begin');
        expect(sequence.slice(numpagesStart + 1, numpagesStart + 4)).toEqual(['fldChar:separate', 'w:t:2', 'fldChar:end']);
        expect(sequence.filter((s) => s === 'fldChar:begin')).toHaveLength(2);
        expect(sequence.filter((s) => s === 'fldChar:end')).toHaveLength(2);
      });
    },
  );

  test
    .openspec('[SDX-GEN-032] field pairing holds in every story part')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' })(
      'Scenario: field pairing holds in every story part',
      async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
        let buffer!: Buffer;
        await given('a generated package with fields in its footer story', async () => {
          buffer = await generateDocx(coverBodySpec());
        });

        await when('the structural field-pairing check scans every story part', async () => {
          const result = await checkGeneratedPackage(buffer);
          expect(result.ok, JSON.stringify(result.issues)).toBe(true);
        });

        await then('removing a fldChar end from the footer is detected as an unclosed field', async () => {
          const zip = await JSZip.loadAsync(buffer);
          const footer = await zip.file('word/footer1.xml')!.async('text');
          const tampered = footer.replace(/<w:r><w:fldChar w:fldCharType="end"\/><\/w:r>/, '');
          expect(tampered).not.toBe(footer);
          zip.file('word/footer1.xml', tampered);
          const result = await checkGeneratedPackage((await zip.generateAsync({ type: 'nodebuffer' })) as Buffer);
          await attachPrettyJson('tampered-field-result', result);
          expect(result.ok).toBe(false);
          expect(result.issues.some((i) => i.check === 'field_pairing' && i.part === 'word/footer1.xml')).toBe(true);
        });
      },
    );

  test('cover→body acceptance artifact is written for the manual compatibility matrix', async () => {
    const buffer = await generateDocx(coverBodySpec());
    expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
    const { writeIntegrationArtifact } = await import('../integration/output-artifacts.js');
    const outputPath = await writeIntegrationArtifact('generation-phase3-cover-body.docx', buffer);
    expect(outputPath).toContain('generation-phase3-cover-body.docx');
  });
});
