import { expect } from 'vitest';
import { testAllure } from '../src/testing/allure-test.js';
import { paragraphWithText, documentXmlFromBodyXml } from '../src/testing/ooxml-fixtures.js';
import { assertRevisionFidelity, RevisionFidelityViolation } from '../src/primitives/revision_fidelity.js';

const TEST_FEATURE = 'add-runtime-revision-fidelity';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE })
  .conformance({spec:'ECMA-376',edition:5,part:1,section:'17.13.5.18'});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parts = (body: string, extra: Record<string,string> = {}) => ({
  'word/document.xml': documentXmlFromBodyXml(body,{namespaces:{r:'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}}), ...extra,
});
const tracked = '<w:p><w:del w:id="1" w:author="Guard"><w:r><w:delText>Before</w:delText></w:r></w:del><w:ins w:id="2" w:author="Guard"><w:r><w:t>After</w:t></w:r></w:ins></w:p>';

test.openspec('Valid tracked edits preserve both projections')('accepts valid replacement and formatting revisions without mutating inputs', () => {
  const input = {source:parts(paragraphWithText('Before')),intended:parts(paragraphWithText('After')),output:parts(tracked)};
  const before = JSON.stringify(input);
  expect(() => assertRevisionFidelity(input)).not.toThrow();
  expect(JSON.stringify(input)).toBe(before);
  const plain = parts(paragraphWithText('Format'));
  const bold = parts('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Format</w:t></w:r></w:p>');
  const marked = parts('<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="Guard"><w:rPr/></w:rPrChange></w:rPr><w:t>Format</w:t></w:r></w:p>');
  expect(() => assertRevisionFidelity({source:plain,intended:bold,output:marked})).not.toThrow();
});

test.openspec('Broken revisions fail closed with a location')('refuses both untracked loss and missing intended content', () => {
  for (const output of [parts(paragraphWithText('After')),parts(tracked.replace('After','Wrong'))]) {
    try { assertRevisionFidelity({source:parts(paragraphWithText('Before')),intended:parts(paragraphWithText('After')),output}); throw Error('guard accepted broken revision'); }
    catch(error) { expect(error).toBeInstanceOf(RevisionFidelityViolation); expect(error).toMatchObject({code:'REVISION_FIDELITY_VIOLATION',failures:expect.arrayContaining([expect.objectContaining({part:'word/document.xml',location:expect.stringContaining('$')})])}); }
  }
});

test.openspec('Referenced notes and assets survive resolution')('refuses a lost note body or drawing even when visible body text is unchanged', () => {
  const body = '<w:p><w:r><w:t>Text</w:t><w:footnoteReference w:id="7"/></w:r></w:p>';
  const source = parts(body, {'word/footnotes.xml':`<w:footnotes xmlns:w="${W}"><w:footnote w:id="7">${paragraphWithText('Note body')}</w:footnote></w:footnotes>`});
  expect(() => assertRevisionFidelity({source,intended:source,output:parts(body)})).toThrow(RevisionFidelityViolation);
  const drawing = parts('<w:p><w:r><w:t>Text</w:t><w:drawing/></w:r></w:p>');
  expect(() => assertRevisionFidelity({source:drawing,intended:drawing,output:parts(paragraphWithText('Text'))})).toThrow(RevisionFidelityViolation);
  const object = parts('<w:p><w:r><w:object r:id="rId7"/></w:r></w:p>', {
    'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="object" Target="embeddings/object.bin"/></Relationships>',
    '@binary:word/embeddings/object.bin':'source-object-digest',
  });
  expect(() => assertRevisionFidelity({source:object,intended:object,output:object})).not.toThrow();
  const missing = {...object}; delete missing['@binary:word/embeddings/object.bin'];
  expect(() => assertRevisionFidelity({source:object,intended:object,output:missing})).toThrow(RevisionFidelityViolation);
});

test.openspec('Explicit performance opt-out')('skips projection only on an explicit false flag', () => {
  expect(() => assertRevisionFidelity({source:parts(paragraphWithText('Before')),intended:parts(paragraphWithText('After')),output:parts(paragraphWithText('After'))},{enabled:false})).not.toThrow();
});

test('keeps the mandatory empty-story paragraph equivalent to an empty body, but preserves nonempty topology', () => {
  const empty = parts(''), placeholder = parts('<w:p/>');
  expect(() => assertRevisionFidelity({source:empty,intended:empty,output:placeholder})).not.toThrow();
  expect(() => assertRevisionFidelity({source:parts('<w:p/><w:p/>'),intended:empty,output:placeholder})).toThrow(RevisionFidelityViolation);
});
test('refuses loss of a content-control shell even if its text survives', () => {
  const controlled = parts('<w:sdt><w:sdtPr><w:tag w:val="Guard control"/></w:sdtPr><w:sdtContent>'+paragraphWithText('Kept')+'</w:sdtContent></w:sdt>');
  expect(() => assertRevisionFidelity({source:controlled,intended:controlled,output:parts(paragraphWithText('Kept'))})).toThrow(RevisionFidelityViolation);
});

// Decimal note IDs have a value space independent of their lexical spelling.
test('resolves note references whose decimal IDs use different legal lexical forms', () => {
  const body = '<w:p><w:r><w:footnoteReference w:id="+007"/></w:r></w:p>';
  const source = parts(body, {'word/footnotes.xml':`<w:footnotes xmlns:w="${W}"><w:footnote w:id=" 7 ">${paragraphWithText('Note')}</w:footnote></w:footnotes>`});
  const output = parts(body.replace('+007','7'), {'word/footnotes.xml':source['word/footnotes.xml']});
  expect(() => assertRevisionFidelity({source,intended:source,output})).not.toThrow();
  const wrong = {...output,'word/footnotes.xml':source['word/footnotes.xml'].replace('Note','Lost')};
  expect(() => assertRevisionFidelity({source,intended:source,output:wrong})).toThrow(RevisionFidelityViolation);
});
