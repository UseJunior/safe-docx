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

async function generatedCommentXml(): Promise<{ documentXml: string; commentsXml: string }> {
  const buffer = await generateDocx(notedSpec());
  return {
    documentXml: (await readZipText(buffer, 'word/document.xml'))!,
    commentsXml: (await readZipText(buffer, 'word/comments.xml'))!,
  };
}

function directElementChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);
}

describe('Traceability: separable drafting-note layer', () => {
  test.openspec('[SDX-GEN-080] a drafting note becomes an anchored comment')(
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

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.6' })(
    'w:comments is the root of the generated comment collection',
    async ({ given, when, then }: AllureBddContext) => {
      let commentsXml!: string;
      let root!: Element;
      await given('a generated document containing drafting notes', async () => {
        ({ commentsXml } = await generatedCommentXml());
      });
      await when('word/comments.xml is parsed', () => {
        root = parseXml(commentsXml).documentElement!;
      });
      await then('the part root is the WordprocessingML comments collection', () => {
        expect(root.namespaceURI).toBe('http://schemas.openxmlformats.org/wordprocessingml/2006/main');
        expect(root.localName).toBe('comments');
      });
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.2' })(
    'each generated comment ID matches its range and reference IDs',
    async ({ given, when, then }: AllureBddContext) => {
      let documentXml!: string;
      let commentsXml!: string;
      await given('a generated document containing two drafting notes', async () => {
        ({ documentXml, commentsXml } = await generatedCommentXml());
      });
      await when('comment definitions and body anchors are read', () => {});
      await then('definition, start, end, and reference ID sequences are identical', () => {
        const comments = parseXml(commentsXml);
        const document = parseXml(documentXml);
        const ids = (name: string, dom: Document) =>
          Array.from(dom.getElementsByTagName(`w:${name}`)).map((element) => element.getAttribute('w:id'));
        expect(ids('comment', comments)).toEqual(['1', '2']);
        expect(ids('commentRangeStart', document)).toEqual(ids('comment', comments));
        expect(ids('commentRangeEnd', document)).toEqual(ids('comment', comments));
        expect(ids('commentReference', document)).toEqual(ids('comment', comments));
      });
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.4' })(
    'commentRangeStart is a direct paragraph child before the anchored content',
    async ({ given, when, then }: AllureBddContext) => {
      let documentXml!: string;
      await given('a generated paragraph carrying a drafting note', async () => {
        ({ documentXml } = await generatedCommentXml());
      });
      await when('the first range start and its paragraph children are inspected', () => {});
      await then('the start is a direct child immediately before the first content run', () => {
        const start = parseXml(documentXml).getElementsByTagName('w:commentRangeStart').item(0)!;
        const paragraph = start.parentNode as Element;
        const children = directElementChildren(paragraph);
        const startIndex = children.indexOf(start);
        expect(paragraph.localName).toBe('p');
        expect(startIndex).toBeGreaterThanOrEqual(0);
        expect(children[startIndex + 1]?.localName).toBe('r');
        expect(children[startIndex + 1]?.textContent).toContain('Confidentiality survives three years.');
      });
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.3' })(
    'commentRangeEnd is a direct paragraph child after the anchored content',
    async ({ given, when, then }: AllureBddContext) => {
      let documentXml!: string;
      await given('a generated paragraph carrying a drafting note', async () => {
        ({ documentXml } = await generatedCommentXml());
      });
      await when('the first range end and its paragraph children are inspected', () => {});
      await then('the end directly follows the final anchored content run', () => {
        const end = parseXml(documentXml).getElementsByTagName('w:commentRangeEnd').item(0)!;
        const paragraph = end.parentNode as Element;
        const children = directElementChildren(paragraph);
        const endIndex = children.indexOf(end);
        expect(paragraph.localName).toBe('p');
        expect(children[endIndex - 1]?.localName).toBe('r');
        expect(children[endIndex - 1]?.textContent).toContain('Confidentiality survives three years.');
      });
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' })(
    'commentReference is inside the trailing paragraph run',
    async ({ given, when, then }: AllureBddContext) => {
      let documentXml!: string;
      await given('a generated paragraph carrying a drafting note', async () => {
        ({ documentXml } = await generatedCommentXml());
      });
      await when('the first comment reference and its ancestors are inspected', () => {});
      await then('the reference is in a run that trails the range end', () => {
        const document = parseXml(documentXml);
        const reference = document.getElementsByTagName('w:commentReference').item(0)!;
        const run = reference.parentNode as Element;
        const paragraph = run.parentNode as Element;
        const children = directElementChildren(paragraph);
        expect(run.localName).toBe('r');
        expect(paragraph.localName).toBe('p');
        expect(directElementChildren(run)).toEqual([reference]);
        expect(children.at(-1)).toBe(run);
        expect(children.at(-2)?.localName).toBe('commentRangeEnd');
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
