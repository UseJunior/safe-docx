import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acceptChanges } from '../primitives/accept_changes.js';
import { rejectChanges } from '../primitives/reject_changes.js';
import { parseXml, serializeXml } from '../primitives/xml.js';
import { OOXML } from '../primitives/namespaces.js';
import { DocxDocument } from '../primitives/document.js';
import { createZipBuffer, readZipText } from '../primitives/zip.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Advanced Revision Classification',
});

const W_NS = OOXML.W_NS;
const metadata = 'q:id="7" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"';

function documentWith(body: string): Document {
  return parseXml(
    `<q:document xmlns:q="${W_NS}"><q:body>${body}</q:body></q:document>`,
  );
}

function count(doc: Document, localName: string): number {
  return doc.getElementsByTagNameNS(W_NS, localName).length;
}

describe('ECMA-376 advanced revision records', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      'accepts and rejects all six supported property-change record shapes with namespace aliases',
      async ({ given, when, then, and }: AllureBddContext) => {
        const cases = [
          { local: 'rPrChange', current: 'rPr', old: '<q:i/>', shape: (change: string) => `<q:p><q:r><q:rPr><q:b/>${change}</q:rPr><q:t>x</q:t></q:r></q:p>` },
          { local: 'pPrChange', current: 'pPr', old: '<q:keepNext/>', shape: (change: string) => `<q:p><q:pPr><q:jc q:val="center"/>${change}</q:pPr><q:r><q:t>x</q:t></q:r></q:p>` },
          { local: 'sectPrChange', current: 'sectPr', old: '<q:pgSz q:w="100" q:h="200"/>', shape: (change: string) => `<q:p><q:pPr><q:sectPr><q:pgSz q:w="200" q:h="300"/>${change}</q:sectPr></q:pPr></q:p>` },
          { local: 'tblPrChange', current: 'tblPr', old: '<q:tblStyle q:val="Old"/>', shape: (change: string) => `<q:tbl><q:tblPr><q:tblStyle q:val="New"/>${change}</q:tblPr><q:tr><q:tc><q:p/></q:tc></q:tr></q:tbl>` },
          { local: 'trPrChange', current: 'trPr', old: '<q:cantSplit/>', shape: (change: string) => `<q:tbl><q:tr><q:trPr><q:tblHeader/>${change}</q:trPr><q:tc><q:p/></q:tc></q:tr></q:tbl>` },
          { local: 'tcPrChange', current: 'tcPr', old: '<q:tcW q:w="100" q:type="dxa"/>', shape: (change: string) => `<q:tbl><q:tr><q:tc><q:tcPr><q:tcW q:w="200" q:type="dxa"/>${change}</q:tcPr><q:p/></q:tc></q:tr></q:tbl>` },
        ];

        await given('six existing property-change records written with a non-w WordprocessingML prefix', () => {});

        for (const revision of cases) {
          const change = `<q:${revision.local} ${metadata}><q:${revision.current}>${revision.old}</q:${revision.current}></q:${revision.local}>`;
          const accepted = documentWith(revision.shape(change));
          const rejected = documentWith(revision.shape(change));

          await when(`${revision.local} is accepted and rejected`, () => {
            acceptChanges(accepted);
            rejectChanges(rejected);
          });

          await then(`accept removes ${revision.local} while retaining current properties`, () => {
            expect(count(accepted, revision.local)).toBe(0);
          });

          await and(`reject restores the prior ${revision.current} snapshot`, () => {
            expect(count(rejected, revision.local)).toBe(0);
            expect(serializeXml(rejected)).toContain(revision.old);
          });
        }
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.21' })(
      'resolves move content while removing range markers without claiming pair semantics',
      async ({ given, when, then, and }: AllureBddContext) => {
        const body =
          `<q:p>` +
          `<q:moveFromRangeStart ${metadata} q:name="source"/>` +
          `<q:moveFrom ${metadata}><q:r><q:delText>source</q:delText></q:r></q:moveFrom>` +
          `<q:moveFromRangeEnd q:id="7"/>` +
          `<q:moveToRangeStart ${metadata} q:name="dest"/>` +
          `<q:moveTo ${metadata}><q:r><q:t>destination</q:t></q:r></q:moveTo>` +
          `<q:moveToRangeEnd q:id="7"/>` +
          `</q:p>`;
        const accepted = documentWith(body);
        const rejected = documentWith(body);

        await given('paired move wrappers and range milestones using a namespace alias', () => {});
        await when('the move is accepted and rejected', () => {
          acceptChanges(accepted);
          rejectChanges(rejected);
        });
        await then('accept keeps destination content and drops source content', () => {
          expect(serializeXml(accepted)).toContain('destination');
          expect(serializeXml(accepted)).not.toContain('source');
        });
        await and('reject keeps source content and drops destination content', () => {
          expect(serializeXml(rejected)).toContain('source');
          expect(serializeXml(rejected)).not.toContain('destination');
        });
        await and('both projections remove move wrappers and range milestones', () => {
          for (const local of ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']) {
            expect(count(accepted, local)).toBe(0);
            expect(count(rejected, local)).toBe(0);
          }
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      'preserves adjacent custom XML, bookmark, comment, permission, and proofing markup',
      async ({ given, when, then }: AllureBddContext) => {
        const markers =
          `<q:customXmlInsRangeStart ${metadata}/><q:customXmlInsRangeEnd q:id="7"/>` +
          `<q:bookmarkStart q:id="8" q:name="b"/><q:bookmarkEnd q:id="8"/>` +
          `<q:commentRangeStart q:id="9"/><q:commentRangeEnd q:id="9"/>` +
          `<q:permStart q:id="10" q:edGrp="everyone"/><q:permEnd q:id="10"/>` +
          `<q:proofErr q:type="spellStart"/>`;
        const accepted = documentWith(`<q:p>${markers}<q:ins ${metadata}><q:r><q:t>x</q:t></q:r></q:ins></q:p>`);
        const rejected = documentWith(`<q:p>${markers}<q:del ${metadata}><q:r><q:delText>x</q:delText></q:r></q:del></q:p>`);

        await given('advanced range and annotation markup adjacent to ordinary revisions', () => {});
        await when('ordinary insertions and deletions are resolved', () => {
          acceptChanges(accepted);
          rejectChanges(rejected);
        });
        await then('the non-semantic interaction markers remain in both outputs', () => {
          for (const local of ['customXmlInsRangeStart', 'customXmlInsRangeEnd', 'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'permStart', 'permEnd', 'proofErr']) {
            expect(count(accepted, local)).toBe(1);
            expect(count(rejected, local)).toBe(1);
          }
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      'leaves unsupported numbering and table-grid records unresolved',
      async ({ given, when, then }: AllureBddContext) => {
        const records =
          `<q:p><q:pPr><q:numPr><q:numberingChange ${metadata}/></q:numPr></q:pPr></q:p>` +
          `<q:tbl><q:tblPr><q:tblPrExChange ${metadata}><q:tblPrEx/></q:tblPrExChange></q:tblPr>` +
          `<q:tblGrid><q:tblGridChange ${metadata}><q:tblGrid/></q:tblGridChange></q:tblGrid><q:tr><q:tc><q:p/></q:tc></q:tr></q:tbl>`;
        const accepted = documentWith(records);
        const rejected = documentWith(records);

        await given('schema vocabulary that the resolver recognizes but does not implement', () => {});
        await when('accept and reject are run', () => {
          acceptChanges(accepted);
          rejectChanges(rejected);
        });
        await then('the records remain, making the conformance gap executable and visible', () => {
          for (const local of ['numberingChange', 'tblPrExChange', 'tblGridChange']) {
            expect(count(accepted, local)).toBe(1);
            expect(count(rejected, local)).toBe(1);
          }
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      'sweeps fixed side stories while preserving header and footer revisions',
      async ({ given, when, then, and }: AllureBddContext) => {
        const revision = `<w:ins w:id="7" w:author="Reviewer" w:date="2026-07-20T12:00:00Z"><w:r><w:t>tracked</w:t></w:r></w:ins>`;
        const packageBytes = await createZipBuffer({
          '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
          '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
          'word/document.xml': `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
          'word/footnotes.xml': `<w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="2"><w:p>${revision}</w:p></w:footnote></w:footnotes>`,
          'word/header1.xml': `<w:hdr xmlns:w="${W_NS}"><w:p>${revision}</w:p></w:hdr>`,
          'word/footer1.xml': `<w:ftr xmlns:w="${W_NS}"><w:p>${revision}</w:p></w:ftr>`,
        });

        await given('a DOCX with the same insertion in a swept note story and unswept header/footer stories', () => {});
        const doc = await DocxDocument.load(packageBytes);
        await when('package-wide accept is applied', async () => {
          await doc.acceptChanges();
        });
        const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
        const footnotes = await readZipText(buffer, 'word/footnotes.xml');
        const header = await readZipText(buffer, 'word/header1.xml');
        const footer = await readZipText(buffer, 'word/footer1.xml');

        await then('the fixed footnote story has its insertion resolved', () => {
          expect(footnotes).not.toContain('<w:ins');
          expect(footnotes).toContain('tracked');
        });
        await and('header and footer revisions remain preservation-only', () => {
          expect(header).toContain('<w:ins');
          expect(footer).toContain('<w:ins');
        });
      },
    );
});
