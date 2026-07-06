/**
 * Baseline settings part (issue #487).
 *
 * Word-authored documents carry word/settings.xml with a w:compat →
 * compatibilityMode=15 compatSetting. generateDocx used to emit settings.xml
 * only when a section needed w:evenAndOddHeaders (or theme-relative authoring
 * needed w:clrSchemeMapping), and even then without a compat block — so Word
 * opened every generated document in legacy "Compatibility Mode". These
 * assertions prove settings.xml is now emitted on every package, fully wired
 * (content type + resolving relationship, registered exactly once), carries the
 * compatibilityMode=15 compatSetting, and that the conditional even/odd-header
 * setting still emits alongside the compat block.
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-generation-baseline-settings';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

/** A minimal spec that needs no conditional settings (no even headers, no theme). */
function plainSpec(): DocumentSpec {
  return {
    meta: { title: 'Baseline', author: 'safe-docx', createdIso: '2026-01-01T00:00:00Z' },
    sections: [
      { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Hello world' }] }] },
    ],
  };
}

/** A spec whose section declares an even-page header, forcing w:evenAndOddHeaders. */
function evenHeaderSpec(): DocumentSpec {
  return {
    meta: { title: 'Even', author: 'safe-docx', createdIso: '2026-01-01T00:00:00Z' },
    sections: [
      {
        blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Body' }] }],
        headers: { even: { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Even header' }] }] } },
      },
    ],
  };
}

describe('Baseline settings part', () => {
  test.openspec('[SDX-GEN-094] the baseline settings part is emitted with compatibilityMode=15')(
    'Scenario: the baseline settings part is emitted with compatibilityMode=15',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      let zipNames!: string[];
      await given('a generated package that needs no conditional settings', async () => {
        buffer = await generateDocx(plainSpec());
        const zip = await JSZip.loadAsync(buffer);
        zipNames = Object.keys(zip.files);
        await attachPrettyJson('package-parts', zipNames.slice().sort());
      });

      await then('it contains word/settings.xml', async () => {
        expect(zipNames, 'missing word/settings.xml').toContain('word/settings.xml');
      });

      await then('the settings part is wired and registered exactly once', async () => {
        const contentTypes = (await readZipText(buffer, '[Content_Types].xml'))!;
        // A single content-type Override for the settings part.
        const overrides = contentTypes.split('PartName="/word/settings.xml"').length - 1;
        expect(overrides, 'settings.xml registered more than once').toBe(1);
        expect(contentTypes).toContain('wordprocessingml.settings+xml');

        const rels = parseXml((await readZipText(buffer, 'word/_rels/document.xml.rels'))!);
        const settingsRels = Array.from(rels.getElementsByTagName('Relationship')).filter(
          (r) => r.getAttribute('Target') === 'settings.xml',
        );
        expect(settingsRels, 'settings relationship missing or duplicated').toHaveLength(1);
        expect(settingsRels[0]!.getAttribute('Type')).toContain('/relationships/settings');
      });

      let settingsXml!: string;
      await when('word/settings.xml is read', async () => {
        settingsXml = (await readZipText(buffer, 'word/settings.xml'))!;
        await attachPrettyJson('settings-xml', settingsXml);
      });

      await then('it declares compatibilityMode=15', async () => {
        const settings = parseXml(settingsXml);
        const compat = settings.getElementsByTagName('w:compat');
        expect(compat, 'missing w:compat').toHaveLength(1);
        const settingEls = Array.from(compat[0]!.getElementsByTagName('w:compatSetting'));
        const compatMode = settingEls.find((el) => el.getAttribute('w:name') === 'compatibilityMode');
        expect(compatMode, 'missing compatibilityMode compatSetting').toBeTruthy();
        expect(compatMode!.getAttribute('w:uri')).toBe('http://schemas.microsoft.com/office/word');
        expect(compatMode!.getAttribute('w:val')).toBe('15');
      });

      await then('the structural checks pass and the package compiles byte-identically', async () => {
        const result = await checkGeneratedPackage(buffer);
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
        const again = await generateDocx(plainSpec());
        expect(again.equals(buffer)).toBe(true);
      });
    },
  );

  test.openspec('[SDX-GEN-094] the baseline settings part is emitted with compatibilityMode=15')(
    'Scenario: conditional even/odd headers still emit alongside the compat block',
    async ({ given, then }: AllureBddContext) => {
      let settingsXml!: string;
      await given('a generated package whose section declares an even-page header', async () => {
        const buffer = await generateDocx(evenHeaderSpec());
        settingsXml = (await readZipText(buffer, 'word/settings.xml'))!;
      });

      await then('the settings part carries both w:evenAndOddHeaders and the compat block', async () => {
        const settings = parseXml(settingsXml);
        expect(settings.getElementsByTagName('w:evenAndOddHeaders'), 'missing w:evenAndOddHeaders').toHaveLength(1);
        const compat = settings.getElementsByTagName('w:compat');
        expect(compat, 'missing w:compat').toHaveLength(1);
        const compatMode = Array.from(compat[0]!.getElementsByTagName('w:compatSetting')).find(
          (el) => el.getAttribute('w:name') === 'compatibilityMode',
        );
        expect(compatMode!.getAttribute('w:val')).toBe('15');
      });
    },
  );
});
