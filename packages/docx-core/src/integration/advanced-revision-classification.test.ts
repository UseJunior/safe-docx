import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acceptChanges } from '../primitives/accept_changes.js';
import { rejectChanges } from '../primitives/reject_changes.js';
import { parseXml, serializeXml } from '../primitives/xml.js';
import { OOXML } from '../primitives/namespaces.js';
import { DocxDocument } from '../primitives/document.js';
import { createZipBuffer, readZipText } from '../primitives/zip.js';
import { validateAiRevisions } from '../primitives/validate_ai_revisions.js';
import { compareDocuments } from '@usejunior/docx-compare';
import { buildSyntheticDocx, getResultParts } from './synthetic-docx-fixture.js';

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

async function packageWithDocumentXml(documentXml: string): Promise<Buffer> {
  return createZipBuffer({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml': documentXml,
  });
}

describe('ECMA-376 advanced revision records', () => {
  test(
      '[ADV-PROPERTY-RESOLUTION-01] accepts and rejects all six supported property-change record shapes with namespace aliases',
      async ({ given, when, then, and }: AllureBddContext) => {
        const cases = [
          { local: 'rPrChange', current: 'rPr', old: '<q:i/>', shape: (change: string) => `<q:p><q:r><q:rPr><q:b/>${change}</q:rPr><q:t>x</q:t></q:r></q:p>` },
          { local: 'rPrChange', current: 'rPr', old: '<q:i/>', shape: (change: string) => `<q:p><q:pPr><q:rPr><q:b/>${change}</q:rPr></q:pPr><q:r><q:t>x</q:t></q:r></q:p>` },
          { local: 'pPrChange', current: 'pPr', old: '<q:keepNext/>', shape: (change: string) => `<q:p><q:pPr><q:jc q:val="center"/>${change}</q:pPr><q:r><q:t>x</q:t></q:r></q:p>` },
          { local: 'sectPrChange', current: 'sectPr', old: '<q:pgSz q:w="100" q:h="200"/>', shape: (change: string) => `<q:p><q:pPr><q:sectPr><q:pgSz q:w="200" q:h="300"/>${change}</q:sectPr></q:pPr></q:p>` },
          { local: 'tblPrChange', current: 'tblPr', old: '<q:tblStyle q:val="Old"/>', shape: (change: string) => `<q:tbl><q:tblPr><q:tblStyle q:val="New"/>${change}</q:tblPr><q:tr><q:tc><q:p/></q:tc></q:tr></q:tbl>` },
          { local: 'trPrChange', current: 'trPr', old: '<q:cantSplit/>', shape: (change: string) => `<q:tbl><q:tr><q:trPr><q:tblHeader/>${change}</q:trPr><q:tc><q:p/></q:tc></q:tr></q:tbl>` },
          { local: 'tcPrChange', current: 'tcPr', old: '<q:tcW q:w="100" q:type="dxa"/>', shape: (change: string) => `<q:tbl><q:tr><q:tc><q:tcPr><q:tcW q:w="200" q:type="dxa"/>${change}</q:tcPr><q:p/></q:tc></q:tr></q:tbl>` },
        ];

        await given('run, paragraph-mark, paragraph, section, table, row, and cell property snapshots using a namespace alias', () => {});

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
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      '[ADV-CONTENT-RESOLUTION-01] resolves ordinary insertion and deletion wrappers',
      async ({ when, then }: AllureBddContext) => {
        const body =
          `<q:p><q:ins ${metadata}><q:r><q:t>new</q:t></q:r></q:ins>` +
          `<q:del q:id="8" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"><q:r><q:delText>old</q:delText></q:r></q:del></q:p>`;
        const accepted = documentWith(body);
        const rejected = documentWith(body);
        await when('both projections are evaluated', () => {
          acceptChanges(accepted);
          rejectChanges(rejected);
        });
        await then('accept keeps ins and reject keeps del content while removing both wrappers', () => {
          expect(serializeXml(accepted)).toContain('new');
          expect(serializeXml(accepted)).not.toContain('old');
          expect(serializeXml(rejected)).toContain('old');
          expect(serializeXml(rejected)).not.toContain('new');
          expect(count(accepted, 'ins')).toBe(0);
          expect(count(accepted, 'del')).toBe(0);
          expect(count(rejected, 'ins')).toBe(0);
          expect(count(rejected, 'del')).toBe(0);
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      '[ADV-CONTENT-EMISSION-01] emits insertion and deletion wrappers in both comparison modes',
      async ({ when, then }: AllureBddContext) => {
        const original = await buildSyntheticDocx({ paragraphs: ['old clause'] });
        const revised = await buildSyntheticDocx({ paragraphs: ['new clause'] });
        for (const mode of ['inplace', 'rebuild'] as const) {
          const result = await when(`${mode} compares replacement text`, () =>
            compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: mode }),
          );
          const doc = parseXml((await getResultParts(result.document)).documentXml);
          await then(`${mode} emits both content wrappers`, () => {
            expect(result.reconstructionModeUsed).toBe(mode);
            expect(doc.getElementsByTagNameNS(W_NS, 'ins').length).toBeGreaterThan(0);
            expect(doc.getElementsByTagNameNS(W_NS, 'del').length).toBeGreaterThan(0);
          });
        }
      },
    );

  test(
    '[ADV-VALIDATOR-COVERAGE-01] validates exact advanced-record placements and range pairs',
    async ({ when, then }: AllureBddContext) => {
      const body =
        `<q:p><q:pPr><q:numPr><q:numberingChange ${metadata}/></q:numPr></q:pPr>` +
        `<q:r><q:fldChar q:fldCharType="begin"><q:numberingChange q:id="8" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/></q:fldChar></q:r>` +
        `<q:moveFromRangeStart q:id="20" q:name="m" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:moveFromRangeEnd q:id="20"/>` +
        `<q:moveToRangeStart q:id="21" q:name="m" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:moveToRangeEnd q:id="21"/>` +
        `<q:customXmlInsRangeStart q:id="22" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:customXmlInsRangeEnd q:id="22"/>` +
        `<q:customXmlDelRangeStart q:id="23" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:customXmlDelRangeEnd q:id="23"/>` +
        `<q:customXmlMoveFromRangeStart q:id="24" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:customXmlMoveFromRangeEnd q:id="24"/>` +
        `<q:customXmlMoveToRangeStart q:id="25" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:customXmlMoveToRangeEnd q:id="25"/></q:p>` +
        `<q:tbl><q:tblPr><q:tblPrExChange q:id="26" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"><q:tblPrEx/></q:tblPrExChange></q:tblPr>` +
        `<q:tblGrid><q:tblGridChange q:id="30" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"><q:tblGrid/></q:tblGridChange></q:tblGrid>` +
        `<q:tr><q:tc><q:tcPr><q:cellIns q:id="27" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/>` +
        `<q:cellDel q:id="28" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:cellMerge q:id="29" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/></q:tcPr><q:p/></q:tc></q:tr></q:tbl>`;
      const result = await when('the namespace-aliased story is validated', () =>
        validateAiRevisions({ aiAuthor: 'SafeDocX AI', stories: [{ part: 'word/document.xml', doc: documentWith(body) }] }),
      );
      await then('all listed schema placements and balanced pairs avoid structural diagnostics', () => {
        expect(result.errors.filter((error) =>
          error.code === 'REVISION_PLACEMENT_INVALID' || error.code === 'RANGE_PAIR_UNBALANCED',
        )).toEqual([]);
      });
    },
  );

  test(
    '[ADV-TOPOLOGY-PRESERVATION-01] retains all cell-topology records without applying semantics',
    async ({ when, then }: AllureBddContext) => {
      const body =
        `<q:tbl><q:tr><q:tc><q:tcPr>` +
        `<q:cellDel q:id="50" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/>` +
        `<q:cellIns q:id="51" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/>` +
        `<q:cellMerge q:id="52" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/>` +
        `</q:tcPr><q:p/></q:tc></q:tr></q:tbl>`;
      const accepted = documentWith(body);
      const rejected = documentWith(body);
      await when('ordinary accept and reject run over topology records', () => {
        acceptChanges(accepted);
        rejectChanges(rejected);
      });
      await then('all three records remain in both projections', () => {
        for (const local of ['cellDel', 'cellIns', 'cellMerge']) {
          expect(count(accepted, local)).toBe(1);
          expect(count(rejected, local)).toBe(1);
        }
      });
    },
  );

  test(
      '[ADV-MOVE-RESOLUTION-01] resolves move content while removing range markers without claiming pair semantics',
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

  test(
      '[ADV-RANGE-PRESERVATION-01] preserves every custom XML, bookmark, comment, permission, and proofing marker',
      async ({ given, when, then }: AllureBddContext) => {
        const markers =
          `<q:customXmlInsRangeStart ${metadata}/><q:customXmlInsRangeEnd q:id="7"/>` +
          `<q:customXmlDelRangeStart q:id="11" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:customXmlDelRangeEnd q:id="11"/>` +
          `<q:customXmlMoveFromRangeStart q:id="12" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:customXmlMoveFromRangeEnd q:id="12"/>` +
          `<q:customXmlMoveToRangeStart q:id="13" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"/><q:customXmlMoveToRangeEnd q:id="13"/>` +
          `<q:bookmarkStart q:id="8" q:name="b"/><q:bookmarkEnd q:id="8"/>` +
          `<q:commentRangeStart q:id="9"/><q:commentRangeEnd q:id="9"/>` +
          `<q:r><q:commentReference q:id="9"/></q:r>` +
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
          for (const local of [
            'customXmlInsRangeStart', 'customXmlInsRangeEnd',
            'customXmlDelRangeStart', 'customXmlDelRangeEnd',
            'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
            'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
            'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
            'commentReference', 'permStart', 'permEnd', 'proofErr',
          ]) {
            expect(count(accepted, local)).toBe(1);
            expect(count(rejected, local)).toBe(1);
          }
        });
      },
    );

  test(
      '[ADV-UNRESOLVED-RECORDS-01] leaves unsupported numbering and table-grid records unresolved',
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

  test(
      '[ADV-STORY-BOUNDARY-01] sweeps fixed side stories while preserving header and footer revisions',
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
        const rejectedDoc = await DocxDocument.load(packageBytes);
        await when('package-wide accept is applied', async () => {
          await doc.acceptChanges();
          await rejectedDoc.rejectChanges();
        });
        const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
        const footnotes = await readZipText(buffer, 'word/footnotes.xml');
        const header = await readZipText(buffer, 'word/header1.xml');
        const footer = await readZipText(buffer, 'word/footer1.xml');
        const rejectedBuffer = (await rejectedDoc.toBuffer({ cleanBookmarks: false })).buffer;
        const rejectedHeader = await readZipText(rejectedBuffer, 'word/header1.xml');
        const rejectedFooter = await readZipText(rejectedBuffer, 'word/footer1.xml');

        await then('the fixed footnote story has its insertion resolved', () => {
          expect(footnotes).not.toContain('<w:ins');
          expect(footnotes).toContain('tracked');
        });
        await and('header and footer revisions remain preservation-only', () => {
          expect(header).toContain('<w:ins');
          expect(footer).toContain('<w:ins');
          expect(rejectedHeader).toContain('<w:ins');
          expect(rejectedFooter).toContain('<w:ins');
        });
      },
    );

  test(
      '[ADV-COMPARE-MOVE-EMISSION-01] emits move wrappers and all range markers in both reconstruction modes',
      async ({ given, when, then }: AllureBddContext) => {
        const original = await given('a three-paragraph source document', () =>
          buildSyntheticDocx({ paragraphs: ['this entire clause moves to another location', 'stable text', 'tail text'] }),
        );
        const revised = await buildSyntheticDocx({ paragraphs: ['stable text', 'this entire clause moves to another location', 'tail text'] });

        for (const mode of ['inplace', 'rebuild'] as const) {
          const result = await when(`the pair is compared in ${mode} mode`, () =>
            compareDocuments(original, revised, {
              engine: 'atomizer',
              reconstructionMode: mode,
              moveDetection: { detectMoves: true, moveMinimumWordCount: 5 },
            }),
          );
          const xml = (await getResultParts(result.document)).documentXml;
          await then(`${mode} output carries complete move markup`, () => {
            expect(result.reconstructionModeUsed).toBe(mode);
            for (const local of [
              'moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd',
              'moveToRangeStart', 'moveToRangeEnd',
            ]) {
              expect(
                parseXml(xml).getElementsByTagNameNS(W_NS, local).length,
                `${mode} should emit ${local}`,
              ).toBeGreaterThan(0);
            }
          });
        }
      },
    );

  test(
      '[ADV-COMPARE-MODE-PRESERVATION-01] records existing advanced-markup preservation by reconstruction mode',
      async ({ given, when, then }: AllureBddContext) => {
        const advanced =
          `<q:bookmarkStart q:id="20" q:name="b"/><q:bookmarkEnd q:id="20"/>` +
          `<q:commentRangeStart q:id="21"/><q:commentRangeEnd q:id="21"/><q:r><q:commentReference q:id="21"/></q:r>` +
          `<q:permStart q:id="22" q:edGrp="everyone"/><q:permEnd q:id="22"/><q:proofErr q:type="spellStart"/>` +
          `<q:customXmlInsRangeStart q:id="30" q:author="R" q:date="2026-07-20T12:00:00Z"/><q:customXmlInsRangeEnd q:id="30"/>` +
          `<q:customXmlDelRangeStart q:id="31" q:author="R" q:date="2026-07-20T12:00:00Z"/><q:customXmlDelRangeEnd q:id="31"/>` +
          `<q:customXmlMoveFromRangeStart q:id="32" q:author="R" q:date="2026-07-20T12:00:00Z"/><q:customXmlMoveFromRangeEnd q:id="32"/>` +
          `<q:customXmlMoveToRangeStart q:id="33" q:author="R" q:date="2026-07-20T12:00:00Z"/><q:customXmlMoveToRangeEnd q:id="33"/>` +
          `<w14:conflictIns xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:id="40"><q:r><q:t>conflict</q:t></q:r></w14:conflictIns>` +
          `<w14:conflictDel xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:id="41"><q:r><q:t>conflict deleted</q:t></q:r></w14:conflictDel>` +
          `<q:ins q:id="41" q:author="R" q:date="2026-07-20T12:00:00Z"><q:r><q:t>inserted</q:t></q:r></q:ins>` +
          `<q:del q:id="42" q:author="R" q:date="2026-07-20T12:00:00Z"><q:r><q:delText>deleted</q:delText></q:r></q:del>` +
          `<q:moveFromRangeStart q:id="43" q:name="m" q:author="R" q:date="2026-07-20T12:00:00Z"/>` +
          `<q:moveFrom q:id="44" q:author="R" q:date="2026-07-20T12:00:00Z"><q:r><q:delText>move</q:delText></q:r></q:moveFrom>` +
          `<q:moveFromRangeEnd q:id="43"/><q:moveToRangeStart q:id="45" q:name="m" q:author="R" q:date="2026-07-20T12:00:00Z"/>` +
          `<q:moveTo q:id="46" q:author="R" q:date="2026-07-20T12:00:00Z"><q:r><q:t>move</q:t></q:r></q:moveTo><q:moveToRangeEnd q:id="45"/>`;
        const input = await given('namespace-equivalent input containing representative advanced records', () =>
          packageWithDocumentXml(`<q:document xmlns:q="${W_NS}"><q:body><q:p>${advanced}</q:p></q:body></q:document>`),
        );

        const outputByMode = new Map<string, Document>();
        for (const mode of ['inplace', 'rebuild'] as const) {
          const result = await when(`the identical pair is compared in ${mode} mode`, () =>
            compareDocuments(input, input, { engine: 'atomizer', reconstructionMode: mode }),
          );
          expect(result.reconstructionModeUsed).toBe(mode);
          outputByMode.set(mode, parseXml((await getResultParts(result.document)).documentXml));
        }

        await then('inplace preserves every sampled record and namespace aliases compare successfully', () => {
          const inplace = outputByMode.get('inplace')!;
          for (const local of [
            'ins', 'del', 'moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd',
            'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart', 'customXmlInsRangeEnd',
            'customXmlDelRangeStart', 'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart',
            'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
            'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
            'commentReference', 'permStart', 'permEnd', 'proofErr',
          ]) expect(inplace.getElementsByTagNameNS(W_NS, local).length).toBeGreaterThan(0);
          expect(inplace.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordml', 'conflictIns').length).toBe(1);
          expect(inplace.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordml', 'conflictDel').length).toBe(1);
        });

        await then('rebuild behavior remains an explicit bounded gap for existing records', () => {
          const rebuild = outputByMode.get('rebuild')!;
          for (const local of ['ins', 'del', 'moveFrom', 'moveTo']) {
            expect(rebuild.getElementsByTagNameNS(W_NS, local).length).toBe(0);
          }
          for (const local of ['moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']) {
            expect(rebuild.getElementsByTagNameNS(W_NS, local).length).toBeGreaterThan(0);
          }
          for (const local of [
            'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart',
            'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
            'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd', 'proofErr',
          ]) expect(rebuild.getElementsByTagNameNS(W_NS, local).length).toBe(0);
          expect(rebuild.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordml', 'conflictIns').length).toBe(0);
          expect(rebuild.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordml', 'conflictDel').length).toBe(0);
        });
      },
    );
});
