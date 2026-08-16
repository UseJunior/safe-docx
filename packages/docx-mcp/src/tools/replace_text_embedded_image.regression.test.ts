/**
 * Regression test for issue #739: blanking a paragraph's visible text with
 * replace_text must not destroy an inline image in the same paragraph.
 *
 * Exercises the full package path — open a DOCX carrying a DrawingML inline
 * picture (w:drawing + r:embed relationship + word/media part), blank the
 * caption through the real replace_text tool, save, and assert the drawing
 * node, the relationship entry, and the media part all survive and the saved
 * package reopens cleanly. Covers both the clean and the tracked flow; in the
 * tracked flow the image must remain a live run, not part of w:del.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';
import { openDocument } from './open_document.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Embedded Object Preservation' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const INLINE_IMAGE_RUN =
  '<w:r><w:drawing>' +
  '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="914400" cy="914400"/>' +
  '<wp:docPr id="1" name="Picture 1"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:nvPicPr><pic:cNvPr id="1" name="Picture 1"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
  ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"' +
  ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">' +
  '<w:body>' +
  '<w:p><w:r><w:t xml:space="preserve">Intro paragraph.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Figure 1 caption.</w:t></w:r>' + INLINE_IMAGE_RUN + '</w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Outro paragraph.</w:t></w:r></w:p>' +
  '</w:body></w:document>';

const IMAGE_PACKAGE_EXTRA_FILES: Record<string, string | Buffer> = {
  '[Content_Types].xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>',
  'word/_rels/document.xml.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '</Relationships>',
  'word/media/image1.png': PNG_1X1,
};

function findDrawings(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'drawing'));
}

function hasRevisionWrapperAncestor(el: Element): boolean {
  let cur: Node | null = el.parentNode;
  while (cur) {
    if (
      cur.nodeType === 1 &&
      (cur as Element).namespaceURI === W_NS &&
      ['ins', 'del', 'moveFrom', 'moveTo'].includes((cur as Element).localName ?? '')
    ) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

async function assertImagePackageIntact(outPath: string): Promise<Document> {
  const buffer = await fs.readFile(outPath);
  const archive = await DocxArchive.load(buffer);

  const documentXml = await archive.getFile('word/document.xml');
  expect(documentXml).toBeTruthy();
  const doc = parseXml(documentXml!);
  const drawings = findDrawings(doc);
  expect(drawings).toHaveLength(1);
  expect(documentXml).toContain('r:embed="rId9"');

  const rels = await archive.getFile('word/_rels/document.xml.rels');
  expect(rels).toContain('Id="rId9"');
  expect(rels).toContain('Target="media/image1.png"');

  const media = await archive.getFileBuffer('word/media/image1.png');
  expect(media).toBeTruthy();
  expect(Buffer.compare(media!, PNG_1X1)).toBe(0);

  return doc;
}

describe('replace_text — embedded image survives caption blanking (#739)', () => {
  registerCleanup();

  test('clean flow: blanking the caption keeps the drawing, relationship, and media part', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: null });

    const session = await given('a DOCX whose second paragraph holds a caption and an inline image', () =>
      openSession([], { mgr, xml: DOCUMENT_XML, extraFiles: IMAGE_PACKAGE_EXTRA_FILES }),
    );
    const captionParaId = session.paraIds[1]!;

    const outPath = path.join(session.tmpDir, 'out-clean.docx');
    await when('replace_text blanks the caption and the session is saved clean', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: captionParaId,
        old_string: 'Figure 1 caption.',
        new_string: '',
        instruction: 'blank the figure caption',
      });
      assertSuccess(replaced, 'replace_text');
      const saved = await save(mgr, {
        file_path: session.inputPath,
        save_to_local_path: outPath,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save');
    });

    await then('the drawing, its relationship, and the media part survive and the package reopens', async () => {
      const doc = await assertImagePackageIntact(outPath);
      expect(hasRevisionWrapperAncestor(findDrawings(doc)[0]!)).toBe(false);

      const reopened = await openDocument(createTestSessionManager(), { file_path: outPath });
      assertSuccess(reopened, 'reopen');
    });
  });

  test('tracked flow: the drawing stays a live run outside w:del while the caption is tracked-deleted', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' });

    const session = await given('a DOCX whose second paragraph holds a caption and an inline image', () =>
      openSession([], { mgr, xml: DOCUMENT_XML, extraFiles: IMAGE_PACKAGE_EXTRA_FILES }),
    );
    const captionParaId = session.paraIds[1]!;

    const outPath = path.join(session.tmpDir, 'out-tracked.docx');
    await when('replace_text blanks the caption under tracked changes and the session is saved tracked', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: captionParaId,
        old_string: 'Figure 1 caption.',
        new_string: '',
        instruction: 'blank the figure caption',
      });
      assertSuccess(replaced, 'replace_text');
      const saved = await save(mgr, {
        file_path: session.inputPath,
        save_to_local_path: outPath,
        save_format: 'tracked',
      });
      assertSuccess(saved, 'save');
    });

    await then('the drawing survives live and the caption text sits inside w:del', async () => {
      const doc = await assertImagePackageIntact(outPath);
      const drawing = findDrawings(doc)[0]!;
      expect(hasRevisionWrapperAncestor(drawing)).toBe(false);

      const delTexts = Array.from(doc.getElementsByTagNameNS(W_NS, 'delText'))
        .map((t) => t.textContent ?? '')
        .join('');
      expect(delTexts).toContain('Figure 1 caption.');

      const reopened = await openDocument(createTestSessionManager(), { file_path: outPath });
      assertSuccess(reopened, 'reopen');
    });
  });
});
