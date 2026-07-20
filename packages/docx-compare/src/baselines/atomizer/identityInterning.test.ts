/**
 * Regression tests for atom identity interning (#585).
 *
 * The interned integer id assigned by `assignIdentityIds` must reproduce the
 * legacy `atomsEqual` relation EXACTLY — equal `sha1Hash`, equal recursive
 * `textContent`, and equal `tagName`. These tests guard the two mistakes the
 * #583/#584 review flagged:
 *   1. interning text alone (would merge same-text/different-attribute atoms), and
 *   2. mis-reading AC3 as "same text + different rPr must NOT match" — rPr lives
 *      on the run ancestor, not `contentElement`, so those atoms MUST match and
 *      become FormatChanged downstream.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import {
  createComparisonUnitAtom,
  assignIdentityIds,
  getIdentityId,
  IdentityInterner,
} from '../../atomizer.js';
import { el } from '../../testing/dom-test-helpers.js';
import type { ComparisonUnitAtom, WmlElement, OpcPart } from '@usejunior/docx-core';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Atom LCS' });

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

/** Build an atom from a leaf element and optional ancestor chain (e.g. a run carrying rPr). */
function atom(contentElement: WmlElement, ancestors: WmlElement[] = []): ComparisonUnitAtom {
  return createComparisonUnitAtom({ contentElement, ancestors, part: PART });
}

/** The legacy relation the interned id must reproduce exactly. */
function legacyEqual(a: ComparisonUnitAtom, b: ComparisonUnitAtom): boolean {
  return (
    a.sha1Hash === b.sha1Hash &&
    (a.contentElement.textContent ?? '') === (b.contentElement.textContent ?? '') &&
    a.contentElement.tagName === b.contentElement.tagName
  );
}

/** Intern a batch through one interner and return their ids in order. */
function idsOf(atoms: ComparisonUnitAtom[]): Array<number | undefined> {
  assignIdentityIds(atoms, new IdentityInterner());
  return atoms.map((a) => getIdentityId(a));
}

describe('atom identity interning', () => {
  test.allure({ story: 'same text + different rPr MUST match (rPr is on the ancestor run, not the atom)' })('same text + different rPr MUST match (rPr is on the ancestor run, not the atom)', async ({ given, then }: AllureBddContext) => {
      let ids: Array<number | undefined>;

      await given('two atoms with identical w:t text but ancestor runs carrying different rPr', () => {
        const boldRun = el('w:r', {}, [el('w:rPr', {}, [el('w:b')])]);
        const plainRun = el('w:r', {}, [el('w:rPr')]);
        const a = atom(el('w:t', {}, undefined, 'Company'), [boldRun]);
        const b = atom(el('w:t', {}, undefined, 'Company'), [plainRun]);
        ids = idsOf([a, b]);
      });

      await then('they receive the same interned identity (so the LCS matches them → FormatChanged)', () => {
        expect(ids[0]).toBe(ids[1]);
      });
    }
  );

  test.allure({ story: 'same text + different content-element attribute must NOT match' })('same text + different content-element attribute must NOT match', async ({ given, then }: AllureBddContext) => {
      let ids: Array<number | undefined>;

      await given('two w:t atoms with identical text but a differing (non-xml:space) attribute', () => {
        const a = atom(el('w:t', {}, undefined, 'Company'));
        const b = atom(el('w:t', { 'w:rsidR': '00AB12' }, undefined, 'Company'));
        ids = idsOf([a, b]);
      });

      await then('they receive different interned identities', () => {
        expect(ids[0]).not.toBe(ids[1]);
      });
    }
  );

  test.allure({ story: 'xml:space differences still collapse (ignored attribute)' })('xml:space differences still collapse (ignored attribute)', async ({ given, then }: AllureBddContext) => {
      let ids: Array<number | undefined>;

      await given('two w:t atoms with identical text, one with xml:space=preserve', () => {
        const a = atom(el('w:t', {}, undefined, 'the '));
        const b = atom(el('w:t', { 'xml:space': 'preserve' }, undefined, 'the '));
        ids = idsOf([a, b]);
      });

      await then('they receive the same interned identity', () => {
        expect(ids[0]).toBe(ids[1]);
      });
    }
  );

  test.allure({ story: 'interned equality reproduces the legacy atomsEqual relation over a cross-product' })('interned equality reproduces the legacy atomsEqual relation over a cross-product', async ({ given, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];
      let ids: Array<number | undefined>;

      await given('a diverse pool of finalized atoms (text, attrs, tags, whitespace, duplicates)', () => {
        atoms = [
          atom(el('w:t', {}, undefined, 'Company')),
          atom(el('w:t', {}, undefined, 'Company')), // duplicate of #0
          atom(el('w:t', {}, undefined, 'company')), // different case
          atom(el('w:t', { 'w:rsidR': 'X' }, undefined, 'Company')), // extra attr
          atom(el('w:t', { 'xml:space': 'preserve' }, undefined, 'Company')), // ignored attr → dup of #0
          atom(el('w:t', {}, undefined, ' ')),
          atom(el('w:t', {}, undefined, '')),
          atom(el('w:br')),
          atom(el('w:br')), // duplicate br
          atom(el('w:tab')),
          atom(el('w:drawing', { 'r:id': 'rId1' })),
          atom(el('w:drawing', { 'r:id': 'rId1' })), // duplicate drawing (collides today — must still match)
          atom(el('w:drawing', { 'r:id': 'rId2' })), // different drawing
        ];
        ids = idsOf(atoms);
      });

      await then('for every pair, id-equality == legacy atomsEqual', () => {
        for (let i = 0; i < atoms.length; i++) {
          for (let j = 0; j < atoms.length; j++) {
            const idEq = ids[i] === ids[j];
            const legEq = legacyEqual(atoms[i]!, atoms[j]!);
            expect(idEq, `pair (${i},${j})`).toBe(legEq);
          }
        }
      });

      await then('the two identical inline drawings share an id (preserving today\'s collision behavior)', () => {
        expect(ids[10]).toBe(ids[11]);
        expect(ids[10]).not.toBe(ids[12]);
      });
    }
  );

  test.allure({ story: 'reading sha1Hash still yields a 40-char hex digest (lazy, materialized on read)' })('reading sha1Hash still yields a 40-char hex digest (lazy, materialized on read)', async ({ given, then }: AllureBddContext) => {
      let hash: string;

      await given('a freshly constructed atom', () => {
        hash = atom(el('w:t', {}, undefined, 'Company')).sha1Hash;
      });

      await then('the digest is 40 hex characters', () => {
        expect(hash).toMatch(/^[0-9a-f]{40}$/);
      });
    }
  );
});
