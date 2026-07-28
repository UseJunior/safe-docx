import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildMinimalDocx,
  detectFormattingLoss,
  findRevisionMarkers,
  formatReport,
  hasFindings,
  main,
  projectParagraphs,
  readDocxParts,
  SELF_TEST_AFTER_BODY,
  SELF_TEST_AFTER_STYLES,
  SELF_TEST_BEFORE_BODY,
  SELF_TEST_BEFORE_STYLES,
  wrapBodyXml,
  wrapStylesXml,
} from './check_docx_formatting_loss.mjs';

/**
 * `styles.shared` applies one styles.xml to both sides; `styles.before` /
 * `styles.after` differ the sides, which is how a style-definition edit is
 * expressed — the document parts stay identical.
 */
function compare(beforeBody, afterBody, options, styles = {}) {
  return detectFormattingLoss(
    projectParagraphs(wrapBodyXml(beforeBody), styles.before ?? styles.shared ?? null),
    projectParagraphs(wrapBodyXml(afterBody), styles.after ?? styles.shared ?? null),
    options,
  );
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraph(paraId, inner, properties = '') {
  return `<w:p w14:paraId="${paraId}">${properties}${inner}</w:p>`;
}

function run(text, runProperties = '') {
  const wrapped = runProperties ? `<w:rPr>${runProperties}</w:rPr>` : '';
  return `<w:r>${wrapped}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function styleDef(styleId, type, rPrInner, basedOn = null) {
  return (
    `<w:style w:type="${type}" w:styleId="${styleId}"><w:name w:val="${styleId}"/>` +
    (basedOn ? `<w:basedOn w:val="${basedOn}"/>` : '') +
    (rPrInner ? `<w:rPr>${rPrInner}</w:rPr>` : '') +
    `</w:style>`
  );
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

test('D1 reduces underline to on/off through the resolver: removal is caught, style-to-style is not', () => {
  // The declared-properties projection kept the raw w:u value, so single to
  // dotted counted as a change. The resolver reduces w:u to on/off, and #684
  // trades that corner deliberately for a single shared implementation.
  const removed = compare(
    paragraph('AAAA0004', run('Signature', '<w:u w:val="single"/>')),
    paragraph('AAAA0004', run('Signature')),
  );
  assert.deepEqual(removed.flattenedParagraphIds, ['AAAA0004']);

  const restyled = compare(
    paragraph('AAAA0004', run('Signature', '<w:u w:val="single"/>')),
    paragraph('AAAA0004', run('Signature', '<w:u w:val="dotted"/>')),
  );
  assert.deepEqual(restyled.flattenedParagraphIds, []);
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

  // 'off' is the transitional ST_OnOff spelling. Reading it as "on" would both
  // miss a real de-bolding and report a spurious change against w:val="0".
  const transitionalOff = compare(
    paragraph('AAAA0006', run('Term', '<w:b/>')),
    paragraph('AAAA0006', run('Term', '<w:b w:val="off"/>')),
  );
  assert.deepEqual(transitionalOff.flattenedParagraphIds, ['AAAA0006']);

  const equivalentSpellings = compare(
    paragraph('AAAA0006', run('Term', '<w:b w:val="0"/>')),
    paragraph('AAAA0006', run('Term', '<w:b w:val="off"/>')),
  );
  assert.deepEqual(equivalentSpellings.flattenedParagraphIds, []);
});

test('D1 sees emphasis dropped by removing a character style, because the resolved bold changes', () => {
  const styles = { shared: wrapStylesXml(styleDef('Strong', 'character', '<w:b/>')) };
  const result = compare(
    paragraph('AAAA0007', run('Term', '<w:rStyle w:val="Strong"/>')),
    paragraph('AAAA0007', run('Term')),
    undefined,
    styles,
  );

  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0007']);
});

test('D1 stays silent when a style reference is replaced by equivalent direct properties', () => {
  // A reader sees identical formatting on both sides. The declared-properties
  // projection flagged this representation difference as a loss (issue #684).
  const styles = { shared: wrapStylesXml(styleDef('Strong', 'character', '<w:b/>')) };
  const result = compare(
    paragraph('AAAA0008', run('Term', '<w:rStyle w:val="Strong"/>')),
    paragraph('AAAA0008', run('Term', '<w:b/>')),
    undefined,
    styles,
  );

  assert.deepEqual(result.flattenedParagraphIds, []);
  assert.equal(hasFindings(result), false);
});

test('a run inheriting bold from its paragraph style projects as bold, so dropping the w:pStyle is caught', () => {
  const styles = wrapStylesXml(styleDef('EmphaticHeading', 'paragraph', '<w:b/>'));
  const pStyle = '<w:pPr><w:pStyle w:val="EmphaticHeading"/></w:pPr>';

  const projection = projectParagraphs(
    wrapBodyXml(paragraph('AAAA0009', run('Heading text.'), pStyle)),
    styles,
  );
  // Span tuple: [length, bold, italic, underline, highlight, font, size, color].
  assert.equal(projection.byParaId.get('AAAA0009').emphasisSpans[0][1], true);

  const result = compare(
    paragraph('AAAA0009', run('Heading text.'), pStyle),
    paragraph('AAAA0009', run('Heading text.')),
    undefined,
    { shared: styles },
  );
  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0009']);
});

test('D1 sees a style-definition edit even though the document part is byte-identical', () => {
  // The declared-properties projection could not see this at all: no run and
  // no reference changed, only the definition the reference points at.
  const body = paragraph('AAAA0010', run('Heading text.'), '<w:pPr><w:pStyle w:val="EmphaticHeading"/></w:pPr>');
  const result = compare(body, body, undefined, {
    before: wrapStylesXml(styleDef('EmphaticHeading', 'paragraph', '<w:b/>')),
    after: wrapStylesXml(styleDef('EmphaticHeading', 'paragraph', '')),
  });

  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0010']);
});

test('D1 resolves through a basedOn chain, so editing an ancestor style is caught', () => {
  const body = paragraph('AAAA0011', run('Term', '<w:rStyle w:val="Derived"/>'));
  const result = compare(body, body, undefined, {
    before: wrapStylesXml(styleDef('Base', 'character', '<w:i/>') + styleDef('Derived', 'character', '', 'Base')),
    after: wrapStylesXml(styleDef('Base', 'character', '') + styleDef('Derived', 'character', '', 'Base')),
  });

  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0011']);
});

test('basedOn resolution is per property: a derived style adding color does not mask inherited bold', () => {
  // Peer review on #684 caught the resolver reading every property from the
  // first chain member that had ANY rPr, so Derived(color) hid Base(bold).
  const withBold = wrapStylesXml(
    styleDef('Base', 'character', '<w:b/>') + styleDef('Derived', 'character', '<w:color w:val="FF0000"/>', 'Base'),
  );
  const body = paragraph('AAAA0013', run('Term', '<w:rStyle w:val="Derived"/>'));

  const projection = projectParagraphs(wrapBodyXml(body), withBold);
  assert.deepEqual(projection.byParaId.get('AAAA0013').emphasisSpans, [[4, true, false, false, 'none', '', 0, 'FF0000']]);

  // And a de-bolding of the ancestor is therefore a finding, color intact.
  const withoutBold = wrapStylesXml(
    styleDef('Base', 'character', '') + styleDef('Derived', 'character', '<w:color w:val="FF0000"/>', 'Base'),
  );
  const result = compare(body, body, undefined, { before: withBold, after: withoutBold });
  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0013']);
});

test('color hex compares case-insensitively, because casing is a writer artifact rather than ink', () => {
  const result = compare(
    paragraph('AAAA0014', run('Term', '<w:color w:val="ff0000"/>')),
    paragraph('AAAA0014', run('Term', '<w:color w:val="FF0000"/>')),
  );

  assert.deepEqual(result.flattenedParagraphIds, []);
  assert.equal(hasFindings(result), false);
});

test('a present styles part that is not w:styles is rejected rather than read as an empty model', () => {
  // An empty model resolves every style to nothing, which silently blinds D1
  // to style-carried loss while the run reads as a clean pass.
  assert.throws(
    () => projectParagraphs(wrapBodyXml(paragraph('AAAA0015', run('Text.'))), '<foo/>'),
    /not a WordprocessingML w:styles part/,
  );
});

test('D1 covers the full resolved tuple: a dropped highlight is a finding', () => {
  const result = compare(
    paragraph('AAAA0012', run('Payment is due.', '<w:highlight w:val="yellow"/>')),
    paragraph('AAAA0012', run('Payment is due.')),
  );

  assert.deepEqual(result.flattenedParagraphIds, ['AAAA0012']);
});

test('the resolver consumed here is docx-core public surface, importable the way a consumer would', async () => {
  const core = await import('@usejunior/docx-core');
  assert.equal(typeof core.extractEffectiveRunFormatting, 'function');
  assert.equal(typeof core.parseStylesXml, 'function');
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

test('D2 does not report a numbered paragraph that was already empty before the change', () => {
  // Otherwise comparing an untouched document to itself exits 1.
  const numbering = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>';
  const body = paragraph('BBBB0005', '', numbering);
  const result = compare(body, body);

  assert.deepEqual(result.orphanNumberingParagraphIds, []);
  assert.equal(hasFindings(result), false);
  assert.equal(result.preExistingEmptyNumbered, 1);
  assert.ok(formatReport(result).some((line) => line.includes('were already empty before the change')));
});

test('D2 does not treat an image-only paragraph as empty', () => {
  // A w:drawing puts marks on the page even though it contributes no w:t text.
  const drawing = '<w:r><w:drawing><wp:inline xmlns:wp="urn:x"/></w:drawing></w:r>';
  const numbering = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>';

  const stillAnImage = compare(paragraph('BBBB0006', drawing, numbering), paragraph('BBBB0006', drawing, numbering));
  assert.deepEqual(stillAnImage.orphanNumberingParagraphIds, []);
  assert.equal(stillAnImage.preExistingEmptyNumbered, 0);

  const textToImage = compare(paragraph('BBBB0007', run('Caption.')), paragraph('BBBB0007', drawing));
  assert.deepEqual(textToImage.emptiedParagraphIds, []);

  const imageRemoved = compare(paragraph('BBBB0008', drawing), paragraph('BBBB0008', ''));
  assert.deepEqual(imageRemoved.emptiedParagraphIds, ['BBBB0008']);
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
  // Span tuple: [length, bold, italic, underline, highlight, font, size, color].
  assert.deepEqual(projection.byParaId.get('CCCC0001').emphasisSpans, [[5, true, false, false, 'none', '', 0, 'auto']]);

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
  assert.equal(result.coverage.beforeDuplicateParagraphs, 2);
});

test('paragraphs without a paraId are counted as uncompared instead of being key-substituted', () => {
  const result = compare(
    paragraph('EEEE0001', run('Keyed.')) + `<w:p>${run('Unkeyed.')}</w:p>`,
    paragraph('EEEE0001', run('Keyed.')) + `<w:p>${run('Unkeyed.')}</w:p>`,
    { minCoverage: 0 },
  );

  assert.equal(result.matchedParagraphs, 1);
  assert.equal(result.coverage.beforeUnkeyed, 1);
  assert.equal(result.coverage.afterUnkeyed, 1);
  assert.equal(result.coverageRatio, 0.5);
});

test('output carrying no paraId at all is inconclusive rather than a clean pass', () => {
  // reconstructionMode 'rebuild' emits exactly this: every paragraph unkeyed.
  // Matched=0 makes every detector report zero, which reads as a pass.
  const result = compare(
    paragraph('EEEE0002', run('Term', '<w:b/>') + run(' means.')),
    `<w:p>${run('Term means.')}</w:p>`,
  );

  assert.equal(result.matchedParagraphs, 0);
  assert.equal(result.coverageRatio, 0);
  assert.equal(result.inconclusive, true);
  assert.equal(hasFindings(result), false);
  assert.ok(formatReport(result).some((line) => line.startsWith('INCONCLUSIVE')));
});

test('an unresolvable duplicate group counts every excluded paragraph, not just the id', () => {
  const body = ['First.', 'Second.', 'Third.'].map((text) => paragraph('EEEE0003', run(text))).join('');
  const projection = projectParagraphs(wrapBodyXml(body));

  assert.equal(projection.duplicateParagraphs, 3);
  assert.deepEqual(projection.duplicateParaIds, ['EEEE0003']);
  assert.equal(detectFormattingLoss(projection, projection).inconclusive, true);
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

test('a well-formed part that is not a w:document is rejected rather than read as empty', () => {
  assert.throws(() => projectParagraphs('<foo/>'), /not a WordprocessingML w:document part/);
  assert.throws(
    () => projectParagraphs(`<w:document xmlns:w="${W_NS}"><w:notBody/></w:document>`),
    /has no w:body/,
  );
});

test('revision markup is detected so a redline is never mistaken for clean output', () => {
  assert.deepEqual(findRevisionMarkers(wrapBodyXml(paragraph('HHHH0001', run('Clean.')))), []);

  const redline =
    `<w:p w14:paraId="HHHH0002"><w:del w:id="1" w:author="x" w:date="2026-01-01T00:00:00Z">` +
    `<w:r><w:delText>Gone.</w:delText></w:r></w:del></w:p>`;
  assert.deepEqual(findRevisionMarkers(wrapBodyXml(redline)), ['del']);
});

test('the CLI reads real .docx packages and exits 1 on findings, 0 when clean, 2 on misuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'formatting-loss-'));
  try {
    const beforePath = join(directory, 'before.docx');
    const afterPath = join(directory, 'after.docx');
    writeFileSync(beforePath, await buildMinimalDocx(SELF_TEST_BEFORE_BODY, SELF_TEST_BEFORE_STYLES));
    writeFileSync(afterPath, await buildMinimalDocx(SELF_TEST_AFTER_BODY, SELF_TEST_AFTER_STYLES));

    const parts = await readDocxParts(beforePath);
    assert.ok(parts.documentXml.includes('w:document'));
    assert.ok(parts.stylesXml.includes('w:styles'));

    const damaged = await captureConsole(() => main([beforePath, afterPath]));
    assert.equal(damaged.value, 1);
    // Two flattened paragraphs: the direct cross-run flattening and the
    // style-definition edit that only the resolved projection can see.
    assert.ok(damaged.lines.some((line) => line.startsWith('D1 run-formatting flattened paragraphs: 2')));

    const clean = await captureConsole(() => main([beforePath, beforePath]));
    assert.equal(clean.value, 0);

    const asJson = await captureConsole(() => main(['--json', beforePath, afterPath]));
    assert.equal(JSON.parse(asJson.lines.join('\n')).flattenedParagraphIds.length, 2);

    const misuse = await captureConsole(() => main([beforePath]));
    assert.equal(misuse.value, 2);

    const missing = await captureConsole(() => main([beforePath, join(directory, 'absent.docx')]));
    assert.equal(missing.value, 2);

    // An unknown flag must not be swallowed — a typo'd threshold would
    // otherwise silently run at the default and read as a deliberate result.
    const typo = await captureConsole(() => main(['--min-coverge', '0.5', beforePath, afterPath]));
    assert.equal(typo.value, 2);
    assert.ok(typo.lines.some((line) => line.includes('unknown option --min-coverge')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the CLI refuses a redline and exits 2 rather than answering a question it cannot answer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'formatting-loss-redline-'));
  try {
    const cleanPath = join(directory, 'clean.docx');
    const redlinePath = join(directory, 'redline.docx');
    writeFileSync(cleanPath, await buildMinimalDocx(SELF_TEST_BEFORE_BODY));
    writeFileSync(
      redlinePath,
      await buildMinimalDocx(
        `<w:p w14:paraId="11111111"><w:ins w:id="1" w:author="x" w:date="2026-01-01T00:00:00Z">` +
          `<w:r><w:t>Added.</w:t></w:r></w:ins></w:p>`,
      ),
    );

    const { value, lines } = await captureConsole(() => main([cleanPath, redlinePath]));
    assert.equal(value, 2);
    assert.ok(lines.some((line) => line.includes('carries revision markup')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rebuild-shaped output exits 2 through the CLI instead of reporting a pass', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'formatting-loss-rebuild-'));
  try {
    const keyedPath = join(directory, 'keyed.docx');
    const unkeyedPath = join(directory, 'unkeyed.docx');
    writeFileSync(keyedPath, await buildMinimalDocx(SELF_TEST_BEFORE_BODY));
    // Same content with every w14:paraId removed — what 'rebuild' emits.
    writeFileSync(unkeyedPath, await buildMinimalDocx(SELF_TEST_AFTER_BODY.replace(/ w14:paraId="[^"]*"/g, '')));

    const { value, lines } = await captureConsole(() => main([keyedPath, unkeyedPath]));
    assert.equal(value, 2);
    assert.ok(lines.some((line) => line.startsWith('INCONCLUSIVE')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the self-test proves the detectors fire before any run is believed', async () => {
  const { value, lines } = await captureConsole(() => main(['--self-test']));

  assert.equal(value, 0);
  assert.ok(lines.some((line) => line.includes('known-good pair clean')));
  assert.ok(lines.some((line) => line.includes('representation swap correctly not reported')));
  assert.ok(lines.some((line) => line.includes('self-test known-bad D1 run-formatting flattened paragraphs: 2')));
});
