import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

const COMMENT_PARTS = ['word/comments.xml', 'word/commentsExtended.xml', 'word/people.xml'] as const;

function notedSpec(): DocumentSpec {
  return {
    meta: { title: 'Drafting notes', author: 'Jane Doe', createdIso: '2026-06-11T00:00:00Z' },
    sections: [
      {
        blocks: [
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Recitals.' }] },
          {
            kind: 'paragraph',
            note: { text: 'Confirm the survival period with the client.', author: 'John Smith', dateIso: '2026-06-10T12:00:00Z' },
            runs: [{ kind: 'text', text: 'Confidentiality survives three years.' }],
          },
          {
            kind: 'paragraph',
            note: { text: 'Mirror the governing-law choice from the MSA.' },
            runs: [{ kind: 'text', text: 'Governing law: Delaware.' }],
          },
        ],
      },
    ],
  };
}

/** The same content with no notes declared at all. */
function bareSpec(): DocumentSpec {
  const spec = notedSpec();
  for (const block of spec.sections[0]!.blocks) {
    if (block.kind === 'paragraph') delete block.note;
  }
  return spec;
}

describe('Traceability: separable drafting-note layer', () => {
  test
    .openspec('[SDX-GEN-080] a drafting note becomes an anchored comment')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.6' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.4' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.3' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' },
    )(
    'Scenario: a drafting note becomes an anchored comment',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('paragraphs carrying drafting notes, compiled with notes enabled (the default)', async () => {
        buffer = await generateDocx(notedSpec());
        expect((await checkGeneratedPackage(buffer)).issues).toEqual([]);
      });

      let documentXml!: string;
      let commentsXml!: string;
      await when('the document and comments parts are parsed back', async () => {
        documentXml = (await readZipText(buffer, 'word/document.xml'))!;
        commentsXml = (await readZipText(buffer, 'word/comments.xml'))!;
        expect(commentsXml).toBeTruthy();
        await attachPrettyXml('word/comments.xml', commentsXml);
      });

      await then('the package contains the comment trio with the note text and metadata', async () => {
        for (const part of ['word/commentsExtended.xml', 'word/people.xml']) {
          expect(await readZipText(buffer, part)).toBeTruthy();
        }
        const comments = Array.from(parseXml(commentsXml).getElementsByTagName('w:comment'));
        expect(comments).toHaveLength(2);
        expect(comments[0]!.getAttribute('w:author')).toBe('John Smith');
        expect(comments[0]!.getAttribute('w:date')).toBe('2026-06-10T12:00:00Z');
        // Authorless note falls back to the document author; dateless to createdIso.
        expect(comments[1]!.getAttribute('w:author')).toBe('Jane Doe');
        expect(comments[1]!.getAttribute('w:date')).toBe('2026-06-11T00:00:00Z');
        expect(commentsXml).toContain('Confirm the survival period with the client.');
      });

      await then('each noted paragraph carries range anchors and a reference with matching ids', async () => {
        const dom = parseXml(documentXml);
        const starts = Array.from(dom.getElementsByTagName('w:commentRangeStart'));
        const ends = Array.from(dom.getElementsByTagName('w:commentRangeEnd'));
        const refs = Array.from(dom.getElementsByTagName('w:commentReference'));
        expect(starts.map((el) => el.getAttribute('w:id'))).toEqual(['1', '2']);
        expect(ends.map((el) => el.getAttribute('w:id'))).toEqual(['1', '2']);
        expect(refs.map((el) => el.getAttribute('w:id'))).toEqual(['1', '2']);
      });
    },
  );

  test.openspec('[SDX-GEN-081] compile-time omission leaves the body identical')(
    'Scenario: compile-time omission leaves the body identical',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let withNotes!: Buffer;
      let disabledViaSpec!: Buffer;
      let disabledViaOpts!: Buffer;
      let bare!: Buffer;
      await given('the same noted spec compiled with notes enabled and disabled, plus a never-noted control', async () => {
        withNotes = await generateDocx(notedSpec());
        disabledViaSpec = await generateDocx({ ...notedSpec(), options: { includeDraftingNotes: false } });
        disabledViaOpts = await generateDocx(notedSpec(), { includeDraftingNotes: false });
        bare = await generateDocx(bareSpec());
      });

      let disabledDocumentXml!: string;
      await when('the body text layers are extracted', async () => {
        disabledDocumentXml = (await readZipText(disabledViaSpec, 'word/document.xml'))!;
        expect(disabledDocumentXml).toBeTruthy();
      });

      await then('the disabled outputs are byte-identical to the never-noted control', async () => {
        expect(disabledViaSpec.equals(bare)).toBe(true);
        expect(disabledViaOpts.equals(bare)).toBe(true);
        await attachPrettyJson('byte-comparison', {
          disabledViaSpecEqualsBare: disabledViaSpec.equals(bare),
          disabledViaOptsEqualsBare: disabledViaOpts.equals(bare),
        });
      });

      await then('the disabled output contains no comment parts or anchors, while the enabled one does', async () => {
        for (const part of COMMENT_PARTS) {
          expect(await readZipText(disabledViaSpec, part)).toBeNull();
          expect(await readZipText(withNotes, part)).toBeTruthy();
        }
        expect(disabledDocumentXml).not.toMatch(/commentRangeStart|commentRangeEnd|commentReference/);
      });
    },
  );

  test.openspec('[SDX-GEN-082] notes can be stripped after generation')(
    'Scenario: notes can be stripped after generation',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let doc!: DocxDocument;
      await given('a generated document with drafting notes', async () => {
        const buffer = await generateDocx(notedSpec());
        doc = await DocxDocument.load(buffer);
        expect((await readZipText(buffer, 'word/comments.xml'))!).toContain('Mirror the governing-law');
      });

      let stripped!: Buffer;
      await when('each comment is deleted through the existing comment-deletion path', async () => {
        await doc.deleteComment({ commentId: 1 });
        await doc.deleteComment({ commentId: 2 });
        stripped = (await doc.toBuffer()).buffer;
        await attachPrettyJson('stripped-size', { bytes: stripped.length });
      });

      await then('the result contains no comment anchors or references and the comments part is empty', async () => {
        const documentXml = (await readZipText(stripped, 'word/document.xml'))!;
        expect(documentXml).not.toMatch(/commentRangeStart|commentRangeEnd|commentReference/);
        const commentsXml = await readZipText(stripped, 'word/comments.xml');
        if (commentsXml !== null) {
          expect(parseXml(commentsXml).getElementsByTagName('w:comment')).toHaveLength(0);
        }
      });

      await then('the stripped document still passes structural validation and loads', async () => {
        const result = await checkGeneratedPackage(stripped);
        expect(result.issues).toEqual([]);
        const reloaded = await DocxDocument.load(stripped);
        reloaded.insertParagraphBookmarks('sdx-gen-082');
        const texts = reloaded.readParagraphs().paragraphs.map((p) => p.text);
        expect(texts.join('\n')).toContain('Confidentiality survives three years.');
      });
    },
  );

  test.openspec('[SDX-GEN-083] comment metadata is deterministic')(
    'Scenario: comment metadata is deterministic',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a spec with drafting notes carrying explicit ISO dates', async () => {
        spec = notedSpec();
        expect(spec.sections[0]!.blocks.some((b) => b.kind === 'paragraph' && b.note?.dateIso)).toBe(true);
      });

      let first!: Buffer;
      let second!: Buffer;
      await when('it is compiled twice', async () => {
        first = await generateDocx(spec);
        second = await generateDocx(spec);
      });

      await then('the outputs are byte-identical', async () => {
        expect(second.equals(first)).toBe(true);
        expect(first.length).toBeGreaterThan(0);
      });

      await then('ids, paraIds, and dates derive only from the spec and compile context', async () => {
        const commentsXml = (await readZipText(first, 'word/comments.xml'))!;
        const comments = Array.from(parseXml(commentsXml).getElementsByTagName('w:comment'));
        expect(comments.map((c) => c.getAttribute('w:id'))).toEqual(['1', '2']);
        const extendedXml = (await readZipText(first, 'word/commentsExtended.xml'))!;
        const paraIds = Array.from(parseXml(extendedXml).getElementsByTagName('w15:commentEx')).map((el) =>
          el.getAttribute('w15:paraId'),
        );
        expect(paraIds).toEqual(['00000001', '00000002']);
        expect(commentsXml).toContain('w14:paraId="00000001"');
        await attachPrettyJson('deterministic-metadata', { paraIds });
      });
    },
  );

  test('phase 6 drafting-notes artifact loads with comments visible to the comment APIs', async () => {
    const buffer = await generateDocx(notedSpec());
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('sdx-gen-phase6');
    const texts = doc.readParagraphs().paragraphs.map((p) => p.text);
    expect(texts.join('\n')).toContain('Governing law: Delaware.');
    const commentsXml = (await readZipText(buffer, 'word/comments.xml'))!;
    expect(commentsXml).toContain('Mirror the governing-law choice from the MSA.');
    const { writeIntegrationArtifact } = await import('../integration/output-artifacts.js');
    const outputPath = await writeIntegrationArtifact('generation-phase6-drafting-notes.docx', buffer);
    expect(outputPath).toContain('generation-phase6-drafting-notes.docx');
  });
});
