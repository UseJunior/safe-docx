import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { compareDocuments } from '../../index.js';
import type { DocumentIntegrityCertificate } from '../../compare-types.js';
import { isLeanVerifierJson, runLeanXmlTripleVerifier } from './leanXmlVerifier.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  normalizeText,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../../testing/ooxml-fixtures.js';

const TEST_FEATURE = 'Lean XML Triple Verifier';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

const TEST_DIR = dirname(import.meta.url.replace('file://', ''));
const PROJECT_ROOT = join(TEST_DIR, '../../../../..');
const LEAN_EXE = join(PROJECT_ROOT, 'verification/lean/.lake/build/bin/leanDocxChecker');
const MAXIMUM_SHAPE_EXE = join(
  PROJECT_ROOT,
  'verification/lean/.lake/build/bin/protocolV4MaximumShape',
);

async function runMaximumShapeProducer(mode: 'shared' | 'distinct'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(MAXIMUM_SHAPE_EXE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`maximum-shape producer exited ${code}: ${Buffer.concat(stderr)}`));
    });
    child.stdin.end(mode);
  });
}

const exeExists = existsSync(LEAN_EXE);
if (!exeExists) {
  console.warn(
    `[lean-xml-verifier] SKIP: ${LEAN_EXE} not found. ` +
      `Build it with: (cd verification/lean && lake build leanDocxChecker)`,
  );
}
const describeWithLean = exeExists ? describe : describe.skip;
const describeWithMaximumShape = existsSync(MAXIMUM_SHAPE_EXE) ? describe : describe.skip;

describeWithLean('Lean XML triple verifier certificate', () => {
  test
    .openspec('[LEAN-XML-CHECK-01] Lean verifier accepts a valid inplace comparison triple')
    .openspec('[LEAN-XML-CERT-01] Inplace comparison reports plain checked properties')(
    'passes a real inplace comparison XML triple through the compiled Lean checker',
    async ({ given, when, then }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('a simple document pair that can be reconstructed in place', async () => {
        original = await buildDocxFromBodyXml(paragraphWithText('Hello'));
        revised = await buildDocxFromBodyXml(paragraphWithText('Hello world'));
      });

      await when('the atomizer runs with the compiled Lean verifier enabled', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          leanXmlVerifier: { enabled: true, executablePath: LEAN_EXE },
        });
      });

      await then('the certificate reports plain document properties and hashes', async () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.documentIntegrity?.status, result.documentIntegrity?.reason).toBe('passed');
        expect(result.documentIntegrity?.protocolVersion).toBe(1);
        expect(result.documentIntegrity?.scope).toBe('word/document.xml');
        expect(result.documentIntegrity?.checkerProtocolVersion).toBe(4);
        expect(result.documentIntegrity?.fixedStoryScope).toEqual([
          'word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml',
        ]);
        expect(result.documentIntegrity?.relationshipStoryScope).toMatchObject({
          selection: 'direct-explicit-section-bindings',
          inheritedRoles: false,
        });
        expect(result.ancillaryFieldEvidence).toMatchObject({
          status: 'passed',
          reconstructionMode: 'inplace',
        });
        expect(result.documentIntegrity?.inputSha256.originalDocumentXml).toMatch(/^[0-9a-f]{64}$/);
        expect(result.documentIntegrity?.inputPackageSha256?.originalDocx).toMatch(/^[0-9a-f]{64}$/);
        expect(result.documentIntegrity?.stories?.map((story) => story.name)).toEqual(['main']);
        expect(
          result.documentIntegrity?.stories?.[0]?.checks.acceptingAllTrackedChangesMatchesRevisedText.claim
        ).toContain('revised story');
        expect(JSON.stringify(result.documentIntegrity)).not.toContain('tier2.checker_sound');
        expect(JSON.stringify(result.documentIntegrity)).not.toContain('INV');
        const packageZip = await JSZip.loadAsync(result.document);
        expect(Object.values(packageZip.files).filter((entry) => entry.dir)).toEqual([]);
        expect(await packageZip.file('word/document.xml')?.async('string')).toContain('w:document');
      });
    },
  );
});

describe('Lean XML triple verifier scope boundary', () => {
  test.openspec('[LEAN-XML-CHECK-02] Lean verifier failure is not converted into a verified claim')(
    'marks an unavailable verifier as not_run instead of verified',
    async ({ given, when, then }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('a document pair that otherwise reconstructs in place', async () => {
        original = await buildDocxFromBodyXml(paragraphWithText('Alpha'));
        revised = await buildDocxFromBodyXml(paragraphWithText('Alpha beta'));
      });

      await when('the verifier is enabled but its executable is unavailable', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          leanXmlVerifier: { enabled: true, executablePath: '/does/not/exist' },
        });
      });

      await then('the certificate does not make a verified claim', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.documentIntegrity?.status).toBe('not_run');
        expect(result.documentIntegrity?.stories).toEqual([]);
        expect(JSON.stringify(result.documentIntegrity)).not.toContain('verified');
      });
    },
  );

  test.openspec('[LEAN-XML-CERT-02] Rebuild comparison does not overclaim')(
    'marks rebuild output as not applicable even when verifier option is enabled',
    async ({ given, when, then }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('a document pair compared in rebuild mode', async () => {
        original = await buildDocxFromBodyXml(paragraphWithText('One'));
        revised = await buildDocxFromBodyXml(paragraphWithText('Two'));
      });

      await when('the atomizer runs with the verifier enabled', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
          leanXmlVerifier: { enabled: true, executablePath: '/does/not/exist' },
        });
      });

      await then('the certificate states that rebuild output is outside this verifier scope', () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        expect(result.documentIntegrity?.status).toBe('not_applicable');
        expect(result.documentIntegrity?.reason).toContain('inplace comparison output only');
      });
    },
  );
});

async function replacePart(
  docx: Buffer,
  path: string,
  xml: string | null,
  compression: 'STORE' | 'DEFLATE' = 'STORE'
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  if (xml === null) zip.remove(path);
  else zip.file(path, xml, { createFolders: false });
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) delete zip.files[entry.name];
  }
  return zip.generateAsync({ type: 'nodebuffer', compression });
}

async function readPart(docx: Buffer, path: string): Promise<string> {
  const part = (await JSZip.loadAsync(docx)).file(path);
  if (!part) throw new Error(`missing test part: ${path}`);
  return part.async('string');
}

function withPrefix(xml: string, from: string, to: string): string {
  return xml
    .replace(`xmlns:${from}=`, `xmlns:${to}=`)
    .replaceAll(`${from}:`, `${to}:`);
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEADER_REL = `${R_NS}/header`;
const FOOTER_REL = `${R_NS}/footer`;

async function relationshipDocx(options: {
  headerText?: string;
  footerText?: string;
  includeAllRoles?: boolean;
  malformedUnselectedRelationship?: boolean;
  headerTarget?: string;
  headerPartPath?: string;
  bodyXml?: string;
  omitFooterRelationship?: boolean;
  omitFooterPart?: boolean;
  explicitEmptyRelationships?: boolean;
} = {}): Promise<Buffer> {
  const roles = options.includeAllRoles ? ['first', 'default', 'even'] : ['default'];
  const references = roles.flatMap((role, index) => [
    `<w:headerReference w:type="${role}" r:id="rIdH${index}"/>`,
    `<w:footerReference w:type="${role}" r:id="rIdF${index}"/>`,
  ]).join('');
  const base = await buildDocxFromBodyXml(
    options.bodyXml ?? paragraphWithText('Body'),
  );
  const zip = await JSZip.loadAsync(base);
  const generatedDocument = await zip.file('word/document.xml')!.async('string');
  zip.file(
    'word/document.xml',
    generatedDocument.replace(
      '<w:sectPr/>',
      options.bodyXml === undefined
        ? `<w:sectPr xmlns:r="${R_NS}">${references}</w:sectPr>`
        : '',
    ),
    { createFolders: false },
  );
  const relationship = (attributes: string) =>
    options.explicitEmptyRelationships ? `<Relationship ${attributes}></Relationship>` : `<Relationship ${attributes}/>`;
  const relationships = roles.flatMap((_, index) => [
    relationship(`Id="rIdH${index}" Type="${HEADER_REL}" Target="${options.headerTarget ?? 'header1.xml'}"`),
    ...(options.omitFooterRelationship ? [] : [
      relationship(`Id="rIdF${index}" Type="${FOOTER_REL}" Target="footer1.xml"`),
    ]),
  ]);
  if (options.malformedUnselectedRelationship) {
    relationships.push('<Relationship Id="unused" Type="urn:test" Target="unused.xml" Unknown="x"/>');
  }
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PR_NS}">${relationships.join('')}</Relationships>`,
    { createFolders: false },
  );
  zip.file(
    options.headerPartPath ?? 'word/header1.xml',
    `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>${options.headerText ?? 'Header'}</w:t></w:r></w:p></w:hdr>`,
    { createFolders: false },
  );
  if (!options.omitFooterPart) {
    zip.file(
      'word/footer1.xml',
      `<w:ftr xmlns:w="${W_NS}"><w:p><w:r><w:t>${options.footerText ?? 'Footer'}</w:t></w:r></w:p></w:ftr>`,
      { createFolders: false },
    );
  }
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) delete zip.files[entry.name];
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const RELATIONSHIP_SLOT_KINDS = [
  ['header', 'first'],
  ['header', 'default'],
  ['header', 'even'],
  ['footer', 'first'],
  ['footer', 'default'],
  ['footer', 'even'],
] as const;

async function resourceRelationshipDocx(options: {
  storyCount: number;
  storyXml?: (index: number, kind: 'header' | 'footer') => string;
  footnotesXml?: string;
  endnotesXml?: string;
}): Promise<Buffer> {
  const sections = Array.from(
    { length: Math.ceil(options.storyCount / RELATIONSHIP_SLOT_KINDS.length) },
    (_, sectionOrdinal) => {
      const start = sectionOrdinal * RELATIONSHIP_SLOT_KINDS.length;
      const references = RELATIONSHIP_SLOT_KINDS
        .map(([kind, role], offset) => {
          const index = start + offset;
          return index < options.storyCount
            ? `<w:${kind}Reference w:type="${role}" r:id="rId${index}"/>`
            : '';
        })
        .join('');
      return { references, terminal: sectionOrdinal === Math.ceil(options.storyCount / 6) - 1 };
    },
  );
  const bodyXml =
    sections
      .filter(({ terminal }) => !terminal)
      .map(({ references }) =>
        `<w:p><w:pPr><w:sectPr xmlns:r="${R_NS}">${references}</w:sectPr></w:pPr></w:p>`,
      )
      .join('') + paragraphWithText('Body');
  const base = await buildDocxFromBodyXml(bodyXml);
  const zip = await JSZip.loadAsync(base);
  const documentXml = await zip.file('word/document.xml')!.async('string');
  zip.file(
    'word/document.xml',
    documentXml.replace(
      '<w:sectPr/>',
      `<w:sectPr xmlns:r="${R_NS}">${sections.at(-1)?.references ?? ''}</w:sectPr>`,
    ),
    { createFolders: false },
  );
  const relationships = Array.from({ length: options.storyCount }, (_, index) => {
    const [kind] = RELATIONSHIP_SLOT_KINDS[index % RELATIONSHIP_SLOT_KINDS.length]!;
    return `<Relationship Id="rId${index}" Type="${kind === 'header' ? HEADER_REL : FOOTER_REL}" ` +
      `Target="${kind}${index}.xml"/>`;
  }).join('');
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PR_NS}">${relationships}</Relationships>`,
    { createFolders: false },
  );
  for (let index = 0; index < options.storyCount; index += 1) {
    const [kind] = RELATIONSHIP_SLOT_KINDS[index % RELATIONSHIP_SLOT_KINDS.length]!;
    const root = kind === 'header' ? 'hdr' : 'ftr';
    zip.file(
      `word/${kind}${index}.xml`,
      options.storyXml?.(index, kind) ??
        `<w:${root} xmlns:w="${W_NS}"><w:p><w:r><w:t>${index}</w:t></w:r></w:p></w:${root}>`,
      { createFolders: false },
    );
  }
  if (options.footnotesXml !== undefined) {
    zip.file('word/footnotes.xml', options.footnotesXml, { createFolders: false });
  }
  if (options.endnotesXml !== undefined) {
    zip.file('word/endnotes.xml', options.endnotesXml, { createFolders: false });
  }
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) delete zip.files[entry.name];
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function centralRecordFor(buffer: Buffer, name: string): { central: number; local: number } {
  let offset = 0;
  while ((offset = buffer.indexOf(Buffer.from('PK\u0001\u0002', 'binary'), offset)) !== -1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const entryName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (entryName === name) return { central: offset, local: buffer.readUInt32LE(offset + 42) };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`missing central record: ${name}`);
}

function mutateExpandedSize(docx: Buffer, name: string, expandedSize: number): Buffer {
  const mutated = Buffer.from(docx);
  const record = centralRecordFor(mutated, name);
  mutated.writeUInt32LE(expandedSize, record.central + 24);
  mutated.writeUInt32LE(expandedSize, record.local + 22);
  return mutated;
}

function corruptCompressedPayload(docx: Buffer, name: string): Buffer {
  const mutated = Buffer.from(docx);
  const { local } = centralRecordFor(mutated, name);
  const nameLength = mutated.readUInt16LE(local + 26);
  const extraLength = mutated.readUInt16LE(local + 28);
  const dataOffset = local + 30 + nameLength + extraLength;
  mutated[dataOffset] = mutated[dataOffset]! ^ 0xff;
  return mutated;
}

function mutateZipFlags(docx: Buffer, name: string, bit: number): Buffer {
  const mutated = Buffer.from(docx);
  const record = centralRecordFor(mutated, name);
  mutated.writeUInt16LE(mutated.readUInt16LE(record.central + 8) | (1 << bit), record.central + 8);
  mutated.writeUInt16LE(mutated.readUInt16LE(record.local + 6) | (1 << bit), record.local + 6);
  return mutated;
}

function mutateZipDiskStart(docx: Buffer, name: string): Buffer {
  const mutated = Buffer.from(docx);
  const record = centralRecordFor(mutated, name);
  mutated.writeUInt16LE(1, record.central + 34);
  return mutated;
}

function mutateZipMethod(docx: Buffer, name: string, method: number): Buffer {
  const mutated = Buffer.from(docx);
  const record = centralRecordFor(mutated, name);
  mutated.writeUInt16LE(method, record.central + 10);
  mutated.writeUInt16LE(method, record.local + 8);
  return mutated;
}

function mutateCentralFlagsOnly(docx: Buffer, name: string, bit: number): Buffer {
  const mutated = Buffer.from(docx);
  const record = centralRecordFor(mutated, name);
  mutated.writeUInt16LE(mutated.readUInt16LE(record.central + 8) | (1 << bit), record.central + 8);
  return mutated;
}

function replaceZipEntryName(docx: Buffer, name: string, replacement: string): Buffer {
  if (Buffer.byteLength(name) !== Buffer.byteLength(replacement)) {
    throw new Error('ZIP entry-name mutation must preserve byte length');
  }
  const mutated = Buffer.from(docx);
  const record = centralRecordFor(mutated, name);
  Buffer.from(replacement).copy(mutated, record.central + 46);
  Buffer.from(replacement).copy(mutated, record.local + 30);
  return mutated;
}

function injectCentralExtra(docx: Buffer, name: string, headerId: number): Buffer {
  const record = centralRecordFor(docx, name);
  const nameLength = docx.readUInt16LE(record.central + 28);
  const extraLength = docx.readUInt16LE(record.central + 30);
  const insertion = record.central + 46 + nameLength + extraLength;
  const extra = Buffer.alloc(4);
  extra.writeUInt16LE(headerId, 0);
  const mutated = Buffer.concat([docx.subarray(0, insertion), extra, docx.subarray(insertion)]);
  mutated.writeUInt16LE(extraLength + extra.length, record.central + 30);
  const oldEocd = docx.lastIndexOf(Buffer.from('PK\u0005\u0006', 'binary'));
  const newEocd = oldEocd + extra.length;
  mutated.writeUInt32LE(docx.readUInt32LE(oldEocd + 12) + extra.length, newEocd + 12);
  return mutated;
}
const footnotes = (userBody: string, separatorBody = '<w:r><w:separator/></w:r>') =>
  `<w:footnotes xmlns:w="${W_NS}">` +
  `<w:footnote w:type="separator" w:id="-1"><w:p>${separatorBody}</w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p>${userBody}</w:p></w:footnote></w:footnotes>`;
const endnotes = (userBody: string) =>
  `<w:endnotes xmlns:w="${W_NS}">` +
  `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
  `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
  `<w:endnote w:id="1"><w:p>${userBody}</w:p></w:endnote></w:endnotes>`;

const originalMoveBody =
  paragraphWithText('Moved text') +
  paragraphWithText('Anchor text');
const revisedMoveBody =
  paragraphWithText('Anchor text') +
  paragraphWithText('Moved text');
const validMoveBody =
  '<w:p>' +
  '<w:moveFromRangeStart w:id="10" w:name="move1" w:author="Comparison" w:date="2026-07-21T00:00:00Z"/>' +
  '<w:moveFrom w:id="11" w:author="Comparison"><w:r><w:delText>Moved text</w:delText></w:r></w:moveFrom>' +
  '<w:moveFromRangeEnd w:id="10"/>' +
  '</w:p>' +
  paragraphWithText('Anchor text') +
  '<w:p>' +
  '<w:moveToRangeStart w:id="12" w:name="move1" w:author="Comparison" w:date="2026-07-21T00:00:00Z"/>' +
  '<w:moveTo w:id="13" w:author="Comparison"><w:r><w:t>Moved text</w:t></w:r></w:moveTo>' +
  '<w:moveToRangeEnd w:id="12"/>' +
  '</w:p>';

describeWithLean('Lean fixed-story package protocol', () => {
  const run = (originalDocx: Buffer, revisedDocx: Buffer, comparedDocx: Buffer) =>
    runLeanXmlTripleVerifier({
      originalDocx, revisedDocx, comparedDocx,
      legacyDocumentXml: { original: '', revised: '', compared: '' },
      reconstructionMode: 'inplace',
      options: { executablePath: LEAN_EXE },
    });

  test.openspec('[LEAN-STORY-01] Fixed stories pass together')(
    'checks main, footnote, and endnote stories in one compiled invocation', async () => {
      const docx = await buildSyntheticDocx({
        paragraphs: ['Body'], footnoteOnParagraph: 0, footnoteText: 'Foot',
        endnoteOnParagraph: 0, endnoteText: 'End',
      });
      const certificate = await run(docx, docx, docx);
      expect(certificate.status).toBe('passed');
      expect(certificate.stories?.map((story) => story.name)).toEqual(['main', 'footnotes', 'endnotes']);
    });

  test.openspec('[LEAN-STORY-02] Side-story state is isolated')(
    'rejects malformed fields even when markers balance across side stories', async () => {
      const base = await buildSyntheticDocx({
        paragraphs: ['Body'], footnoteOnParagraph: 0, endnoteOnParagraph: 0,
      });
      const withFootnote = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'));
      const malformed = await replacePart(withFootnote, 'word/endnotes.xml', endnotes('<w:r><w:fldChar w:fldCharType="end"/></w:r>'));
      const certificate = await run(malformed, malformed, malformed);
      expect(certificate.status).toBe('failed');
      expect(certificate.stories?.filter((story) => story.status === 'failed').map((story) => story.name)).toEqual(['footnotes', 'endnotes']);
    });

  test.openspec('[LEAN-STORY-03] Optional presence is modeled as an empty story')(
    'checks missing stories as empty so tracked additions and removals pass but untracked divergence fails', async () => {
      const withNote = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
      const withoutNote = await replacePart(withNote, 'word/footnotes.xml', null);
      const untrackedAddition = await run(withoutNote, withNote, withNote);
      expect(untrackedAddition.status).toBe('failed');
      expect(untrackedAddition.presenceMismatches).toEqual([]);
      expect(untrackedAddition.stories?.find((story) => story.name === 'footnotes')?.presence).toEqual({
        original: false, revised: true, compared: true,
      });
      const added = await replacePart(
        withNote,
        'word/footnotes.xml',
        footnotes('<w:ins><w:r><w:t>Added note</w:t></w:r></w:ins>')
      );
      const revisedAdded = await replacePart(
        withNote,
        'word/footnotes.xml',
        footnotes('<w:r><w:t>Added note</w:t></w:r>')
      );
      const removed = await replacePart(
        withNote,
        'word/footnotes.xml',
        footnotes('<w:del><w:r><w:delText>Removed note</w:delText></w:r></w:del>')
      );
      const originalRemoved = await replacePart(
        withNote,
        'word/footnotes.xml',
        footnotes('<w:r><w:t>Removed note</w:t></w:r>')
      );

      expect((await run(withoutNote, revisedAdded, added)).status).toBe('passed');
      expect((await run(originalRemoved, withoutNote, removed)).status).toBe('passed');
    });

  test('fails closed when the required main story is missing from any package', async () => {
    const base = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const missingMain = await replacePart(base, 'word/document.xml', null);
    const certificate = await run(missingMain, base, base);
    expect(certificate.status).toBe('not_run');
    expect(certificate.relationshipSlots).toBeUndefined();
  });

  test.openspec('[LEAN-STORY-04] Reserved separator text is excluded')(
    'ignores reserved separator entry text through the Lean projection', async () => {
      const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
      const original = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>User note</w:t></w:r>', '<w:r><w:t>Old separator</w:t></w:r>'));
      const revised = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>User note</w:t></w:r>', '<w:r><w:t>New separator</w:t></w:r>'));
      expect((await run(original, revised, revised)).status).toBe('passed');
    });

  test('uses namespace-qualified note type rather than numeric IDs for reserved projection', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
    const typedAnyId = (reserved: string, normalZero: string) =>
      `<w:footnotes xmlns:w="${W_NS}">` +
      `<w:footnote w:type="separator" w:id="77"><w:p><w:r><w:t>${reserved}</w:t></w:r></w:p></w:footnote>` +
      `<w:footnote w:id="0"><w:p><w:r><w:t>${normalZero}</w:t></w:r></w:p></w:footnote>` +
      `</w:footnotes>`;
    const original = await replacePart(base, 'word/footnotes.xml', typedAnyId('old reserved', 'visible old'));
    const revisedReservedOnly = await replacePart(base, 'word/footnotes.xml', typedAnyId('new reserved', 'visible old'));
    const revisedNormalZero = await replacePart(base, 'word/footnotes.xml', typedAnyId('new reserved', 'visible new'));

    expect((await run(original, revisedReservedOnly, revisedReservedOnly)).status).toBe('passed');
    expect((await run(original, revisedNormalZero, revisedNormalZero)).status).toBe('failed');
  });

  test.openspec('[LEAN-STORY-06] Alternate namespace prefixes preserve checks')(
    'accepts alternate WordprocessingML prefixes and detects divergent text through them', async () => {
    const base = await buildDocxFromBodyXml(paragraphWithText('Original'));
    const originalXml = withPrefix(await readPart(base, 'word/document.xml'), 'w', 'wp');
    const original = await replacePart(base, 'word/document.xml', originalXml);
    const revisedXml = originalXml.replace('Original', 'Revised');
    const revised = await replacePart(base, 'word/document.xml', revisedXml);
    const malformedFieldBase = await buildDocxFromBodyXml(
      '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>'
    );
    const malformedField = await replacePart(
      malformedFieldBase,
      'word/document.xml',
      withPrefix(await readPart(malformedFieldBase, 'word/document.xml'), 'w', 'wp')
    );

    expect((await run(original, original, original)).status).toBe('passed');
    expect((await run(original, revised, revised)).status).toBe('failed');
    expect((await run(malformedField, malformedField, malformedField)).status).toBe('failed');
    });

  test('rejects malformed or unrecognized WordprocessingML roots instead of accepting empty tokens', async () => {
    const base = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const wrongRoot = await replacePart(
      base,
      'word/document.xml',
      '<x:document xmlns:x="urn:not-wordprocessingml"><x:p><x:t>Body</x:t></x:p></x:document>'
    );
    const malformed = await replacePart(base, 'word/document.xml', '<w:document><w:p></w:document>');
    expect((await run(wrongRoot, wrongRoot, wrongRoot)).status).toBe('not_run');
    expect((await run(malformed, malformed, malformed)).status).toBe('not_run');
  });

  test('rejects illegal literal characters, invalid QNames, and content outside the root', async () => {
    const base = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const xml = await readPart(base, 'word/document.xml');
    const malformedInputs = {
      controlInText: xml.replace('Body', 'B\u0001ody'),
      controlInAttribute: xml.replace('xmlns:w=', '_bad="\u000B" xmlns:w='),
      noncharacterFffe: xml.replace('Body', 'B\uFFFEody'),
      noncharacterFfff: xml.replace('Body', 'B\uFFFFody'),
      multipleElementColons: xml.replace('<w:p>', '<w:x:p>'),
      emptyElementPrefix: xml.replace('<w:p>', '<:p>'),
      emptyElementLocalName: xml.replace('<w:p>', '<w:>'),
      invalidElementStart: xml.replace('<w:p>', '<w:1p>'),
      multipleAttributeColons: xml.replace('xmlns:w=', 'xmlns:w:x='),
      emptyAttributePrefix: xml.replace('xmlns:w=', ':bad="x" xmlns:w='),
      emptyAttributeLocalName: xml.replace('xmlns:w=', 'w:="x" xmlns:w='),
      invalidAttributeStart: xml.replace('xmlns:w=', '1bad="x" xmlns:w='),
      reboundXmlPrefix: xml.replace('xmlns:w=', 'xmlns:xml="urn:not-xml" xmlns:w='),
      reboundXmlnsPrefix: xml.replace('xmlns:w=', 'xmlns:xmlns="urn:not-xmlns" xmlns:w='),
      aliasedXmlNamespace: xml.replace(
        'xmlns:w=',
        `xmlns:x="http://www.w3.org/XML/1998/namespace" xmlns:w=`,
      ),
      duplicateForeignExpandedName: xml.replace(
        'xmlns:w=',
        'xmlns:a="urn:duplicate" xmlns:b="urn:duplicate" a:value="1" b:value="2" xmlns:w=',
      ),
      duplicateNamespacePrefix: xml.replace(
        'xmlns:w=',
        'xmlns:a="urn:first" xmlns:a="urn:second" xmlns:w=',
      ),
      normalizedNamespaceAliasCollision: xml.replace(
        'xmlns:w=',
        'xmlns:a="urn:normalized\tvalue" xmlns:b="urn:normalized value" ' +
        'a:value="1" b:value="2" xmlns:w=',
      ),
      invalidClosingQName: xml.replace('</w:p>', '</w:x:p>'),
      contentBeforeRoot: `garbage${xml}`,
      contentAfterRoot: `${xml}garbage`,
      contentAfterDeclaration: xml.replace('?>', '?>garbage'),
      secondRoot: `${xml}<w:document xmlns:w="${W_NS}"/>`,
      leadingWhitespaceBeforeDeclaration: ` \n${xml}`,
      unsupportedComment: xml.replace('?>', '?><!-- comment -->'),
      unsupportedProcessingInstruction: xml.replace('?>', '?><?work value?>'),
      unsupportedDoctype: xml.replace('?>', '?><!DOCTYPE w:document>'),
      unsupportedCdata: xml.replace('<w:body>', '<w:body><![CDATA[text]]>'),
      malformedDeclaration: xml.replace('version="1.0"', 'version="1.1"'),
      incompatibleEncoding: xml.replace('encoding="UTF-8"', 'encoding="UTF-16"'),
      incompatibleUtf8Alias: xml.replace('encoding="UTF-8"', 'encoding="UTF8"'),
      unknownReferenceInForeignText: xml.replace(
        '<w:body>',
        '<w:body><x:foreign xmlns:x="urn:foreign">bad&unknown;</x:foreign>',
      ),
      malformedReferenceInForeignText: xml.replace(
        '<w:body>',
        '<w:body><x:foreign xmlns:x="urn:foreign">bad&#xZZ;</x:foreign>',
      ),
    } as const;

    for (const [mutation, malformedXml] of Object.entries(malformedInputs)) {
      const malformedDocx = await replacePart(base, 'word/document.xml', malformedXml);
      expect((await run(malformedDocx, malformedDocx, malformedDocx)).status, mutation).toBe('not_run');
    }
  });

  test('accepts legal XML character, QName, declaration, and root-whitespace boundaries', async () => {
    const legalText = `legal\t\n\r \u00B7\uD7FF\uE000\uFFFD\u{10000}`;
    const base = await buildDocxFromBodyXml(
      `<w:p>` +
      `<w:_extension xmlns="urn:default" xmlns:a="urn:default" xmlns:b="urn:other" ` +
      `_meta="${legalText}" local="none" a:local="default" b:local="other"/>` +
      `<x:foreign xmlns:x="urn:foreign">legal&amp;&#x20;&#128512;</x:foreign>` +
      `<w:r><w:t>${legalText}</w:t></w:r></w:p>`,
    );
    const xml = await readPart(base, 'word/document.xml');
    const legalInputs = {
      emittedDeclaration: xml,
      minimalDeclaration: xml.replace(/^<\?xml[^?]*\?>/, "<?xml version='1.0'?>"),
      standaloneDeclaration: xml.replace(
        /^<\?xml[^?]*\?>/,
        '<?xml version="1.0" standalone="no"?>',
      ),
      mixedCaseUtf8Encoding: xml.replace('encoding="UTF-8"', 'encoding="uTf-8"'),
      leadingUtf8Bom: `\uFEFF${xml}`,
      referencedWmlNamespace: xml.replace(
        W_NS,
        W_NS.replace('wordprocessingml', 'word&#112;rocessingml'),
      ),
      noDeclarationWithWhitespace: ` \t\n${xml.replace(/^<\?xml[^?]*\?>/, '')}\r\n`,
    } as const;

    for (const [control, legalXml] of Object.entries(legalInputs)) {
      const legalDocx = await replacePart(base, 'word/document.xml', legalXml);
      expect((await run(legalDocx, legalDocx, legalDocx)).status, control).toBe('passed');
    }
  });

  test('rejects balanced malformed end-before-begin and repeated-separate fields per story', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
    const endThenBegin =
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
    const repeatedSeparate =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const malformedOrder = await replacePart(base, 'word/footnotes.xml', footnotes(endThenBegin));
    const malformedRepeat = await replacePart(base, 'word/footnotes.xml', footnotes(repeatedSeparate));
    expect((await run(malformedOrder, malformedOrder, malformedOrder)).status).toBe('failed');
    expect((await run(malformedRepeat, malformedRepeat, malformedRepeat)).status).toBe('failed');
  });

  test.openspec('[LEAN-STORY-05] Side-story divergence is visible')(
    'reports reject text divergence in a footnote story', async () => {
      const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
      const original = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Original note</w:t></w:r>'));
      const revised = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Revised note</w:t></w:r>'));
      const certificate = await run(original, revised, revised);
      expect(certificate.status).toBe('failed');
      expect(certificate.stories?.find((story) => story.name === 'footnotes')?.checks.rejectingAllTrackedChangesMatchesOriginalText.status).toBe('failed');
    });

  test('agrees with the existing TS accept/reject oracle on a tracked footnote protocol case', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
    const original = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Original note</w:t></w:r>'));
    const revised = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:t>Revised note</w:t></w:r>'));
    const combinedBody =
      '<w:del><w:r><w:delText>Original note</w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>Revised note</w:t></w:r></w:ins>';
    const combined = await replacePart(base, 'word/footnotes.xml', footnotes(combinedBody));

    const [originalXml, revisedXml, combinedXml] = await Promise.all([
      readPart(original, 'word/footnotes.xml'),
      readPart(revised, 'word/footnotes.xml'),
      readPart(combined, 'word/footnotes.xml'),
    ]);
    expect(normalizeText(extractTextWithParagraphs(acceptAllChanges(combinedXml)))).toBe(
      normalizeText(extractTextWithParagraphs(acceptAllChanges(revisedXml)))
    );
    expect(normalizeText(extractTextWithParagraphs(rejectAllChanges(combinedXml)))).toBe(
      normalizeText(extractTextWithParagraphs(rejectAllChanges(originalXml)))
    );
    expect((await run(original, revised, combined)).status).toBe('passed');
  });

  test.openspec('[LEAN-MOVE-RANGE-01] Compiled checker certifies structurally valid move ranges')(
    'certifies unique, balanced, non-crossing move ranges with matching source and destination identities', async () => {
      const original = await buildDocxFromBodyXml(originalMoveBody);
      const revised = await buildDocxFromBodyXml(revisedMoveBody);
      const combined = await buildDocxFromBodyXml(validMoveBody);

      const certificate = await run(original, revised, combined);
      expect(certificate.status).toBe('passed');
      expect(certificate.checks.trackedMoveRangesAreCorrectlyPaired).toEqual({
        status: 'passed',
        claim: 'Tracked move range markers are structurally paired by range ID and move name.',
      });
      expect(certificate.stories?.[0]?.checks.trackedMoveRangesAreCorrectlyPaired?.status).toBe('passed');
      expect(certificate.exclusions).toContain(
        'association of individual moveFrom or moveTo wrapper revision IDs with move ranges',
      );
    });

  test('accepts quoted move names with spaces and entities plus canonical endpoint aliases', async () => {
    const original = await buildDocxFromBodyXml(originalMoveBody);
    const revised = await buildDocxFromBodyXml(revisedMoveBody);
    const body = validMoveBody
      .replaceAll('w:name="move1"', "w:name = 'move one &amp; two > three'")
      .replace('w:id="10"/>', 'w:id=" 010 "/>')
      .replace('w:id="12"/>', 'w:id="+12"/>');
    const combined = await buildDocxFromBodyXml(body);

    const certificate = await run(original, revised, combined);
    expect(certificate.status).toBe('passed');
    expect(certificate.checks.trackedMoveRangesAreCorrectlyPaired?.status).toBe('passed');
  });

  test('pairs semantically equal move names across literal, entity, decimal, hex, and supplementary forms', async () => {
    const original = await buildDocxFromBodyXml(originalMoveBody);
    const revised = await buildDocxFromBodyXml(revisedMoveBody);
    const equivalentNames = [
      ['move one', 'move&#32;one'],
      ['move\tone', 'move one'],
      ['move\none', 'move one'],
      ['move\rone', 'move one'],
      ['move\r\none', 'move one'],
      ['move&#9;one', 'move&#x9;one'],
      ['move&#10;one', 'move&#xA;one'],
      ['move&#13;one', 'move&#xD;one'],
      ['move>one', 'move&gt;one'],
      ['move&#32;one', 'move&#x20;one'],
      ['move&amp;one', 'move&#38;one'],
      ['move😀one', 'move&#x1F600;one'],
      ['move&#128512;one', 'move&#x1F600;one'],
    ] as const;

    for (const [sourceName, destinationName] of equivalentNames) {
      const body = validMoveBody
        .replace('w:name="move1"', `w:name="${sourceName}"`)
        .replace('w:name="move1"', `w:name="${destinationName}"`);
      const combined = await buildDocxFromBodyXml(body);
      const certificate = await run(original, revised, combined);
      expect(certificate.status, `${sourceName} = ${destinationName}`).toBe('passed');
      expect(
        certificate.checks.trackedMoveRangesAreCorrectlyPaired?.status,
        `${sourceName} = ${destinationName}`,
      ).toBe('passed');
    }
  });

  test('distinguishes normalized literal attribute whitespace from referenced whitespace', async () => {
    const original = await buildDocxFromBodyXml(originalMoveBody);
    const revised = await buildDocxFromBodyXml(revisedMoveBody);
    const distinctions = [
      ['move\tone', 'move&#9;one'],
      ['move\none', 'move&#10;one'],
      ['move\rone', 'move&#13;one'],
      ['move\r\none', 'move  one'],
    ] as const;

    for (const [sourceName, destinationName] of distinctions) {
      const body = validMoveBody
        .replace('w:name="move1"', `w:name="${sourceName}"`)
        .replace('w:name="move1"', `w:name="${destinationName}"`);
      const combined = await buildDocxFromBodyXml(body);
      const certificate = await run(original, revised, combined);
      expect(certificate.status, `${sourceName} != ${destinationName}`).toBe('failed');
      expect(certificate.checks.trackedMoveRangesAreCorrectlyPaired?.status).toBe('failed');
    }
  });

  test('fails closed on malformed or ambiguous XML attributes and character references', async () => {
    const original = await buildDocxFromBodyXml(originalMoveBody);
    const revised = await buildDocxFromBodyXml(revisedMoveBody);
    const malformedInputs = {
      adjacentAttributes: validMoveBody.replace('w:id="10" w:name=', 'w:id="10"w:name='),
      duplicateId: validMoveBody.replace('w:id="10"', 'w:id="10" w:id="10"'),
      duplicateName: validMoveBody.replace('w:name="move1"', 'w:name="move1" w:name="move1"'),
      duplicateExpandedId: validMoveBody.replace(
        '<w:moveFromRangeStart w:id="10"',
        `<w:moveFromRangeStart xmlns:x="${W_NS}" w:id="10" x:id="10"`,
      ),
      missingEquals: validMoveBody.replace('w:id="10"', 'w:id "10"'),
      unquotedValue: validMoveBody.replace('w:id="10"', 'w:id=10'),
      literalLessThan: validMoveBody.replace('w:name="move1"', 'w:name="move<one"'),
      emptyDecimalReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#;"'),
      emptyHexReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#x;"'),
      malformedDecimalReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#12x;"'),
      malformedHexReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#xGG;"'),
      unterminatedReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#32"'),
      unknownEntity: validMoveBody.replace('w:name="move1"', 'w:name="move&unknown;"'),
      nulReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#0;"'),
      controlReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#1;"'),
      surrogateReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#xD800;"'),
      outOfRangeReference: validMoveBody.replace('w:name="move1"', 'w:name="move&#x110000;"'),
    } as const;

    for (const [mutation, body] of Object.entries(malformedInputs)) {
      const combined = await buildDocxFromBodyXml(body);
      expect((await run(original, revised, combined)).status, mutation).toBe('not_run');
    }
  });

  test.openspec('[LEAN-MOVE-RANGE-02] Move-range mutations fail independently of text checks')(
    'mutation-checks duplicate, missing, crossed, mismatched, malformed, aliased, and empty identities', async () => {
      const original = await buildDocxFromBodyXml(originalMoveBody);
      const revised = await buildDocxFromBodyXml(revisedMoveBody);
      const mutations = {
        duplicate: validMoveBody.replace(
          '<w:moveFromRangeStart w:id="10"',
          '<w:moveFromRangeStart w:id="10" w:name="move1" w:author="Comparison" w:date="2026-07-21T00:00:00Z"/>' +
          '<w:moveFromRangeStart w:id="10"',
        ),
        missing: validMoveBody.replace('<w:moveFromRangeEnd w:id="10"/>', ''),
        crossed: validMoveBody.replace(
          '<w:moveFromRangeStart w:id="10" w:name="move1"',
          '<w:moveFromRangeStart w:id="20" w:name="move2" w:author="Comparison" w:date="2026-07-21T00:00:00Z"/>' +
          '<w:moveFromRangeStart w:id="10" w:name="move1"',
        ).replace(
          '<w:moveFromRangeEnd w:id="10"/>',
          '<w:moveFromRangeEnd w:id="20"/><w:moveFromRangeEnd w:id="10"/>' +
          '<w:moveToRangeStart w:id="22" w:name="move2" w:author="Comparison" w:date="2026-07-21T00:00:00Z"/>' +
          '<w:moveToRangeEnd w:id="22"/>',
        ),
        mismatched: validMoveBody.replace(
          '<w:moveToRangeStart w:id="12" w:name="move1"',
          '<w:moveToRangeStart w:id="12" w:name="move2"',
        ),
        malformedDecimal: validMoveBody.replaceAll('w:id="10"', 'w:id="abc"'),
        numericAlias: validMoveBody
          .replace(
            '<w:moveFromRangeStart w:id="10"',
            '<w:moveFromRangeStart w:id="010" w:name="move2"/>' +
            '<w:moveFromRangeEnd w:id="010"/>' +
            '<w:moveFromRangeStart w:id="10"',
          )
          .replace(
            '<w:moveToRangeStart w:id="12"',
            '<w:moveToRangeStart w:id="22" w:name="move2"/>' +
            '<w:moveToRangeEnd w:id="22"/>' +
            '<w:moveToRangeStart w:id="12"',
          ),
        emptyName: validMoveBody.replaceAll('w:name="move1"', 'w:name=""'),
      } as const;

      for (const [mutation, body] of Object.entries(mutations)) {
        const combined = await buildDocxFromBodyXml(body);
        const certificate = await run(original, revised, combined);
        expect(certificate.status, `${mutation}: ${certificate.reason}`).toBe('failed');
        expect(certificate.checks.trackedMoveRangesAreCorrectlyPaired?.status, mutation).toBe('failed');
        expect(certificate.checks.acceptingAllTrackedChangesMatchesRevisedText.status, mutation).toBe('passed');
        expect(certificate.checks.rejectingAllTrackedChangesMatchesOriginalText.status, mutation).toBe('passed');
      }
  });
});

describeWithLean('Lean direct relationship-story protocol v4', () => {
  const run = (originalDocx: Buffer, revisedDocx = originalDocx, comparedDocx = revisedDocx) =>
    runLeanXmlTripleVerifier({
      originalDocx, revisedDocx, comparedDocx,
      legacyDocumentXml: { original: '', revised: '', compared: '' },
      reconstructionMode: 'inplace',
      options: { executablePath: LEAN_EXE },
    });

  test
    .openspec('[LEAN-REL-01] Direct explicit header and footer roles are selected')
    .openspec('[LEAN-REL-05] Shared targets are checked once with all selectors')(
    'aligns all six role slots and deduplicates shared physical targets', async () => {
      const docx = await relationshipDocx({ includeAllRoles: true });
      const certificate = await run(docx);
      expect(certificate.status).toBe('passed');
      expect(certificate.checkerProtocolVersion).toBe(4);
      expect(certificate.relationshipSlots).toHaveLength(6);
      expect(certificate.relationshipSlots?.map(({ kind, role }) => `${kind}:${role}`)).toEqual([
        'header:first', 'header:default', 'header:even',
        'footer:first', 'footer:default', 'footer:even',
      ]);
      expect(certificate.relationshipStories).toHaveLength(2);
      expect(certificate.relationshipStories?.map((story) => story.selectingSlotOrdinals)).toEqual([
        [0, 1, 2], [3, 4, 5],
      ]);
    },
  );

  test.openspec('[LEAN-REL-18] Selected story failures use the generic checker')(
    'fails a compared-only parser-visible header mutation without changing selection', async () => {
      const original = await relationshipDocx();
      const compared = await relationshipDocx({ headerText: 'Changed header' });
      const certificate = await run(original, original, compared);
      expect(certificate.status).toBe('failed');
      expect(certificate.relationshipSelectionFailures).toEqual([]);
      expect(certificate.relationshipSlots).toHaveLength(2);
      const header = certificate.relationshipStories?.find((story) => story.kind === 'header');
      expect(header?.status).toBe('failed');
      expect(Object.values(header?.checks ?? {}).some((item) => item.status === 'failed')).toBe(true);
    },
  );

  test.openspec('[LEAN-REL-08] Selector-observable section changes fail closed')(
    'reports an ordered slot inventory mismatch without semantic section reconciliation', async () => {
      const selected = await relationshipDocx();
      const plain = await buildDocxFromBodyXml(paragraphWithText('Body'));
      const certificate = await run(selected, plain, plain);
      expect(certificate.status).toBe('failed');
      expect(certificate.relationshipSlots).toEqual([]);
      expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
        'SECTION_SLOT_MISMATCH',
      );
    },
  );

  test('reports unsupported sectPr ancestry instead of selecting nested false positives', async () => {
    const cases = [
      paragraphWithText('Body') +
        `<w:p><w:r><w:sectPr xmlns:r="${R_NS}"><w:headerReference w:type="default" r:id="rIdH0"/></w:sectPr></w:r></w:p>`,
      paragraphWithText('Body') +
        `<x:p xmlns:x="${W_NS}" xmlns:q="${R_NS}"><x:r><x:sectPr><x:headerReference x:type="default" q:id="rIdH0"/></x:sectPr></x:r></x:p>`,
      `<w:tbl><w:tr><w:tc><w:p><w:pPr><w:sectPr xmlns:r="${R_NS}">` +
        `<w:headerReference w:type="default" r:id="rIdH0"/></w:sectPr></w:pPr></w:p></w:tc></w:tr></w:tbl>`,
    ];
    for (const bodyXml of cases) {
      const certificate = await run(await relationshipDocx({ bodyXml }));
      expect(certificate.status).toBe('failed');
      expect(certificate.relationshipSlots).toEqual([]);
      expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
        'UNSUPPORTED_SECTION_PLACEMENT',
      );
    }
  });

  test('fails required-main inventory construction for malformed body and terminal sectPr shapes', async () => {
    const document = (content: string) =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">${content}</w:document>`;
    const base = await relationshipDocx();
    const malformedDocuments = {
      noBody: document('<w:p/>'),
      nestedBody: document('<w:body><w:body/></w:body>'),
      twoTerminalSectPr: document('<w:body><w:sectPr/><w:sectPr/></w:body>'),
      nonTerminalBodySectPr: document('<w:body><w:sectPr/><w:p/></w:body>'),
      multipleBody: document('<w:body/><w:body/>'),
    };
    for (const [name, xml] of Object.entries(malformedDocuments)) {
      const malformed = await replacePart(base, 'word/document.xml', xml);
      const certificate = await run(malformed);
      expect(certificate.status, name).toBe('not_run');
      expect(certificate.relationshipSlots, name).toBeUndefined();
    }
  });

  test('reports header and footer references outside an open supported sectPr', async () => {
    const bodyXml =
      paragraphWithText('Body') +
      `<w:headerReference xmlns:r="${R_NS}" w:type="default" r:id="rIdH0"/>` +
      `<w:footerReference xmlns:r="${R_NS}" w:type="default" r:id="rIdF0"/>`;
    const certificate = await run(await relationshipDocx({ bodyXml }));
    expect(certificate.status).toBe('failed');
    expect(certificate.relationshipSlots).toEqual([]);
    const codes = certificate.relationshipSelectionFailures?.map((issue) => issue.code);
    expect(codes).toHaveLength(6);
    expect(codes?.every((code) => code === 'INDIRECT_SECTION_BINDING')).toBe(true);
  });

  test('accepts namespace-resolved direct paragraph-property sectPr ancestry', async () => {
    const bodyXml =
      `<x:p xmlns:x="${W_NS}" xmlns:q="${R_NS}"><x:pPr><x:sectPr>` +
      `<x:headerReference x:type="default" q:id="rIdH0"/>` +
      `<x:footerReference x:type="default" q:id="rIdF0"/>` +
      `</x:sectPr></x:pPr><x:r><x:t>Body</x:t></x:r></x:p>`;
    const certificate = await run(await relationshipDocx({ bodyXml }));
    expect(certificate.status).toBe('passed');
    expect(certificate.relationshipSlots?.map((slot) => slot.kind)).toEqual(['header', 'footer']);
  });

  test('reports indirect descendants of supported sectPr instead of silently omitting them', async () => {
    const cases = [
      paragraphWithText('Body') +
        `<w:sectPr xmlns:r="${R_NS}"><w:p><w:headerReference w:type="default" r:id="rIdH0"/></w:p></w:sectPr>`,
      paragraphWithText('Body') +
        `<x:sectPr xmlns:x="${W_NS}" xmlns:q="${R_NS}"><x:custom><x:headerReference x:type="default" q:id="rIdH0"/></x:custom></x:sectPr>`,
    ];
    for (const bodyXml of cases) {
      const certificate = await run(await relationshipDocx({ bodyXml }));
      expect(certificate.status).toBe('failed');
      expect(certificate.relationshipSlots).toEqual([]);
      expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
        'INDIRECT_SECTION_BINDING',
      );
    }
  });

  test('retains successfully resolved slots and stories when a peer binding fails', async () => {
    const certificate = await run(await relationshipDocx({ omitFooterRelationship: true }));
    expect(certificate.status).toBe('failed');
    expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
      'MISSING_RELATIONSHIP',
    );
    expect(certificate.relationshipSlots?.map((slot) => slot.kind)).toEqual(['header']);
    expect(certificate.relationshipStories?.map((story) => story.kind)).toEqual(['header']);
  });

  test('retains a valid loaded header when the independently selected footer part is missing', async () => {
    const certificate = await run(await relationshipDocx({ omitFooterPart: true }));
    expect(certificate.status).toBe('failed');
    expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
      'MISSING_TARGET_PART',
    );
    expect(certificate.relationshipSlots?.map((slot) => slot.kind)).toEqual(['header']);
    expect(certificate.relationshipStories?.map((story) => story.kind)).toEqual(['header']);
    expect(certificate.relationshipStories?.[0]?.selectingSlotOrdinals).toEqual([0]);
  });

  test.openspec('[LEAN-REL-07] Every relationship record is structurally parsed')(
    'rejects a malformed unselected relationship record as structured failed evidence', async () => {
      const malformed = await relationshipDocx({ malformedUnselectedRelationship: true });
      const certificate = await run(malformed);
      expect(certificate.status).toBe('failed');
      expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
        'MALFORMED_RELATIONSHIP_RECORD',
      );
    },
  );

  test('accepts safe percent-decoded targets and rejects encoded separators', async () => {
    const safe = await relationshipDocx({
      headerTarget: 'header%20one.xml',
      headerPartPath: 'word/header one.xml',
    });
    const unsafe = await relationshipDocx({ headerTarget: 'header%2Fone.xml' });
    expect((await run(safe)).status).toBe('passed');
    const rejected = await run(unsafe);
    expect(rejected.status).toBe('failed');
    expect(rejected.relationshipSelectionFailures?.map((issue) => issue.code)).toContain('UNSAFE_TARGET');
  });

  test('accepts explicit-empty relationships and bounded repeated safe percent decoding', async () => {
    const explicitEmpty = await relationshipDocx({ explicitEmptyRelationships: true });
    const repeatedSafe = await relationshipDocx({
      headerTarget: 'header%2520one.xml',
      headerPartPath: 'word/header one.xml',
    });
    expect((await run(explicitEmpty)).status).toBe('passed');
    expect((await run(repeatedSafe)).status).toBe('passed');
    for (const headerTarget of ['header%252Fone.xml', '%252e%252e/header1.xml']) {
      const rejected = await run(await relationshipDocx({ headerTarget }));
      expect(rejected.status).toBe('failed');
      expect(rejected.relationshipSelectionFailures?.map((issue) => issue.code)).toContain('UNSAFE_TARGET');
    }
  });

  test('rejects raw and repeatedly percent-decoded glob metacharacters', async () => {
    for (const headerTarget of [
      'head*er1.xml', 'header[1].xml',
      'head%2Aer1.xml', 'header%5B1%5D.xml',
      'head%252Aer1.xml', 'header%255B1%255D.xml',
    ]) {
      const certificate = await run(await relationshipDocx({ headerTarget }));
      expect(certificate.status, headerTarget).toBe('failed');
      expect(
        certificate.relationshipSelectionFailures?.map((issue) => issue.code),
        headerTarget,
      ).toContain('UNSAFE_TARGET');
    }
  });

  test('reports invalid selected-part UTF-8 as structured failed evidence', async () => {
    const docx = await relationshipDocx();
    const zip = await JSZip.loadAsync(docx);
    zip.file('word/header1.xml', Buffer.from([0xff, 0xfe]), { createFolders: false });
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) delete zip.files[entry.name];
    }
    const malformed = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const certificate = await run(malformed);
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain('INVALID_UTF8');
  });

  test.openspec('[LEAN-REL-22] Metadata and event admission stop decompression')(
    'rejects more than 256 unique selected paths before selected decompression', async () => {
    const docx = corruptCompressedPayload(
      await resourceRelationshipDocx({ storyCount: 257 }),
      'word/header0.xml',
    );
    const certificate = await run(docx);
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
      'UNIQUE_SELECTED_PART_LIMIT_EXCEEDED',
    );
    expect(certificate.relationshipStories).toEqual([]);
    },
  );

  test.openspec('[LEAN-REL-22] Metadata and event admission stop decompression')(
    'checks relationship metadata before selected parts and optional notes', async () => {
    let docx = await resourceRelationshipDocx({
      storyCount: 3,
      footnotesXml: footnotes('<w:r><w:t>Must not extract</w:t></w:r>'),
    });
    for (let index = 0; index < 3; index += 1) {
      docx = mutateExpandedSize(docx, `word/header${index}.xml`, 12 * 1024 * 1024);
    }
    docx = corruptCompressedPayload(docx, 'word/header0.xml');
    docx = corruptCompressedPayload(docx, 'word/footnotes.xml');
    const certificate = await run(docx);
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
      'AGGREGATE_EXPANDED_LIMIT_EXCEEDED',
    );
    expect(certificate.relationshipStories).toEqual([]);
    expect(certificate.fixedStoryFailures?.map((issue) => issue.code)).toContain(
      'OPTIONAL_STORY_AGGREGATE_LIMIT_EXCEEDED',
    );
    },
  );

  test.openspec('[LEAN-REL-22] Metadata and event admission stop decompression')(
    'classifies an optional note crossing after completed relationship work', async () => {
    const rootPrefix = `<w:hdr xmlns:w="${W_NS}">`;
    const rootSuffix = '</w:hdr>';
    const exactExpandedLimitXml =
      rootPrefix +
      ' '.repeat(16 * 1024 * 1024 - Buffer.byteLength(rootPrefix + rootSuffix)) +
      rootSuffix;
    let docx = await resourceRelationshipDocx({
      storyCount: 1,
      storyXml: () => exactExpandedLimitXml,
      footnotesXml: footnotes('<w:r><w:t>Must not extract</w:t></w:r>'),
    });
    docx = mutateExpandedSize(docx, 'word/footnotes.xml', 16 * 1024 * 1024);
    docx = corruptCompressedPayload(docx, 'word/footnotes.xml');
    const certificate = await run(docx);
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.relationshipStories).toHaveLength(1);
    expect(certificate.fixedStoryFailures?.map((issue) => issue.code)).toContain(
      'OPTIONAL_STORY_AGGREGATE_LIMIT_EXCEEDED',
    );
    expect(certificate.relationshipSelectionFailures).toEqual([]);
    },
    30_000,
  );

  test.openspec('[LEAN-REL-22] Metadata and event admission stop decompression')(
    'stops selected extraction when aggregate XML events are exhausted', async () => {
    const repeatedEvents = '<w:r/>'.repeat(340_000);
    const originalBase = await resourceRelationshipDocx({
      storyCount: 4,
      storyXml: (_index, kind) => {
        const root = kind === 'header' ? 'hdr' : 'ftr';
        return `<w:${root} xmlns:w="${W_NS}">${repeatedEvents}</w:${root}>`;
      },
    });
    const original = corruptCompressedPayload(originalBase, 'word/footer3.xml');
    const revised = corruptCompressedPayload(originalBase, 'word/header2.xml');
    const certificate = await run(original, revised, originalBase);
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
      'XML_TOKEN_LIMIT_EXCEEDED',
    );
    expect(certificate.relationshipStories).toHaveLength(2);
    },
    30_000,
  );

  test.openspec('[LEAN-REL-22] Metadata and event admission stop decompression')(
    'treats the exact per-part equality boundary as aggregate exhaustion', async () => {
      const selectedXml = (kind: 'header' | 'footer', events: number) => {
        const root = kind === 'header' ? 'hdr' : 'ftr';
        return `<w:${root} xmlns:w="${W_NS}">${'<w:r/>'.repeat(events - 2)}</w:${root}>`;
      };
      const threeStoryMainAndRelationshipEvents = 21;
      const eventsLeavingExactlyOnePerPartBudget =
        1_000_000 - 500_000 - threeStoryMainAndRelationshipEvents;
      const base = await resourceRelationshipDocx({
        storyCount: 3,
        storyXml: (index, kind) =>
          selectedXml(kind, index === 0 ? eventsLeavingExactlyOnePerPartBudget : 500_001),
      });
      const corruptedThird = corruptCompressedPayload(base, 'word/header2.xml');
      const certificate = await run(corruptedThird);
      expect(certificate.status, certificate.reason).toBe('failed');
      expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
        'XML_TOKEN_LIMIT_EXCEEDED',
      );
      expect(certificate.relationshipStories).toHaveLength(1);
      expect(certificate.relationshipSelectionFailures?.[0]?.detail).toContain(
        'aggregate limit',
      );
    },
    60_000,
  );

  test.openspec('[LEAN-REL-22] Metadata and event admission stop decompression')(
    'keeps genuine per-part overflow distinct when aggregate headroom is larger', async () => {
      const selectedXml = (kind: 'header' | 'footer', events: number) => {
        const root = kind === 'header' ? 'hdr' : 'ftr';
        return `<w:${root} xmlns:w="${W_NS}">${'<w:r/>'.repeat(events - 2)}</w:${root}>`;
      };
      const docx = await resourceRelationshipDocx({
        storyCount: 2,
        storyXml: (index, kind) => selectedXml(kind, index === 0 ? 500_001 : 3),
      });
      const certificate = await run(docx);
      expect(certificate.status, certificate.reason).toBe('failed');
      expect(certificate.relationshipSelectionFailures?.map((issue) => issue.code)).toContain(
        'XML_TOKEN_LIMIT_EXCEEDED',
      );
      expect(certificate.relationshipSelectionFailures?.[0]?.detail).not.toContain(
        'aggregate limit',
      );
      expect(certificate.relationshipStories).toHaveLength(1);
    },
    60_000,
  );

  test.openspec('[LEAN-REL-22] Metadata and event admission stop decompression')(
    'stops optional extraction at the exact aggregate equality boundary', async () => {
      const oneStoryMainAndRelationshipEvents = 17;
      const selectedEvents = 1_000_000 - 500_000 - oneStoryMainAndRelationshipEvents;
      const headerXml =
        `<w:hdr xmlns:w="${W_NS}">` +
        `${'<w:r/>'.repeat(selectedEvents - 2)}</w:hdr>`;
      const oversizedFootnotes =
        `<w:footnotes xmlns:w="${W_NS}">` +
        `${'<w:footnote/>'.repeat(499_999)}</w:footnotes>`;
      const base = await resourceRelationshipDocx({
        storyCount: 1,
        storyXml: () => headerXml,
        footnotesXml: oversizedFootnotes,
        endnotesXml: endnotes('<w:r><w:t>Must not extract</w:t></w:r>'),
      });
      const corruptedEndnotes = corruptCompressedPayload(base, 'word/endnotes.xml');
      const certificate = await run(corruptedEndnotes);
      expect(certificate.status, certificate.reason).toBe('failed');
      expect(certificate.relationshipStories).toHaveLength(1);
      expect(certificate.relationshipSelectionFailures).toEqual([]);
      expect(certificate.fixedStoryFailures?.map((issue) => issue.code)).toContain(
        'OPTIONAL_STORY_AGGREGATE_LIMIT_EXCEEDED',
      );
    },
    60_000,
  );

  test.openspec('[LEAN-REL-21] Archive ambiguity is not a structured verifier result')(
    'rejects binary-index ambiguity before extraction', async () => {
      const docx = await relationshipDocx();
      const malformedPackages = [
        mutateZipFlags(docx, 'word/document.xml', 0),
        mutateZipFlags(docx, 'word/document.xml', 3),
        mutateZipDiskStart(docx, 'word/document.xml'),
        mutateZipMethod(docx, 'word/document.xml', 99),
        mutateCentralFlagsOnly(docx, 'word/document.xml', 11),
        injectCentralExtra(docx, 'word/document.xml', 0x0001),
        injectCentralExtra(docx, 'word/document.xml', 0x7075),
        replaceZipEntryName(docx, 'word/footer1.xml', 'word/header1.xml'),
        replaceZipEntryName(docx, 'word/header1.xml', 'word/../evil.xml'),
        docx.subarray(0, docx.length - 1),
      ];
      for (const malformed of malformedPackages) {
        const certificate = await run(malformed, malformed, malformed);
        expect(certificate.status).toBe('not_run');
        expect(certificate.relationshipSelectionFailures).toBeUndefined();
      }
    },
  );
});

const validProtocolReport = {
  protocolVersion: 4,
  checker: 'safe-docx-lean-relationship-story-checker',
  passed: true,
  fixedStories: [{
    name: 'main',
    presence: { original: true, revised: true, combined: true },
    parsedTokenCounts: { original: 1, revised: 1, combined: 1 },
    report: {
      passed: true,
      checks: {
        acceptPreservesFieldStructure: true,
        rejectPreservesFieldStructure: true,
        acceptTextMatchesRevised: true,
        rejectTextMatchesOriginal: true,
        combinedHasNoFldCharInsideDel: true,
        combinedHasValidMoveRanges: true,
      },
    },
  }],
  presenceMismatches: [],
  fixedStoryIssues: [],
  relationshipSlots: [],
  relationshipStories: [],
  selectionIssues: [],
};

async function fakeChecker(output: unknown): Promise<{ dir: string; executable: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'safe-docx-fake-checker-'));
  const executable = join(dir, 'checker');
  await writeFile(
    executable,
    `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${JSON.stringify(output)}'\n`,
  );
  await chmod(executable, 0o700);
  return { dir, executable };
}

describe('Lean fixed-story protocol and security hardening', () => {
  const runWith = (
    originalDocx: Buffer,
    revisedDocx: Buffer,
    comparedDocx: Buffer,
    executablePath: string,
    timeoutMs = 10_000,
  ) => runLeanXmlTripleVerifier({
    originalDocx,
    revisedDocx,
    comparedDocx,
    legacyDocumentXml: { original: '<w:document/>', revised: '<w:document/>', compared: '<w:document/>' },
    reconstructionMode: 'inplace',
    options: { executablePath, timeoutMs },
  });

  test
    .openspec('[LEAN-STORY-08] Public certificate remains v1 compatible')
    .openspec('[SDX-ANC-BOUNDARY-03] Lean protocol and scope remain unchanged')(
    'preserves the public v1 certificate fields while adding package-story evidence', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const fake = await fakeChecker(validProtocolReport);
    try {
      const result = await runWith(docx, docx, docx, fake.executable);
      const legacyShape: {
        protocolVersion: 1;
        verifier: 'Lean XML triple checker';
        scope: 'word/document.xml';
      } = result;
      expect(legacyShape).toMatchObject({
        protocolVersion: 1,
        verifier: 'Lean XML triple checker',
        scope: 'word/document.xml',
      });
      expect(result.status).toBe('passed');
      expect(result.checks.acceptingAllTrackedChangesMatchesRevisedText.status).toBe('passed');
      expect(result.checkerProtocolVersion).toBe(4);
      expect(result.fixedStoryScope).toEqual([
        'word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml',
      ]);
      expect(result.relationshipStoryScope?.inheritedRoles).toBe(false);
    } finally {
      await rm(fake.dir, { recursive: true, force: true });
    }
    });

  test('keeps the additive v1 move-range check compatible with legacy producers and decoders', () => {
    const unavailable = { status: 'not_evaluated', claim: 'Legacy producer did not evaluate this check.' } as const;
    const legacyProducer: DocumentIntegrityCertificate = {
      status: 'not_run',
      reason: 'legacy producer fixture',
      protocolVersion: 1,
      verifier: 'Lean XML triple checker',
      scope: 'word/document.xml',
      reconstructionMode: 'inplace',
      checks: {
        acceptingAllTrackedChangesMatchesRevisedText: unavailable,
        rejectingAllTrackedChangesMatchesOriginalText: unavailable,
        acceptingAllTrackedChangesKeepsValidFieldStructure: unavailable,
        rejectingAllTrackedChangesKeepsValidFieldStructure: unavailable,
        comparedDocumentHasNoFieldMarkersInsideDeletions: unavailable,
      },
      inputSha256: {
        originalDocumentXml: '0'.repeat(64),
        revisedDocumentXml: '0'.repeat(64),
        comparedDocumentXml: '0'.repeat(64),
      },
      exclusions: [],
    };
    expect(legacyProducer.checks.trackedMoveRangesAreCorrectlyPaired).toBeUndefined();

    const decodeLegacyV1 = (value: DocumentIntegrityCertificate) => ({
      protocolVersion: value.protocolVersion,
      verifier: value.verifier,
      scope: value.scope,
      status: value.status,
      acceptText: value.checks.acceptingAllTrackedChangesMatchesRevisedText,
    });
    expect(decodeLegacyV1({
      ...legacyProducer,
      checks: { ...legacyProducer.checks, trackedMoveRangesAreCorrectlyPaired: unavailable },
    })).toEqual({
      protocolVersion: 1,
      verifier: 'Lean XML triple checker',
      scope: 'word/document.xml',
      status: 'not_run',
      acceptText: unavailable,
    });
  });

  test.openspec('[LEAN-STORY-09] Inconsistent executable protocol is rejected')(
    'rejects duplicate, negative-count, inconsistent, and extra-field protocol reports', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const variants = [
      { ...validProtocolReport, protocolVersion: 2 },
      { ...validProtocolReport, fixedStories: [...validProtocolReport.fixedStories, validProtocolReport.fixedStories[0]] },
      { ...validProtocolReport, fixedStories: [{
        ...validProtocolReport.fixedStories[0],
        parsedTokenCounts: { original: -1, revised: 1, combined: 1 },
      }] },
      { ...validProtocolReport, fixedStories: [{
        ...validProtocolReport.fixedStories[0],
        parsedTokenCounts: { original: 1.5, revised: 1, combined: 1 },
      }] },
      { ...validProtocolReport, fixedStories: [{
        ...validProtocolReport.fixedStories[0],
        name: 'comments',
      }] },
      { ...validProtocolReport, fixedStories: [{
        ...validProtocolReport.fixedStories[0],
        name: 'footnotes',
      }] },
      { ...validProtocolReport, fixedStories: [{
        ...validProtocolReport.fixedStories[0],
        report: { ...validProtocolReport.fixedStories[0]!.report, passed: false },
      }] },
      { ...validProtocolReport, passed: false },
      { ...validProtocolReport, unexpected: true },
      { ...validProtocolReport, passed: false, presenceMismatches: [{
        name: 'main',
        packagePart: 'word/document.xml',
        required: true,
        presence: { original: false, revised: false, combined: false },
        unexpected: true,
      }] },
    ];
    for (const variant of variants) {
      const fake = await fakeChecker(variant);
      try {
        expect((await runWith(docx, docx, docx, fake.executable)).status).toBe('not_run');
      } finally {
        await rm(fake.dir, { recursive: true, force: true });
      }
    }
    });

  describeWithMaximumShape('compiled maximum-shape response constructors', () => {
    test.openspec('[LEAN-REL-22] Every legal response fits the output cap')(
      'accepts exact maximum shared and distinct responses emitted by compiled Lean constructors', async () => {
      const emittedStringBytes = (value: unknown): number => {
        if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
        if (Array.isArray(value)) return value.reduce((sum, item) => sum + emittedStringBytes(item), 0);
        if (value && typeof value === 'object') {
          return Object.values(value).reduce((sum, item) => sum + emittedStringBytes(item), 0);
        }
        return 0;
      };
      const outputs = await Promise.all(['shared', 'distinct'].map(async (mode) => {
        const stdout = await runMaximumShapeProducer(mode as 'shared' | 'distinct');
        return { mode, stdout, parsed: JSON.parse(stdout) as Record<string, unknown> };
      }));
      for (const { mode, stdout, parsed } of outputs) {
        expect(isLeanVerifierJson(parsed), mode).toBe(true);
        expect(Buffer.byteLength(stdout, 'utf8'), mode).toBeLessThan(8 * 1024 * 1024);
        expect(stdout, mode).toContain('\\"');
      }
      expect(emittedStringBytes(outputs[0]!.parsed)).toBe(1_047_663);
      expect(emittedStringBytes(outputs[1]!.parsed)).toBe(1_048_093);
      const shared = outputs[0]!.parsed as {
        relationshipSlots: unknown[];
        relationshipStories: Array<{ selectingSlotOrdinals: number[] }>;
      };
      expect(shared.relationshipSlots).toHaveLength(192);
      expect(shared.relationshipStories).toHaveLength(1);
      expect(shared.relationshipStories[0]?.selectingSlotOrdinals).toHaveLength(192);
      const distinct = outputs[1]!.parsed as {
        relationshipSlots: unknown[];
        relationshipStories: Array<{ selectingSlotOrdinals: number[] }>;
      };
      expect(distinct.relationshipSlots).toHaveLength(384);
      expect(distinct.relationshipStories).toHaveLength(384);
      expect(distinct.relationshipStories.flatMap((story) => story.selectingSlotOrdinals)).toHaveLength(384);
    },
      60_000,
    );
  });

  test('strictly rejects nested unknown keys and broken selector partitions', () => {
    const identity = { relationshipId: 'rId1', normalizedPartPath: 'word/header1.xml' };
    const slot = {
      slotOrdinal: 0, sectionOrdinal: 0, kind: 'header', role: 'default',
      original: identity, revised: identity, compared: identity, physicalStoryOrdinal: 0,
    };
    const story = {
      physicalStoryOrdinal: 0, kind: 'header',
      originalPartPath: 'word/header1.xml',
      revisedPartPath: 'word/header1.xml',
      comparedPartPath: 'word/header1.xml',
      selectingSlotOrdinals: [0],
      parsedTokenCounts: { original: 1, revised: 1, combined: 1 },
      report: validProtocolReport.fixedStories[0]!.report,
    };
    const valid = {
      ...validProtocolReport,
      relationshipSlots: [slot],
      relationshipStories: [story],
    };
    expect(isLeanVerifierJson(valid)).toBe(true);
    expect(isLeanVerifierJson({
      ...valid,
      relationshipSlots: [{ ...slot, original: { ...identity, unknown: true } }],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...valid,
      relationshipStories: [{ ...story, selectingSlotOrdinals: [0, 0] }],
    })).toBe(false);
  });

  test('rejects 257 unique selected paths on any package side', () => {
    const roles = ['first', 'default', 'even'] as const;
    const identities = Array.from({ length: 257 }, (_, slotOrdinal) => {
      const withinSection = slotOrdinal % 6;
      const kind = withinSection < 3 ? 'header' as const : 'footer' as const;
      const role = roles[withinSection % 3]!;
      const path = `word/${kind}${slotOrdinal}.xml`;
      const identity = { relationshipId: `rId${slotOrdinal}`, normalizedPartPath: path };
      return {
        slot: {
          slotOrdinal,
          sectionOrdinal: Math.floor(slotOrdinal / 6),
          kind,
          role,
          original: identity,
          revised: identity,
          compared: identity,
          physicalStoryOrdinal: slotOrdinal,
        },
        story: {
          physicalStoryOrdinal: slotOrdinal,
          kind,
          originalPartPath: path,
          revisedPartPath: path,
          comparedPartPath: path,
          selectingSlotOrdinals: [slotOrdinal],
          parsedTokenCounts: { original: 1, revised: 1, combined: 1 },
          report: validProtocolReport.fixedStories[0]!.report,
        },
      };
    });
    expect(isLeanVerifierJson({
      ...validProtocolReport,
      relationshipSlots: identities.map(({ slot }) => slot),
      relationshipStories: identities.map(({ story }) => story),
    })).toBe(false);
  });

  test('rejects simultaneous optional fixed-story success and failure evidence', () => {
    const footnotes = {
      ...validProtocolReport.fixedStories[0]!,
      name: 'footnotes',
    };
    const footnoteIssue = {
      code: 'OPTIONAL_STORY_INVALID_XML',
      name: 'footnotes',
      side: 'original',
      packagePart: 'word/footnotes.xml',
      detail: 'malformed optional story',
    };
    expect(isLeanVerifierJson({
      ...validProtocolReport,
      passed: false,
      fixedStories: [...validProtocolReport.fixedStories, footnotes],
      fixedStoryIssues: [footnoteIssue],
    })).toBe(false);
  });

  test('accepts only the canonical terminal evidence-overflow shape', () => {
    const terminalIssue = {
      code: 'EVIDENCE_STRING_BUDGET_EXCEEDED',
      detail: 'aggregate emitted strings exceed the evidence limit',
    };
    const terminal = {
      ...validProtocolReport,
      passed: false,
      selectionIssues: [terminalIssue],
    };
    expect(isLeanVerifierJson(terminal)).toBe(true);
    expect(isLeanVerifierJson({
      ...terminal,
      fixedStories: [
        ...validProtocolReport.fixedStories,
        { ...validProtocolReport.fixedStories[0]!, name: 'footnotes' },
      ],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...terminal,
      selectionIssues: [terminalIssue, {
        code: 'ISSUE_LIMIT_EXCEEDED',
        detail: 'too many issues',
      }],
    })).toBe(false);
  });

  test('rejects contradictory or root-inconsistent required-story presence mismatches', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const impossibleReports = [
      { ...validProtocolReport, passed: false, presenceMismatches: [{
        name: 'main',
        packagePart: 'word/document.xml',
        required: true,
        presence: { original: true, revised: true, combined: true },
      }] },
      { ...validProtocolReport, passed: false, presenceMismatches: [{
        name: 'main',
        packagePart: 'word/document.xml',
        required: true,
        presence: { original: false, revised: true, combined: true },
      }] },
    ];

    for (const report of impossibleReports) {
      const fake = await fakeChecker(report);
      try {
        const result = await runWith(docx, docx, docx, fake.executable);
        expect(result.status).toBe('not_run');
        expect(result.stories).toEqual([]);
      } finally {
        await rm(fake.dir, { recursive: true, force: true });
      }
    }
  });

  test('snapshots mutable package buffers before hashing, writing, or awaiting', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const dir = await mkdtemp(join(tmpdir(), 'safe-docx-snapshot-checker-'));
    const executable = join(dir, 'checker');
    await writeFile(executable, `#!/usr/bin/env node
let raw = '';
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => setTimeout(() => {
  const req = JSON.parse(raw);
  const bytes = require('node:fs').readFileSync(req.originalDocxPath);
  if (bytes.subarray(0, 2).toString() !== 'PK') process.exit(9);
  process.stdout.write(${JSON.stringify(JSON.stringify(validProtocolReport))});
}, 50));
`);
    await chmod(executable, 0o700);
    try {
      const mutable = Buffer.from(docx);
      const pending = runWith(mutable, docx, docx, executable);
      mutable.fill(0);
      expect((await pending).status).toBe('passed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('kills verifier process groups when a timeout fires', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const dir = await mkdtemp(join(tmpdir(), 'safe-docx-timeout-checker-'));
    const executable = join(dir, 'checker');
    const pidPath = join(dir, 'descendant.pid');
    await writeFile(executable, `#!/bin/sh\nsleep 30 &\necho $! > '${pidPath}'\ncat >/dev/null\nwait\n`);
    await chmod(executable, 0o700);
    try {
      expect((await runWith(docx, docx, docx, executable, 300)).status).toBe('not_run');
      const pid = Number((await readFile(pidPath, 'utf8')).trim());
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describeWithLean('Lean compiled package extraction limits', () => {
  const run = (docx: Buffer) => runLeanXmlTripleVerifier({
    originalDocx: docx,
    revisedDocx: docx,
    comparedDocx: docx,
    legacyDocumentXml: { original: '', revised: '', compared: '' },
    reconstructionMode: 'inplace',
    options: { executablePath: LEAN_EXE },
  });

  test.openspec('[LEAN-STORY-07] Unsafe package extraction fails closed')(
    'reports corrupt archives as not_run rather than missing optional stories', async () => {
    const result = await run(Buffer.from('not a zip archive'));
    expect(result.status).toBe('not_run');
    expect(result.reason).toContain('ZIP is too short for EOCD');
    });

  test('rejects oversized expanded story output before buffering it', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
    const huge = footnotes(`<w:r><w:t>${'x'.repeat(16 * 1024 * 1024 + 1)}</w:t></w:r>`);
    const oversized = await replacePart(base, 'word/footnotes.xml', huge, 'DEFLATE');
    const result = await run(oversized);
    expect(result.status).toBe('failed');
    expect(result.fixedStoryFailures?.map((issue) => issue.code)).toContain(
      'OPTIONAL_STORY_PART_LIMIT_EXCEEDED',
    );
  });

  test('accepts highly compressed XML when explicit byte and parser limits are satisfied', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
    const bomb = footnotes(`<w:r><w:t>${'x'.repeat(2 * 1024 * 1024)}</w:t></w:r>`);
    const compressed = await replacePart(base, 'word/footnotes.xml', bomb, 'DEFLATE');
    const result = await run(compressed);
    expect(result.status).toBe('passed');
  });
});
