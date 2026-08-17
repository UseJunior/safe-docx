import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import type { StrategyDifferentialFixture } from './strategy-differential-harness.js';
import {
  deleteOneRealParagraph,
  resolveRealCorpusAvailability,
} from './real-corpus-fixtures.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const FIXTURE_MANIFEST_PATH = resolve(
  REPO_ROOT,
  'packages/docx-compare/src/testing/fixtures/manifest.json',
);

interface FixtureManifest {
  base_dir: string;
  fixtures: Array<{
    name: string;
    original: string;
    revised: string;
    tags: string[];
  }>;
}

async function loadCheckedInFixtures(): Promise<StrategyDifferentialFixture[]> {
  const manifest = JSON.parse(await readFile(FIXTURE_MANIFEST_PATH, 'utf8')) as FixtureManifest;
  const base = resolve(FIXTURE_MANIFEST_PATH, '..', manifest.base_dir);
  return Promise.all(manifest.fixtures.map(async (fixture) => ({
    id: `checked-in/${fixture.name}`,
    original: await readFile(resolve(base, fixture.original)),
    revised: await readFile(resolve(base, fixture.revised)),
    capabilityTags: [
      ...fixture.tags,
      ...(fixture.name === 'ILPA'
        ? ['fields', 'formatting', 'numbering', 'relationships', 'tables']
        : []),
    ],
    expectedPackageParts: ['word/document.xml', 'word/_rels/document.xml.rels'],
    approvedDivergenceIds:
      fixture.name === 'ILPA'
        ? [
            'TD-FUZZY-MOVE-001',
            'TD-LEGACY-ILPA-REJECT-001',
            'TD-NUMBERING-001',
          ]
        : [],
  })));
}

async function loadAncillaryCapabilityFixture(): Promise<StrategyDifferentialFixture> {
  const common = {
    footnoteOnParagraph: 0,
    footnoteText: 'Footnote definition',
    endnoteOnParagraph: 1,
    endnoteText: 'Endnote definition',
    commentOnParagraph: 2,
    commentText: 'Comment definition',
    commentAuthor: 'Capability Author',
    commentAncillaryParts: true,
    bookmarkOnParagraph: { paragraph: 1, name: 'CapabilityBookmark', id: 41 },
  } as const;
  const [original, revised] = await Promise.all([
    buildSyntheticDocx({ ...common, paragraphs: ['Stable', 'Original clause', 'Commented'] }),
    buildSyntheticDocx({ ...common, paragraphs: ['Stable', 'Revised clause', 'Commented'] }),
  ]);
  return {
    id: 'synthetic/ancillary-definitions',
    original,
    revised,
    capabilityTags: [
      'auxiliary-definitions',
      'bookmarks',
      'comments',
      'endnotes',
      'footnotes',
      'relationships',
    ],
    expectedPackageParts: [
      'word/comments.xml',
      'word/commentsExtended.xml',
      'word/endnotes.xml',
      'word/footnotes.xml',
      'word/people.xml',
    ],
  };
}

function vmlTextBoxBody(text: string): string {
  return '<w:p><w:r><w:pict><v:shape id="strategy-box" o:spid="_x0000_s1026">'
    + '<v:textbox><w:txbxContent><w:p w14:paraId="20000001" w14:textId="20000001">'
    + `<w:r><w:t>${text}</w:t></w:r>`
    + '</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>';
}

async function loadTextBoxCapabilityFixture(): Promise<StrategyDifferentialFixture> {
  const options = {
    namespaces: {
      o: 'urn:schemas-microsoft-com:office:office',
      v: 'urn:schemas-microsoft-com:vml',
    },
  } as const;
  const [original, revised] = await Promise.all([
    buildDocxFromBodyXml(vmlTextBoxBody('Original boxed clause'), [], options),
    buildDocxFromBodyXml(vmlTextBoxBody('Revised boxed clause'), [], options),
  ]);
  return {
    id: 'synthetic/vml-text-box',
    original,
    revised,
    capabilityTags: ['formatting', 'relationships', 'text-boxes'],
    expectedPackageParts: ['word/document.xml', 'word/_rels/document.xml.rels'],
  };
}

async function loadMoveCapabilityFixture(): Promise<StrategyDifferentialFixture> {
  const alpha = '<w:p><w:r><w:t>Alpha covenant remains distinct across every reviewed agreement.</w:t></w:r></w:p>';
  const beta = '<w:p><w:r><w:t>Beta covenant remains independently distinct across every agreement.</w:t></w:r></w:p>';
  const [original, revised] = await Promise.all([
    buildDocxFromBodyXml(alpha + beta),
    buildDocxFromBodyXml(beta + alpha),
  ]);
  return {
    id: 'synthetic/exact-paragraph-move',
    original,
    revised,
    capabilityTags: ['moves', 'paragraph-reorder', 'range-boundaries'],
    expectedPackageParts: ['word/document.xml', 'word/_rels/document.xml.rels'],
    approvedDivergenceIds: ['TD-LEGACY-MOVE-PROJECTION-001'],
  };
}

async function loadRealCorpusFixtures(
  corpusRoot: string,
): Promise<StrategyDifferentialFixture[]> {
  const availability = resolveRealCorpusAvailability(corpusRoot);
  if (!availability.available) {
    throw new Error(availability.skipWarning ?? 'real strategy-differential corpus unavailable');
  }
  return Promise.all(availability.entries.map(async (entry) => {
    const original = await readFile(join(corpusRoot, entry.id, 'source.docx'));
    const deletion = await deleteOneRealParagraph(original, entry.id);
    return {
      id: `real/${entry.id}/paragraph-deletion`,
      original,
      revised: deletion.revised,
      capabilityTags: [
        'bookmarks',
        'contract',
        'fields',
        'formatting',
        'numbering',
        'paragraph-deletion',
        'relationships',
        'real-world',
      ],
      expectedPackageParts: ['word/document.xml', 'word/_rels/document.xml.rels'],
    } satisfies StrategyDifferentialFixture;
  }));
}

export async function loadStrategyDifferentialFixtures(
  corpusRoot: string,
): Promise<StrategyDifferentialFixture[]> {
  const [checkedIn, ancillary, textBox, move, real] = await Promise.all([
    loadCheckedInFixtures(),
    loadAncillaryCapabilityFixture(),
    loadTextBoxCapabilityFixture(),
    loadMoveCapabilityFixture(),
    loadRealCorpusFixtures(corpusRoot),
  ]);
  return [...checkedIn, ancillary, textBox, move, ...real]
    .sort((left, right) => left.id.localeCompare(right.id));
}
