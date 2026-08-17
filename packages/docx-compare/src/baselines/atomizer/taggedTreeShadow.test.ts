import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildTaggedTreeShadowXml, runTaggedTreeShadow } from './taggedTreeShadow.js';
import {
  buildStandaloneTaggedPackage,
  compareDocumentsAtomizer,
  type TaggedPackageShadowReport,
} from './pipeline.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import {
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  DEFAULT_MOVE_DETECTION_SETTINGS,
  DocxArchive,
  parseXml,
} from '@usejunior/docx-core';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { DEFAULT_NUMBERING_OPTIONS } from './numberingIntegration.js';

const TEST_FEATURE = 'refactor-tagged-tree-redline-construction';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (value: string) =>
  `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:body></w:document>`;
const revisionAttributes = 'w:id="7" w:author="Reviewer" w:date="2026-08-14T12:00:00Z"';

function publishPreExistingRevision(documentXml: string): string {
  return buildTaggedTreeShadowXml({
    originalXml: documentXml,
    revisedXml: documentXml,
    author: 'Comparator',
    date: new Date('2026-08-14T12:00:00Z'),
  });
}

function tableRowRevision(marker: 'ins' | 'del'): string {
  return `<w:document xmlns:w="${W_NS}"><w:body><w:tbl>`
    + `<w:tr><w:trPr><w:${marker} ${revisionAttributes}/></w:trPr>`
    + `<w:tc><w:p><w:r><w:t>TRACKED ROW</w:t></w:r></w:p></w:tc></w:tr>`
    + `<w:tr><w:tc><w:p><w:r><w:t>STABLE ROW</w:t></w:r></w:p></w:tc></w:tr>`
    + `</w:tbl></w:body></w:document>`;
}

function projectTableRows(documentXml: string, projection: 'accept' | 'reject'): string {
  const document = parseXml(documentXml);
  for (const row of Array.from(document.getElementsByTagName('w:tr'))) {
    const rowProperties = Array.from(row.childNodes)
      .find((node): node is Element => node.nodeType === 1 && (node as Element).tagName === 'w:trPr');
    const inserted = rowProperties?.getElementsByTagName('w:ins').length === 1;
    const deleted = rowProperties?.getElementsByTagName('w:del').length === 1;
    if ((projection === 'accept' && deleted) || (projection === 'reject' && inserted)) {
      row.parentNode?.removeChild(row);
    }
  }
  return document.documentElement.textContent;
}

describe('tagged-tree offline evaluation', () => {
  test.openspec('Standalone publication has no legacy assembly dependency')(
    'matches the authoritative normalized package without consuming legacy assembly state',
    async () => {
      const original = await buildDocxFromBodyXml(
        '<w:p><w:r><w:t>Original agreement language.</w:t></w:r></w:p>',
      );
      const revised = await buildDocxFromBodyXml(
        '<w:p><w:r><w:t>Revised agreement language.</w:t></w:r></w:p>',
      );
      let report: TaggedPackageShadowReport | undefined;
      const result = await compareDocumentsAtomizer(original, revised, {
        author: 'Comparator',
        date: new Date('2026-08-17T12:00:00Z'),
        standaloneTaggedPackageShadowObserver: (value) => { report = value; },
      });

      expect(result.comparisonStrategyUsed).toBe('tagged-tree');
      expect(report).toEqual({
        missingParts: [],
        unexpectedParts: [],
        differentParts: [],
        standaloneHasNoLegacyAssemblyInputs: true,
      });
    },
  );

  test('reports package-only changes and their source-projected formatting evidence', async () => {
    const paragraph = '<w:p><w:r><w:t>Stable agreement.</w:t></w:r></w:p>';
    const withPageSize = async (width: string, height: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(await buildDocxFromBodyXml(paragraph));
      archive.setDocumentXml(
        (await archive.getDocumentXml()).replace(
          '<w:sectPr/>',
          `<w:sectPr><w:pgSz w:w="${width}" w:h="${height}"/></w:sectPr>`,
        ),
      );
      return archive.save();
    };
    const original = await withPageSize('12240', '15840');
    const revised = await withPageSize('15840', '12240');

    const standalone = await buildStandaloneTaggedPackage(original, revised, {
      author: 'Comparator',
      date: new Date('2026-08-17T12:00:00Z'),
      moveDetection: DEFAULT_MOVE_DETECTION_SETTINGS,
      formatDetection: DEFAULT_FORMAT_DETECTION_SETTINGS,
      numbering: DEFAULT_NUMBERING_OPTIONS,
    });

    expect(standalone.unrepresentedChanges).toEqual([
      expect.objectContaining({ scope: 'section', kind: 'changed' }),
    ]);
    expect(standalone.formattingFidelity.accept.score).toBe(1);
    expect(standalone.formattingFidelity.reject.score).toBe(1);
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.16' })(
    'preserves the empty deleted-row marker that makes Accept remove and Reject keep the row',
    () => {
      const published = publishPreExistingRevision(tableRowRevision('del'));
      const document = parseXml(published);
      const marker = document.getElementsByTagName('w:del').item(0);

      expect(marker?.parentNode && (marker.parentNode as Element).tagName).toBe('w:trPr');
      expect(marker?.getAttribute('w:id')).toBe('7');
      expect(published).toContain('TRACKED ROW');
      expect(published).toContain('STABLE ROW');
      expect(projectTableRows(published, 'accept')).toBe('STABLE ROW');
      expect(projectTableRows(published, 'reject')).toBe('TRACKED ROWSTABLE ROW');
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.19' })(
    'preserves the empty inserted-row marker that makes Accept keep and Reject remove the row',
    () => {
      const published = publishPreExistingRevision(tableRowRevision('ins'));
      const document = parseXml(published);
      const marker = document.getElementsByTagName('w:ins').item(0);

      expect(marker?.parentNode && (marker.parentNode as Element).tagName).toBe('w:trPr');
      expect(marker?.getAttribute('w:id')).toBe('7');
      expect(published).toContain('TRACKED ROW');
      expect(published).toContain('STABLE ROW');
      expect(projectTableRows(published, 'accept')).toBe('TRACKED ROWSTABLE ROW');
      expect(projectTableRows(published, 'reject')).toBe('STABLE ROW');
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' })(
    'preserves paragraph-mark revisions while removing truly empty content wrappers',
    () => {
      const source = `<w:document xmlns:w="${W_NS}"><w:body><w:p>`
        + `<w:pPr><w:rPr><w:del ${revisionAttributes}/></w:rPr></w:pPr>`
        + `<w:ins ${revisionAttributes}/><w:del ${revisionAttributes}/>`
        + `<w:r><w:t>PARAGRAPH</w:t></w:r></w:p></w:body></w:document>`;

      const published = publishPreExistingRevision(source);
      const document = parseXml(published);

      expect(document.getElementsByTagName('w:del').length).toBe(1);
      expect(document.getElementsByTagName('w:del').item(0)?.parentNode
        && (document.getElementsByTagName('w:del').item(0)!.parentNode as Element).tagName).toBe('w:rPr');
      expect(document.getElementsByTagName('w:ins').length).toBe(0);
    },
  );

  test('reports without mutating caller-owned legacy output',
    async ({ given, when, then, and }: AllureBddContext) => {
      const legacy = xml('legacy bytes remain caller-owned');
      let report!: ReturnType<typeof runTaggedTreeShadow>;
      await given('an explicit offline evaluation and a legacy candidate', () => undefined);
      await when('the tagged tree is constructed and serialized beside it', () => {
        report = runTaggedTreeShadow({
          originalXml: xml('old'), revisedXml: xml('new'), legacyXml: legacy,
          author: 'Comparator', date: new Date('2026-08-14T12:00:00Z'), fixtureIdentity: 'unit-replacement',
        });
      });
      await then('the report records that the legacy output remains authoritative', () => {
        expect(report.legacyOutputUnchanged).toBe(true);
        expect(legacy).toBe(xml('legacy bytes remain caller-owned'));
      });
      await and('source projections are equivalent even if formatting differs from the legacy candidate', () => {
        expect(report.divergingProjections).not.toContain('accept');
        expect(report.divergingProjections).not.toContain('reject');
      });
    },
  );

  test.openspec('Tagged-tree is default with legacy rollback')(
    'uses tagged publication by default while retaining explicit legacy rollback',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await buildDocxFromBodyXml('<w:p><w:r><w:t>old</w:t></w:r></w:p>');
      const revised = await buildDocxFromBodyXml('<w:p><w:r><w:t>new</w:t></w:r></w:p>');
      const options = { author: 'Comparator', date: new Date('2026-08-14T12:00:00Z') };
      let defaultXml = '';
      let taggedXml = '';
      let legacyXml = '';
      await given('a comparison with a deterministic revision', () => undefined);
      await when('the omitted, tagged, and rollback strategies are executed', async () => {
        const [defaultResult, taggedResult, legacyResult] = await Promise.all([
          compareDocumentsAtomizer(original, revised, options),
          compareDocumentsAtomizer(original, revised, { ...options, comparisonStrategy: 'tagged-tree' }),
          compareDocumentsAtomizer(original, revised, { ...options, comparisonStrategy: 'legacy' }),
        ]);
        defaultXml = await (await DocxArchive.load(defaultResult.document)).getDocumentXml();
        taggedXml = await (await DocxArchive.load(taggedResult.document)).getDocumentXml();
        legacyXml = await (await DocxArchive.load(legacyResult.document)).getDocumentXml();
      });
      await then('omitting the strategy selects the tagged implementation observably', () => {
        expect(defaultXml).toBe(taggedXml);
      });
      await and('both the default and explicit legacy rollback preserve exact source projections', () => {
        for (const candidate of [defaultXml, legacyXml]) {
          expect(parseXml(acceptAllChanges(candidate)).documentElement.textContent).toBe('new');
          expect(parseXml(rejectAllChanges(candidate)).documentElement.textContent).toBe('old');
        }
      });
    },
  );

  test.openspec('Tagged-tree publication failure returns the validated legacy redline')(
    'falls back observably instead of discarding the assembled legacy candidate',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await buildDocxFromBodyXml('<w:p><w:r><w:t>old</w:t></w:r></w:p>');
      const revised = await buildDocxFromBodyXml('<w:p><w:r><w:t>new</w:t></w:r></w:p>');
      const options = { author: 'Comparator', date: new Date('2026-08-14T12:00:00Z') };
      const forcedFailure = {
        safe: false,
        checks: {
          acceptText: false,
          rejectText: true,
          acceptBookmarks: true,
          rejectBookmarks: true,
          fieldStructure: true,
        },
        failedChecks: ['acceptText' as const],
        failureDetails: undefined,
        failureSummary: undefined,
      };
      let fallbackResult!: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;
      let legacyResult!: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

      await given('a tagged-tree candidate whose publication safety check fails', () => undefined);
      await when('the ordinary default comparison runs', async () => {
        [fallbackResult, legacyResult] = await Promise.all([
          compareDocumentsAtomizer(original, revised, {
            ...options,
            taggedTreePublicationSafetyEvaluator: () => forcedFailure,
          }),
          compareDocumentsAtomizer(original, revised, {
            ...options,
            comparisonStrategy: 'legacy',
          }),
        ]);
      });
      await then('the already validated legacy redline and stats are returned', async () => {
        const fallbackXml = await (await DocxArchive.load(fallbackResult.document)).getDocumentXml();
        const legacyXml = await (await DocxArchive.load(legacyResult.document)).getDocumentXml();
        expect(fallbackResult.document.equals(legacyResult.document)).toBe(true);
        expect(fallbackXml).toBe(legacyXml);
        expect(fallbackResult.stats).toEqual(legacyResult.stats);
      });
      await and('the requested default and actual fallback strategy are machine readable', () => {
        expect(fallbackResult.comparisonStrategyRequested).toBe('tagged-tree');
        expect(fallbackResult.comparisonStrategyUsed).toBe('legacy');
        expect(fallbackResult.comparisonStrategyFallbackReason)
          .toBe('tagged_tree_publication_safety_check_failed');
        expect(fallbackResult.taggedTreeFallbackDiagnostics).toEqual({
          checks: forcedFailure.checks,
          failedChecks: ['acceptText'],
          failureDetails: undefined,
          firstDiffSummary: undefined,
        });
        expect(fallbackResult.fallbackReason).toBeUndefined();
      });
    },
  );

  test.openspec('Divergence is recorded with fixture identity')(
    'uses a stable opaque hash when no corpus identity is supplied',
    async ({ when, then, and }: AllureBddContext) => {
      const input = {
        originalXml: xml('A'), revisedXml: xml('B'), legacyXml: xml('B'),
        author: 'Comparator', date: new Date('2026-08-14T12:00:00Z'),
      };
      const first = runTaggedTreeShadow(input);
      const second = runTaggedTreeShadow(input);
      await when('the same fixture pair is evaluated twice', () => undefined);
      await then('the report carries the same opaque identity', () => {
        expect(first.fixtureIdentity).toMatch(/^[0-9a-f]{24}$/);
        expect(second.fixtureIdentity).toBe(first.fixtureIdentity);
      });
      await and('the divergence classification and projection names are machine readable', () => {
        expect(['projection-equivalent', 'projection-inequivalent']).toContain(first.classification);
        expect(first.divergingProjections.every((value) => ['accept', 'reject', 'formatting'].includes(value))).toBe(true);
      });
    },
  );

  test.openspec('Legacy rollback reaches its sunset')(
    'keeps the dated rollback explicitly gated on successor release evidence',
    async () => {
      const sunset = new Date('2026-11-16T00:00:00Z');
      const predecessorShipDate = new Date('2026-08-16T00:00:00Z');
      expect(sunset.getTime()).toBeGreaterThan(predecessorShipDate.getTime());
      const original = await buildDocxFromBodyXml('<w:p><w:r><w:t>old</w:t></w:r></w:p>');
      const revised = await buildDocxFromBodyXml('<w:p><w:r><w:t>new</w:t></w:r></w:p>');
      const result = await compareDocumentsAtomizer(original, revised, {
        comparisonStrategy: 'legacy',
        author: 'Rollback Gate',
        date: predecessorShipDate,
      });
      expect(result.comparisonStrategyUsed).toBe('legacy');
    },
  );

  test('proves direct paragraph and run formatting against source projections', async () => {
    const originalBody = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>SYNTHETIC OLD</w:t></w:r></w:p>';
    const revisedBody = '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>SYNTHETIC NEW</w:t></w:r></w:p>';
    const original = await buildDocxFromBodyXml(originalBody);
    const revised = await buildDocxFromBodyXml(revisedBody);
    const legacy = await compareDocumentsAtomizer(original, revised, {
      author: 'Safe DOCX Synthetic Test', date: new Date('2026-08-14T12:00:00Z'),
    });
    const legacyXml = await (await DocxArchive.load(legacy.document)).getDocumentXml();
    const report = runTaggedTreeShadow({
      originalXml: xml('SYNTHETIC OLD').replace('<w:p>', '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>').replace('<w:r>', '<w:r><w:rPr><w:b/></w:rPr>'),
      revisedXml: xml('SYNTHETIC NEW').replace('<w:p>', '<w:p><w:pPr><w:jc w:val="right"/></w:pPr>').replace('<w:r>', '<w:r><w:rPr><w:i/></w:rPr>'),
      legacyXml,
      author: 'Safe DOCX Synthetic Test', date: new Date('2026-08-14T12:00:00Z'),
      fixtureIdentity: 'synthetic-paragraph-formatting-divergence',
    });

    expect(report.divergingProjections).not.toContain('accept');
    expect(report.divergingProjections).not.toContain('reject');
    expect(report.divergingProjections).not.toContain('formatting');
    expect(report.fidelityScore).toBe(1);
    expect(report.diagnostics).toEqual([]);
    expect(report.classification).toBe('projection-equivalent');
  });
});
