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
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.10
 */
async function addSelectedCommentsPart(source: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(source);
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
      '<w:comment w:id="710"><w:p/></w:comment></w:comments>',
  );
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
      expect(originalAtomCount).toBe(41_615);

      const revised = await deriveMinimallyEditedRevision(original);
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
      expect(atomizerLogs.some((message) =>
        message.includes('word-split to 41621, punct-merged to 41621'),
      )).toBe(true);
      expect(
        comparison.documentIntegrity?.status,
        JSON.stringify(comparison.documentIntegrity, null, 2),
      ).toBe('passed');
      expect(comparison.reconstructionModeUsed).toBe('inplace');
      expect(comparison.documentIntegrity?.checkerProtocolVersion).toBe(6);
      expect(comparison.documentIntegrity?.commentInventories?.every((inventory) =>
        inventory.status === 'passed' && inventory.definitions === 1,
      )).toBe(true);

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
        expect(certificate.checkerProtocolVersion).toBe(6);
        expect(certificate.commentIntegrityFailures).toEqual([
          expect.objectContaining({
            side: 'compared',
            code: 'COMMENT_DEFINITION_NOT_DIRECT',
          }),
        ]);
        expect(certificate.commentIntegrityFailures?.[0]?.canonicalId)
          .toBeUndefined();
      }
    },
    300_000,
  );
});
