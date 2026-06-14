import { acceptAllChanges } from './packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.js';
import { parseDocumentXml } from './packages/docx-core/src/baselines/atomizer/xmlToWmlElement.js';

function esc(s) { return s; }
function atomToXml(a) {
  if ('text' in a) return `<w:t xml:space="preserve">${esc(a.text)}</w:t>`;
  if ('delText' in a) return `<w:delText xml:space="preserve">${esc(a.delText)}</w:delText>`;
}
function blockToXml(b) {
  if ('run' in b) return `<w:r>${b.run.content.map(atomToXml).join('')}</w:r>`;
  if ('ins' in b) return `<w:ins w:id="1" w:author="t" w:date="2020-01-01T00:00:00Z">${b.ins.map(blockToXml).join('')}</w:ins>`;
  if ('del' in b) return `<w:del w:id="1" w:author="t" w:date="2020-01-01T00:00:00Z">${b.del.map(blockToXml).join('')}</w:del>`;
}

const G3_DOC = [
  { body: [{ ins: [{ del: [{ run: { content: [{ delText: 'x' }] } }] }] }] },
  { body: [{ run: { content: [{ text: 'keep' }] } }] },
];

const body = G3_DOC.map((p) => `<w:p>${p.body.map(blockToXml).join('')}</w:p>`).join('');
const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
console.log("Input XML:");
console.log(xml);
console.log("\nAccepted XML:");
console.log(acceptAllChanges(xml));
