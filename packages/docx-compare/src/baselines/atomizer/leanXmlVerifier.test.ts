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
import {
  isCommentIssue,
  isLeanVerifierJson,
  runLeanXmlTripleVerifier,
  runLeanXmlTripleVerifierForTest,
  validateCanonicalProtocolJson,
} from './leanXmlVerifier.js';
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
const NEAR_ENVELOPE_EXE = join(
  PROJECT_ROOT,
  'verification/lean/.lake/build/bin/protocolV6OrdinaryEnvelopeWitness',
);
const TERMINAL_SHAPES_EXE = join(
  PROJECT_ROOT,
  'verification/lean/.lake/build/bin/protocolV6CanonicalTerminalShapes',
);

async function runNearEnvelopeProducer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(NEAR_ENVELOPE_EXE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`near-envelope producer exited ${code}: ${Buffer.concat(stderr)}`));
    });
    child.stdin.end();
  });
}

async function runTerminalShapeProducer(mode: 'issues' | 'strings'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(TERMINAL_SHAPES_EXE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`terminal-shape producer exited ${code}: ${Buffer.concat(stderr)}`));
    });
    child.stdin.end(mode);
  });
}

function evidenceStringBytesForTest(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + evidenceStringBytesForTest(item), 0);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce<number>(
      (sum, item) => sum + evidenceStringBytesForTest(item),
      0,
    );
  }
  return 0;
}

function canonicalJsonForTest(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonForTest).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJsonForTest(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const exeExists = existsSync(LEAN_EXE);
if (!exeExists) {
  console.warn(
    `[lean-xml-verifier] SKIP: ${LEAN_EXE} not found. ` +
      `Build it with: (cd verification/lean && lake build leanDocxChecker)`,
  );
}
const describeWithLean = exeExists ? describe : describe.skip;
const describeWithNearEnvelope = existsSync(NEAR_ENVELOPE_EXE) ? describe : describe.skip;

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
        expect(result.documentIntegrity?.checkerProtocolVersion).toBe(6);
        expect(result.documentIntegrity?.fixedStoryScope).toBeUndefined();
        expect(result.documentIntegrity?.referenceSourcePartitions).toHaveLength(3);
        expect(result.documentIntegrity?.noteStories?.map((story) => story.kind)).toEqual([
          'footnotes', 'endnotes',
        ]);
        expect(result.documentIntegrity?.noteInventories).toHaveLength(6);
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
  headerTargets?: string[];
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
    relationship(`Id="rIdH${index}" Type="${HEADER_REL}" Target="${
      options.headerTargets?.[index] ?? options.headerTarget ?? 'header1.xml'
    }"`),
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
  const headerPartPaths = options.headerTargets
    ? new Set(options.headerTargets.map((target) => `word/${target}`))
    : new Set([options.headerPartPath ?? 'word/header1.xml']);
  for (const path of headerPartPaths) {
    zip.file(
      path,
      `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>${options.headerText ?? 'Header'}</w:t></w:r></w:p></w:hdr>`,
      { createFolders: false },
    );
  }
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
  });
  if (options.footnotesXml !== undefined) {
    relationships.push(
      `<Relationship Id="rIdFootnotes" Type="${R_NS}/footnotes" Target="footnotes.xml"/>`,
    );
  }
  if (options.endnotesXml !== undefined) {
    relationships.push(
      `<Relationship Id="rIdEndnotes" Type="${R_NS}/endnotes" Target="endnotes.xml"/>`,
    );
  }
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PR_NS}">${relationships.join('')}</Relationships>`,
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

function sizedNoteXml(kind: 'footnote' | 'endnote', targetBytes: number): string {
  const plural = `${kind}s`;
  const prefix = `<w:${plural} xmlns:w="${W_NS}"><w:${kind} w:id="1"><w:p><w:r><w:t>`;
  const suffix = `</w:t></w:r></w:p></w:${kind}></w:${plural}>`;
  const padding = targetBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  if (padding < 0) throw new Error('target note XML size is too small');
  return `${prefix}${'x'.repeat(padding)}${suffix}`;
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.7
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.10
 */
async function noteIntegrityDocx(options: {
  bodyReferences?: string;
  footnotesPath?: string;
  endnotesPath?: string;
  footnotesXml?: string;
  endnotesXml?: string;
  extraRelationships?: string;
  includeFootnotesRelationship?: boolean;
  includeEndnotesRelationship?: boolean;
  footnotesTarget?: string;
  endnotesTarget?: string;
} = {}): Promise<Buffer> {
  const bodyReferences = options.bodyReferences ??
    '<w:r><w:footnoteReference w:id="1"/></w:r>' +
    '<w:r><w:endnoteReference w:id="2"/></w:r>';
  const base = await buildDocxFromBodyXml(`<w:p>${bodyReferences}</w:p>`);
  const zip = await JSZip.loadAsync(base);
  const footnotesPath = options.footnotesPath ?? 'word/footnotes.xml';
  const endnotesPath = options.endnotesPath ?? 'word/endnotes.xml';
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PR_NS}">` +
    `${options.includeFootnotesRelationship === false ? '' :
      `<Relationship Id="rIdFootnotes" Type="${R_NS}/footnotes" ` +
      `Target="${options.footnotesTarget ?? footnotesPath.slice(5)}"/>`}` +
    `${options.includeEndnotesRelationship === false ? '' :
      `<Relationship Id="rIdEndnotes" Type="${R_NS}/endnotes" ` +
      `Target="${options.endnotesTarget ?? endnotesPath.slice(5)}"/>`}` +
    `${options.extraRelationships ?? ''}</Relationships>`,
    { createFolders: false },
  );
  zip.file(
    footnotesPath,
    options.footnotesXml ??
      `<w:footnotes xmlns:w="${W_NS}">` +
      `<w:footnote w:type="separator" w:id="1"><w:p/></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>` +
      `<w:footnote w:type="continuationNotice" w:id="-2"><w:p/></w:footnote>` +
      `<w:footnote w:id="1"><w:p><w:r><w:t>Foot</w:t></w:r></w:p></w:footnote>` +
      `</w:footnotes>`,
    { createFolders: false },
  );
  zip.file(
    endnotesPath,
    options.endnotesXml ??
      `<w:endnotes xmlns:w="${W_NS}">` +
      `<w:endnote w:id="2"><w:p><w:r><w:t>End</w:t></w:r></w:p></w:endnote>` +
      `</w:endnotes>`,
    { createFolders: false },
  );
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) delete zip.files[entry.name];
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.10
 */
async function commentIntegrityDocx(options: {
  referenceId?: string;
  commentsPath?: string;
  commentsTarget?: string;
  commentsXml?: string | Buffer;
  includeRelationship?: boolean;
  extraRelationships?: string;
  relationshipTargetMode?: string;
  omitCommentsPart?: boolean;
} = {}): Promise<Buffer> {
  const referenceId = options.referenceId ?? '7';
  const base = await buildDocxFromBodyXml(
    `<w:p><w:r><w:t>Commented</w:t></w:r>` +
    `<w:r><w:commentReference w:id="${referenceId}"/></w:r></w:p>`,
  );
  const zip = await JSZip.loadAsync(base);
  const commentsPath = options.commentsPath ?? 'word/comments.xml';
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PR_NS}">` +
    `${options.includeRelationship === false ? '' :
      `<Relationship Id="rIdComments" Type="${R_NS}/comments" ` +
      `Target="${options.commentsTarget ?? commentsPath.slice(5)}"` +
      `${options.relationshipTargetMode
        ? ` TargetMode="${options.relationshipTargetMode}"` : ''}/>`}` +
    `${options.extraRelationships ?? ''}</Relationships>`,
    { createFolders: false },
  );
  if (!options.omitCommentsPart) {
    zip.file(
      commentsPath,
      options.commentsXml ??
        `<w:comments xmlns:w="${W_NS}">` +
        `<w:comment w:id="7"><w:p><w:r><w:t>Comment</w:t></w:r></w:p></w:comment>` +
        `<w:comment w:id="99"><w:p><w:r><w:t>Unreferenced</w:t></w:r></w:p></w:comment>` +
        `</w:comments>`,
      { createFolders: false },
    );
  }
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) delete zip.files[entry.name];
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.10
 */
async function commentIntegrityAllStoriesDocx(
  omitDefinition?: string,
): Promise<Buffer> {
  const reference = (id: string) =>
    `<w:p><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;
  const base = await buildDocxFromBodyXml(reference('1'), [], {
    namespaces: { r: R_NS },
  });
  const zip = await JSZip.loadAsync(base);
  const documentXml = await zip.file('word/document.xml')!.async('string');
  zip.file(
    'word/document.xml',
    documentXml.replace(
      '<w:sectPr/>',
      `<w:sectPr>` +
      `<w:headerReference w:type="default" r:id="rIdHeader"/>` +
      `<w:footerReference w:type="default" r:id="rIdFooter"/>` +
      `</w:sectPr>`,
    ),
    { createFolders: false },
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PR_NS}">` +
    `<Relationship Id="rIdHeader" Type="${R_NS}/header" Target="header-legal.xml"/>` +
    `<Relationship Id="rIdFooter" Type="${R_NS}/footer" Target="footer-legal.xml"/>` +
    `<Relationship Id="rIdFootnotes" Type="${R_NS}/footnotes" Target="footnotes.xml"/>` +
    `<Relationship Id="rIdEndnotes" Type="${R_NS}/endnotes" Target="endnotes.xml"/>` +
    `<Relationship Id="rIdComments" Type="${R_NS}/comments" ` +
    `Target="annotations/comments-legal.xml"/>` +
    `</Relationships>`,
    { createFolders: false },
  );
  zip.file(
    'word/header-legal.xml',
    `<w:hdr xmlns:w="${W_NS}">${reference('2')}</w:hdr>`,
    { createFolders: false },
  );
  zip.file(
    'word/footer-legal.xml',
    `<w:ftr xmlns:w="${W_NS}">${reference('3')}</w:ftr>`,
    { createFolders: false },
  );
  zip.file(
    'word/footnotes.xml',
    `<w:footnotes xmlns:w="${W_NS}">` +
    `<w:footnote w:id="10">${reference('4')}</w:footnote>` +
    `</w:footnotes>`,
    { createFolders: false },
  );
  zip.file(
    'word/endnotes.xml',
    `<w:endnotes xmlns:w="${W_NS}">` +
    `<w:endnote w:id="11">${reference('5')}</w:endnote>` +
    `</w:endnotes>`,
    { createFolders: false },
  );
  const definitions = ['1', '2', '3', '4', '5']
    .filter((id) => id !== omitDefinition)
    .map((id) => `<w:comment w:id="${id}"><w:p/></w:comment>`)
    .join('');
  zip.file(
    'word/annotations/comments-legal.xml',
    `<w:comments xmlns:w="${W_NS}">${definitions}</w:comments>`,
    { createFolders: false },
  );
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) delete zip.files[entry.name];
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describeWithLean('Lean conventional comment-reference integrity', () => {
  const run = (
    originalDocx: Buffer,
    revisedDocx = originalDocx,
    comparedDocx = revisedDocx,
  ) => runLeanXmlTripleVerifier({
    originalDocx,
    revisedDocx,
    comparedDocx,
    legacyDocumentXml: { original: '', revised: '', compared: '' },
    reconstructionMode: 'inplace',
    options: { executablePath: LEAN_EXE },
  });
  const expectGlobalCommentStop = (
    certificate: Awaited<ReturnType<typeof run>>,
    firstCode: string,
  ) => {
    expect(certificate.commentIntegrityFailures?.[0]).toMatchObject({
      side: 'original',
      code: firstCode,
    });
    expect(certificate.commentIntegrityFailures?.some((issue) =>
      issue.side === 'revised' || issue.side === 'compared')).toBe(false);
    expect(certificate.commentInventories).toHaveLength(3);
    expect(certificate.commentInventories?.every((inventory) =>
      inventory.status === 'not_evaluated' &&
      inventory.referenceOccurrences === 0 &&
      inventory.definitions === 0)).toBe(true);
    expect(certificate.commentStory?.original.status).toBe('not_evaluated');
    expect(certificate.commentStory?.revised.status).toBe('not_evaluated');
    expect(certificate.commentStory?.compared.status).toBe('not_evaluated');
  };

  test
    .openspec('[LEAN-COMMENT-01] Selected comments resolve admitted references')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' })(
    'accepts relocated comments and retains unique unreferenced definitions', async () => {
      const docx = await commentIntegrityDocx({
        commentsPath: 'word/annotations/legal-comments.xml',
      });
      const certificate = await run(docx);
      expect(certificate.status, certificate.reason).toBe('passed');
      expect(certificate.checkerProtocolVersion).toBe(6);
      expect(certificate.commentStory?.original.status).toBe('passed');
      expect(certificate.commentStory?.original.relationship?.normalizedPartPath)
        .toBe('word/annotations/legal-comments.xml');
      expect(certificate.commentInventories?.[0]).toMatchObject({
        status: 'passed',
        referenceOccurrences: 1,
        uniqueReferenceIds: 1,
        definitions: 2,
        unreferencedDefinitions: 1,
      });
    },
  );

  test
    .openspec('[LEAN-COMMENT-02] Comment relationship absence wins before ID decoding')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' })(
    'reports required relationship before a malformed reference ID', async () => {
      const docx = await commentIntegrityDocx({
        referenceId: 'not-a-decimal',
        includeRelationship: false,
      });
      const certificate = await run(docx);
      expect(certificate.status, certificate.reason).toBe('failed');
      expect(certificate.commentIntegrityFailures?.map((issue) => issue.code))
        .toContain('COMMENT_RELATIONSHIP_REQUIRED');
      expect(certificate.commentIntegrityFailures?.map((issue) => issue.code))
        .not.toContain('COMMENT_REFERENCE_ID_MALFORMED');
      expectGlobalCommentStop(certificate, 'COMMENT_RELATIONSHIP_REQUIRED');
    },
  );

  test
    .openspec('[LEAN-COMMENT-03] Direct definitions are unique by decimal value')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.10' })(
    'rejects an aliased duplicate definition only in the compared package', async () => {
      const valid = await commentIntegrityDocx();
      const compared = await commentIntegrityDocx({
        commentsXml: `<w:comments xmlns:w="${W_NS}">` +
          `<w:comment w:id="7"><w:p/></w:comment>` +
          `<w:comment w:id="+007"><w:p/></w:comment></w:comments>`,
      });
      const certificate = await run(valid, valid, compared);
      expect(certificate.status).toBe('failed');
      expect(certificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          side: 'compared',
          code: 'COMMENT_DEFINITION_DUPLICATE',
          canonicalId: '7',
        }),
      ]));
    },
  );

  test
    .openspec('[LEAN-COMMENT-04] Comment selector and realization failures are fail-closed')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.2' })(
    'rejects an external comments relationship', async () => {
      const certificate = await run(await commentIntegrityDocx({
        relationshipTargetMode: 'External',
      }));
      expect(certificate.status, certificate.reason).toBe('failed');
      expect(certificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          side: 'original',
          code: 'COMMENT_RELATIONSHIP_EXTERNAL',
        }),
      ]));
      expectGlobalCommentStop(certificate, 'COMMENT_RELATIONSHIP_EXTERNAL');
    },
  );

  test('rejects an unsafe comments relationship target', async () => {
    testAllure.conformance({
      spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.2',
    });
    const certificate = await run(await commentIntegrityDocx({
      commentsTarget: '../../outside.xml',
    }));
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        side: 'original',
        code: 'COMMENT_RELATIONSHIP_UNSAFE_TARGET',
      }),
    ]));
    expectGlobalCommentStop(certificate, 'COMMENT_RELATIONSHIP_UNSAFE_TARGET');
  });

  test('rejects ambiguous comments relationships', async () => {
    testAllure.conformance({
      spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.2',
    });
    const certificate = await run(await commentIntegrityDocx({
      extraRelationships:
        `<Relationship Id="rIdComments2" Type="${R_NS}/comments" Target="comments2.xml"/>`,
    }));
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        side: 'original',
        code: 'COMMENT_RELATIONSHIP_AMBIGUOUS',
      }),
    ]));
    expectGlobalCommentStop(certificate, 'COMMENT_RELATIONSHIP_AMBIGUOUS');
  });

  test('rejects a missing selected comments part', async () => {
    testAllure.conformance({
      spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.6',
    });
    const certificate = await run(await commentIntegrityDocx({
      omitCommentsPart: true,
    }));
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: 'original', code: 'COMMENT_PART_MISSING' }),
    ]));
    expectGlobalCommentStop(certificate, 'COMMENT_PART_MISSING');
  });

  test('rejects a selected comments part with the wrong root', async () => {
    testAllure.conformance({
      spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.6',
    });
    const certificate = await run(await commentIntegrityDocx({
      commentsXml: `<w:footnotes xmlns:w="${W_NS}"/>`,
    }));
    expect(certificate.status, certificate.reason).toBe('failed');
    expect(certificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        side: 'original',
        code: 'COMMENT_PART_ROOT_MISMATCH',
      }),
    ]));
    expectGlobalCommentStop(certificate, 'COMMENT_PART_ROOT_MISMATCH');
  });

  test
    .openspec('[LEAN-COMMENT-05] Comment IDs use bounded ST_DecimalNumber semantics')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.10' })(
    'canonicalizes signed aliases and rejects malformed, overlong, and non-direct definitions',
    async () => {
      const aliases = await run(await commentIntegrityDocx({
        referenceId: ' +007 ',
      }));
      expect(aliases.status, aliases.reason).toBe('passed');

      const malformed = await run(await commentIntegrityDocx({
        referenceId: 'seven',
      }));
      expect(malformed.status, malformed.reason).toBe('failed');
      expect(malformed.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMMENT_REFERENCE_ID_MALFORMED', rawId: 'seven' }),
      ]));

      const overlong = await run(await commentIntegrityDocx({
        referenceId: '1'.repeat(65),
      }));
      expect(overlong.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'COMMENT_REFERENCE_ID_TOO_LONG',
          rawIdByteLength: 65,
        }),
      ]));

      const nonDirect = await run(await commentIntegrityDocx({
        commentsXml: `<w:comments xmlns:w="${W_NS}"><w:custom>` +
          `<w:comment w:id="7"><w:p/></w:comment></w:custom></w:comments>`,
      }));
      expect(nonDirect.status, nonDirect.reason).toBe('failed');
      expect(nonDirect.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'COMMENT_DEFINITION_NOT_DIRECT',
          canonicalId: '7',
        }),
      ]));

      const definitionCases = [
        [
          `<w:comments xmlns:w="${W_NS}"><w:comment><w:p/></w:comment></w:comments>`,
          'COMMENT_DEFINITION_ID_MISSING',
        ],
        [
          `<w:comments xmlns:w="${W_NS}"><w:comment w:id="seven"><w:p/></w:comment></w:comments>`,
          'COMMENT_DEFINITION_ID_MALFORMED',
        ],
        [
          `<w:comments xmlns:w="${W_NS}"><w:comment w:id="${'1'.repeat(65)}">` +
          `<w:p/></w:comment></w:comments>`,
          'COMMENT_DEFINITION_ID_TOO_LONG',
        ],
      ] as const;
      for (const [commentsXml, code] of definitionCases) {
        const result = await run(await commentIntegrityDocx({ commentsXml }));
        expect(result.commentIntegrityFailures).toEqual(expect.arrayContaining([
          expect.objectContaining({ code }),
        ]));
      }

      const negativeZero = await run(await commentIntegrityDocx({
        referenceId: '-0',
        commentsXml: `<w:comments xmlns:w="${W_NS}">` +
          `<w:comment w:id="+0"><w:p/></w:comment></w:comments>`,
      }));
      expect(negativeZero.status, negativeZero.reason).toBe('passed');
    },
  );

  test
    .openspec('[LEAN-COMMENT-06] Every admitted physical story contributes references')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' })(
    'collects main, header, footer, footnote, and endnote references in canonical order',
    async () => {
      const valid = await commentIntegrityAllStoriesDocx();
      const certificate = await run(valid);
      expect(certificate.status, certificate.reason).toBe('passed');
      expect(certificate.commentInventories?.[0]).toMatchObject({
        status: 'passed',
        referenceOccurrences: 5,
        uniqueReferenceIds: 5,
        definitions: 5,
      });

      const compared = await commentIntegrityAllStoriesDocx('5');
      const mutated = await run(valid, valid, compared);
      expect(mutated.status).toBe('failed');
      expect(mutated.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          side: 'compared',
          code: 'COMMENT_DEFINITION_MISSING',
          canonicalId: '5',
          source: { sourceStory: 'endnotes', sourceStoryOrdinal: 0 },
        }),
      ]));
    },
  );

  test
    .openspec('[LEAN-COMMENT-07] Comments metadata and XML limits fail before semantic reads')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.2' })(
    'classifies expanded-size, ratio, and depth crossings without later ID evidence',
    async () => {
      const base = await commentIntegrityDocx();
      const expanded = corruptCompressedPayload(
        mutateExpandedSize(base, 'word/comments.xml', 16 * 1024 * 1024 + 1),
        'word/comments.xml',
      );
      const expandedCertificate = await run(expanded);
      expect(expandedCertificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMMENT_PART_EXPANDED_LIMIT_EXCEEDED' }),
      ]));
      expect(expandedCertificate.commentIntegrityFailures?.some((issue) =>
        issue.code === 'COMMENT_PART_EXTRACTION_FAILED')).toBe(false);
      expectGlobalCommentStop(
        expandedCertificate,
        'COMMENT_PART_EXPANDED_LIMIT_EXCEEDED',
      );

      const ratio = corruptCompressedPayload(
        mutateExpandedSize(base, 'word/comments.xml', 1024 * 1024),
        'word/comments.xml',
      );
      const ratioCertificate = await run(ratio);
      expect(ratioCertificate.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMMENT_PART_RATIO_LIMIT_EXCEEDED' }),
      ]));
      expect(ratioCertificate.commentIntegrityFailures?.some((issue) =>
        issue.code === 'COMMENT_PART_EXTRACTION_FAILED')).toBe(false);
      expectGlobalCommentStop(ratioCertificate, 'COMMENT_PART_RATIO_LIMIT_EXCEEDED');

      const wrappers = Array.from({ length: 129 }, (_, index) => `<w:d${index}>`).join('');
      const closes = Array.from(
        { length: 129 },
        (_, index) => `</w:d${128 - index}>`,
      ).join('');
      const depth = await run(await commentIntegrityDocx({
        commentsXml: `<w:comments xmlns:w="${W_NS}">${wrappers}${closes}</w:comments>`,
      }));
      expect(depth.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED' }),
      ]));
      expect(depth.commentIntegrityFailures?.some((issue) =>
        issue.code.startsWith('COMMENT_DEFINITION_'))).toBe(false);
      expectGlobalCommentStop(depth, 'COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED');

      const extraction = await run(corruptCompressedPayload(
        base,
        'word/comments.xml',
      ));
      expect(extraction.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMMENT_PART_EXTRACTION_FAILED' }),
      ]));
      expectGlobalCommentStop(extraction, 'COMMENT_PART_EXTRACTION_FAILED');

      const invalidUtf8 = await run(await commentIntegrityDocx({
        commentsXml: Buffer.from([0xff, 0xfe, 0xfd]),
      }));
      expect(invalidUtf8.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMMENT_PART_INVALID_UTF8' }),
      ]));
      expectGlobalCommentStop(invalidUtf8, 'COMMENT_PART_INVALID_UTF8');

      const invalidXml = await run(await commentIntegrityDocx({
        commentsXml: `<w:comments xmlns:w="${W_NS}"><w:comment`,
      }));
      expect(invalidXml.commentIntegrityFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMMENT_PART_INVALID_XML' }),
      ]));
      expectGlobalCommentStop(invalidXml, 'COMMENT_PART_INVALID_XML');

      const incompleteSourceZip = await JSZip.loadAsync(
        await commentIntegrityAllStoriesDocx(),
      );
      incompleteSourceZip.remove('word/footnotes.xml');
      const incompleteSource = await run(await incompleteSourceZip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      }));
      expect(incompleteSource.commentIntegrityFailures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'COMMENT_SOURCE_PARTITION_INCOMPLETE',
          }),
        ]),
      );
      expectGlobalCommentStop(
        incompleteSource,
        'COMMENT_SOURCE_PARTITION_INCOMPLETE',
      );

      for (const stopped of [
        extraction,
        invalidUtf8,
        invalidXml,
        incompleteSource,
      ]) {
        expect(stopped.commentInventories).toEqual(expect.arrayContaining([
          expect.objectContaining({
            status: 'not_evaluated',
            referenceOccurrences: 0,
            definitions: 0,
          }),
        ]));
        expect(stopped.commentIntegrityFailures?.some((issue) =>
          issue.code.startsWith('COMMENT_REFERENCE_') ||
          issue.code.startsWith('COMMENT_DEFINITION_'))).toBe(false);
      }
    },
  );
});

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
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.7' });
      const docx = await buildSyntheticDocx({
        paragraphs: ['Body'], footnoteOnParagraph: 0, footnoteText: 'Foot',
        endnoteOnParagraph: 0, endnoteText: 'End',
      });
      const certificate = await run(docx, docx, docx);
      expect(certificate.status).toBe('passed');
      expect(certificate.stories?.map((story) => story.name)).toEqual(['main']);
      expect(certificate.noteStories?.map((story) => story.kind)).toEqual(['footnotes', 'endnotes']);
      expect(certificate.noteInventories?.every((inventory) =>
        inventory.referenceOccurrences > 0 && inventory.definitions.user > 0,
      )).toBe(true);
      expect(certificate.fixedStoryScope).toEqual([
        'word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml',
      ]);
    });

  test.openspec('[LEAN-NOTE-01] Relationship-selected semantic note stories pass')(
    'checks both note kinds at alternate safe relationship targets', async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.7' });
      const docx = await noteIntegrityDocx({
        footnotesPath: 'word/notes/legal-footnotes.xml',
        endnotesPath: 'word/notes/legal-endnotes.xml',
      });
      const certificate = await run(docx, docx, docx);
      expect(certificate.status, certificate.reason).toBe('passed');
      expect(certificate.fixedStoryScope).toBeUndefined();
      expect(certificate.noteInventories?.map((inventory) =>
        inventory.relationship?.normalizedPartPath,
      )).toEqual([
        'word/notes/legal-footnotes.xml', 'word/notes/legal-endnotes.xml',
        'word/notes/legal-footnotes.xml', 'word/notes/legal-endnotes.xml',
        'word/notes/legal-footnotes.xml', 'word/notes/legal-endnotes.xml',
      ]);
    });

  test.openspec('[LEAN-NOTE-02] Canonical note IDs have exactly one user definition')(
    'rejects canonical duplicate and missing definitions but permits unreferenced definitions', async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.10' });
      const duplicate = await noteIntegrityDocx({
        footnotesXml:
          `<w:footnotes xmlns:w="${W_NS}">` +
          `<w:footnote w:id="01"><w:p/></w:footnote>` +
          `<w:footnote w:id=" 1 "><w:p/></w:footnote>` +
          `<w:footnote w:id="99"><w:p/></w:footnote></w:footnotes>`,
      });
      const duplicateCertificate = await run(duplicate, duplicate, duplicate);
      expect(duplicateCertificate.status, duplicateCertificate.reason).toBe('failed');
      expect(duplicateCertificate.noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_USER_DEFINITION_DUPLICATE',
      )).toBe(true);

      const missing = await noteIntegrityDocx({
        footnotesXml: `<w:footnotes xmlns:w="${W_NS}"/>`,
      });
      expect((await run(missing, missing, missing)).noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_REFERENCE_MISSING_DEFINITION',
      )).toBe(true);

      const unreferenced = await noteIntegrityDocx({
        footnotesXml:
          `<w:footnotes xmlns:w="${W_NS}">` +
          `<w:footnote w:id="1"><w:p/></w:footnote>` +
          `<w:footnote w:id="99"><w:p/></w:footnote></w:footnotes>`,
      });
      expect((await run(unreferenced, unreferenced, unreferenced)).status).toBe('passed');
    });

  test.openspec('[LEAN-NOTE-03] Note definition stories cannot contain references')(
    'rejects recursive and cross-kind note references plus ambiguous internal-external selection',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.7' });
      const poisoned = await noteIntegrityDocx({
        footnotesXml:
          `<w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="1"><w:p>` +
          `<w:r><w:footnoteReference w:id="1"/></w:r>` +
          `<w:r><w:endnoteReference w:id="2"/></w:r>` +
          `</w:p></w:footnote></w:footnotes>`,
      });
      const poisonedCertificate = await run(poisoned, poisoned, poisoned);
      expect(poisonedCertificate.status).toBe('failed');
      expect(poisonedCertificate.noteIntegrityFailures?.filter((issue) =>
        issue.code === 'NOTE_REFERENCE_IN_DEFINITION_STORY',
      )).toHaveLength(6);
      expect(poisonedCertificate.noteInventories?.every((inventory) =>
        inventory.status === 'failed',
      )).toBe(true);

      const ambiguous = await noteIntegrityDocx({
        extraRelationships:
          `<Relationship Id="rIdExternalFootnotes" Type="${R_NS}/footnotes" ` +
          `Target="https://example.invalid/notes" TargetMode="External"/>`,
      });
      const ambiguousCertificate = await run(ambiguous, ambiguous, ambiguous);
      expect(ambiguousCertificate.status).toBe('failed');
      expect(ambiguousCertificate.noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_RELATIONSHIP_AMBIGUOUS',
      )).toBe(true);
      expect(ambiguousCertificate.noteInventories?.every((inventory) =>
        inventory.status === 'not_evaluated',
      )).toBe(true);
    });

  test.openspec('[LEAN-NOTE-04] Decimal aliases and overlong IDs have canonical evidence')(
    'coalesces lexical aliases and overlong identifiers without retaining forbidden raw values',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.10' });
      const aliases = await noteIntegrityDocx({
        bodyReferences: '<w:r><w:footnoteReference w:id="+01"/></w:r>',
        footnotesXml:
          `<w:footnotes xmlns:w="${W_NS}">` +
          `<w:footnote w:id="1"><w:p/></w:footnote>` +
          `<w:footnote w:id=" 001 "><w:p/></w:footnote>` +
          `<w:footnote w:id="+1"><w:p/></w:footnote>` +
          `<w:footnote w:id="-0"><w:p/></w:footnote>` +
          `</w:footnotes>`,
      });
      const aliasCertificate = await run(aliases, aliases, aliases);
      const duplicates = aliasCertificate.noteIntegrityFailures?.filter((issue) =>
        issue.code === 'NOTE_USER_DEFINITION_DUPLICATE',
      ) ?? [];
      expect(duplicates).toHaveLength(3);
      expect(duplicates.every((issue) =>
        issue.canonicalId === '1' && issue.occurrenceCount === 2,
      )).toBe(true);

      const overlong = '7'.repeat(65);
      const overlongDocx = await noteIntegrityDocx({
        bodyReferences: '',
        footnotesXml:
          `<w:footnotes xmlns:w="${W_NS}">` +
          `<w:footnote w:id="${overlong}"><w:p/></w:footnote>` +
          `<w:footnote w:id="${overlong}"><w:p/></w:footnote>` +
          `</w:footnotes>`,
      });
      const overlongCertificate = await run(overlongDocx, overlongDocx, overlongDocx);
      const lexical = overlongCertificate.noteIntegrityFailures?.filter((issue) =>
        issue.code === 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED',
      ) ?? [];
      expect(lexical).toHaveLength(3);
      expect(lexical.every((issue) =>
        issue.occurrenceCount === 2 &&
        issue.rawId === undefined &&
        issue.canonicalId === undefined &&
        issue.rawIdByteLength === 65 &&
        /^[0-9a-f]{8}$/.test(issue.rawIdDigest ?? ''),
      )).toBe(true);
    });

  test('makes a missing exact relationship with references side-wide incomplete', async () => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
    const missingRelationship = await noteIntegrityDocx({
      includeFootnotesRelationship: false,
    });
    const certificate = await run(missingRelationship, missingRelationship, missingRelationship);
    expect(certificate.noteIntegrityFailures?.some((issue) =>
      issue.code === 'NOTE_RELATIONSHIP_REQUIRED',
    )).toBe(true);
    expect(certificate.referenceSourcePartitions?.every((partition) =>
      partition.status === 'incomplete',
    )).toBe(true);
    expect(certificate.noteInventories?.every((inventory) =>
      inventory.status === 'not_evaluated' &&
      inventory.referenceOccurrences === 0 &&
      inventory.uniqueReferenceIds === 0,
    )).toBe(true);
    expect(certificate.fixedStoryScope).toBeUndefined();
  });

  test('classifies malformed definition-story reference IDs in poison ordinal space', async () => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.10' });
    const overlong = '9'.repeat(65);
    const poisoned = await noteIntegrityDocx({
      footnotesXml:
        `<w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="1"><w:p>` +
        `<w:r><w:footnoteReference/></w:r>` +
        `<w:r><w:endnoteReference w:id="bad"/></w:r>` +
        `<w:r><w:footnoteReference w:id="${overlong}"/></w:r>` +
        `</w:p></w:footnote></w:footnotes>`,
    });
    const certificate = await run(poisoned, poisoned, poisoned);
    const malformed = certificate.noteIntegrityFailures?.filter((issue) =>
      issue.code.startsWith('NOTE_ID_'),
    ) ?? [];
    expect(malformed.map((issue) => issue.code)).toEqual([
      'NOTE_ID_MISSING', 'NOTE_ID_INVALID_DECIMAL', 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED',
      'NOTE_ID_MISSING', 'NOTE_ID_INVALID_DECIMAL', 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED',
      'NOTE_ID_MISSING', 'NOTE_ID_INVALID_DECIMAL', 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED',
    ]);
    expect(malformed.every((issue) =>
      issue.ordinalSpace === 'poison' &&
      issue.source?.sourceStory === 'footnotes' &&
      issue.referencedKind !== undefined,
    )).toBe(true);
    expect(malformed.filter((issue) =>
      issue.code === 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED',
    ).every((issue) =>
      issue.rawId === undefined && issue.rawIdByteLength === 65 &&
      /^[0-9a-f]{8}$/.test(issue.rawIdDigest ?? ''),
    )).toBe(true);
  });

  test('preserves XML traversal order when definition and poison limits are both saturated',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
      const definitions = Array.from({ length: 4_096 }, (_, index) =>
        `<w:footnote w:id="${index + 1}"><w:p/></w:footnote>`).join('');
      const poison = Array.from({ length: 4_096 }, () =>
        '<w:r><w:footnoteReference w:id="1"/></w:r>').join('');
      const poisonFirst = await noteIntegrityDocx({
        footnotesXml:
          `<w:footnotes xmlns:w="${W_NS}">${definitions}` +
          `${poison}<w:r><w:endnoteReference w:id="2"/></w:r>` +
          `<w:footnote w:id="4097"/></w:footnotes>`,
      });
      expect((await run(poisonFirst, poisonFirst, poisonFirst))
        .noteIntegrityFailures?.[0]?.code).toBe('NOTE_POISON_REFERENCE_LIMIT_EXCEEDED');

      const definitionFirst = await noteIntegrityDocx({
        footnotesXml:
          `<w:footnotes xmlns:w="${W_NS}">${definitions}<w:footnote w:id="4097"/>` +
          `${poison}<w:r><w:endnoteReference w:id="2"/></w:r></w:footnotes>`,
      });
      expect((await run(definitionFirst, definitionFirst, definitionFirst))
        .noteIntegrityFailures?.[0]?.code).toBe('NOTE_DEFINITION_LIMIT_EXCEEDED');
    },
    60_000,
  );

  test('distinguishes an overlong relationship target from unsafe target syntax', async () => {
    const overlong = await noteIntegrityDocx({
      footnotesTarget: 'n'.repeat(257),
    });
    const certificate = await run(overlong, overlong, overlong);
    expect(certificate.noteIntegrityFailures?.some((issue) =>
      issue.code === 'NOTE_RELATIONSHIP_TARGET_LIMIT_EXCEEDED',
    )).toBe(true);
    expect(certificate.noteIntegrityFailures?.some((issue) =>
      issue.code === 'NOTE_RELATIONSHIP_UNSAFE_TARGET',
    )).toBe(false);
  });

  test('admits note-part bytes cumulatively across footnotes then endnotes', async () => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.2' });
    const individuallyAdmittedBytes = 16 * 1024 * 1024 - 64;
    const crossing = await noteIntegrityDocx({
      footnotesXml: sizedNoteXml('footnote', individuallyAdmittedBytes),
      endnotesXml: sizedNoteXml('endnote', individuallyAdmittedBytes),
    });
    const certificate = await run(crossing, crossing, crossing);
    expect(certificate.noteIntegrityFailures?.some((issue) =>
      issue.code === 'NOTE_PART_LIMIT_EXCEEDED' &&
      issue.side === 'original' &&
      issue.kind === 'endnotes' &&
      issue.source?.sourceStory === 'endnotes',
    )).toBe(true);
    expect(certificate.referenceSourcePartitions?.every((partition) =>
      partition.status === 'incomplete',
    )).toBe(true);
    expect(certificate.noteInventories?.every((inventory) =>
      inventory.status === 'not_evaluated' &&
      inventory.referenceOccurrences === 0,
    )).toBe(true);
  }, 60_000);

  test.openspec('[LEAN-NOTE-05] Semantic limit precedence is deterministic')(
    'lets the 8193rd reference win before a simultaneous 4097th unique ID and skips later sides',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
      const references = Array.from({ length: 8_193 }, (_, index) => {
        const id = index < 8_192 ? (index % 4_096) + 1 : 4_097;
        return `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
      }).join('');
      const crossing = await noteIntegrityDocx({ bodyReferences: references });
      const certificate = await run(crossing, crossing, crossing);
      expect(certificate.status).toBe('failed');
      expect(certificate.noteIntegrityFailures?.map((issue) => issue.code)).toEqual([
        'NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED',
      ]);
      expect(certificate.noteIntegrityFailures?.[0]).toMatchObject({
        side: 'original',
        kind: 'footnotes',
        ordinalSpace: 'reference',
        firstOccurrenceOrdinal: 8_192,
        occurrenceCount: 1,
        source: { sourceStory: 'main', sourceStoryOrdinal: 0 },
      });
      expect(certificate.noteInventories?.every((inventory) =>
        inventory.status === 'not_evaluated' &&
        inventory.referenceOccurrences === 0 &&
        inventory.uniqueReferenceIds === 0,
      )).toBe(true);
      expect(certificate.noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_UNIQUE_REFERENCE_LIMIT_EXCEEDED',
      )).toBe(false);
    },
    60_000,
  );

  test.openspec('[LEAN-NOTE-06] Aggregate issue exhaustion has one terminal shape')(
    'collapses the compiled response when the 512th ordinary issue is reached',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.18.10' });
      const references = Array.from(
        { length: 512 },
        (_, index) => `<w:r><w:footnoteReference w:id="invalid-${index}"/></w:r>`,
      ).join('');
      const exhausted = await noteIntegrityDocx({ bodyReferences: references });
      const certificate = await run(exhausted, exhausted, exhausted);

      expect(certificate.status, certificate.reason).toBe('failed');
      expect(certificate.relationshipSlots).toEqual([]);
      expect(certificate.relationshipStories).toEqual([]);
      expect(certificate.referenceSourcePartitions).toHaveLength(3);
      expect(certificate.referenceSourcePartitions?.every((partition) =>
        partition.status === 'incomplete' &&
        partition.sources.length === 1 &&
        partition.definitionStories.every((story) =>
          story.partPresent === false && story.relationship === undefined),
      )).toBe(true);
      expect(certificate.noteStories?.every((story) =>
        story.status === 'not_evaluated' &&
        story.original.partPresent === false &&
        story.revised.partPresent === false &&
        story.compared.partPresent === false,
      )).toBe(true);
      expect(certificate.noteInventories?.every((inventory) =>
        inventory.status === 'not_evaluated' &&
        inventory.relationship === undefined &&
        inventory.referenceOccurrences === 0 &&
        inventory.uniqueReferenceIds === 0,
      )).toBe(true);
      expect(certificate.noteIntegrityFailures).toEqual([]);
      expect(certificate.commentIntegrityFailures).toEqual([{
        code: 'COMMENT_ISSUE_LIMIT_EXCEEDED',
        side: 'original',
        kind: 'comments',
        detail: 'protocol v6 aggregate ordinary issue limit exceeded',
        ordinalSpace: 'aggregate',
        firstOccurrenceOrdinal: 0,
        occurrenceCount: 1,
      }]);
    },
    60_000,
  );

  test.openspec('[LEAN-STORY-02] Side-story state is isolated')(
    'rejects malformed fields even when markers balance across side stories', async () => {
      const base = await buildSyntheticDocx({
        paragraphs: ['Body'], footnoteOnParagraph: 0, endnoteOnParagraph: 0,
      });
      const withFootnote = await replacePart(base, 'word/footnotes.xml', footnotes('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'));
      const malformed = await replacePart(withFootnote, 'word/endnotes.xml', endnotes('<w:r><w:fldChar w:fldCharType="end"/></w:r>'));
      const certificate = await run(malformed, malformed, malformed);
      expect(certificate.status).toBe('failed');
      expect(certificate.noteStories?.filter((story) => story.status === 'failed')
        .map((story) => story.kind)).toEqual(['footnotes', 'endnotes']);
    });

  test.openspec('[LEAN-STORY-03] Optional presence is modeled as an empty story')(
    'treats a selected missing note part as failed presence without partial evidence', async () => {
      const withNote = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
      const withoutNote = await replacePart(withNote, 'word/footnotes.xml', null);
      const untrackedAddition = await run(withoutNote, withNote, withNote);
      expect(untrackedAddition.status).toBe('failed');
      expect(untrackedAddition.presenceMismatches).toEqual([]);
      expect(untrackedAddition.referenceSourcePartitions?.[0]?.status).toBe('incomplete');
      expect(untrackedAddition.noteIntegrityFailures?.some((issue) =>
        issue.code === 'NOTE_PART_MISSING',
      )).toBe(true);
      expect(untrackedAddition.noteInventories?.slice(0, 2).every((inventory) =>
        inventory.status === 'not_evaluated' &&
        inventory.referenceOccurrences === 0 &&
        inventory.definitions.user === 0,
      )).toBe(true);
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

      expect((await run(withoutNote, revisedAdded, added)).status).toBe('failed');
      expect((await run(originalRemoved, withoutNote, removed)).status).toBe('failed');
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
    const typedAnyId = (reserved: string, normalZero: string) =>
      `<w:footnotes xmlns:w="${W_NS}">` +
      `<w:footnote w:type="separator" w:id="77"><w:p><w:r><w:t>${reserved}</w:t></w:r></w:p></w:footnote>` +
      `<w:footnote w:id="0"><w:p><w:r><w:t>${normalZero}</w:t></w:r></w:p></w:footnote>` +
      `</w:footnotes>`;
    const make = (reserved: string, normalZero: string) => noteIntegrityDocx({
      bodyReferences: '<w:r><w:footnoteReference w:id="0"/></w:r>',
      footnotesXml: typedAnyId(reserved, normalZero),
    });
    const original = await make('old reserved', 'visible old');
    const revisedReservedOnly = await make('new reserved', 'visible old');
    const revisedNormalZero = await make('new reserved', 'visible new');

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
      expect(certificate.noteStories?.find((story) => story.kind === 'footnotes')?.status).toBe('failed');
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

describeWithLean('Lean direct relationship-story protocol v5', () => {
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
      expect(certificate.checkerProtocolVersion).toBe(6);
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

  test.openspec('[LEAN-REL-05] Shared targets are checked once with all selectors')(
    'preserves first-seen physical order for an interleaved A, B, A target partition',
    async () => {
      const docx = await relationshipDocx({
        includeAllRoles: true,
        headerTargets: ['headerA.xml', 'headerB.xml', 'headerA.xml'],
      });
      const certificate = await run(docx);

      expect(certificate.status, certificate.reason).toBe('passed');
      expect(certificate.relationshipStories?.map((story) => ({
        path: story.originalPartPath,
        selectors: story.selectingSlotOrdinals,
      }))).toEqual([
        { path: 'word/headerA.xml', selectors: [0, 2] },
        { path: 'word/headerB.xml', selectors: [1] },
        { path: 'word/footer1.xml', selectors: [3, 4, 5] },
      ]);
      expect(certificate.referenceSourcePartitions?.every((partition) =>
        partition.sources.slice(1).map((source) => source.normalizedPartPath)
          .join('|') ===
            'word/headerA.xml|word/headerB.xml|word/footer1.xml',
      )).toBe(true);
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
    expect(certificate.noteInventories?.every((inventory) =>
      inventory.status === 'not_evaluated',
    )).toBe(true);
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
    expect(certificate.noteIntegrityFailures?.map((issue) => issue.code)).toContain(
      'NOTE_PART_LIMIT_EXCEEDED',
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
      expect(certificate.noteIntegrityFailures?.map((issue) => issue.code)).toContain(
        'NOTE_SOURCE_PARTITION_INCOMPLETE',
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

const validDefinitionStory = (kind: 'footnotes' | 'endnotes') => ({
  kind,
  partPresent: false,
});
const validProtocolReport = {
  protocolVersion: 6,
  checker: 'safe-docx-lean-conventional-main-comment-integrity-checker',
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
  referenceSourcePartitions: ['original', 'revised', 'compared'].map((side) => ({
    side,
    status: 'complete',
    sources: [{
      sourceOrdinal: 0,
      sourceStory: 'main',
      normalizedPartPath: 'word/document.xml',
    }],
    definitionStories: [
      validDefinitionStory('footnotes'),
      validDefinitionStory('endnotes'),
    ],
  })),
  noteStories: (['footnotes', 'endnotes'] as const).map((kind) => ({
    kind,
    status: 'passed',
    original: validDefinitionStory(kind),
    revised: validDefinitionStory(kind),
    compared: validDefinitionStory(kind),
    parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
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
  })),
  noteInventories: ['original', 'revised', 'compared'].flatMap((side) =>
    (['footnotes', 'endnotes'] as const).map((kind) => ({
      side,
      kind,
      status: 'passed',
      referenceOccurrences: 0,
      uniqueReferenceIds: 0,
      definitions: {
        user: 0,
        separator: 0,
        continuationSeparator: 0,
        continuationNotice: 0,
      },
      forbiddenDefinitionStoryReferences: 0,
    })),
  ),
  noteIntegrityIssues: [],
  commentStory: {
    status: 'passed',
    original: { status: 'absent', relationship: null, partPresent: false },
    revised: { status: 'absent', relationship: null, partPresent: false },
    compared: { status: 'absent', relationship: null, partPresent: false },
    parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
  },
  commentInventories: ['original', 'revised', 'compared'].map((side) => ({
    side,
    status: 'passed',
    relationship: null,
    referenceOccurrences: 0,
    uniqueReferenceIds: 0,
    definitions: 0,
    unreferencedDefinitions: 0,
    nonDirectDefinitions: 0,
  })),
  commentIntegrityIssues: [],
};

test('rejects duplicate and non-canonical raw JSON object keys before parsing', () => {
  expect(() => validateCanonicalProtocolJson(
    '{"a":{"a":"\\b\\f\\n\\r\\t\\u0000","b":2},"b":[]}',
  )).not.toThrow();
  expect(() => validateCanonicalProtocolJson('{"a":1,"a":2}'))
    .toThrow(/duplicate object key/);
  expect(() => validateCanonicalProtocolJson('{"b":1,"a":2}'))
    .toThrow(/canonical order/);
  expect(() => validateCanonicalProtocolJson('{"a":{"b":1,"a":2}}'))
    .toThrow(/canonical order/);
});

test('strictly decodes protocol-v6 comment identities, counts, issues, and status equations', () => {
  const relationship = {
    relationshipId: 'rIdComments',
    relationshipRecordOrdinal: 0,
    normalizedPartPath: 'word/comments.xml',
  };
  const selected = {
    ...validProtocolReport,
    commentStory: {
      ...validProtocolReport.commentStory,
      original: { status: 'passed', relationship, partPresent: true },
      parsedTokenCounts: { original: 1, revised: 0, combined: 0 },
    },
    commentInventories: validProtocolReport.commentInventories.map((inventory, index) =>
      index === 0 ? {
        ...inventory,
        relationship,
        referenceOccurrences: 1,
        uniqueReferenceIds: 1,
        definitions: 2,
        unreferencedDefinitions: 1,
      } : inventory),
  };
  expect(isLeanVerifierJson(selected)).toBe(true);
  expect(isLeanVerifierJson({
    ...selected,
    commentStory: {
      ...selected.commentStory,
      original: {
        ...selected.commentStory.original,
        relationship: { ...relationship, relationshipRecordOrdinal: -1 },
      },
    },
  })).toBe(false);
  expect(isLeanVerifierJson({
    ...selected,
    commentInventories: selected.commentInventories.map((inventory, index) =>
      index === 0 ? { ...inventory, uniqueReferenceIds: 2 } : inventory),
  })).toBe(false);
  expect(isLeanVerifierJson({
    ...selected,
    commentStory: {
      ...selected.commentStory,
      original: { status: 'absent', relationship, partPresent: false },
    },
  })).toBe(false);

  const issue = {
    code: 'COMMENT_DEFINITION_MISSING',
    side: 'original',
    kind: 'comments',
    detail: 'comment reference does not resolve to exactly one direct definition',
    ordinalSpace: 'reference',
    firstOccurrenceOrdinal: 0,
    occurrenceCount: 1,
    source: { sourceStory: 'main', sourceStoryOrdinal: 0 },
    canonicalId: '7',
  };
  const failed = {
    ...selected,
    passed: false,
    commentStory: {
      ...selected.commentStory,
      status: 'failed',
      original: { status: 'failed', relationship, partPresent: true },
    },
    commentInventories: selected.commentInventories.map((inventory, index) =>
      index === 0 ? { ...inventory, status: 'failed' } : inventory),
    commentIntegrityIssues: [issue],
  };
  expect(isLeanVerifierJson(failed)).toBe(true);
  expect(isLeanVerifierJson({
    ...failed,
    commentIntegrityIssues: [{ ...issue, canonicalId: undefined }],
  })).toBe(false);
  expect(isLeanVerifierJson({
    ...failed,
    commentIntegrityIssues: [{ ...issue, rawId: '7' }],
  })).toBe(false);
  expect(isLeanVerifierJson({
    ...failed,
    commentIntegrityIssues: [{
      ...issue,
      source: { sourceStory: 'comments', sourceStoryOrdinal: 0 },
    }],
  })).toBe(false);
});

test('enforces the canonical equation table for all 40 comment issue codes', () => {
  type IssueSpec = {
    code: string;
    space: 'relationship' | 'source' | 'reference' | 'definition' | 'aggregate';
    ordinal: number;
    source?: { sourceStory: string; sourceStoryOrdinal: number };
    status: 'failed' | 'not_evaluated';
    selected?: boolean;
    extras?: Record<string, unknown>;
    coalesced?: 'definitions' | 'references';
    counts?: Partial<{
      referenceOccurrences: number;
      uniqueReferenceIds: number;
      definitions: number;
      unreferencedDefinitions: number;
      nonDirectDefinitions: number;
    }>;
  };
  const main = { sourceStory: 'main', sourceStoryOrdinal: 0 };
  const comments = { sourceStory: 'comments', sourceStoryOrdinal: 0 };
  const selectedExtras = {
    relationshipId: 'rIdComments',
    normalizedPartPath: 'word/comments.xml',
  };
  const specs: IssueSpec[] = [
    { code: 'COMMENT_RELATIONSHIP_AMBIGUOUS', space: 'relationship', ordinal: 1, source: main, status: 'not_evaluated' },
    { code: 'COMMENT_RELATIONSHIP_EXTERNAL', space: 'relationship', ordinal: 0, source: main, status: 'not_evaluated', extras: { relationshipId: 'rIdComments', rawTarget: 'comments.xml' } },
    { code: 'COMMENT_RELATIONSHIP_INVALID_TARGET_MODE', space: 'relationship', ordinal: 0, source: main, status: 'not_evaluated', extras: { relationshipId: 'rIdComments', rawTarget: 'comments.xml', targetMode: 'Unsupported' } },
    { code: 'COMMENT_RELATIONSHIP_TARGET_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: main, status: 'not_evaluated', extras: { relationshipId: 'rIdComments', rawTargetByteLength: 257 } },
    { code: 'COMMENT_RELATIONSHIP_UNSAFE_TARGET', space: 'relationship', ordinal: 0, source: main, status: 'not_evaluated', extras: { relationshipId: 'rIdComments', rawTarget: '../comments.xml' } },
    { code: 'COMMENT_SOURCE_PARTITION_INCOMPLETE', space: 'source', ordinal: 0, source: main, status: 'not_evaluated' },
    { code: 'COMMENT_RELATIONSHIP_REQUIRED', space: 'reference', ordinal: 0, source: main, status: 'not_evaluated' },
    { code: 'COMMENT_PART_MISSING', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_SELECTED_PART_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_TRIPLE_SELECTED_PART_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_COMPRESSED_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_EXPANDED_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_RATIO_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_CUMULATIVE_COMPRESSED_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_CUMULATIVE_EXPANDED_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_TRIPLE_COMPRESSED_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_TRIPLE_EXPANDED_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_EXTRACTION_FAILED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_INVALID_UTF8', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_INVALID_XML', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_XML_EVENT_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_CUMULATIVE_XML_EVENT_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_TRIPLE_XML_EVENT_LIMIT_EXCEEDED', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_PART_ROOT_MISMATCH', space: 'relationship', ordinal: 0, source: comments, status: 'not_evaluated', selected: true, extras: selectedExtras },
    { code: 'COMMENT_REFERENCE_ID_MISSING', space: 'reference', ordinal: 0, source: main, status: 'failed', selected: true, counts: { referenceOccurrences: 1 } },
    { code: 'COMMENT_REFERENCE_ID_MALFORMED', space: 'reference', ordinal: 0, source: main, status: 'failed', selected: true, extras: { rawId: 'bad' }, counts: { referenceOccurrences: 1 } },
    { code: 'COMMENT_REFERENCE_ID_TOO_LONG', space: 'reference', ordinal: 0, source: main, status: 'failed', selected: true, extras: { rawIdByteLength: 65 }, counts: { referenceOccurrences: 1 } },
    { code: 'COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED', space: 'reference', ordinal: 4096, source: main, status: 'not_evaluated', selected: true },
    { code: 'COMMENT_UNIQUE_REFERENCE_ID_LIMIT_EXCEEDED', space: 'reference', ordinal: 4095, source: main, status: 'not_evaluated', selected: true, extras: { canonicalId: '4096' } },
    { code: 'COMMENT_DEFINITION_ID_MISSING', space: 'definition', ordinal: 0, source: comments, status: 'failed', selected: true },
    { code: 'COMMENT_DEFINITION_ID_MALFORMED', space: 'definition', ordinal: 0, source: comments, status: 'failed', selected: true, extras: { rawId: 'bad' } },
    { code: 'COMMENT_DEFINITION_ID_TOO_LONG', space: 'definition', ordinal: 0, source: comments, status: 'failed', selected: true, extras: { rawIdByteLength: 65 } },
    { code: 'COMMENT_DEFINITION_LIMIT_EXCEEDED', space: 'definition', ordinal: 4096, source: comments, status: 'not_evaluated', selected: true },
    { code: 'COMMENT_DEFINITION_NOT_DIRECT', space: 'definition', ordinal: 0, source: comments, status: 'failed', selected: true, extras: { canonicalId: '7' }, counts: { nonDirectDefinitions: 1 } },
    { code: 'COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED', space: 'definition', ordinal: 4096, source: comments, status: 'not_evaluated', selected: true },
    { code: 'COMMENT_DEFINITION_DUPLICATE', space: 'definition', ordinal: 1, source: comments, status: 'failed', selected: true, extras: { canonicalId: '7' }, coalesced: 'definitions', counts: { definitions: 2 } },
    { code: 'COMMENT_DEFINITION_MISSING', space: 'reference', ordinal: 0, source: main, status: 'failed', selected: true, extras: { canonicalId: '7' }, coalesced: 'references', counts: { referenceOccurrences: 1, uniqueReferenceIds: 1 } },
    { code: 'COMMENT_ISSUE_LIMIT_EXCEEDED', space: 'aggregate', ordinal: 0, status: 'not_evaluated' },
    { code: 'COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED', space: 'aggregate', ordinal: 0, status: 'not_evaluated' },
  ];
  expect(specs).toHaveLength(40);
  expect(new Set(specs.map(({ code }) => code)).size).toBe(40);

  const relationship = {
    relationshipId: 'rIdComments',
    relationshipRecordOrdinal: 0,
    normalizedPartPath: 'word/comments.xml',
  };
  const issueFor = (spec: IssueSpec, occurrenceCount = 1): Record<string, unknown> => ({
    code: spec.code,
    side: 'original',
    kind: 'comments',
    detail: 'bounded mutation fixture',
    ordinalSpace: spec.space,
    firstOccurrenceOrdinal: spec.ordinal,
    occurrenceCount,
    ...(spec.source ? { source: spec.source } : {}),
    ...spec.extras,
  });
  const reportFor = (spec: IssueSpec, issue: Record<string, unknown>) => {
    if (spec.space === 'aggregate') {
      return {
        ...validProtocolReport,
        passed: false,
        relationshipSlots: [],
        relationshipStories: [],
        selectionIssues: [],
        referenceSourcePartitions: validProtocolReport.referenceSourcePartitions.map(
          (partition) => ({
            ...partition,
            status: 'incomplete',
            sources: partition.sources.slice(0, 1),
          }),
        ),
        noteStories: validProtocolReport.noteStories.map(
          ({ report: _report, ...story }) => ({
            ...story,
            status: 'not_evaluated',
            parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
          }),
        ),
        noteInventories: validProtocolReport.noteInventories.map((inventory) => ({
          ...inventory,
          status: 'not_evaluated',
        })),
        noteIntegrityIssues: [],
        commentStory: {
          status: 'not_evaluated',
          original: { status: 'not_evaluated', relationship: null, partPresent: false },
          revised: { status: 'not_evaluated', relationship: null, partPresent: false },
          compared: { status: 'not_evaluated', relationship: null, partPresent: false },
          parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
        },
        commentInventories: validProtocolReport.commentInventories.map((inventory) => ({
          ...inventory,
          status: 'not_evaluated',
        })),
        commentIntegrityIssues: [issue],
      };
    }
    const occurrenceCount = issue.occurrenceCount as number;
    const counts = {
      referenceOccurrences: 0,
      uniqueReferenceIds: 0,
      definitions: 0,
      unreferencedDefinitions: 0,
      nonDirectDefinitions: 0,
      ...spec.counts,
      ...(spec.coalesced === 'definitions'
        ? { definitions: occurrenceCount + 1 } : {}),
      ...(spec.coalesced === 'references'
        ? { referenceOccurrences: occurrenceCount, uniqueReferenceIds: 1 } : {}),
    };
    const inventory = {
      side: 'original',
      status: spec.status,
      relationship: spec.selected ? relationship : null,
      ...counts,
    };
    if (spec.status === 'failed') {
      return {
        ...validProtocolReport,
        passed: false,
        commentStory: {
          ...validProtocolReport.commentStory,
          status: 'failed',
          original: {
            status: 'failed',
            relationship,
            partPresent: true,
          },
        },
        commentInventories: [
          inventory,
          ...validProtocolReport.commentInventories.slice(1),
        ],
        commentIntegrityIssues: [issue],
      };
    }
    return {
      ...validProtocolReport,
      passed: false,
      commentStory: {
        status: 'not_evaluated',
        original: {
          status: 'not_evaluated',
          relationship: spec.selected ? relationship : null,
          partPresent: false,
        },
        revised: { status: 'not_evaluated', relationship: null, partPresent: false },
        compared: { status: 'not_evaluated', relationship: null, partPresent: false },
        parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
      },
      commentInventories: ['original', 'revised', 'compared'].map((side, index) => ({
        side,
        status: 'not_evaluated',
        relationship: index === 0 && spec.selected
          ? relationship : null,
        referenceOccurrences: 0,
        uniqueReferenceIds: 0,
        definitions: 0,
        unreferencedDefinitions: 0,
        nonDirectDefinitions: 0,
      })),
      commentIntegrityIssues: [issue],
    };
  };

  const invalidExtras: Record<string, unknown[]> = {
    canonicalId: [7, '+7', '7'.repeat(65)],
    rawId: [7, 'x'.repeat(65)],
    rawIdByteLength: ['65', 64],
    relationshipId: [7, '', 'r'.repeat(129)],
    rawTarget: [7, 'x'.repeat(257)],
    rawTargetByteLength: ['257', 256],
    targetMode: [7, 'x'.repeat(17)],
    normalizedPartPath: [7, '/unsafe', `word/${'é'.repeat(124)}.xml`],
  };
  const normalizedPartPath256 = `word/${'é'.repeat(123)}a.xml`;
  const normalizedPartPath257 = `word/${'é'.repeat(124)}.xml`;
  expect(Buffer.byteLength(normalizedPartPath256, 'utf8')).toBe(256);
  expect(Buffer.byteLength(normalizedPartPath257, 'utf8')).toBe(257);

  for (const spec of specs) {
    const issue = issueFor(spec);
    expect(isCommentIssue(issue), `${spec.code}: valid row`).toBe(true);
    expect(isCommentIssue({ ...issue, occurrenceCount: 0 }),
      `${spec.code}: zero count`).toBe(false);
    if (!spec.coalesced) {
      expect(isCommentIssue({ ...issue, occurrenceCount: 2 }),
        `${spec.code}: non-coalescing count 2`).toBe(false);
    } else {
      const coalesced = issueFor(spec, 2);
      expect(isCommentIssue(coalesced),
        `${spec.code}: coalesced count 2`).toBe(true);
      expect(isLeanVerifierJson(reportFor(spec, coalesced)),
        `${spec.code}: coalesced count equations`).toBe(true);
    }
    expect(isCommentIssue({
      ...issue,
      ordinalSpace: issue.ordinalSpace === 'aggregate' ? 'relationship' : 'aggregate',
    }), `${spec.code}: wrong space`).toBe(false);
    const wrongSourceIssue = {
      ...issue,
      source: spec.source
        ? {
          sourceStory: spec.source.sourceStory === 'comments' ? 'main' : 'comments',
          sourceStoryOrdinal: spec.source.sourceStoryOrdinal,
        }
        : comments,
    };
    expect(isLeanVerifierJson(reportFor(spec, wrongSourceIssue)),
      `${spec.code}: wrong source`).toBe(false);
    expect(isCommentIssue({ ...issue, unexpected: true }),
      `${spec.code}: extra field`).toBe(false);
    const boundary = spec.space === 'relationship' ? 1024
      : spec.space === 'source' ? 387
        : spec.space === 'aggregate' ? 1 : 4096;
    if (spec.ordinal !== boundary) {
      expect(isCommentIssue({ ...issue, firstOccurrenceOrdinal: boundary }),
        `${spec.code}: boundary or terminal ordinal`).toBe(false);
    }
    if (spec.ordinal === 4096) {
      expect(isCommentIssue({ ...issue, firstOccurrenceOrdinal: 4095 }),
        `${spec.code}: sentinel minus one`).toBe(false);
      expect(isCommentIssue({ ...issue, firstOccurrenceOrdinal: 4097 }),
        `${spec.code}: sentinel plus one`).toBe(false);
    }
    for (const [key, value] of Object.entries(spec.extras ?? {})) {
      const missing = { ...issue };
      delete missing[key];
      expect(isCommentIssue(missing), `${spec.code}: missing ${key}`).toBe(false);
      for (const invalid of invalidExtras[key] ?? []) {
        expect(isCommentIssue({ ...issue, [key]: invalid }),
          `${spec.code}: invalid ${key}=${String(invalid)}`).toBe(false);
      }
      expect(value).not.toBeUndefined();
      if (key === 'normalizedPartPath') {
        const boundaryIssue = { ...issue, normalizedPartPath: normalizedPartPath256 };
        expect(isCommentIssue(boundaryIssue),
          `${spec.code}: normalized path exact 256-byte boundary`).toBe(true);
        expect(isLeanVerifierJson(reportFor(spec, boundaryIssue)),
          `${spec.code}: decoder accepts normalized path exact 256-byte boundary`).toBe(true);
        const overBoundaryIssue = { ...issue, normalizedPartPath: normalizedPartPath257 };
        expect(isCommentIssue(overBoundaryIssue),
          `${spec.code}: normalized path 257-byte boundary`).toBe(false);
        expect(isLeanVerifierJson(reportFor(spec, overBoundaryIssue)),
          `${spec.code}: decoder rejects normalized path 257-byte boundary`).toBe(false);
      }
    }
    const report = reportFor(spec, issue);
    expect(isLeanVerifierJson(report), `${spec.code}: valid report`).toBe(true);
    const wrongStatus = structuredClone(report);
    if (spec.space === 'aggregate') {
      wrongStatus.commentStory.status = 'failed';
    } else {
      wrongStatus.commentStory.original.status =
        spec.status === 'failed' ? 'not_evaluated' : 'failed';
      wrongStatus.commentInventories[0]!.status =
        spec.status === 'failed' ? 'not_evaluated' : 'failed';
    }
    expect(isLeanVerifierJson(wrongStatus), `${spec.code}: wrong status`).toBe(false);
  }
});

async function fakeChecker(output: unknown): Promise<{ dir: string; executable: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'safe-docx-fake-checker-'));
  const executable = join(dir, 'checker');
  await writeFile(
    executable,
    `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${canonicalJsonForTest(output)}'\n`,
  );
  await chmod(executable, 0o700);
  return { dir, executable };
}

async function lifecycleChecker(
  mode: 'success' | 'nonzero',
  sentinel: string,
): Promise<{ dir: string; executable: string; rootPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'safe-docx-lifecycle-checker-'));
  const executable = join(dir, 'checker');
  const rootPath = join(dir, 'verifier-root.txt');
  const successOutput = `${canonicalJsonForTest(validProtocolReport)}\n`;
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const root = process.env.SAFE_DOCX_LEAN_TEMP_ROOT;
fs.writeFileSync(${JSON.stringify(rootPath)}, root);
fs.writeFileSync(root + '/confidential.txt', ${JSON.stringify(sentinel)});
process.stdin.resume();
process.stdin.on('end', () => {
  if (${JSON.stringify(mode)} === 'success') {
    process.stdout.write(${JSON.stringify(successOutput)});
  } else {
    process.stderr.write('ordinary lifecycle failure');
    process.exitCode = 17;
  }
});
`);
  await chmod(executable, 0o700);
  return { dir, executable, rootPath };
}

describe('Lean fixed-story protocol and security hardening', () => {
  const inputWith = (
    originalDocx: Buffer,
    revisedDocx: Buffer,
    comparedDocx: Buffer,
    executablePath: string,
    timeoutMs = 10_000,
  ) => ({
    originalDocx,
    revisedDocx,
    comparedDocx,
    legacyDocumentXml: { original: '<w:document/>', revised: '<w:document/>', compared: '<w:document/>' },
    reconstructionMode: 'inplace' as const,
    options: { executablePath, timeoutMs },
  });
  const runWith = (
    originalDocx: Buffer,
    revisedDocx: Buffer,
    comparedDocx: Buffer,
    executablePath: string,
    timeoutMs = 10_000,
  ) => runLeanXmlTripleVerifier(
    inputWith(originalDocx, revisedDocx, comparedDocx, executablePath, timeoutMs),
  );

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
      expect(result.checkerProtocolVersion).toBe(6);
      expect(result.fixedStoryScope).toBeUndefined();
      expect(result.noteStoryScope?.alignment).toBe('semantic-note-kind');
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

  describeWithNearEnvelope('compiled near-envelope response constructors', () => {
    test.openspec('[LEAN-REL-22] Every legal response fits the output cap')(
      'strict-decodes a realizable near-envelope ordinary protocol-v6 response', async () => {
      const raw = await runNearEnvelopeProducer();
      const parsed = JSON.parse(raw);
      expect(isLeanVerifierJson(parsed)).toBe(true);
      expect(Buffer.byteLength(raw.trimEnd(), 'utf8')).toBeLessThanOrEqual(2_624_704);
      expect(parsed.relationshipSlots).toHaveLength(384);
      expect(parsed.relationshipStories).toHaveLength(384);
      expect(parsed.referenceSourcePartitions.every(
        (partition: { sources: unknown[] }) => partition.sources.length === 385,
      )).toBe(true);
      expect(
        parsed.selectionIssues.length +
        parsed.noteIntegrityIssues.length +
        parsed.commentIntegrityIssues.length,
      ).toBe(511);
      expect(parsed.commentIntegrityIssues.length).toBeGreaterThan(0);
      expect(evidenceStringBytesForTest(parsed)).toBe(1_571_840);
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
      referenceSourcePartitions: validProtocolReport.referenceSourcePartitions.map((partition) => ({
        ...partition,
        sources: [
          partition.sources[0],
          {
            sourceOrdinal: 1,
            sourceStory: 'header',
            physicalStoryOrdinal: 0,
            normalizedPartPath: 'word/header1.xml',
          },
        ],
      })),
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

  test('rejects a complete evaluated note story whose selected relationship part is absent', () => {
    const relationship = {
      relationshipId: 'rIdFootnotes',
      normalizedPartPath: 'word/footnotes.xml',
    };
    const forgedStory = {
      kind: 'footnotes',
      relationship,
      partPresent: false,
    };
    const forged = {
      ...validProtocolReport,
      referenceSourcePartitions: validProtocolReport.referenceSourcePartitions.map(
        (partition) => ({
          ...partition,
          definitionStories: [forgedStory, partition.definitionStories[1]],
        }),
      ),
      noteStories: validProtocolReport.noteStories.map((story) =>
        story.kind === 'footnotes'
          ? { ...story, original: forgedStory, revised: forgedStory, compared: forgedStory }
          : story),
      noteInventories: validProtocolReport.noteInventories.map((inventory) =>
        inventory.kind === 'footnotes' ? { ...inventory, relationship } : inventory),
    };
    expect(isLeanVerifierJson(forged)).toBe(false);
  });

  test('requires canonical discriminated source identity on ordinary note issues', () => {
    const issue = {
      code: 'NOTE_ID_INVALID_DECIMAL',
      side: 'original',
      kind: 'footnotes',
      detail: 'note reference w:id is not an ST_DecimalNumber',
      ordinalSpace: 'reference',
      firstOccurrenceOrdinal: 0,
      occurrenceCount: 1,
      source: { sourceStory: 'main', sourceStoryOrdinal: 0 },
      rawId: 'not-a-number',
    };
    const failed = {
      ...validProtocolReport,
      passed: false,
      noteInventories: validProtocolReport.noteInventories.map((inventory, index) =>
        index === 0 ? { ...inventory, status: 'failed' } : inventory),
      noteIntegrityIssues: [issue],
    };
    expect(isLeanVerifierJson(failed)).toBe(true);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [{ ...issue, source: undefined }],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [{
        ...issue,
        source: { sourceStory: 'main', sourceStoryOrdinal: 1 },
      }],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [{
        ...issue,
        source: { sourceStory: 'header', sourceStoryOrdinal: 384 },
      }],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [{
        ...issue,
        code: 'NOTE_ID_MISSING',
      }],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [{
        ...issue,
        rawId: undefined,
      }],
    })).toBe(false);
  });

  test('rejects locator fields forbidden for a relationship issue code', () => {
    const baseIssue = {
      code: 'NOTE_RELATIONSHIP_AMBIGUOUS',
      side: 'original',
      kind: 'footnotes',
      detail: 'multiple exact Transitional note relationships select the semantic note story',
      ordinalSpace: 'relationship',
      firstOccurrenceOrdinal: 0,
      occurrenceCount: 1,
      source: { sourceStory: 'main', sourceStoryOrdinal: 0 },
    };
    const absent = baseIssue;
    const presentEmpty = { ...baseIssue, rawTarget: '' };
    const failed = {
      ...validProtocolReport,
      passed: false,
      noteInventories: validProtocolReport.noteInventories.map((inventory, index) =>
        index === 0 ? { ...inventory, status: 'failed' } : inventory),
      noteIntegrityIssues: [absent, presentEmpty],
    };
    expect(isLeanVerifierJson({ ...failed, noteIntegrityIssues: [absent] })).toBe(true);
    expect(isLeanVerifierJson(failed)).toBe(false);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [presentEmpty, absent],
    })).toBe(false);
  });

  test('strictly validates optional note-issue relationship and part locators', () => {
    const baseIssue = {
      code: 'NOTE_RELATIONSHIP_UNSAFE_TARGET',
      side: 'original',
      kind: 'footnotes',
      detail: 'the sole exact Transitional note relationship target is unsafe',
      ordinalSpace: 'relationship',
      firstOccurrenceOrdinal: 0,
      occurrenceCount: 1,
      source: { sourceStory: 'main', sourceStoryOrdinal: 0 },
      relationshipId: 'rIdFootnotes',
      rawTarget: '../footnotes.xml',
    };
    const failed = {
      ...validProtocolReport,
      passed: false,
      noteInventories: validProtocolReport.noteInventories.map((inventory, index) =>
        index === 0 ? { ...inventory, status: 'failed' } : inventory),
      noteIntegrityIssues: [baseIssue],
    };
    expect(isLeanVerifierJson(failed)).toBe(true);
    for (const mutation of [
      { relationshipId: 7 },
      { relationshipId: '7invalid' },
      { relationshipId: `r${'x'.repeat(128)}` },
      { rawTarget: 7 },
      { rawTarget: 'x'.repeat(257) },
      { rawTarget: 'bad\u0000target' },
    ]) {
      expect(isLeanVerifierJson({
        ...failed,
        noteIntegrityIssues: [{ ...baseIssue, ...mutation }],
      })).toBe(false);
    }
    const partIssue = {
      code: 'NOTE_PART_MISSING',
      side: 'original',
      kind: 'footnotes',
      detail: 'selected note relationship target part is missing',
      ordinalSpace: 'source',
      firstOccurrenceOrdinal: 1,
      occurrenceCount: 1,
      source: { sourceStory: 'footnotes', sourceStoryOrdinal: 0 },
      normalizedPartPath: 'word/footnotes.xml',
    };
    const partFailed = { ...failed, noteIntegrityIssues: [partIssue] };
    expect(isLeanVerifierJson(partFailed)).toBe(true);
    for (const normalizedPartPath of [
      7, `word/${'x'.repeat(252)}`, 'word/../footnotes.xml', '/word/footnotes.xml',
    ]) {
      expect(isLeanVerifierJson({
        ...partFailed,
        noteIntegrityIssues: [{ ...partIssue, normalizedPartPath }],
      })).toBe(false);
    }
  });

  test('binds source-partition failures to the first canonical incomplete source', () => {
    const sourceIssue = {
      code: 'NOTE_SOURCE_PARTITION_INCOMPLETE',
      side: 'original',
      kind: 'footnotes',
      detail: 'canonical admitted source stories exceed the side-wide XML-event limit',
      ordinalSpace: 'source',
      firstOccurrenceOrdinal: 0,
      occurrenceCount: 1,
      source: { sourceStory: 'main', sourceStoryOrdinal: 0 },
    };
    const failed = {
      ...validProtocolReport,
      passed: false,
      referenceSourcePartitions: validProtocolReport.referenceSourcePartitions.map(
        (partition, index) => index === 0
          ? { ...partition, status: 'incomplete' }
          : partition,
      ),
      noteStories: validProtocolReport.noteStories.map(({ report: _report, ...story }) => ({
        ...story,
        status: 'not_evaluated',
        parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
      })),
      noteInventories: validProtocolReport.noteInventories.map((inventory, index) =>
        index < 2 ? { ...inventory, status: 'not_evaluated' } : inventory),
      noteIntegrityIssues: [sourceIssue],
    };
    expect(isLeanVerifierJson(failed)).toBe(true);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [{
        ...sourceIssue,
        firstOccurrenceOrdinal: 1,
        source: { sourceStory: 'footnotes', sourceStoryOrdinal: 0 },
      }],
    })).toBe(false);
    const laterSourceIssue = {
      ...sourceIssue,
      firstOccurrenceOrdinal: 1,
      source: { sourceStory: 'footnotes', sourceStoryOrdinal: 0 },
    };
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [
        laterSourceIssue,
        sourceIssue,
      ],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...failed,
      noteIntegrityIssues: [sourceIssue, laterSourceIssue],
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
      code: 'COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED',
      side: 'original',
      kind: 'comments',
      detail: 'protocol v6 escaped evidence string budget exceeded',
      ordinalSpace: 'aggregate',
      firstOccurrenceOrdinal: 0,
      occurrenceCount: 1,
    };
    const terminal = {
      ...validProtocolReport,
      passed: false,
      referenceSourcePartitions: validProtocolReport.referenceSourcePartitions.map((partition) => ({
        ...partition,
        status: 'incomplete',
        sources: partition.sources.slice(0, 1),
      })),
      noteStories: validProtocolReport.noteStories.map(({ report: _report, ...story }) => ({
        ...story,
        status: 'not_evaluated',
        parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
      })),
      noteInventories: validProtocolReport.noteInventories.map((inventory) => ({
        ...inventory,
        status: 'not_evaluated',
      })),
      commentStory: {
        status: 'not_evaluated',
        original: { status: 'not_evaluated', relationship: null, partPresent: false },
        revised: { status: 'not_evaluated', relationship: null, partPresent: false },
        compared: { status: 'not_evaluated', relationship: null, partPresent: false },
        parsedTokenCounts: { original: 0, revised: 0, combined: 0 },
      },
      commentInventories: validProtocolReport.commentInventories.map((inventory) => ({
        ...inventory,
        status: 'not_evaluated',
      })),
      noteIntegrityIssues: [],
      commentIntegrityIssues: [terminalIssue],
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
      noteIntegrityIssues: [{ ...terminalIssue, source: {
        sourceStory: 'main', sourceStoryOrdinal: 0,
      } }],
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...terminal,
      referenceSourcePartitions: terminal.referenceSourcePartitions.map((partition, index) =>
        index === 0 ? {
          ...partition,
          definitionStories: [{
            kind: 'footnotes',
            relationship: {
              relationshipId: 'rIdFootnotes',
              normalizedPartPath: 'word/footnotes.xml',
            },
            partPresent: false,
          }, partition.definitionStories[1]],
        } : partition),
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...terminal,
      noteInventories: terminal.noteInventories.map((inventory, index) =>
        index === 0 ? {
          ...inventory,
          relationship: {
            relationshipId: 'rIdFootnotes',
            normalizedPartPath: 'word/footnotes.xml',
          },
        } : inventory),
    })).toBe(false);
    expect(isLeanVerifierJson({
      ...terminal,
      selectionIssues: [{
        code: 'ISSUE_LIMIT_EXCEEDED',
        detail: 'legacy terminal is forbidden in selectionIssues',
      }],
    })).toBe(false);
  });

  test('accepts both complete canonical terminal responses emitted by Lean', async () => {
    if (!existsSync(TERMINAL_SHAPES_EXE)) return;
    for (const mode of ['issues', 'strings'] as const) {
      const raw = await runTerminalShapeProducer(mode);
      expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(2_626_369);
      expect(isLeanVerifierJson(JSON.parse(raw))).toBe(true);
    }
  }, 20_000);

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
  process.stdout.write(${JSON.stringify(`${canonicalJsonForTest(validProtocolReport)}\n`)});
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

  test('removes the private verifier root and confidential sentinel after a successful response', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const sentinel = 'confidential-success-sentinel';
    const fake = await lifecycleChecker('success', sentinel);
    try {
      const result = await runWith(docx, docx, docx, fake.executable);
      expect(result.status, result.reason).toBe('passed');
      const verifierRoot = await readFile(fake.rootPath, 'utf8');
      expect(existsSync(verifierRoot)).toBe(false);
      await expect(readFile(join(verifierRoot, 'confidential.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(fake.dir, { recursive: true, force: true });
    }
  });

  test('removes the private verifier root and confidential sentinel after a nonzero child exit', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const sentinel = 'confidential-nonzero-sentinel';
    const fake = await lifecycleChecker('nonzero', sentinel);
    try {
      const result = await runWith(docx, docx, docx, fake.executable);
      expect(result.status).toBe('not_run');
      expect(result.reason).toBe(
        'Lean relationship-story checker exited with code 17: ordinary lifecycle failure',
      );
      const verifierRoot = await readFile(fake.rootPath, 'utf8');
      expect(existsSync(verifierRoot)).toBe(false);
      await expect(readFile(join(verifierRoot, 'confidential.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(fake.dir, { recursive: true, force: true });
    }
  });

  test('surfaces the exact deterministic error when private-root removal fails', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const sentinel = 'confidential-cleanup-failure-sentinel';
    const fake = await lifecycleChecker('success', sentinel);
    let verifierRoot: string | undefined;
    try {
      const error = await runLeanXmlTripleVerifierForTest(
        inputWith(docx, docx, docx, fake.executable),
        {
          removeRoot: async () => {
            throw new Error('deliberately induced root-removal failure');
          },
        },
      ).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      verifierRoot = await readFile(fake.rootPath, 'utf8');
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `Lean verifier private temporary-root cleanup failed for ${verifierRoot}: ` +
        'deliberately induced root-removal failure',
      );
      expect(existsSync(verifierRoot)).toBe(true);
      await expect(readFile(join(verifierRoot, 'confidential.txt'), 'utf8')).resolves.toBe(sentinel);
    } finally {
      if (verifierRoot) await rm(verifierRoot, { recursive: true, force: true });
      await rm(fake.dir, { recursive: true, force: true });
    }
  });

  test('kills verifier process groups when a timeout fires', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const dir = await mkdtemp(join(tmpdir(), 'safe-docx-timeout-checker-'));
    const executable = join(dir, 'checker');
    const pidPath = join(dir, 'descendant.pid');
    const rootPath = join(dir, 'verifier-root.txt');
    const sentinel = 'confidential-timeout-sentinel';
    await writeFile(executable, `#!/bin/sh
if [ "$1" = "--probe" ]; then exit 0; fi
printf '%s' "$SAFE_DOCX_LEAN_TEMP_ROOT" > '${rootPath}'
printf '%s' '${sentinel}' > "$SAFE_DOCX_LEAN_TEMP_ROOT/confidential.txt"
sleep 30 &
echo $! > '${pidPath}'
cat >/dev/null
wait
`);
    await chmod(executable, 0o700);
    await new Promise<void>((resolve, reject) => {
      const probe = spawn(executable, ['--probe'], { stdio: 'ignore' });
      probe.on('error', reject);
      probe.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`timeout checker probe exited with code ${code}`));
      });
    });
    try {
      const result = await runWith(docx, docx, docx, executable, 300);
      expect(result.status, result.reason).toBe('not_run');
      const pidText = await readFile(pidPath, 'utf8').catch((error: unknown) => {
        throw new Error(`timeout checker did not write descendant PID: ${result.reason}`, {
          cause: error,
        });
      });
      const pid = Number(pidText.trim());
      const verifierRoot = await readFile(rootPath, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).toThrow();
      expect(existsSync(verifierRoot)).toBe(false);
      await expect(readFile(join(verifierRoot, 'confidential.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('removes the private verifier root after protocol output overflow', async () => {
    const docx = await buildDocxFromBodyXml(paragraphWithText('Body'));
    const dir = await mkdtemp(join(tmpdir(), 'safe-docx-overflow-checker-'));
    const executable = join(dir, 'checker');
    const rootPath = join(dir, 'verifier-root.txt');
    const rootModePath = join(dir, 'verifier-root-mode.txt');
    const sentinel = 'confidential-overflow-sentinel';
    await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const root = process.env.SAFE_DOCX_LEAN_TEMP_ROOT;
fs.writeFileSync(${JSON.stringify(rootPath)}, root);
fs.writeFileSync(${JSON.stringify(rootModePath)}, (fs.statSync(root).mode & 0o777).toString(8));
fs.writeFileSync(root + '/confidential.txt', ${JSON.stringify(sentinel)});
process.stdin.resume();
process.stdin.on('end', () => process.stdout.write('x'.repeat(2626370)));
`);
    await chmod(executable, 0o700);
    try {
      const result = await runWith(docx, docx, docx, executable);
      expect(result.status).toBe('not_run');
      expect(result.reason).toContain('exceeded protocol output limits');
      const verifierRoot = await readFile(rootPath, 'utf8');
      expect(await readFile(rootModePath, 'utf8')).toBe('700');
      expect(existsSync(verifierRoot)).toBe(false);
      await expect(readFile(join(verifierRoot, 'confidential.txt'), 'utf8')).rejects.toThrow();
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
    expect(result.noteIntegrityFailures?.map((issue) => issue.code)).toContain(
      'NOTE_PART_LIMIT_EXCEEDED',
    );
  });

  test('accepts highly compressed XML when explicit byte and parser limits are satisfied', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Body'], footnoteOnParagraph: 0 });
    const bomb = footnotes(`<w:r><w:t>${'x'.repeat(2 * 1024 * 1024)}</w:t></w:r>`);
    const compressed = await replacePart(base, 'word/footnotes.xml', bomb, 'DEFLATE');
    const result = await run(compressed);
    expect(result.status, result.reason).toBe('passed');
  }, 20_000);
});
