import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';
import { DocxZip, createZipBuffer, readZipText } from './zip.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Mutation snapshot isolation' });

describe('official mutation snapshots and forks', () => {
  test('fork edits change deterministic contents without changing the source DOM, view or version', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(
      paragraphWithText('Alpha') + paragraphWithText('Beta'),
    ));
    doc.insertParagraphBookmarks('snapshot-test');
    const view = doc.buildDocumentView({ includeSemanticTags: false });
    const id = view.nodes[0]!.id;
    const version = doc.getMutationVersion();
    const before = await doc.getMutationSnapshot();
    const fork = doc.fork();
    expect(fork.getMutationVersion()).toBe(version);
    expect(await fork.getMutationSnapshot()).toEqual(before);
    fork.replaceText({ targetParagraphId: id, findText: 'Alpha', replaceText: 'Gamma' });
    const after = await fork.getMutationSnapshot();
    expect(after).not.toEqual(before);
    expect(await readZipText(after, 'word/document.xml')).toContain('Gamma');
    expect(doc.getParagraphTextById(id)).toBe('Alpha');
    expect(doc.getMutationVersion()).toBe(version);
    expect(doc.buildDocumentView({ includeSemanticTags: false }).nodes).toBe(view.nodes);
    expect(await doc.getMutationSnapshot()).toEqual(before);
  });

  test('ZIP forks retain binary payloads and entry dates while isolating entry replacement and addition', async () => {
    const zip = await DocxZip.load(await createZipBuffer({
      'part.xml': '<root>Original</root>',
      'media/blob.bin': Buffer.from([0, 1, 255]),
    }, { fileDate: new Date('2006-01-01T00:00:00Z') }));
    const before = await zip.toBuffer();
    const fork = zip.fork();
    expect(await fork.toBuffer()).toEqual(before);
    fork.writeText('part.xml', '<root>Changed</root>');
    fork.writeText('new.xml', '<new/>');
    expect(await zip.readText('part.xml')).toBe('<root>Original</root>');
    expect(zip.hasFile('new.xml')).toBe(false);
    expect(await zip.toBuffer()).toEqual(before);
    expect(await fork.toBuffer()).not.toEqual(before);
  });
});
