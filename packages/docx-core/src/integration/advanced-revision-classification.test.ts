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
import { revisionEvidence, revisionEvidenceCases } from '../testing/revision-evidence.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Advanced Revision Classification',
});

const W_NS = OOXML.W_NS;
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const metadata = 'q:id="7" q:author="Reviewer" q:date="2026-07-20T12:00:00Z"';

function documentWith(body: string): Document {
  return parseXml(
    `<q:document xmlns:q="${W_NS}"><q:body>${body}</q:body></q:document>`,
  );
}

function count(doc: Document, localName: string): number {
  return doc.getElementsByTagNameNS(W_NS, localName).length;
}

function cloneDocument(doc: Document): Document {
  return parseXml(serializeXml(doc));
}

function corruptPreservationTarget(doc: Document, element: string): Document {
  const clone = cloneDocument(doc);
  const namespace = element.startsWith('w14:') ? OOXML.W14_NS : W_NS;
  const local = element.replace('w14:', '');
  const target = clone.getElementsByTagNameNS(namespace, local).item(0);
  if (!target) throw new Error(`Missing preservation target ${element}`);

  if (local === 'proofErr') {
    target.setAttributeNS(W_NS, `${target.prefix ?? 'w'}:type`, 'gramStart');
    return clone;
  }

  const currentId = target.getAttributeNS(namespace, 'id');
  if (currentId === null) throw new Error(`No schema-valid corruption defined for ${element}`);
  target.setAttributeNS(namespace, `${target.prefix ?? 'w'}:id`, currentId === '999' ? '998' : '999');
  return clone;
}

function withoutElement(doc: Document, localName: string): Document {
  const clone = cloneDocument(doc);
  for (const node of Array.from(clone.getElementsByTagNameNS(W_NS, localName))) node.parentNode?.removeChild(node);
  return clone;
}

function documentEvidenceCases(options: {
  elements: readonly string[];
  operations: readonly string[];
  story?: string | ((element: string) => string);
  buildFixture: (element: string, operation: string, story: string) => Document | Promise<Document>;
  run?: (fixture: Document, context: { operation: string; story: string }) => Document | Promise<Document>;
  observe: (
    run: { input: Document; output: Document },
    element: string,
    expected: { operation: string; story: string },
  ) => boolean;
  corruptTarget?: (fixture: Document, element: string) => Document;
}) {
  return revisionEvidenceCases({
    elements: options.elements,
    operations: options.operations,
    story: options.story ?? 'main',
    buildFixture: (element, context) => options.buildFixture(element, context.operation, context.story),
    run: async (fixture, _element, context) => {
      const input = cloneDocument(fixture);
      if (options.run) return { input, output: await options.run(fixture, context) };
      const output = cloneDocument(fixture);
      if (context.operation === 'accept') acceptChanges(output);
      else if (context.operation === 'reject') rejectChanges(output);
      else if (context.operation !== 'preserve') throw new Error(`Unsupported document evidence operation: ${context.operation}`);
      return { input, output };
    },
    observe: (run, element, expected) => options.observe(run, element, expected),
    mutations: (element) => [
      {
        name: 'remove-target',
        apply: (fixture, context) => ({ fixture: withoutElement(fixture, element), context }),
      },
      {
        name: 'corrupt-target',
        apply: (fixture, context) => ({
          fixture: options.corruptTarget
            ? options.corruptTarget(fixture, element)
            : documentWith(`<q:p><q:${element} q:id="999" q:author="CORRUPT"/></q:p>`),
          context,
        }),
      },
    ],
  });
}

function validatorFixtureFor(element: string): Document {
  const pairedRanges: Record<string, string> = {
    moveFromRangeStart: `<q:moveFromRangeStart ${metadata} q:name="m"/><q:moveFromRangeEnd q:id="7"/>`,
    moveFromRangeEnd: `<q:moveFromRangeStart ${metadata} q:name="m"/><q:moveFromRangeEnd q:id="7"/>`,
    moveToRangeStart: `<q:moveToRangeStart ${metadata} q:name="m"/><q:moveToRangeEnd q:id="7"/>`,
    moveToRangeEnd: `<q:moveToRangeStart ${metadata} q:name="m"/><q:moveToRangeEnd q:id="7"/>`,
    customXmlInsRangeStart: `<q:customXmlInsRangeStart ${metadata}/><q:customXmlInsRangeEnd q:id="7"/>`,
    customXmlInsRangeEnd: `<q:customXmlInsRangeStart ${metadata}/><q:customXmlInsRangeEnd q:id="7"/>`,
    customXmlDelRangeStart: `<q:customXmlDelRangeStart ${metadata}/><q:customXmlDelRangeEnd q:id="7"/>`,
    customXmlDelRangeEnd: `<q:customXmlDelRangeStart ${metadata}/><q:customXmlDelRangeEnd q:id="7"/>`,
    customXmlMoveFromRangeStart: `<q:customXmlMoveFromRangeStart ${metadata}/><q:customXmlMoveFromRangeEnd q:id="7"/>`,
    customXmlMoveFromRangeEnd: `<q:customXmlMoveFromRangeStart ${metadata}/><q:customXmlMoveFromRangeEnd q:id="7"/>`,
    customXmlMoveToRangeStart: `<q:customXmlMoveToRangeStart ${metadata}/><q:customXmlMoveToRangeEnd q:id="7"/>`,
    customXmlMoveToRangeEnd: `<q:customXmlMoveToRangeStart ${metadata}/><q:customXmlMoveToRangeEnd q:id="7"/>`,
  };
  if (pairedRanges[element]) return documentWith(`<q:p>${pairedRanges[element]}</q:p>`);
  if (element === 'tblPrExChange') return documentWith(`<q:tbl><q:tblPr><q:tblPrExChange ${metadata}><q:tblPrEx/></q:tblPrExChange></q:tblPr><q:tblGrid/><q:tr><q:tc><q:p/></q:tc></q:tr></q:tbl>`);
  if (element === 'tblGridChange') return documentWith(`<q:tbl><q:tblPr/><q:tblGrid><q:tblGridChange ${metadata}><q:tblGrid/></q:tblGridChange></q:tblGrid><q:tr><q:tc><q:p/></q:tc></q:tr></q:tbl>`);
  if (['cellDel', 'cellIns', 'cellMerge'].includes(element)) return documentWith(`<q:tbl><q:tblPr/><q:tblGrid/><q:tr><q:tc><q:tcPr><q:${element} ${metadata}/></q:tcPr><q:p/></q:tc></q:tr></q:tbl>`);
  throw new Error(`No validator fixture for ${element}`);
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
        const acceptedByElement = new Map<string, Document>();
        const rejectedByElement = new Map<string, Document>();
        const sourceByElement = new Map<string, Document>();

        await given('run, paragraph-mark, paragraph, section, table, row, and cell property snapshots using a namespace alias', () => {});

        for (const revision of cases) {
          const change = `<q:${revision.local} ${metadata}><q:${revision.current}>${revision.old}</q:${revision.current}></q:${revision.local}>`;
          const accepted = documentWith(revision.shape(change));
          const rejected = documentWith(revision.shape(change));
          sourceByElement.set(revision.local, cloneDocument(accepted));
          acceptedByElement.set(revision.local, accepted);
          rejectedByElement.set(revision.local, rejected);

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
        const hasPropertyMarker = (output: Document, element: string, operation: string): boolean => {
          const localByOperation: Record<string, { accept: string; reject: string }> = {
            rPrChange: { accept: 'b', reject: 'i' },
            pPrChange: { accept: 'jc', reject: 'keepNext' },
            sectPrChange: { accept: 'pgSz', reject: 'pgSz' },
            tblPrChange: { accept: 'tblStyle', reject: 'tblStyle' },
            trPrChange: { accept: 'tblHeader', reject: 'cantSplit' },
            tcPrChange: { accept: 'tcW', reject: 'tcW' },
          };
          const marker = output.getElementsByTagNameNS(W_NS, localByOperation[element]![operation as 'accept' | 'reject']).item(0);
          if (!marker) return false;
          if (element === 'sectPrChange' || element === 'tcPrChange') {
            return marker.getAttributeNS(W_NS, 'w') === (operation === 'accept' ? '200' : '100');
          }
          if (element === 'tblPrChange' || element === 'pPrChange') {
            return marker.getAttributeNS(W_NS, 'val') === (element === 'tblPrChange'
              ? operation === 'accept' ? 'New' : 'Old'
              : operation === 'accept' ? 'center' : null);
          }
          return true;
        };
        await revisionEvidence('ADV-PROPERTY-RESOLUTION-01', documentEvidenceCases({
          elements: ['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange'],
          operations: ['accept', 'reject'],
          buildFixture: (element) => cloneDocument(sourceByElement.get(element)!),
          observe: (run, element, expected) => count(run.input, element) === 1 &&
            count(run.output, element) === 0 &&
            hasPropertyMarker(run.output, element, expected.operation),
        }));
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
        const source = cloneDocument(accepted);
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
        await revisionEvidence('ADV-CONTENT-RESOLUTION-01', documentEvidenceCases({
          elements: ['ins', 'del'],
          operations: ['accept', 'reject'],
          buildFixture: () => cloneDocument(source),
          observe: (run, element, expected) => {
            const expectedTarget = source.getElementsByTagNameNS(W_NS, element).item(0);
            const inputTarget = run.input.getElementsByTagNameNS(W_NS, element).item(0);
            if (!expectedTarget || !inputTarget || inputTarget.toString() !== expectedTarget.toString() || count(run.output, element) !== 0) return false;
            const text = run.output.documentElement.textContent ?? '';
            if (element === 'ins') return expected.operation === 'accept' ? text.includes('new') : !text.includes('new');
            return expected.operation === 'reject' ? text.includes('old') : !text.includes('old');
          },
        }));
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      '[ADV-CONTENT-EMISSION-01] emits insertion and deletion wrappers in both comparison modes',
      async ({ when, then }: AllureBddContext) => {
        const original = await buildSyntheticDocx({ paragraphs: ['old clause'] });
        const revised = await buildSyntheticDocx({ paragraphs: ['new clause'] });
        const outputByMode = new Map<string, Document>();
        for (const mode of ['inplace', 'rebuild'] as const) {
          const result = await when(`${mode} compares replacement text`, () =>
            compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: mode }),
          );
          const doc = parseXml((await getResultParts(result.document)).documentXml);
          outputByMode.set(mode, doc);
          await then(`${mode} emits both content wrappers`, () => {
            expect(result.reconstructionModeUsed).toBe(mode);
            expect(doc.getElementsByTagNameNS(W_NS, 'ins').length).toBeGreaterThan(0);
            expect(doc.getElementsByTagNameNS(W_NS, 'del').length).toBeGreaterThan(0);
          });
        }
        await revisionEvidence('ADV-CONTENT-EMISSION-01', revisionEvidenceCases({
          elements: ['ins', 'del'],
          operations: ['emit', 'comparison.inplace', 'comparison.rebuild'],
          story: 'main',
          buildFixture: () => ({ original: 'old clause', revised: 'new clause' }),
          run: async (fixture, _element, context) => {
            const modes = context.operation === 'emit'
              ? ['inplace', 'rebuild'] as const
              : [context.operation.endsWith('.rebuild') ? 'rebuild' : 'inplace'] as const;
            const documents = new Map<string, Document>();
            for (const mode of modes) {
              const left = await buildSyntheticDocx({ paragraphs: [fixture.original] });
              const right = await buildSyntheticDocx({ paragraphs: [fixture.revised] });
              const result = await compareDocuments(left, right, { engine: 'atomizer', reconstructionMode: mode });
              if (result.reconstructionModeUsed !== mode) return { documents: new Map<string, Document>() };
              documents.set(mode, parseXml((await getResultParts(result.document)).documentXml));
            }
            return { documents };
          },
          observe: (run, element) => run.documents.size > 0 &&
            [...run.documents.values()].every((doc) => {
              const target = doc.getElementsByTagNameNS(W_NS, element).item(0);
              return target !== null && (target.textContent ?? '').includes(element === 'ins' ? 'new' : 'old');
            }),
          mutations: () => [
            {
              name: 'remove-target',
              apply: (fixture, context) => ({ fixture: { ...fixture, revised: fixture.original }, context }),
            },
            {
              name: 'corrupt-target',
              apply: (_fixture, context) => ({ fixture: { original: 'alpha source', revised: 'beta target' }, context }),
            },
          ],
        }));
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
      const validatorElements = [
        'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
        'tblPrExChange', 'tblGridChange', 'cellDel', 'cellIns', 'cellMerge',
        'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart',
        'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
        'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
      ];
      const validatorFixtures = new Map<string, {
        target: Document;
        diagnostics: Awaited<ReturnType<typeof validateAiRevisions>>['errors'];
        withoutTarget: Document;
        withoutTargetDiagnostics: Awaited<ReturnType<typeof validateAiRevisions>>['errors'];
      }>();
      for (const element of validatorElements) {
        const target = validatorFixtureFor(element);
        const validation = await validateAiRevisions({
          aiAuthor: 'SafeDocX AI',
          stories: [{ part: 'word/document.xml', doc: target }],
        });
        const withoutTarget = withoutElement(target, element);
        const removedValidation = await validateAiRevisions({
          aiAuthor: 'SafeDocX AI',
          stories: [{ part: 'word/document.xml', doc: withoutTarget }],
        });
        const withoutTargetDiagnostics = [...removedValidation.errors, ...removedValidation.warnings];
        validatorFixtures.set(element, {
          target,
          diagnostics: [...validation.errors, ...validation.warnings],
          withoutTarget,
          withoutTargetDiagnostics,
        });
        expect(count(withoutTarget, element), `${element} target-specific mutation must remove the element`).toBe(0);
        if (element.includes('Range')) {
          expect(withoutTargetDiagnostics.some((error) => error.code === 'RANGE_PAIR_UNBALANCED'), `${element} removal must produce its pair diagnostic`).toBe(true);
        } else {
          expect(withoutTargetDiagnostics.some((error) => error.code === 'REVISION_PLACEMENT_INVALID'), `${element} removal must not retain a placement outcome`).toBe(false);
        }
      }
      await revisionEvidence('ADV-VALIDATOR-COVERAGE-01', revisionEvidenceCases({
        elements: validatorElements,
        operations: ['validate'],
        story: 'main',
        buildFixture: (element) => validatorFixtureFor(element),
        run: async (fixture) => ({
          fixture,
          validation: await validateAiRevisions({
            aiAuthor: 'SafeDocX AI',
            stories: [{ part: 'word/document.xml', doc: fixture }],
          }),
        }),
        observe: (run, element) => count(run.fixture, element) > 0 &&
          ![...run.validation.errors, ...run.validation.warnings].some((error) =>
            error.code === 'REVISION_PLACEMENT_INVALID' || error.code === 'RANGE_PAIR_UNBALANCED'),
        mutations: (element) => [
          {
            name: 'remove-target',
            apply: (fixture, context) => ({ fixture: withoutElement(fixture, element), context }),
          },
          {
            name: 'corrupt-target',
            apply: (_fixture, context) => ({
              fixture: parseXml(`<q:document xmlns:q="${W_NS}" xmlns:x="urn:corrupt"><q:body><q:p><x:${element}/></q:p></q:body></q:document>`),
              context,
            }),
          },
        ],
      }));

      for (const element of validatorElements.filter((name) => name.startsWith('customXml'))) {
        const mutated = withoutElement(validatorFixtureFor(element), element);
        const validation = await validateAiRevisions({
          aiAuthor: 'SafeDocX AI',
          stories: [{ part: 'word/document.xml', doc: mutated }],
        });
        expect([...validation.errors, ...validation.warnings].some((error) => error.code === 'RANGE_PAIR_UNBALANCED'), `${element} removal must break its exact pair`).toBe(true);
      }
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
      const source = cloneDocument(accepted);
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
      await revisionEvidence('ADV-TOPOLOGY-PRESERVATION-01', documentEvidenceCases({
        elements: ['cellDel', 'cellIns', 'cellMerge'],
        operations: ['accept', 'reject', 'preserve'],
        buildFixture: () => cloneDocument(source),
        observe: (run, element) => {
          const inputTarget = run.input.getElementsByTagNameNS(W_NS, element).item(0);
          const outputTarget = run.output.getElementsByTagNameNS(W_NS, element).item(0);
          return inputTarget?.getAttributeNS(W_NS, 'author') === 'Reviewer' &&
            outputTarget?.getAttributeNS(W_NS, 'author') === 'Reviewer';
        },
      }));
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
        const source = cloneDocument(accepted);

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
        await revisionEvidence('ADV-MOVE-RESOLUTION-01', documentEvidenceCases({
          elements: ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd'],
          operations: ['accept', 'reject'],
          buildFixture: () => cloneDocument(source),
          observe: (run, element, expected) => {
            const inputTarget = run.input.getElementsByTagNameNS(W_NS, element).item(0);
            const xml = serializeXml(run.output);
            const expectedText = expected.operation === 'accept' ? 'destination' : 'source';
            const excludedText = expected.operation === 'accept' ? 'source' : 'destination';
            return inputTarget?.getAttributeNS(W_NS, 'id') === '7' && count(run.output, element) === 0 &&
              xml.includes(expectedText) && !xml.includes(excludedText);
          },
        }));
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
        const source = cloneDocument(accepted);

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
        await revisionEvidence('ADV-RANGE-PRESERVATION-01', documentEvidenceCases({
          elements: [
            'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart',
            'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
            'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd', 'bookmarkStart', 'bookmarkEnd',
            'commentRangeStart', 'commentRangeEnd', 'commentReference', 'permStart', 'permEnd', 'proofErr',
          ],
          operations: ['accept', 'reject'],
          buildFixture: () => cloneDocument(source),
          observe: (run, element) => {
            const expectedTarget = source.getElementsByTagNameNS(W_NS, element).item(0);
            const inputTarget = run.input.getElementsByTagNameNS(W_NS, element).item(0);
            const outputTarget = run.output.getElementsByTagNameNS(W_NS, element).item(0);
            return expectedTarget !== null && inputTarget !== null && outputTarget !== null &&
              inputTarget.toString() === expectedTarget.toString() &&
              outputTarget.toString() === expectedTarget.toString();
          },
        }));
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
        const source = cloneDocument(accepted);

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
        await revisionEvidence('ADV-UNRESOLVED-RECORDS-01', documentEvidenceCases({
          elements: ['numberingChange', 'tblPrExChange', 'tblGridChange'],
          operations: ['accept', 'reject'],
          buildFixture: () => cloneDocument(source),
          observe: (run, element) => {
            const inputTarget = run.input.getElementsByTagNameNS(W_NS, element).item(0);
            const outputTarget = run.output.getElementsByTagNameNS(W_NS, element).item(0);
            return inputTarget?.getAttributeNS(W_NS, 'author') === 'Reviewer' &&
              outputTarget?.getAttributeNS(W_NS, 'author') === 'Reviewer';
          },
        }));
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
        await revisionEvidence('ADV-STORY-BOUNDARY-01', revisionEvidenceCases({
          elements: ['header story revisions', 'footer story revisions'],
          operations: ['accept', 'reject', 'preserve'],
          story: (element) => element.startsWith('header') ? 'header' : 'footer',
          buildFixture: (_element, context) => ({ story: context.story, content: 'tracked' }),
          run: async (fixture, _element, context) => {
            const tracked = fixture.content === 'none'
              ? ''
              : `<w:ins w:id="7" w:author="Reviewer"><w:r><w:t>${fixture.content}</w:t></w:r></w:ins>`;
            const bytes = await createZipBuffer({
              '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
              '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
              'word/document.xml': `<w:document xmlns:w="${W_NS}"><w:body><w:p/><w:sectPr/></w:body></w:document>`,
              [`word/${fixture.story}1.xml`]: `<w:${fixture.story === 'header' ? 'hdr' : 'ftr'} xmlns:w="${W_NS}"><w:p>${tracked}</w:p></w:${fixture.story === 'header' ? 'hdr' : 'ftr'}>`,
            });
            const loaded = await DocxDocument.load(bytes);
            if (context.operation === 'accept') await loaded.acceptChanges();
            else if (context.operation === 'reject') await loaded.rejectChanges();
            const output = (await loaded.toBuffer({ cleanBookmarks: false })).buffer;
            return readZipText(output, `word/${context.story}1.xml`);
          },
          observe: (xml) => xml?.includes('<w:ins') === true && xml.includes('tracked'),
          mutations: () => [
            {
              name: 'remove-target',
              apply: (fixture, context) => ({ fixture: { ...fixture, content: 'none' }, context }),
            },
            {
              name: 'corrupt-target',
              apply: (fixture, context) => ({ fixture: { ...fixture, content: 'corrupt' }, context }),
            },
          ],
        }));
      },
    );

  test(
      '[ADV-COMPARE-MOVE-EMISSION-01] emits move wrappers and all range markers in both reconstruction modes',
      async ({ given, when, then }: AllureBddContext) => {
        const original = await given('a three-paragraph source document', () =>
          buildSyntheticDocx({ paragraphs: ['this entire clause moves to another location', 'stable text', 'tail text'] }),
        );
        const revised = await buildSyntheticDocx({ paragraphs: ['stable text', 'this entire clause moves to another location', 'tail text'] });
        const outputByMode = new Map<string, Document>();

        for (const mode of ['inplace', 'rebuild'] as const) {
          const result = await when(`the pair is compared in ${mode} mode`, () =>
            compareDocuments(original, revised, {
              engine: 'atomizer',
              reconstructionMode: mode,
            }),
          );
          const xml = (await getResultParts(result.document)).documentXml;
          outputByMode.set(mode, parseXml(xml));
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
        await revisionEvidence('ADV-COMPARE-MOVE-EMISSION-01', revisionEvidenceCases({
          elements: ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd'],
          operations: ['emit', 'comparison.inplace', 'comparison.rebuild'],
          story: 'main',
          buildFixture: () => ({
            original: ['this entire clause moves to another location', 'stable text', 'tail text'],
            revised: ['stable text', 'this entire clause moves to another location', 'tail text'],
          }),
          run: async (fixture, _element, context) => {
            const modes = context.operation === 'emit'
              ? ['inplace', 'rebuild'] as const
              : [context.operation.endsWith('.rebuild') ? 'rebuild' : 'inplace'] as const;
            const documents = new Map<string, Document>();
            for (const mode of modes) {
              const left = await buildSyntheticDocx({ paragraphs: fixture.original });
              const right = await buildSyntheticDocx({ paragraphs: fixture.revised });
              const result = await compareDocuments(left, right, { engine: 'atomizer', reconstructionMode: mode });
              if (result.reconstructionModeUsed !== mode) return { documents: new Map<string, Document>() };
              documents.set(mode, parseXml((await getResultParts(result.document)).documentXml));
            }
            return { documents };
          },
          observe: (run, element) => run.documents.size > 0 && [...run.documents.values()].every((doc) =>
            count(doc, element) > 0 && serializeXml(doc).includes('this entire clause moves to another location')),
          mutations: () => [
            {
              name: 'remove-target',
              apply: (fixture, context) => ({ fixture: { ...fixture, revised: [...fixture.original] }, context }),
            },
            {
              name: 'corrupt-target',
              apply: (_fixture, context) => ({
                fixture: {
                  original: ['corrupt clause', 'stable text', 'tail text'],
                  revised: ['stable text', 'corrupt clause', 'tail text'],
                },
                context,
              }),
            },
          ],
        }));
      },
      // Runs two full comparisons per evidence case; borderline against the 5s
      // default and reliably over it under coverage instrumentation.
      60000,
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
        const sourceDocument = parseXml(`<q:document xmlns:q="${W_NS}"><q:body><q:p>${advanced}</q:p></q:body></q:document>`);
        sourceDocument.documentElement.setAttributeNS(XMLNS_NS, 'xmlns:w14', OOXML.W14_NS);
        sourceDocument.documentElement.setAttributeNS(XMLNS_NS, 'xmlns:mc', MC_NS);
        sourceDocument.documentElement.setAttributeNS(MC_NS, 'mc:Ignorable', 'w14');
        expect(sourceDocument.documentElement.getAttributeNS(MC_NS, 'Ignorable')).toBe('w14');
        expect(sourceDocument.documentElement.lookupNamespaceURI('w14')).toBe(OOXML.W14_NS);
        const sourceXml = serializeXml(sourceDocument);
        expect(sourceXml).toContain('xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"');
        expect(sourceXml).toContain('mc:Ignorable="w14"');
        const input = await given('namespace-equivalent input containing representative advanced records', () =>
          packageWithDocumentXml(sourceXml),
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
        const absentFromRebuild = new Set([
          'ins', 'del', 'moveFrom', 'moveTo', 'customXmlInsRangeStart', 'customXmlInsRangeEnd',
          'customXmlDelRangeStart', 'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart',
          'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
          'proofErr', 'w14:conflictIns', 'w14:conflictDel',
        ]);
        const preservationElements = [
          'ins', 'del', 'moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd',
          'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart', 'customXmlInsRangeEnd',
          'customXmlDelRangeStart', 'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart',
          'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
          'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
          'commentReference', 'permStart', 'permEnd', 'proofErr', 'w14:conflictIns', 'w14:conflictDel',
        ];
        await then('proofing-error corruption uses a schema-valid alternate type without adding an id', () => {
          const corrupted = corruptPreservationTarget(sourceDocument, 'proofErr');
          const proofErr = corrupted.getElementsByTagNameNS(W_NS, 'proofErr').item(0)!;
          expect(proofErr.getAttributeNS(W_NS, 'type')).toBe('gramStart');
          expect(proofErr.hasAttributeNS(W_NS, 'id')).toBe(false);
        });
        await revisionEvidence('ADV-COMPARE-MODE-PRESERVATION-01', revisionEvidenceCases({
          elements: preservationElements,
          operations: ['reconstruction.inplace', 'reconstruction.rebuild'],
          story: 'main',
          buildFixture: () => cloneDocument(sourceDocument),
          run: async (fixture, _element, context) => {
            const mode = context.operation.endsWith('.rebuild') ? 'rebuild' : 'inplace';
            const bytes = await packageWithDocumentXml(serializeXml(fixture));
            const result = await compareDocuments(bytes, bytes, { engine: 'atomizer', reconstructionMode: mode });
            return {
              input: fixture,
              output: parseXml((await getResultParts(result.document)).documentXml),
              modeUsed: result.reconstructionModeUsed,
            };
          },
          observe: (run, element, expected) => {
            const mode = expected.operation.split('.')[1];
            const namespace = element.startsWith('w14:') ? OOXML.W14_NS : W_NS;
            const local = element.replace('w14:', '');
            const expectedTarget = sourceDocument.getElementsByTagNameNS(namespace, local).item(0);
            const inputTarget = run.input.getElementsByTagNameNS(namespace, local).item(0);
            if (!expectedTarget || !inputTarget || inputTarget.toString() !== expectedTarget.toString() || run.modeUsed !== mode) return false;
            const present = run.output.getElementsByTagNameNS(namespace, local).length > 0;
            return mode === 'inplace' ? present : present === !absentFromRebuild.has(element);
          },
          mutations: (element) => [
            {
              name: 'remove-target',
              apply: (fixture, context) => {
                const clone = cloneDocument(fixture);
                const namespace = element.startsWith('w14:') ? OOXML.W14_NS : W_NS;
                for (const node of Array.from(clone.getElementsByTagNameNS(namespace, element.replace('w14:', '')))) node.parentNode?.removeChild(node);
                return { fixture: clone, context };
              },
            },
            {
              name: 'corrupt-target',
              apply: (fixture, context) => ({
                fixture: corruptPreservationTarget(fixture, element),
                context,
              }),
            },
          ],
        }));
      },
      30_000,
    );
});
