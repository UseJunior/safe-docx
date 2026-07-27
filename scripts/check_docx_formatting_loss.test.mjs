import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildMinimalDocx,
  detectFormattingLoss,
  formatReport,
  hasFindings,
  main,
  projectParagraphs,
  readDocumentXml,
  SELF_TEST_AFTER_BODY,
  SELF_TEST_BEFORE_BODY,
  wrapBodyXml,
} from './check_docx_formatting_loss.mjs';

function compare(beforeBody, afterBody) {
  return detectFormattingLoss(projectParagraphs(wrapBodyXml(beforeBody)), projectParagraphs(wrapBodyXml(afterBody)));
}

function paragraph(paraId, inner, properties = '') {
  return `<w:p w14:paraId="${paraId}">${properties}${inner}</w:p>`;
}

function run(text, runProperties = '') {
  const wrapped = runProperties ? `<w:rPr>${runProperties}</w:rPr>` : '';
  return `<w:r>${wrapped}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function captureConsole(callback) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  return Promise.resolve(callback())
    .then((value) => ({ value, lines }))
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
    });
}

test('D1 fires when a cross-run replacement flattens bold onto a defined term', () => {
  const result = compare(
    paragraph('AAAA0001', run('Term', '<w:b/>') + run(' means the defined thing.')),
    paragraph('AAAA0001', run('Term means the defined thing.')),
  );

  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0001']);
  assert.equal(hasFindings(result), true);
});

test('D1 stays silent when a run boundary moves but every character keeps its emphasis', () => {
  // The shape atomizer token splitting and rsid churn (#677) produce. The
  // multiset formulation sketched in #682 would report this as a finding.
  const result = compare(
    paragraph('AAAA0002', run('Term', '<w:b/>') + run(' means.')),
    paragraph('AAAA0002', run('Te', '<w:b/>') + run('rm', '<w:b/>') + run(' means.')),
  );

  assert.deepEqual(result.flattenedParagraphIds, []);
  assert.equal(hasFindings(result), false);
});

test('D1 stays silent when the text itself changed, which is a content edit rather than formatting loss', () => {
  const result = compare(
    paragraph('AAAA0003', run('Term', '<w:b/>') + run(' means.')),
    paragraph('AAAA0003', run('Term means something else.')),
  );

  assert.deepEqual(result.flattenedParagraphIds, []);
});

test('D1 distinguishes underline styles rather than collapsing them to on/off', () => {
  const result = compare(
    paragraph('AAAA0004', run('Signature', '<w:u w:val="single"/>')),
    paragraph('AAAA0004', run('Signature', '<w:u w:val="dotted"/>')),
  );

  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0004']);
});

test('D1 reads w:val on toggle properties, so an explicit on-value is not a change', () => {
  const unchanged = compare(
    paragraph('AAAA0005', run('Term', '<w:b/>')),
    paragraph('AAAA0005', run('Term', '<w:b w:val="1"/>')),
  );
  assert.deepEqual(unchanged.flattenedParagraphIds, []);

  const turnedOff = compare(
    paragraph('AAAA0006', run('Term', '<w:b/>')),
    paragraph('AAAA0006', run('Term', '<w:b w:val="0"/>')),
  );
  assert.deepEqual(turnedOff.flattenedParagraphIds, ['AAAA0006']);
});

test('D2 flags a paragraph that carried text before and carries none after', () => {
  const result = compare(paragraph('BBBB0001', run('An obligation.')), paragraph('BBBB0001', ''));

  assert.deepEqual(result.emptiedParagraphIds, ['BBBB0001']);
});

test('D2 does not flag a paragraph that was already empty', () => {
  const result = compare(paragraph('BBBB0002', ''), paragraph('BBBB0002', ''));

  assert.deepEqual(result.emptiedParagraphIds, []);
  assert.deepEqual(result.orphanNumberingParagraphIds, []);
});

test('D2 flags an emptied paragraph that kept w:numPr, because it renders an orphan label', () => {
  const numbering = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>';
  const result = compare(
    paragraph('BBBB0003', run('A numbered obligation.'), numbering),
    paragraph('BBBB0003', '', numbering),
  );

  assert.deepEqual(result.emptiedParagraphIds, ['BBBB0003']);
  assert.deepEqual(result.orphanNumberingParagraphIds, ['BBBB0003']);
});

test('D2 does not report an orphan label for an emptied paragraph with no numbering', () => {
  const result = compare(paragraph('BBBB0004', run('Body text.')), paragraph('BBBB0004', ''));

  assert.deepEqual(result.emptiedParagraphIds, ['BBBB0004']);
  assert.deepEqual(result.orphanNumberingParagraphIds, []);
});

test('a paragraph nested in a text box is projected separately from the paragraph containing it', () => {
  // A w:p inside w:txbxContent sits inside a run of the outer w:p. Attributing
  // its runs to the outer paragraph would mask changes on both.
  const textBox = (inner) =>
    `<w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
    `<mc:Fallback><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>` +
    `${inner}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;

  const before = paragraph('CCCC0001', run('Outer', '<w:b/>') + textBox(paragraph('CCCC0002', run('Inner', '<w:b/>'))));
  const after = paragraph('CCCC0001', run('Outer', '<w:b/>') + textBox(paragraph('CCCC0002', run('Inner'))));

  const projection = projectParagraphs(wrapBodyXml(before));
  assert.equal(projection.totalParagraphs, 2);
  assert.deepEqual(projection.byParaId.get('CCCC0001').emphasisSpans, [[5, true, false, 'none']]);

  const result = compare(before, after);
  assert.deepEqual(result.flattenedParagraphIds, ['CCCC0002']);
});

test('duplicate paraIds are excluded from matching rather than silently resolved', () => {
  const body = paragraph('DDDD0001', run('First.')) + paragraph('DDDD0001', run('Second.'));
  const projection = projectParagraphs(wrapBodyXml(body));

  assert.equal(projection.totalParagraphs, 2);
  assert.equal(projection.byParaId.has('DDDD0001'), false);
  assert.deepEqual(projection.duplicateParaIds, ['DDDD0001']);

  const result = detectFormattingLoss(projection, projection);
  assert.equal(result.matchedParagraphs, 0);
  assert.equal(result.coverage.beforeDuplicateIds, 1);
});

test('paragraphs without a paraId are counted as uncompared instead of being key-substituted', () => {
  const result = compare(
    paragraph('EEEE0001', run('Keyed.')) + `<w:p>${run('Unkeyed.')}</w:p>`,
    paragraph('EEEE0001', run('Keyed.')) + `<w:p>${run('Unkeyed.')}</w:p>`,
  );

  assert.equal(result.matchedParagraphs, 1);
  assert.equal(result.coverage.beforeUnkeyed, 1);
  assert.equal(result.coverage.afterUnkeyed, 1);
  assert.ok(formatReport(result).some((line) => line.includes('carry no w14:paraId and were not compared')));
});

test('the report states all three counts even when every detector is silent', () => {
  const lines = formatReport(compare(paragraph('FFFF0001', run('Same.')), paragraph('FFFF0001', run('Same.'))));

  assert.ok(lines.some((line) => line.startsWith('D1 run-formatting flattened paragraphs: 0')));
  assert.ok(lines.some((line) => line.startsWith('D2 emptied-but-retained paragraphs: 0')));
  assert.ok(lines.some((line) => line.startsWith('D2 empty paragraphs retaining w:numPr: 0')));
});

test('neither the report nor the projection carries document text', () => {
  const secret = 'Zephyrine Quartermain';
  const before = paragraph('FFFF0002', run(secret, '<w:b/>') + run(' signs.'));
  const after = paragraph('FFFF0002', run(`${secret} signs.`));

  const projection = projectParagraphs(wrapBodyXml(before));
  assert.equal(JSON.stringify([...projection.byParaId]).includes(secret), false);

  const result = compare(before, after);
  assert.equal(formatReport(result).join('\n').includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('the id list is truncated so a damaged document cannot flood the report', () => {
  const ids = Array.from({ length: 25 }, (_, index) => `GGGG${String(index).padStart(4, '0')}`);
  const before = ids.map((id) => paragraph(id, run('Text.', '<w:b/>'))).join('');
  const after = ids.map((id) => paragraph(id, run('Text.'))).join('');

  const line = formatReport(compare(before, after)).find((entry) => entry.startsWith('D1'));
  assert.ok(line.includes('25 ['));
  assert.ok(line.includes('(+5 more)'));
});

test('a malformed document part fails loudly instead of projecting zero paragraphs', () => {
  // Zero paragraphs projects to zero findings, which reads exactly like a pass.
  assert.throws(() => projectParagraphs(wrapBodyXml('<w:p><w:r></w:p>')), /did not parse/);
  assert.throws(() => projectParagraphs('<w:p xmlns:w="urn:x"/>garbage'), /did not parse/);
});

test('the CLI reads real .docx packages and exits 1 on findings, 0 when clean, 2 on misuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'formatting-loss-'));
  try {
    const beforePath = join(directory, 'before.docx');
    const afterPath = join(directory, 'after.docx');
    writeFileSync(beforePath, await buildMinimalDocx(SELF_TEST_BEFORE_BODY));
    writeFileSync(afterPath, await buildMinimalDocx(SELF_TEST_AFTER_BODY));

    assert.ok((await readDocumentXml(beforePath)).includes('w:document'));

    const damaged = await captureConsole(() => main([beforePath, afterPath]));
    assert.equal(damaged.value, 1);
    assert.ok(damaged.lines.some((line) => line.startsWith('D1 run-formatting flattened paragraphs: 1')));

    const clean = await captureConsole(() => main([beforePath, beforePath]));
    assert.equal(clean.value, 0);

    const asJson = await captureConsole(() => main(['--json', beforePath, afterPath]));
    assert.equal(JSON.parse(asJson.lines.join('\n')).flattenedParagraphIds.length, 1);

    const misuse = await captureConsole(() => main([beforePath]));
    assert.equal(misuse.value, 2);

    const missing = await captureConsole(() => main([beforePath, join(directory, 'absent.docx')]));
    assert.equal(missing.value, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the self-test proves the detectors fire before any run is believed', async () => {
  const { value, lines } = await captureConsole(() => main(['--self-test']));

  assert.equal(value, 0);
  assert.ok(lines.some((line) => line.includes('known-good pair clean')));
  assert.ok(lines.some((line) => line.includes('self-test known-bad D1 run-formatting flattened paragraphs: 1')));
});
