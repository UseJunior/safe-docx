import { describe, expect } from 'vitest';
import { serializeXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { replaceText } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Tag Parser' });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('font size validation before mutation', () => {
  registerCleanup();

  for (const operation of ['replace_text', 'insert_paragraph'] as const) {
    test(
      `${operation} rejects invalid sizes without changing XML or edit counters`, async () => {
        const opened = await openSession(['Original target', 'Tail paragraph']);
        const session = (await opened.mgr.getSessionByFilePath(opened.filePath))!;
        const documentXml = () => serializeXml(session.doc.getParagraphs()[0]!.ownerDocument!);
        const beforeXml = documentXml();
        const beforeCounters = { editCount: session.editCount, editRevision: session.editRevision };

        for (const size of ['NaN', 'Infinity', '-Infinity', '0', '-0', '-1', '1e309', '1e308', '1e-999', 'abc', ' ']) {
          // Valid text precedes the invalid nested tag; insertion also has a
          // complete valid paragraph before the paragraph that must be refused.
          const markup = `valid <font size="10.5">outer<font size="${size}">invalid</font></font>`;
          const result = operation === 'replace_text'
            ? await replaceText(opened.mgr, {
              file_path: opened.filePath,
              target_paragraph_id: opened.firstParaId,
              old_string: 'Original target',
              new_string: markup,
              normalize_first: true,
              instruction: 'reject invalid replacement font size',
            })
            : await insertParagraph(opened.mgr, {
              file_path: opened.filePath,
              positional_anchor_node_id: opened.firstParaId,
              position: 'AFTER',
              new_string: `valid paragraph\n\n${markup}`,
              instruction: 'reject invalid insertion font size',
            });

          assertFailure(result);
          expect(result.error?.message).toContain('Tag parse error in new_string: Invalid font size:');
          expect(documentXml()).toBe(beforeXml);
          expect({ editCount: session.editCount, editRevision: session.editRevision }).toEqual(beforeCounters);
        }
      },
    );

    test(
      `${operation} preserves fractional sizes, inheritance, and outer size restoration`, async () => {
        const opened = await openSession(['Original target']);
        const markup = '<font size="10.5">a<font size="12">b</font><font color="FF0000">c</font>d</font>';
        const result = operation === 'replace_text'
          ? await replaceText(opened.mgr, {
            file_path: opened.filePath,
            target_paragraph_id: opened.firstParaId,
            old_string: 'Original target',
            new_string: markup,
            instruction: 'replace with nested fractional font sizes',
          })
          : await insertParagraph(opened.mgr, {
            file_path: opened.filePath,
            positional_anchor_node_id: opened.firstParaId,
            position: 'AFTER',
            new_string: markup,
            instruction: 'insert nested fractional font sizes',
          });
        assertSuccess(result);
        const session = (await opened.mgr.getSessionByFilePath(opened.filePath))!;
        const paragraphId = operation === 'replace_text' ? opened.firstParaId : String(result.new_paragraph_id);
        const paragraph = session.doc.getParagraphElementById(paragraphId)!;
        expect(session.doc.getParagraphTextById(paragraphId)).toBe('abcd');
        const runs = Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r')) as Element[];
        const sizedText = runs.flatMap((run) => {
          const text = Array.from(run.getElementsByTagNameNS(W_NS, 't') as ArrayLike<Element>)
            .map((node) => node.textContent).join('');
          return text ? [{ text, size: run.getElementsByTagNameNS(W_NS, 'sz').item(0)?.getAttribute('w:val') }] : [];
        });
        expect(sizedText).toEqual([
          { text: 'a', size: '21' }, { text: 'b', size: '24' },
          { text: 'c', size: '21' }, { text: 'd', size: '21' },
        ]);
      },
    );
  }
});
