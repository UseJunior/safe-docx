import { describe, expect } from 'vitest';
import { itAllure as it } from '../../docx-core/src/testing/allure-test.js';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';
import { compileMarkdoc } from './compile.js';
import { exportEditPairs } from './export.js';

async function fixture() {
  const imported = await importDocxToMarkdoc(await buildSyntheticDocx({ paragraphs: ['Original provision.'] }));
  const p = requireMarkdoc(imported.markdoc).scaffold[0]!;
  const attributes = `id="${p.id}" fingerprint="${p.fingerprint}" style="${p.style}" operation="rewrite" format="inherit-source-paragraph"`;
  const replace = (block: string) => imported.markdoc.replace(/\{% para [\s\S]*?\{% \/para %\}/, block);
  return { imported, attributes, replace };
}

describe('authored before-state verification', () => {
  it('rejects false and empty explicit before states for replacement and deletion', async () => {
    const { imported, attributes, replace } = await fixture();
    for (const before of ['False provision.', '']) {
      for (const after of ['Revised provision.', '']) {
        const markdoc = replace(`{% change ${attributes} %}\n{% before %}\n${before}\n{% /before %}\n{% after %}\n${after}\n{% /after %}\n{% /change %}`);
        await expect(compileMarkdoc(imported.anchoredSource, markdoc)).rejects.toMatchObject({ code: 'SOURCE_TEXT_DRIFT' });
      }
    }
  });

  it('resolves legacy originals only during compilation and refuses unresolved exports', async () => {
    const { imported, attributes, replace } = await fixture();
    for (const block of [`{% replace-source ${attributes} %}\nRevised provision.\n{% /replace-source %}`, `{% delete-source ${attributes} /%}`]) {
      const markdoc = replace(block);
      expect(() => exportEditPairs(requireMarkdoc(markdoc))).toThrow('Compile source-only edits');
      const result = await compileMarkdoc(imported.anchoredSource, markdoc);
      expect(result.certificate.passed).toBe(true);
      expect(exportEditPairs(result.ir)[0]!.before).toBe('Original provision.');
    }
  });
});
