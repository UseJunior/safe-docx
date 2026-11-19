import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { MATRIX_STORIES, buildMatrixFixture, matrixBody, matrixFixtures } from './fixtures/section-boundary-matrix.mjs';
import { ROUND_TRIP_CASES, buildRoundTripSide } from './fixtures/section-break-round-trip.mjs';

const count = (xml, re) => (xml.match(re) ?? []).length;

test('the matrix has the 30 #1188 fixtures: 20 at body and paragraph level, 10 at body level', () => {
  const fixtures = matrixFixtures();
  assert.equal(fixtures.length, 30);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, 30);
  assert.equal(fixtures.filter((f) => f.position === 'para').length, 10);
  assert.ok(fixtures.every((f) => f.primaryMode === (f.shape === 's1e' ? 'reject' : 'accept')));
});

test('S1e removes an empty inserted boundary; S3b a deleted mark on a content paragraph', () => {
  const s1e = matrixBody('s1e', 'v0none', 'body');
  assert.match(s1e, /<w:p><w:pPr><w:rPr><w:ins w:id="1"[^>]*\/><\/w:rPr><w:sectPr>/);
  const s3b = matrixBody('s3b', 'v0none', 'body');
  assert.match(s3b, /<w:rPr><w:del w:id="1"[^>]*\/><\/w:rPr><w:sectPr>.*?<\/w:pPr><w:r><w:t>First section/);
  // v0none: the removed section binds all six A references; the body-level survivor binds none.
  assert.equal(count(s1e, /rIdHA|rIdFA/g), 6);
  assert.match(s1e, /<w:sectPr><w:pgSz w:w="12240" w:h="15840"\/><w:pgMar[^>]*\/><\/w:sectPr>$/);
  // v9prior adds a section C before the removed one; that one binds only defaults.
  const prior = matrixBody('s1e', 'v9prior', 'body');
  assert.ok(prior.startsWith('<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdHCdefault"/>'));
  assert.equal(count(prior, /rIdHA|rIdFA/g), 2);
  assert.throws(() => matrixBody('s1e', 'v99', 'body'), /unknown matrix variant/);
});

test('matrix packages declare every header/footer part and are byte-deterministic', async () => {
  const [first] = matrixFixtures();
  const a = await buildMatrixFixture(first);
  const b = await buildMatrixFixture(first);
  assert.ok(a.equals(b));
  const zip = await JSZip.loadAsync(a);
  const types = await zip.file('[Content_Types].xml').async('string');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  assert.equal(MATRIX_STORIES.length, 18);
  for (const s of MATRIX_STORIES) {
    assert.ok(zip.file(`word/${s.target}`), s.target);
    assert.ok(types.includes(`PartName="/word/${s.target}"`), `content type for ${s.target}`);
    assert.ok(rels.includes(`Id="${s.id}"`), `relationship ${s.id}`);
  }
  assert.ok(zip.file('word/styles.xml') && zip.file('word/settings.xml'));
});

test('the nine part A round-trip pairs each add or remove a section break', async () => {
  assert.equal(ROUND_TRIP_CASES.length, 9);
  for (const c of ROUND_TRIP_CASES) {
    const sections = (side) => count(side.body + side.finalSection, /<w:sectPr[ />]/g);
    assert.notEqual(sections(c.original), sections(c.revised), c.id);
    const zip = await JSZip.loadAsync(await buildRoundTripSide(c.original));
    for (const part of c.original.parts) assert.ok(zip.file(`word/${part.target}`), `${c.id} ${part.target}`);
  }
});
