/** Public synthetic, controlled move-source vocabulary probes for issue #941. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import { DocxArchive, parseXml } from '../../../packages/docx-core/src/index.js';
import { compareDocuments } from '../../../packages/docx-compare/src/index.js';
import { buildDocxFromBodyXml, paragraphWithText, resultText } from '../../../packages/docx-core/src/testing/ooxml-fixtures.js';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: tsx scripts/oracle/word/issue-941-move-fixtures.ts <new-output-directory>');
const out = resolve(directory);
await mkdir(out, { recursive: false });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const moved = 'this complete paragraph moves away';
const stable = 'a second sufficiently long paragraph of stable prose here';
const final = 'third stable paragraph containing plenty of ordinary words';
const cases = [
  { name: 'whole-paragraph', original: paragraphWithText(moved) + paragraphWithText(stable),
    revised: paragraphWithText(stable) + paragraphWithText(moved) },
  { name: 'run-between-paragraphs', original: `<w:p>${resultText(stable)}${resultText(moved)}</w:p>` + paragraphWithText(final),
    revised: paragraphWithText(stable) + `<w:p>${resultText(final)}${resultText(moved)}</w:p>` },
];
const evidence = [];
for (const fixture of cases) {
  const compared = await compareDocuments(await buildDocxFromBodyXml(fixture.original),
    await buildDocxFromBodyXml(fixture.revised), {
      detectMoves: true, author: 'Move Vocabulary Probe', date: new Date('2026-09-07T00:00:00Z'),
    });
  for (const vocabulary of ['t', 'delText']) {
    const archive = await DocxArchive.load(compared.document);
    const document = parseXml(await archive.getDocumentXml());
    const sources = Array.from(document.getElementsByTagNameNS(W_NS, 'moveFrom'));
    if (sources.length === 0) throw new Error(`No move source detected: ${fixture.name}`);
    if (fixture.name === 'run-between-paragraphs' && sources.some(source => source.parentNode?.nodeName === 'w:rPr')) {
      throw new Error('The run-level control unexpectedly contains a moved paragraph mark');
    }
    for (const source of sources) {
      for (const old of Array.from(source.getElementsByTagName('*')).filter(element =>
        element.namespaceURI === W_NS && ['t', 'delText'].includes(element.localName))) {
        const text = document.createElementNS(W_NS, `w:${vocabulary}`);
        for (const attribute of Array.from(old.attributes)) {
          text.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        }
        while (old.firstChild) text.appendChild(old.firstChild);
        old.parentNode!.replaceChild(text, old);
      }
    }
    const xml = new XMLSerializer().serializeToString(document);
    archive.setDocumentXml(xml);
    const bytes = await archive.save();
    const name = `${fixture.name}-${vocabulary}.docx`;
    await writeFile(join(out, name), bytes);
    evidence.push({ name, documentXmlSha256: createHash('sha256').update(xml).digest('hex'),
      sourceContentWrappers: sources.filter(source => source.parentNode?.nodeName === 'w:p').length,
      sourceParagraphMarks: sources.filter(source => source.parentNode?.nodeName === 'w:rPr').length,
      sourceTextElements: sources.reduce((sum, source) => sum + source.getElementsByTagNameNS(W_NS, vocabulary).length, 0) });
  }
}
await writeFile(join(out, 'fixtures.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
