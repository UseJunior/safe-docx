import { describe, expect, vi } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  atomizeTree,
  compareDocuments,
  parseDocumentXml,
  runLeanXmlTripleVerifier,
} from '@usejunior/docx-compare';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { DocxDocument } from '../primitives/document.js';
import { getParagraphText, replaceParagraphTextRange } from '../primitives/text.js';
import { OOXML } from '../primitives/namespaces.js';
import type { OpcPart } from '../core-types.js';

const TEST_FEATURE = 'NVCA Structural Regression';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const COMMENTS_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_PATH = 'word/comments-lean-710.xml';
const COMMENTS_RELATIONSHIP_ID = 'rIdLean710Comments';

describe('NVCA Structural Regression', () => {
  const sourcePath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/source.docx');
  const filledPath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/filled.docx');

  test('should compare NVCA source vs filled in inplace mode without safety fallback', async ({ given, when, then, and }: AllureBddContext) => {
    let sourceBuf: Buffer;
    let filledBuf: Buffer;
    let res: Awaited<ReturnType<typeof compareDocuments>>;

    await given('NVCA source and filled fixture files exist and are loaded', async () => {
      expect(fs.existsSync(sourcePath), `missing committed fixture: ${sourcePath}`).toBe(true);
      expect(fs.existsSync(filledPath), `missing committed fixture: ${filledPath}`).toBe(true);
      sourceBuf = fs.readFileSync(sourcePath);
      filledBuf = fs.readFileSync(filledPath);
    });

    await when('documents are compared in inplace mode', async () => {
      res = await compareDocuments(sourceBuf, filledBuf, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
        author: 'RegressionTest'
      });
    });

    await then('it used inplace mode without safety fallback', async () => {
      // Check that it used inplace mode (meaning it passed all safety checks)
      expect(res.reconstructionModeUsed).toBe('inplace');
      expect(res.fallbackReason).toBeUndefined();
      expect(res.inplaceSuccessDiagnostics?.passUsed).toBe('inplace_word_split');
      expect(res.inplaceSuccessDiagnostics?.precedingFailedAttempts).toEqual([]);
    });

    await and('stats are within expected ranges', async () => {
      // Pin a bounded characterization range. A lower-bound-only assertion
      // accidentally rewarded extra revision noise and failed when #720 let the
      // higher-fidelity word-split pass reduce insertion ranges from 101+ to 99.
      expect(res.stats.insertions).toBeGreaterThanOrEqual(90);
      expect(res.stats.insertions).toBeLessThanOrEqual(110);
      expect(res.stats.deletions).toBeGreaterThanOrEqual(250);
      expect(res.stats.deletions).toBeLessThanOrEqual(300);
    });
  }, 60000); // 60 second timeout for large document comparison
});

async function deriveMinimallyEditedRevision(source: Buffer): Promise<Buffer> {
  const document = await DocxDocument.load(source);
  const paragraph = document.getParagraphs().find((candidate) => {
    const text = getParagraphText(candidate);
    return text.length >= 20 &&
      candidate.getElementsByTagNameNS(OOXML.W_NS, 'fldChar').length === 0;
  });
  if (!paragraph) throw new Error('NVCA source has no suitable body paragraph');
  const text = getParagraphText(paragraph);
  replaceParagraphTextRange(paragraph, 0, 1, text[0] === 'A' ? 'B' : 'A');
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.10
 */
async function addSelectedCommentsPart(source: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(source);
  const documentXml = await archive.getDocumentXml();
  const relationshipsPath = 'word/_rels/document.xml.rels';
  const relationships = await archive.getFile(relationshipsPath);
  if (!relationships?.includes('</Relationships>')) {
    throw new Error('NVCA source has no conventional Main Document relationships part');
  }
  if (relationships.includes(`Type="${COMMENTS_RELATIONSHIP_TYPE}"`)) {
    throw new Error('NVCA source unexpectedly already selects legacy comments');
  }
  archive.setFile(
    relationshipsPath,
    relationships.replace(
      '</Relationships>',
      `<Relationship Id="${COMMENTS_RELATIONSHIP_ID}" ` +
        `Type="${COMMENTS_RELATIONSHIP_TYPE}" ` +
        `Target="${COMMENTS_PATH.replace(/^word\//, '')}"/></Relationships>`,
    ),
  );
  archive.setFile(
    COMMENTS_PATH,
    `<w:comments xmlns:w="${OOXML.W_NS}">` +
      [710, 711, 712, 713, 714, 715]
        .map((id) => `<w:comment w:id="${id}"><w:p/></w:comment>`).join('') +
      '</w:comments>',
  );
  archive.setFile(
    'word/document.xml',
    documentXml.replace(
      '</w:p>',
      '<w:commentRangeStart w:id="710"/>' +
        '<w:r><w:t>NVCA comment range</w:t></w:r>' +
        '<w:commentRangeEnd w:id="710"/>' +
        '<w:r><w:commentReference w:id="710"/></w:r></w:p>',
    ),
  );
  const retainedStoryRanges: Array<[string, string, number, string]> = [
    ['word/header1.xml', '</w:hdr>', 712,
      '<w:p><w:r><w:t>NVCA header range</w:t></w:r></w:p>'],
    ['word/footer1.xml', '</w:ftr>', 713,
      '<w:p><w:r><w:t>NVCA footer range</w:t></w:r></w:p>'],
    ['word/footnotes.xml', '</w:footnotes>', 714,
      '<w:footnote w:id="1000"><w:p></w:p></w:footnote>'],
    ['word/endnotes.xml', '</w:endnotes>', 715,
      '<w:endnote w:id="1000"><w:p></w:p></w:endnote>'],
  ];
  for (const [partPath, closing, id, container] of retainedStoryRanges) {
    const xml = await archive.getFile(partPath);
    if (!xml?.includes(closing)) {
      throw new Error(`NVCA source lacks retained story ${partPath}`);
    }
    const ranged = container.replace(
      '<w:p>',
      `<w:p><w:commentRangeStart w:id="${id}"/>`,
    ).replace(
      '</w:p>',
      `<w:commentRangeEnd w:id="${id}"/>` +
        `<w:r><w:commentReference w:id="${id}"/></w:r></w:p>`,
    );
    archive.setFile(partPath, xml.replace(closing, `${ranged}${closing}`));
  }
  return archive.save();
}

async function addNestedCommentDefinition(
  source: Buffer,
  rawId: string | undefined,
): Promise<Buffer> {
  const archive = await DocxArchive.load(source);
  const comments = await archive.getFile(COMMENTS_PATH);
  if (!comments?.includes('</w:comments>')) {
    throw new Error('NVCA comparison output has no selected Comments part');
  }
  const idAttribute = rawId === undefined ? '' : ` w:id="${rawId}"`;
  archive.setFile(
    COMMENTS_PATH,
    comments.replace(
      '</w:comments>',
      `<w:custom><w:comment${idAttribute}><w:p/></w:comment></w:custom>` +
        '</w:comments>',
    ),
  );
  return archive.save();
}

type RangeMutation = 'orphan-start' | 'orphan-end' | 'reversed' |
  'duplicate-reference' | 'malformed-start' | 'overlong-end' |
  'alias' | 'cross-story' | 'missing-association' | 'start-limit';

async function mutateNvcaCommentRange(source: Buffer, mutation: RangeMutation):
Promise<{ docx: Buffer; documentXml: string }> {
  const archive = await DocxArchive.load(source);
  let documentXml = await archive.getDocumentXml();
  if (mutation === 'orphan-start') {
    documentXml = documentXml.replace('<w:commentRangeEnd w:id="710"/>', '');
  } else if (mutation === 'orphan-end') {
    documentXml = documentXml.replace('<w:commentRangeStart w:id="710"/>', '');
  } else if (mutation === 'reversed') {
    documentXml = documentXml
      .replace('<w:commentRangeStart w:id="710"/>', '<w:commentRangeEnd w:id="710"/>')
      .replace('<w:commentRangeEnd w:id="710"/><w:r><w:commentReference',
        '<w:commentRangeStart w:id="710"/><w:r><w:commentReference');
  } else if (mutation === 'duplicate-reference') {
    documentXml = documentXml.replace(
      '<w:commentReference w:id="710"/>',
      '<w:commentReference w:id="710"/><w:commentReference w:id="710"/>',
    );
  } else if (mutation === 'malformed-start') {
    documentXml = documentXml.replace(
      '<w:commentRangeStart w:id="710"/>',
      '<w:commentRangeStart w:id="seven"/>',
    );
  } else if (mutation === 'overlong-end') {
    documentXml = documentXml.replace(
      '<w:commentRangeEnd w:id="710"/>',
      `<w:commentRangeEnd w:id="${'1'.repeat(65)}"/>`,
    );
  } else if (mutation === 'alias') {
    documentXml = documentXml.replaceAll('w:id="710"', 'w:id=" +0710 "');
  } else if (mutation === 'cross-story') {
    documentXml = documentXml.replace('<w:commentRangeEnd w:id="710"/>', '');
    const header = await archive.getFile('word/header1.xml');
    if (!header?.includes('<w:commentRangeEnd w:id="712"/>')) {
      throw new Error('NVCA compared header lacks the retained range endpoint');
    }
    archive.setFile(
      'word/header1.xml',
      header.replace(
        '<w:commentRangeEnd w:id="712"/>',
        '<w:commentRangeEnd w:id="710"/>',
      ),
    );
  } else if (mutation === 'missing-association') {
    const comments = await archive.getFile(COMMENTS_PATH);
    if (!comments?.includes('<w:comment w:id="710">')) {
      throw new Error('NVCA compared Comments part lacks definition 710');
    }
    archive.setFile(
      COMMENTS_PATH,
      comments.replace('<w:comment w:id="710">', '<w:comment w:id="999">'),
    );
  } else {
    documentXml = documentXml.replace(
      '<w:commentRangeStart w:id="710"/>',
      '<w:commentRangeStart w:id="710"/>'.repeat(4097),
    );
  }
  archive.setFile('word/document.xml', documentXml);
  return { docx: await archive.save(), documentXml };
}

async function removeNvcaRetainedFootnotes(source: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  zip.remove('word/footnotes.xml');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const leanCheckerPath = path.resolve(
  __dirname,
  '../../../../verification/lean/.lake/build/bin/leanDocxChecker',
);
if (process.env.SAFE_DOCX_REQUIRE_LEAN_CHECKER === '1' &&
    !fs.existsSync(leanCheckerPath)) {
  throw new Error(`required compiled Lean checker is missing: ${leanCheckerPath}`);
}
const describeWithCompiledLean = fs.existsSync(leanCheckerPath) ? describe : describe.skip;

describeWithCompiledLean('NVCA full-document Lean comment stack safety', () => {
  test
    .openspec('[LEAN-COMMENT-11] Full real NVCA comment scanning is stack-safe')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.3' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.4' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.6' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.10' })(
    'returns structured results for selected comments and nested-definition mutations',
    async () => {
      const sourcePath = path.resolve(
        __dirname,
        '../../../../tests/test_documents/nvca-regression/source.docx',
      );
      const original = await addSelectedCommentsPart(fs.readFileSync(sourcePath));
      const originalArchive = await DocxArchive.load(original);
      const originalXml = await originalArchive.getDocumentXml();
      expect(originalXml.length).toBeGreaterThan(350_000);
      const originalTree = parseDocumentXml(originalXml);
      const originalBody =
        originalTree.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
      expect(originalBody).not.toBeNull();
      const originalPart: OpcPart = {
        uri: 'word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      };
      const originalAtomCount =
        atomizeTree(originalBody!, [], originalPart).atoms.length;
      expect(originalAtomCount).toBeGreaterThanOrEqual(41_000);
      expect(originalAtomCount).toBe(41_621);

      const revised = await deriveMinimallyEditedRevision(original);
      // This used to assert the `[DEBUG] atomizeTree: ... word-split to N, punct-merged to M`
      // line was emitted. `8035dce` (#785, fixing #783) deleted that line so CLI stdout stays
      // valid machine-readable JSON, and added a unit regression in atomizer.test.ts holding
      // atomization silent — leaving this assertion requiring a log another test forbids, which
      // is why this step began failing on exactly that commit and, until #804, silently skipped
      // both Lean↔TS differential harnesses behind it.
      //
      // Inverted rather than deleted. The original intent — evidence that the word-split and
      // punct-merge passes ran — is carried by the exact atom-count fingerprint asserted above:
      // a composite regression fingerprint over the whole pipeline, which would move if either
      // pass stopped running, though it does not isolate them individually. That is the same
      // grade of evidence the log line gave, without depending on stdout. Asserting silence
      // here additionally pins #785's property at full-document scale, where paths the atomizer
      // unit test cannot reach are exercised.
      const atomizerLogs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...values) => {
        atomizerLogs.push(values.map(String).join(' '));
      });
      let comparison!: Awaited<ReturnType<typeof compareDocuments>>;
      try {
        comparison = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          author: 'RegressionTest',
          leanXmlVerifier: {
            enabled: true,
            executablePath: leanCheckerPath,
            timeoutMs: 120_000,
          },
        });
      } finally {
        logSpy.mockRestore();
      }
      expect(atomizerLogs).toEqual([]);
      expect(
        comparison.documentIntegrity?.status,
        JSON.stringify(comparison.documentIntegrity, null, 2),
      ).toBe('passed');
      expect(comparison.reconstructionModeUsed).toBe('inplace');
      expect(comparison.documentIntegrity?.checkerProtocolVersion).toBe(7);
      expect(comparison.documentIntegrity?.commentInventories?.every((inventory) =>
        inventory.status === 'passed' && inventory.definitions === 6 &&
        inventory.unreferencedDefinitions === 1 &&
        inventory.referenceOccurrences === 5 &&
        inventory.rangeStartOccurrences === 5 &&
        inventory.rangeEndOccurrences === 5,
      ), JSON.stringify({
        inventories: comparison.documentIntegrity?.commentInventories,
        partitions: comparison.documentIntegrity?.referenceSourcePartitions,
      }, null, 2))
        .toBe(true);

      const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
      const comparedXml =
        await (await DocxArchive.load(comparison.document)).getDocumentXml();
      const runMutation = async (rawId: string | undefined) =>
        runLeanXmlTripleVerifier({
          originalDocx: original,
          revisedDocx: revised,
          comparedDocx: await addNestedCommentDefinition(comparison.document, rawId),
          legacyDocumentXml: {
            original: originalXml,
            revised: revisedXml,
            compared: comparedXml,
          },
          reconstructionMode: 'inplace',
          options: { executablePath: leanCheckerPath, timeoutMs: 120_000 },
        });

      for (const rawId of [undefined, 'seven', '1'.repeat(65)]) {
        const certificate = await runMutation(rawId);
        expect(
          certificate.status,
          `${rawId ?? 'missing'}: ${certificate.reason}`,
        ).toBe('failed');
        expect(certificate.checkerProtocolVersion).toBe(7);
        expect(certificate.commentIntegrityFailures).toEqual([
          expect.objectContaining({
            side: 'compared',
            code: 'COMMENT_DEFINITION_NOT_DIRECT',
          }),
        ]);
        expect(certificate.commentIntegrityFailures?.[0]?.canonicalId)
          .toBeUndefined();
      }

      const rangeMutations: Array<[RangeMutation, string]> = [
        ['orphan-start', 'COMMENT_RANGE_START_ORPHANED'],
        ['orphan-end', 'COMMENT_RANGE_END_ORPHANED'],
        ['reversed', 'COMMENT_RANGE_REVERSED'],
        ['duplicate-reference', 'COMMENT_REFERENCE_DUPLICATE'],
        ['malformed-start', 'COMMENT_RANGE_START_ID_MALFORMED'],
        ['overlong-end', 'COMMENT_RANGE_END_ID_TOO_LONG'],
        ['cross-story', 'COMMENT_RANGE_CROSS_STORY'],
        ['missing-association', 'COMMENT_DEFINITION_MISSING'],
        ['start-limit', 'COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED'],
      ];
      for (const [mutation, code] of rangeMutations) {
        const changed = await mutateNvcaCommentRange(comparison.document, mutation);
        const certificate = await runLeanXmlTripleVerifier({
          originalDocx: original,
          revisedDocx: revised,
          comparedDocx: changed.docx,
          legacyDocumentXml: {
            original: originalXml,
            revised: revisedXml,
            compared: changed.documentXml,
          },
          reconstructionMode: 'inplace',
          options: { executablePath: leanCheckerPath, timeoutMs: 120_000 },
        });
        expect(certificate.status, `${mutation}: ${certificate.reason}`).toBe('failed');
        expect(certificate.checkerProtocolVersion).toBe(7);
        expect(certificate.commentIntegrityFailures).toEqual(
          expect.arrayContaining([expect.objectContaining({ side: 'compared', code })]),
        );
      }

      const alias = await mutateNvcaCommentRange(comparison.document, 'alias');
      const aliasCertificate = await runLeanXmlTripleVerifier({
        originalDocx: original,
        revisedDocx: revised,
        comparedDocx: alias.docx,
        legacyDocumentXml: {
          original: originalXml,
          revised: revisedXml,
          compared: alias.documentXml,
        },
        reconstructionMode: 'inplace',
        options: { executablePath: leanCheckerPath, timeoutMs: 120_000 },
      });
      expect(aliasCertificate.status, aliasCertificate.reason).toBe('passed');

      const incompleteCertificate = await runLeanXmlTripleVerifier({
        originalDocx: original,
        revisedDocx: revised,
        comparedDocx: await removeNvcaRetainedFootnotes(comparison.document),
        legacyDocumentXml: {
          original: originalXml,
          revised: revisedXml,
          compared: comparedXml,
        },
        reconstructionMode: 'inplace',
        options: { executablePath: leanCheckerPath, timeoutMs: 120_000 },
      });
      expect(
        incompleteCertificate.status,
        incompleteCertificate.reason,
      ).toBe('failed');
      expect(incompleteCertificate.commentIntegrityFailures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            side: 'compared',
            code: 'COMMENT_SOURCE_PARTITION_INCOMPLETE',
          }),
        ]),
      );
    },
    300_000,
  );
});
