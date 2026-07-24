import { describe, expect } from 'vitest';
import { OOXML } from '../primitives/namespaces.js';
import { parseXml } from '../primitives/xml.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildSyntheticDocx } from './synthetic-docx-fixture.js';

const test = testAllure.epic('Document Generation').withLabels({
  feature: 'Synthetic DOCX Fixture',
  severity: 'critical',
});

function elements(doc: Document, namespace: string, localName: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS(namespace, localName));
}

describe('synthetic DOCX fixture escaping', () => {
  test(
    'semantic text inputs remain text in every generated story',
    async ({ when, then }: AllureBddContext) => {
      const text = 'safe & <w:r><w:t>injected</w:t></w:r> "quoted"';
      let archive: DocxArchive | undefined;

      await when('the same adversarial text is used across document stories', async () => {
        archive = await DocxArchive.load(
          await buildSyntheticDocx({
            paragraphs: [text],
            footnoteOnParagraph: 0,
            footnoteText: text,
            endnoteOnParagraph: 0,
            endnoteText: text,
            commentOnParagraph: 0,
            commentText: text,
            replyText: text,
          }),
        );
      });

      await then('each story contains the exact text and no injected run', async () => {
        if (!archive) throw new Error('missing synthetic archive');
        const partPaths = [
          'word/document.xml',
          'word/footnotes.xml',
          'word/endnotes.xml',
          'word/comments.xml',
        ];
        for (const path of partPaths) {
          const xml = await archive.getFile(path);
          if (!xml) throw new Error(`missing ${path}`);
          const doc = parseXml(xml);
          expect(elements(doc, OOXML.W_NS, 't').some((node) => node.textContent === text)).toBe(true);
          expect(elements(doc, OOXML.W_NS, 't').some((node) => node.textContent === 'injected')).toBe(false);
        }
      });
    },
  );

  test(
    'semantic attribute inputs remain in their original OOXML attributes',
    async ({ when, then }: AllureBddContext) => {
      const value = 'safe" injected="yes & < >';
      let archive: DocxArchive | undefined;

      await when('move, bookmark, and comment metadata contain attribute delimiters', async () => {
        archive = await DocxArchive.load(
          await buildSyntheticDocx({
            paragraphs: ['from', 'to', 'bookmark', 'comment'],
            trackedMove: { from: 0, to: 1, name: value, author: value },
            bookmarkOnParagraph: { paragraph: 2, name: value },
            siblingBookmarkBefore: { index: 2, name: value },
            commentOnParagraph: 3,
            commentAuthor: value,
            replyText: 'reply',
            replyAuthor: value,
            commentAncillaryParts: true,
          }),
        );
      });

      await then('all metadata round-trips without injected attributes', async () => {
        if (!archive) throw new Error('missing synthetic archive');
        const documentXml = await archive.getDocumentXml();
        const document = parseXml(documentXml);
        const move = elements(document, OOXML.W_NS, 'moveFromRangeStart')[0];
        if (!move) throw new Error('missing tracked move');
        expect(move.getAttributeNS(OOXML.W_NS, 'name')).toBe(value);
        expect(move.getAttributeNS(OOXML.W_NS, 'author')).toBe(value);
        expect(move.hasAttribute('injected')).toBe(false);

        for (const bookmark of elements(document, OOXML.W_NS, 'bookmarkStart')) {
          expect(bookmark.getAttributeNS(OOXML.W_NS, 'name')).toBe(value);
          expect(bookmark.hasAttribute('injected')).toBe(false);
        }

        const commentsXml = await archive.getFile('word/comments.xml');
        const peopleXml = await archive.getFile('word/people.xml');
        if (!commentsXml || !peopleXml) throw new Error('missing comment metadata parts');
        for (const comment of elements(parseXml(commentsXml), OOXML.W_NS, 'comment')) {
          expect(comment.getAttributeNS(OOXML.W_NS, 'author')).toBe(value);
          expect(comment.hasAttribute('injected')).toBe(false);
        }
        for (const person of elements(parseXml(peopleXml), OOXML.W15_NS, 'person')) {
          expect(person.getAttributeNS(OOXML.W15_NS, 'author')).toBe(value);
          expect(person.hasAttribute('injected')).toBe(false);
        }
        for (const presence of elements(parseXml(peopleXml), OOXML.W15_NS, 'presenceInfo')) {
          expect(presence.getAttributeNS(OOXML.W15_NS, 'userId')).toBe(`${value}@example.com`);
          expect(presence.hasAttribute('injected')).toBe(false);
        }
      });
    },
  );
});
