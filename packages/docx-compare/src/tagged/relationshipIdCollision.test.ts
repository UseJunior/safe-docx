/**
 * Characterization tests for relationshipIdCollision.ts
 *
 * OPC relationship IDs are part-local (ECMA-376 Part 2 §6.5.3.4: the `Id` value
 * is unique only within its own Relationships part), so two independently
 * authored documents both number from `rId1` and the same `rId9` routinely
 * means an image in one and a header in the other. The comparison output is a
 * clone of one side's package carrying a document merged from both, so a
 * reference inherited from the other side either dangles or silently binds to
 * an unrelated part of the wrong type.
 *
 * These tests pin both halves end-to-end against in-memory archives: the
 * pre-comparison renumbering that makes the two id spaces disjoint (including
 * that it leaves genuinely-identical relationships alone, and that it rewrites
 * the merge-source side rather than the base), and the assembly-time import
 * that pulls referenced relationships, their target parts, and content types
 * into the result package.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { DocxArchive, normalizeOpcRelationshipTarget } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  importReferencedRelationships,
  renumberCollidingRelationshipIds,
} from './relationshipIdCollision.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Relationship ID Collision' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.3.4' });

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

interface Rel {
  id: string;
  type: string;
  target: string;
}

function relsPart(rels: Rel[]): string {
  const entries = rels
    .map((r) => `<Relationship Id="${r.id}" Type="${TYPE_BASE}/${r.type}" Target="${r.target}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${REL_NS}">${entries}</Relationships>`;
}

function documentPart(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`;
}

function contentTypes(overrides: Array<[string, string]> = []): string {
  const entries = overrides
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="${CT_NS}"><Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>${entries}</Types>`;
}

const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

/**
 * A schema-valid inline picture carrying `r:embed`.
 *
 * The reference has to sit on `a:blip`, not on `w:drawing` -- the emitted-document
 * schema gate validates every document.xml this pipeline produces, so a shortcut
 * fixture here fails CI even though the unit assertions would pass.
 */
function inlinePicture(relationshipId: string): string {
  return `<w:r><w:drawing><wp:inline xmlns:wp="${WP_NS}">` +
    `<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Relationship fixture"/>` +
    `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}">` +
    `<pic:pic xmlns:pic="${PIC_NS}"><pic:nvPicPr><pic:cNvPr id="1" name="fixture.png"/>` +
    `<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>` +
    `<a:blip r:embed="${relationshipId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const HEADER_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';

async function archiveWith(files: Record<string, string | Buffer>): Promise<DocxArchive> {
  const archive = await DocxArchive.create();
  for (const [path, content] of Object.entries(files)) archive.setFile(path, content);
  return archive;
}

/** Parse a rels part into id -> {type, target}. */
async function readRels(
  archive: DocxArchive,
): Promise<Map<string, { type: string; target: string }>> {
  const xml = (await archive.getFile('word/_rels/document.xml.rels')) ?? '';
  const out = new Map<string, { type: string; target: string }>();
  for (const match of xml.matchAll(
    /Id="([^"]+)"\s+Type="[^"]*\/([^"/]+)"\s+Target="([^"]+)"/g,
  )) {
    out.set(match[1]!, { type: match[2]!, target: match[3]! });
  }
  return out;
}

describe('relationship ID collision resolution', () => {
  test('renumbers only ids that mean different things on the two sides', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let base!: DocxArchive;
    let mergeSource!: DocxArchive;

    await given('two packages sharing rId1 for the same styles part, and rId2 for different parts', async () => {
      base = await archiveWith({
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'styles', target: 'styles.xml' },
          { id: 'rId2', type: 'header', target: 'header1.xml' },
        ]),
        'word/document.xml': documentPart('<w:p/>'),
      });
      mergeSource = await archiveWith({
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'styles', target: 'styles.xml' },
          { id: 'rId2', type: 'image', target: 'media/logo.png' },
        ]),
        'word/document.xml': documentPart(
          `<w:p>${inlinePicture('rId2')}</w:p><w:sectPr><w:headerReference r:id="rId1"/></w:sectPr>`,
        ),
      });
    });

    let renumbered: Awaited<ReturnType<typeof renumberCollidingRelationshipIds>>;
    await when('the merge-source side is renumbered against the base', async () => {
      renumbered = await renumberCollidingRelationshipIds(mergeSource, base);
    });

    await then('only the conflicting id is rewritten', async () => {
      expect(renumbered.map((r) => r.previousId)).toEqual(['rId2']);
      const rels = await readRels(mergeSource);
      // rId1 means the same thing on both sides, so it stays put.
      expect(rels.get('rId1')).toEqual({ type: 'styles', target: 'styles.xml' });
      expect(rels.has('rId2')).toBe(false);
    });

    await and('the new id collides with neither side and references follow it', async () => {
      const nextId = renumbered[0]!.nextId;
      expect(['rId1', 'rId2']).not.toContain(nextId);
      const xml = await mergeSource.getDocumentXml();
      expect(xml).toContain(`r:embed="${nextId}"`);
      // The non-colliding reference is untouched.
      expect(xml).toContain('r:id="rId1"');
    });
  });

  test('leaves the base package untouched', async ({ given, when, then }: AllureBddContext) => {
    let base!: DocxArchive;
    let mergeSource!: DocxArchive;
    let baseRelsBefore!: string;

    await given('two packages whose ids collide entirely', async () => {
      base = await archiveWith({
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'header', target: 'header1.xml' },
        ]),
        'word/document.xml': documentPart('<w:p/>'),
      });
      mergeSource = await archiveWith({
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'footer', target: 'footer1.xml' },
        ]),
        'word/document.xml': documentPart('<w:p/>'),
      });
      baseRelsBefore = (await base.getFile('word/_rels/document.xml.rels'))!;
    });

    await when('the merge-source side is renumbered', async () => {
      await renumberCollidingRelationshipIds(mergeSource, base);
    });

    await then('the base relationship table is byte-identical', async () => {
      expect(await base.getFile('word/_rels/document.xml.rels')).toBe(baseRelsBefore);
    });
  });

  test('imports a referenced relationship with its target part and content type', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let result!: DocxArchive;
    let mergeSource!: DocxArchive;
    const mergedXml = documentPart(
      '<w:p/><w:sectPr><w:headerReference r:id="rId9"/></w:sectPr>',
    );

    await given('a result package lacking the header the merged document references', async () => {
      result = await archiveWith({
        '[Content_Types].xml': contentTypes(),
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'styles', target: 'styles.xml' },
        ]),
        'word/document.xml': mergedXml,
      });
      mergeSource = await archiveWith({
        '[Content_Types].xml': contentTypes([['/word/header7.xml', HEADER_CT]]),
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId9', type: 'header', target: 'header7.xml' },
        ]),
        'word/header7.xml': '<w:hdr/>',
        'word/document.xml': documentPart('<w:p/>'),
      });
    });

    let imported: Awaited<ReturnType<typeof importReferencedRelationships>>;
    await when('referenced relationships are imported at assembly', async () => {
      imported = await importReferencedRelationships(mergeSource, result, mergedXml);
    });

    await then('the relationship resolves to a header, not to something else', async () => {
      expect(imported.map((r) => r.id)).toEqual(['rId9']);
      const rels = await readRels(result);
      expect(rels.get('rId9')).toEqual({ type: 'header', target: 'header7.xml' });
    });

    await and('the target part and its content type came across', async () => {
      expect(result.hasFile('word/header7.xml')).toBe(true);
      expect(await result.getFile('[Content_Types].xml')).toContain('/word/header7.xml');
    });
  });

  test('copies the transitive part closure a referenced part depends on', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: DocxArchive;
    let mergeSource!: DocxArchive;
    const mergedXml = documentPart(
      '<w:p/><w:sectPr><w:headerReference r:id="rId9"/></w:sectPr>',
    );

    await given('a header on the merge-source side that itself references an image', async () => {
      result = await archiveWith({
        '[Content_Types].xml': contentTypes(),
        'word/_rels/document.xml.rels': relsPart([]),
        'word/document.xml': mergedXml,
      });
      mergeSource = await archiveWith({
        '[Content_Types].xml': contentTypes([['/word/header7.xml', HEADER_CT]]),
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId9', type: 'header', target: 'header7.xml' },
        ]),
        'word/header7.xml': '<w:hdr xmlns:r="' + R_NS + '"><w:p r:embed="rId3"/></w:hdr>',
        'word/_rels/header7.xml.rels': relsPart([
          { id: 'rId3', type: 'image', target: 'media/logo.png' },
        ]),
        'word/media/logo.png': Buffer.from('PNGDATA') as unknown as string,
        'word/document.xml': documentPart('<w:p/>'),
      });
    });

    await when('referenced relationships are imported', async () => {
      await importReferencedRelationships(mergeSource, result, mergedXml);
    });

    await then('the header, its own rels part, and the image all came across', async () => {
      expect(result.hasFile('word/header7.xml')).toBe(true);
      expect(result.hasFile('word/_rels/header7.xml.rels')).toBe(true);
      expect(result.hasFile('word/media/logo.png')).toBe(true);
    });
  });

  test('copies a name-colliding part aside instead of binding to the base content', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let result!: DocxArchive;
    let mergeSource!: DocxArchive;
    const mergedXml = documentPart(
      '<w:p/><w:sectPr><w:headerReference r:id="rId9"/></w:sectPr>',
    );

    await given('both packages define word/header7.xml with unrelated content', async () => {
      result = await archiveWith({
        '[Content_Types].xml': contentTypes([['/word/header7.xml', HEADER_CT]]),
        'word/_rels/document.xml.rels': relsPart([]),
        'word/document.xml': mergedXml,
        'word/header7.xml': '<w:hdr>BASE-UNRELATED</w:hdr>',
      });
      mergeSource = await archiveWith({
        '[Content_Types].xml': contentTypes([['/word/header7.xml', HEADER_CT]]),
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId9', type: 'header', target: 'header7.xml' },
        ]),
        'word/header7.xml': '<w:hdr>EXPECTED-SOURCE</w:hdr>',
        'word/document.xml': documentPart('<w:p/>'),
      });
    });

    await when('the referenced header is imported', async () => {
      await importReferencedRelationships(mergeSource, result, mergedXml);
    });

    await then('the relationship resolves to the merge source content', async () => {
      const rels = await readRels(result);
      const target = rels.get('rId9')!.target;
      expect(target).not.toBe('header7.xml');
      expect(await result.getFile(`word/${target}`)).toContain('EXPECTED-SOURCE');
    });

    await and("the base's own part and content type registration survive", async () => {
      expect(await result.getFile('word/header7.xml')).toContain('BASE-UNRELATED');
      const rels = await readRels(result);
      expect(await result.getFile('[Content_Types].xml')).toContain(rels.get('rId9')!.target);
    });
  });

  test('reuses a name-colliding part when the bytes are identical', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: DocxArchive;
    let mergeSource!: DocxArchive;
    const mergedXml = documentPart(
      '<w:p/><w:sectPr><w:headerReference r:id="rId9"/></w:sectPr>',
    );
    const sharedHeader = '<w:hdr>SHARED</w:hdr>';

    await given('both packages define word/header7.xml with the same bytes', async () => {
      result = await archiveWith({
        '[Content_Types].xml': contentTypes([['/word/header7.xml', HEADER_CT]]),
        'word/_rels/document.xml.rels': relsPart([]),
        'word/document.xml': mergedXml,
        'word/header7.xml': sharedHeader,
      });
      mergeSource = await archiveWith({
        '[Content_Types].xml': contentTypes([['/word/header7.xml', HEADER_CT]]),
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId9', type: 'header', target: 'header7.xml' },
        ]),
        'word/header7.xml': sharedHeader,
        'word/document.xml': documentPart('<w:p/>'),
      });
    });

    await when('the referenced header is imported', async () => {
      await importReferencedRelationships(mergeSource, result, mergedXml);
    });

    await then('no duplicate part is created', async () => {
      const rels = await readRels(result);
      expect(rels.get('rId9')!.target).toBe('header7.xml');
      expect(result.listFiles().filter((p) => p.includes('header7'))).toEqual([
        'word/header7.xml',
      ]);
    });
  });

  test('leaves the result untouched when nothing is missing', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: DocxArchive;
    let mergeSource!: DocxArchive;
    let before!: string;
    const mergedXml = documentPart(
      '<w:p/><w:sectPr><w:headerReference r:id="rId1"/></w:sectPr>',
    );

    await given('a result package already carrying every referenced relationship', async () => {
      result = await archiveWith({
        '[Content_Types].xml': contentTypes(),
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'header', target: 'header1.xml' },
        ]),
        'word/document.xml': mergedXml,
      });
      mergeSource = await archiveWith({
        '[Content_Types].xml': contentTypes(),
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'header', target: 'header1.xml' },
        ]),
        'word/document.xml': documentPart('<w:p/>'),
      });
      before = (await result.getFile('word/_rels/document.xml.rels'))!;
    });

    let imported: Awaited<ReturnType<typeof importReferencedRelationships>>;
    await when('referenced relationships are imported', async () => {
      imported = await importReferencedRelationships(mergeSource, result, mergedXml);
    });

    await then('nothing is imported and the table is byte-identical', async () => {
      expect(imported).toEqual([]);
      expect(await result.getFile('word/_rels/document.xml.rels')).toBe(before);
    });
  });

  test('a newly minted hyperlink id never captures a renumbered merge-source reference', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original!: Buffer;
    let revised!: Buffer;

    const replaceParts = async (
      input: Buffer,
      files: Record<string, string>,
    ): Promise<Buffer> => {
      const zip = await JSZip.loadAsync(input);
      for (const [path, value] of Object.entries(files)) zip.file(path, value);
      return zip.generateAsync({ type: 'nodebuffer' });
    };

    await given('a revised side whose image id collides with a base id and which also adds a hyperlink', async () => {
      original = await buildDocxFromBodyXml('<w:p><w:r><w:t>Before</w:t></w:r></w:p>');
      revised = await buildDocxFromBodyXml(
        `<w:p xmlns:r="${R_NS}">` +
        `<w:hyperlink r:id="rId4"><w:r><w:t>https://new.example</w:t></w:r></w:hyperlink>` +
        `${inlinePicture('rId2')}</w:p>`,
      );
      original = await replaceParts(original, {
        'word/_rels/document.xml.rels': relsPart([
          { id: 'rId1', type: 'styles', target: 'styles.xml' },
          { id: 'rId2', type: 'image', target: 'media/base.png' },
        ]),
        'word/styles.xml': `<w:styles xmlns:w="${W_NS}"/>`,
        'word/media/base.png': 'BASE',
      });
      revised = await replaceParts(revised, {
        '[Content_Types].xml': contentTypes(),
        'word/_rels/document.xml.rels':
          relsPart([
            { id: 'rId1', type: 'styles', target: 'styles.xml' },
            // Same id as the base's image, different target -- so it gets renumbered.
            { id: 'rId2', type: 'image', target: 'media/revised.png' },
          ]).replace(
            '</Relationships>',
            `<Relationship Id="rId4" Type="${TYPE_BASE}/hyperlink" Target="https://new.example" TargetMode="External"/></Relationships>`,
          ),
        'word/styles.xml': `<w:styles xmlns:w="${W_NS}"/>`,
        'word/media/revised.png': 'REVISED-IMAGE',
      });
    });

    let bound: { type: string; target: string } | undefined;
    await when('compared in rebuild mode, which mints a relationship for the new hyperlink', async () => {
      const compared = await compareDocumentsAtomizer(original, revised, {
        moveDetection: { detectMoves: false },
      });
      const output = await DocxArchive.load(compared.document);
      const xml = await output.getDocumentXml();
      const rels = await readRels(output);
      const embedId = /<a:blip[^>]+r:embed="([^"]+)"/.exec(xml)?.[1];
      bound = embedId ? rels.get(embedId) : undefined;
    });

    await then('the image reference still resolves to an image, not to the hyperlink', () => {
      // Type alone is not enough: the base also has an image at rId2. The target
      // proves the reference resolved to the merge source's picture.
      expect(bound?.type).toBe('image');
      expect(bound?.target).toBe('media/revised.png');
    });
  });

  test.openspec('One package preserves both source projections')(
    'same-path internal targets with different bytes project to their respective parts',
    async () => {
      const replaceParts = async (input: Buffer, id: string, bytes: string): Promise<Buffer> => {
        const zip = await JSZip.loadAsync(input);
        zip.file('[Content_Types].xml', contentTypes());
        zip.file('word/_rels/document.xml.rels', relsPart([
          { id, type: 'image', target: '/word/media/logo.png' },
        ]));
        zip.file('word/media/logo.png', bytes);
        return zip.generateAsync({ type: 'nodebuffer' });
      };
      const original = await replaceParts(
        await buildDocxFromBodyXml(`<w:p xmlns:r="${R_NS}">${inlinePicture('rId7')}</w:p>`),
        'rId7', 'ORIGINAL_IMAGE',
      );
      const revised = await replaceParts(
        await buildDocxFromBodyXml(`<w:p xmlns:r="${R_NS}">${inlinePicture('rId3')}</w:p>`),
        'rId3', 'REVISED_IMAGE',
      );
      const result = await compareDocumentsAtomizer(original, revised, {
        author: 'Relationship Test',
        date: new Date('2026-08-16T12:00:00Z'),
      });
      const output = await DocxArchive.load(result.document);
      const documentXml = await output.getDocumentXml();
      const rels = await readRels(output);
      const projectedBytes = async (xml: string): Promise<string> => {
        const id = /<a:blip[^>]+r:embed="([^"]+)"/.exec(xml)?.[1];
        const target = id ? rels.get(id)?.target : undefined;
        expect(target).toBeDefined();
        const partPath = normalizeOpcRelationshipTarget({
          ownerPart: 'word/document.xml', target: target!,
        }).target;
        return (await output.getFileBuffer(partPath))!.toString();
      };

      expect(await projectedBytes(acceptAllChanges(documentXml))).toBe('REVISED_IMAGE');
      expect(await projectedBytes(rejectAllChanges(documentXml))).toBe('ORIGINAL_IMAGE');
    },
  );

  test('cyclic internal relationship closures terminate during tagged comparison', async () => {
    const base = await buildDocxFromBodyXml(
      `<w:p xmlns:r="${R_NS}">${inlinePicture('rId7')}${inlinePicture('rId8')}</w:p>`,
    );
    const zip = await JSZip.loadAsync(base);
    zip.file('[Content_Types].xml', contentTypes());
    zip.file('word/_rels/document.xml.rels', relsPart([
      { id: 'rId7', type: 'image', target: 'media/a.png' },
      { id: 'rId8', type: 'image', target: 'media/b.png' },
    ]));
    zip.file('word/media/a.png', 'A');
    zip.file('word/media/b.png', 'B');
    zip.file('word/media/_rels/a.png.rels', relsPart([
      { id: 'rId1', type: 'image', target: 'b.png' },
    ]));
    zip.file('word/media/_rels/b.png.rels', relsPart([
      { id: 'rId1', type: 'image', target: 'a.png' },
    ]));
    const cyclic = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await compareDocumentsAtomizer(cyclic, cyclic, {
      author: 'Relationship Test',
      date: new Date('2026-08-16T12:00:00Z'),
    });
    expect(result.document.byteLength).toBeGreaterThan(0);
  });
});
