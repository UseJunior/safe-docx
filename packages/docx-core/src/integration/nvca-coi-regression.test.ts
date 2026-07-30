/**
 * Regression coverage using the checked-in NVCA COI source package.
 *
 * The revised side is derived from that source with a minimal body-text edit,
 * so both packages retain the real relationship-addressed footer and footnote
 * stories while exercising the two publication modes.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect } from 'vitest';
import {
  acceptAllChanges,
  compareDocuments,
  compareTexts,
  extractTextWithParagraphs,
  rejectAllChanges,
  runLeanXmlTripleVerifier,
  type ReconstructionMode,
} from '@usejunior/docx-compare';
import { DocxDocument } from '../primitives/document.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  getParagraphText,
  replaceParagraphTextRange,
} from '../primitives/text.js';
import { OOXML } from '../primitives/namespaces.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const TEST_FEATURE = 'verify-ancillary-field-stories';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

const sourcePath = path.resolve(
  __dirname,
  '../../../../tests/test_documents/nvca-coi-regression/source.docx',
);
const filledPath = path.resolve(
  __dirname,
  '../../../../tests/test_documents/nvca-coi-regression/filled.docx',
);
const leanCheckerPath = path.resolve(
  __dirname,
  '../../../../verification/lean/.lake/build/bin/leanDocxChecker',
);
const describeWithCompiledLean = fs.existsSync(leanCheckerPath) ? describe : describe.skip;

async function deriveMinimallyEditedRevision(source: Buffer): Promise<Buffer> {
  const document = await DocxDocument.load(source);
  const paragraph = document.getParagraphs().find((candidate) => {
    const text = getParagraphText(candidate);
    return text.length >= 20 &&
      candidate.getElementsByTagNameNS(OOXML.W_NS, 'fldChar').length === 0;
  });
  if (!paragraph) {
    throw new Error('NVCA source has no suitable body paragraph for a minimal text edit');
  }
  const text = getParagraphText(paragraph);
  const replacement = text[0] === 'A' ? 'B' : 'A';
  replaceParagraphTextRange(paragraph, 0, 1, replacement);
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 11.3.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.7
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.10
 */
async function addNvcaEndnoteEvidence(source: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(source);
  const documentXml = await archive.getDocumentXml();
  const paragraphClose = documentXml.indexOf('</w:p>');
  if (paragraphClose < 0) throw new Error('NVCA source has no paragraph for endnote evidence');
  archive.setFile(
    'word/document.xml',
    documentXml.slice(0, paragraphClose) +
      '<w:r><w:endnoteReference w:id="640"/></w:r>' +
      documentXml.slice(paragraphClose),
  );
  const relationshipsPath = 'word/_rels/document.xml.rels';
  const relationships = await archive.getFile(relationshipsPath);
  if (!relationships?.includes('</Relationships>')) {
    throw new Error('NVCA source has no conventional Main Document relationships part');
  }
  const endnotesType =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';
  const existingRelationship = relationships.match(/<Relationship\b[^>]*\/?>/g)
    ?.find((record) => record.includes(`Type="${endnotesType}"`));
  const existingTarget = existingRelationship?.match(/\bTarget="([^"]+)"/)?.[1];
  const endnotesPath = existingTarget ? `word/${existingTarget}` : 'word/endnotes-lean-640.xml';
  if (!existingRelationship) {
    archive.setFile(
      relationshipsPath,
      relationships.replace(
        '</Relationships>',
        `<Relationship Id="rIdLeanEndnotes640" Type="${endnotesType}" ` +
          'Target="endnotes-lean-640.xml"/></Relationships>',
      ),
    );
  }
  const existingEndnotes = await archive.getFile(endnotesPath);
  const userDefinition =
    '<w:endnote w:id="640"><w:p><w:r><w:t>NVCA endnote evidence</w:t></w:r></w:p></w:endnote>';
  archive.setFile(
    endnotesPath,
    existingEndnotes?.includes('</w:endnotes>')
      ? existingEndnotes.replace('</w:endnotes>', `${userDefinition}</w:endnotes>`)
      : `<w:endnotes xmlns:w="${OOXML.W_NS}">${userDefinition}</w:endnotes>`,
  );
  return archive.save();
}

describe('NVCA COI Regression', () => {
  test('should compare COI source vs filled in inplace mode without safety fallback', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let sourceBuf: Buffer;
    let filledBuf: Buffer;
    let res: Awaited<ReturnType<typeof compareDocuments>>;

    await given('COI source and filled fixture files exist and are loaded', async () => {
      if (!fs.existsSync(sourcePath) || !fs.existsSync(filledPath)) {
        console.warn('Skipping NVCA COI Regression: fixture files not found');
        return;
      }
      sourceBuf = fs.readFileSync(sourcePath);
      filledBuf = fs.readFileSync(filledPath);
    });

    await when('documents are compared in inplace mode', async () => {
      res = await compareDocuments(sourceBuf, filledBuf, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
        author: 'RegressionTest',
      });
    });

    await then('it used inplace mode without safety fallback', async () => {
      expect(res.reconstructionModeUsed).toBe('inplace');
      expect(res.fallbackReason).toBeUndefined();
    });

    await and('stats are within expected ranges', async () => {
      expect(res.stats.insertions).toBeLessThan(500);
      expect(res.stats.deletions).toBeLessThan(500);
      expect(res.stats.deletedAtoms).toBeGreaterThan(5000);
    });

    await and('accept-all text matches revised document', async () => {
      const resultArchive = await DocxArchive.load(res.document);
      const resultXml = await resultArchive.getDocumentXml();
      const acceptedXml = acceptAllChanges(resultXml);
      const acceptedText = extractTextWithParagraphs(acceptedXml);

      const revisedArchive = await DocxArchive.load(filledBuf);
      const revisedXml = await revisedArchive.getDocumentXml();
      const revisedText = extractTextWithParagraphs(revisedXml);

      const comparison = compareTexts(revisedText, acceptedText);
      expect(comparison.normalizedIdentical).toBe(true);
    });

    await and('reject-all text matches original document', async () => {
      const resultArchive = await DocxArchive.load(res.document);
      const resultXml = await resultArchive.getDocumentXml();
      const rejectedXml = rejectAllChanges(resultXml);
      const rejectedText = extractTextWithParagraphs(rejectedXml);

      const originalArchive = await DocxArchive.load(sourceBuf);
      const originalXml = await originalArchive.getDocumentXml();
      const originalText = extractTextWithParagraphs(originalXml);

      const comparison = compareTexts(originalText, rejectedText);
      expect(comparison.normalizedIdentical).toBe(true);
    });
    // This drives a full inplace comparison + accept-all + reject-all round-trip on a
    // real ~5000-atom NVCA COI document. In isolation under v8 coverage it runs ~29s
    // (measured identical on 0.18.0 and 0.19.0 — no regression), but in the release
    // preflight it runs concurrently with the full docx-core suite under coverage +
    // parallel workers, where CI contention pushed it past the previous 60s cap. Give
    // it 3 min of headroom for the loaded CI environment.
  }, 180_000);
});

describe('NVCA COI ancillary field evidence', () => {
  for (const reconstructionMode of ['inplace', 'rebuild'] as const satisfies readonly ReconstructionMode[]) {
    test
      .openspec('[SDX-ANC-BOUNDARY-01] NVCA COI source-derived pair supplies non-vacuous evidence in both modes')(
      `[SDX-ANC-NVCA-${reconstructionMode}] real source-derived pair preserves footer PAGE and footnote REF in ${reconstructionMode}`,
      async () => {
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.44' });
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' });

        if (!fs.existsSync(sourcePath)) {
          throw new Error(`NVCA COI source fixture not found: ${sourcePath}`);
        }
        const source = fs.readFileSync(sourcePath);
        const revised = await deriveMinimallyEditedRevision(source);

        const result = await compareDocuments(source, revised, {
          engine: 'atomizer',
          reconstructionMode,
          author: 'RegressionTest',
        });
        const evidence = result.ancillaryFieldEvidence;
        const footerPageRanges = evidence?.ranges.filter((range) =>
          range.instructionKind === 'PAGE' &&
          /^word\/footer[^/]*\.xml$/u.test(range.locator.normalizedPartPath),
        ) ?? [];
        const footnoteRefRanges = evidence?.ranges.filter((range) =>
          range.instructionKind === 'REF' &&
          range.locator.normalizedPartPath === 'word/footnotes.xml' &&
          range.locator.entryId !== undefined,
        ) ?? [];

        expect(result.reconstructionModeUsed).toBe(reconstructionMode);
        expect(result.fallbackReason).toBeUndefined();
        expect(evidence).toMatchObject({
          status: 'passed',
          reconstructionMode,
        });
        expect(footerPageRanges.length).toBeGreaterThan(0);
        expect(footnoteRefRanges.length).toBeGreaterThan(0);
        expect([...footerPageRanges, ...footnoteRefRanges].every((range) =>
          range.canonicalMatch &&
          range.provenance === 'base' &&
          range.sourceSide === (reconstructionMode === 'inplace' ? 'revised' : 'original'),
        )).toBe(true);
      },
      60_000,
    );
  }
});

describeWithCompiledLean('NVCA COI Lean relationship-story evidence', () => {
  test.openspec('[LEAN-NOTE-04] NVCA source-derived note evidence is non-vacuous')(
    'checks source-derived footnote and added endnote references before a poison mutation',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.7' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '11.3.4' });
      if (!fs.existsSync(sourcePath)) throw new Error('NVCA source fixture is missing');
      const original = await addNvcaEndnoteEvidence(fs.readFileSync(sourcePath));
      const revised = await deriveMinimallyEditedRevision(original);
      const comparison = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
        author: 'RegressionTest',
        leanXmlVerifier: { enabled: true, executablePath: leanCheckerPath, timeoutMs: 60_000 },
      });
      expect(
        comparison.documentIntegrity?.status,
        JSON.stringify(comparison.documentIntegrity, null, 2),
      ).toBe('passed');
      expect(comparison.documentIntegrity?.checkerProtocolVersion).toBe(7);
      expect(comparison.documentIntegrity?.noteInventories?.every((inventory) =>
        inventory.referenceOccurrences > 0 && inventory.definitions.user > 0,
      )).toBe(true);

      const poisoned = await DocxArchive.load(comparison.document);
      const endnotesPath = comparison.documentIntegrity?.noteInventories?.find((inventory) =>
        inventory.side === 'compared' && inventory.kind === 'endnotes',
      )?.relationship?.normalizedPartPath;
      if (!endnotesPath) throw new Error('NVCA evidence has no selected compared endnotes path');
      const endnotesXml = await poisoned.getFile(endnotesPath);
      if (!endnotesXml) throw new Error('NVCA selected endnotes part is missing');
      poisoned.setFile(
        endnotesPath,
        endnotesXml.replace(
          '</w:endnotes>',
          '<w:endnote w:id="641"><w:p>' +
            '<w:r><w:endnoteReference w:id="640"/></w:r>' +
            '<w:r><w:footnoteReference w:id="1"/></w:r>' +
            '</w:p></w:endnote>' +
            '</w:endnotes>',
        ),
      );
      const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
      const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
      const comparedXml = await (await DocxArchive.load(comparison.document)).getDocumentXml();
      const runCompared = async (comparedDocx: Buffer) => runLeanXmlTripleVerifier({
        originalDocx: original,
        revisedDocx: revised,
        comparedDocx,
        legacyDocumentXml: { original: originalXml, revised: revisedXml, compared: comparedXml },
        reconstructionMode: 'inplace',
        options: { executablePath: leanCheckerPath, timeoutMs: 60_000 },
      });
      const expectedRelationshipStories = comparison.documentIntegrity?.relationshipStories;
      const failed = await runCompared(await poisoned.save());
      expect(failed.status).toBe('failed');
      expect(failed.noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_REFERENCE_IN_DEFINITION_STORY',
      )).toBe(true);
      expect(failed.relationshipStories).toEqual(expectedRelationshipStories);

      const missingDefinition = await DocxArchive.load(comparison.document);
      missingDefinition.setFile(
        endnotesPath,
        endnotesXml.replace(
          '<w:endnote w:id="640"><w:p><w:r><w:t>NVCA endnote evidence</w:t></w:r></w:p></w:endnote>',
          '',
        ),
      );
      const missingDefinitionResult = await runCompared(await missingDefinition.save());
      expect(missingDefinitionResult.noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_REFERENCE_MISSING_DEFINITION' &&
        issue.side === 'compared' && issue.kind === 'endnotes',
      )).toBe(true);
      expect(missingDefinitionResult.relationshipStories).toEqual(expectedRelationshipStories);

      const missingRelationship = await DocxArchive.load(comparison.document);
      const relsPath = 'word/_rels/document.xml.rels';
      const relsXml = await missingRelationship.getFile(relsPath);
      const endnoteRelationshipId = comparison.documentIntegrity?.noteInventories?.find((inventory) =>
        inventory.side === 'compared' && inventory.kind === 'endnotes',
      )?.relationship?.relationshipId;
      if (!relsXml || !endnoteRelationshipId) {
        throw new Error('NVCA compared endnote relationship evidence is missing');
      }
      const relationshipPattern = new RegExp(
        `<Relationship\\b(?=[^>]*\\bId="${endnoteRelationshipId}")[^>]*` +
        `(?:/>|>[\\s\\S]*?</Relationship>)`,
      );
      const relationshipsWithoutEndnotes = relsXml.replace(relationshipPattern, '');
      expect(relationshipsWithoutEndnotes).not.toBe(relsXml);
      missingRelationship.setFile(relsPath, relationshipsWithoutEndnotes);
      const missingRelationshipResult = await runCompared(await missingRelationship.save());
      expect(
        missingRelationshipResult.status,
        JSON.stringify(missingRelationshipResult, null, 2),
      ).toBe('failed');
      expect(missingRelationshipResult.noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_RELATIONSHIP_REQUIRED' &&
        issue.side === 'compared' && issue.kind === 'endnotes',
      )).toBe(true);

      const lexicalAlias = await DocxArchive.load(comparison.document);
      lexicalAlias.setFile(
        endnotesPath,
        endnotesXml.replace('w:id="640"', 'w:id=" +0640 "'),
      );
      const lexicalAliasResult = await runCompared(await lexicalAlias.save());
      expect(lexicalAliasResult.status).toBe('passed');
      expect(lexicalAliasResult.relationshipStories).toEqual(expectedRelationshipStories);

      const collision = await DocxArchive.load(comparison.document);
      collision.setFile(
        endnotesPath,
        endnotesXml.replace(
          '</w:endnotes>',
          '<w:endnote w:id="+0640"><w:p/></w:endnote>' +
            '<w:endnote w:id="00640"><w:p/></w:endnote></w:endnotes>',
        ),
      );
      const collisionResult = await runCompared(await collision.save());
      expect(collisionResult.noteIntegrityFailures?.filter((issue) =>
        issue.code === 'NOTE_USER_DEFINITION_DUPLICATE' &&
        issue.side === 'compared' && issue.kind === 'endnotes',
      )).toEqual([
        expect.objectContaining({ canonicalId: '640', occurrenceCount: 2 }),
      ]);

      const relocated = await DocxArchive.load(comparison.document);
      const relocatedPath = 'word/notes/nvca-endnotes.xml';
      relocated.setFile(relocatedPath, endnotesXml);
      const currentTarget = endnotesPath.replace(/^word\//, '');
      relocated.setFile(
        relsPath,
        relsXml.replace(`Target="${currentTarget}"`, 'Target="notes/nvca-endnotes.xml"'),
      );
      const relocatedResult = await runCompared(await relocated.save());
      expect(relocatedResult.status).toBe('passed');
      expect(relocatedResult.noteInventories?.find((inventory) =>
        inventory.side === 'compared' && inventory.kind === 'endnotes',
      )?.relationship?.normalizedPartPath).toBe(relocatedPath);
      expect(relocatedResult.relationshipStories).toEqual(expectedRelationshipStories);
    },
    300_000,
  );

  test.openspec('[LEAN-REL-12] Real NVCA selected-story mutations fail')(
    'keeps selection stable and fails every deduplicated selected header/footer mutation',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.3' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.4' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' });
      if (!fs.existsSync(sourcePath)) {
        throw new Error('NVCA source fixture is missing');
      }

      const source = fs.readFileSync(sourcePath);
      const revised = await deriveMinimallyEditedRevision(source);
      const baseline = await compareDocuments(source, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
        author: 'RegressionTest',
        leanXmlVerifier: { enabled: true, executablePath: leanCheckerPath, timeoutMs: 60_000 },
      });
      const evidence = baseline.documentIntegrity;
      expect(evidence?.status).toBe('passed');
      expect(evidence?.checkerProtocolVersion).toBe(7);
      expect(evidence?.relationshipSlots?.length).toBeGreaterThan(0);
      expect(evidence?.relationshipStories?.length).toBeGreaterThan(0);

      const originalXml = await (await DocxArchive.load(source)).getDocumentXml();
      const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
      const comparedXml = await (await DocxArchive.load(baseline.document)).getDocumentXml();
      const baselineSlots = evidence!.relationshipSlots!;

      for (const selectedStory of evidence!.relationshipStories!) {
        const mutatedArchive = await DocxArchive.load(baseline.document);
        const selectedXml = await mutatedArchive.getFile(selectedStory.comparedPartPath);
        if (!selectedXml) throw new Error(`missing selected NVCA part: ${selectedStory.comparedPartPath}`);
        const closingRoot = selectedStory.kind === 'header' ? '</w:hdr>' : '</w:ftr>';
        if (!selectedXml.includes(closingRoot)) {
          throw new Error(`selected NVCA part uses an unexpected root spelling: ${selectedStory.comparedPartPath}`);
        }
        mutatedArchive.setFile(
          selectedStory.comparedPartPath,
          selectedXml.replace(
            closingRoot,
            '<w:p><w:r><w:t>LEAN-COMPARED-ONLY-MUTATION</w:t></w:r></w:p>' + closingRoot,
          ),
        );
        const mutatedCompared = await mutatedArchive.save();
        const certificate = await runLeanXmlTripleVerifier({
          originalDocx: source,
          revisedDocx: revised,
          comparedDocx: mutatedCompared,
          legacyDocumentXml: { original: originalXml, revised: revisedXml, compared: comparedXml },
          reconstructionMode: 'inplace',
          options: { executablePath: leanCheckerPath, timeoutMs: 60_000 },
        });

        expect(certificate.status, selectedStory.comparedPartPath).toBe('failed');
        expect(certificate.relationshipSelectionFailures, selectedStory.comparedPartPath).toEqual([]);
        expect(certificate.relationshipSlots, selectedStory.comparedPartPath).toEqual(baselineSlots);
        const failed = certificate.relationshipStories?.find((story) =>
          story.physicalStoryOrdinal === selectedStory.physicalStoryOrdinal);
        expect(failed?.status, selectedStory.comparedPartPath).toBe('failed');
        expect(failed?.selectingSlotOrdinals, selectedStory.comparedPartPath).toEqual(
          selectedStory.selectingSlotOrdinals,
        );
        expect(
          Object.values(failed?.checks ?? {}).some((check) => check.status === 'failed'),
          selectedStory.comparedPartPath,
        ).toBe(true);
      }
    },
    300_000,
  );
});
