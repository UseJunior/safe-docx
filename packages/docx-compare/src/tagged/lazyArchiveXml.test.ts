import { describe, expect, vi } from 'vitest';
import { DocxArchive } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { LazyArchiveXml } from './auxiliaryIdCollision.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Auxiliary ID Collision' });
const path = 'part.xml';
const source = '<?xml version="1.0"?><root><item id="1"/><item/></root>';

async function fixture() {
  const archive = await DocxArchive.create();
  archive.setFile(path, source);
  const setFile = vi.spyOn(archive, 'setFile');
  const xml = new LazyArchiveXml(archive, path, source);
  return { archive, setFile, xml };
}

describe('lazy XML flush lifecycle', () => {
  test('keeps unread, read-only and unchanged mappings clean', async () => {
    const { archive, setFile, xml } = await fixture();
    xml.flush();
    const values = xml.attributeValues(['item'], 'id');
    expect(values).toEqual(['1']);
    values[0] = 'outside mutation';
    expect(xml.attributeValues(['item'], 'id')).toEqual(['1']);
    xml.applyAttributeMap(['item'], 'id', new Map());
    xml.applyAttributeMap(['item'], 'id', new Map([['missing', '2']]));
    xml.applyAttributeMap(['item'], 'id', new Map([['1', '1']]));
    xml.flush();
    expect(setFile).not.toHaveBeenCalled();
    expect(await archive.getFile(path)).toBe(source);
  });

  test('writes once after mutations and becomes dirty again after a later mutation', async () => {
    const { archive, setFile, xml } = await fixture();
    xml.applyAttributeMap(['item'], 'id', new Map([['1', '2']]));
    xml.applyAttributeMap(['item'], 'id', new Map([['2', '3']]));
    xml.flush();
    expect(setFile).toHaveBeenCalledTimes(1);
    expect(await archive.getFile(path)).toBe('<?xml version="1.0"?><root><item id="3"/><item/></root>');
    xml.flush();
    xml.applyAttributeMap(['item'], 'id', new Map([['3', '3']]));
    xml.flush();
    expect(setFile).toHaveBeenCalledTimes(1);

    xml.applyAttributeMap(['item'], 'id', new Map([['3', '4']]));
    xml.flush();
    xml.flush();
    expect(setFile).toHaveBeenCalledTimes(2);
    expect(await archive.getFile(path)).toContain('id="4"');
  });

  test('retries a failed archive update with the pending XML', async () => {
    const { archive, setFile, xml } = await fixture();
    xml.applyAttributeMap(['item'], 'id', new Map([['1', '2']]));
    setFile.mockImplementationOnce(() => { throw new Error('write failed'); });
    expect(() => xml.flush()).toThrow('write failed');
    expect(await archive.getFile(path)).toBe(source);
    xml.flush();
    expect(setFile).toHaveBeenCalledTimes(2);
    expect(setFile.mock.calls[1]).toEqual(setFile.mock.calls[0]);
    expect(await archive.getFile(path)).toContain('id="2"');
    xml.flush();
    expect(setFile).toHaveBeenCalledTimes(2);
  });

  test('preserves additional mutations made after a failed archive update', async () => {
    const { archive, setFile, xml } = await fixture();
    xml.applyAttributeMap(['item'], 'id', new Map([['1', '2']]));
    setFile.mockImplementationOnce(() => { throw new Error('write failed'); });
    expect(() => xml.flush()).toThrow('write failed');
    xml.applyAttributeMap(['item'], 'id', new Map([['2', '3']]));
    xml.flush();
    xml.flush();
    expect(setFile).toHaveBeenCalledTimes(2);
    expect(await archive.getFile(path)).toContain('id="3"');
  });

  test('rewrites normalized keys without dirtying already exact values', async () => {
    const { archive, setFile, xml } = await fixture();
    const normalize = (value: string) => value.padStart(2, '0');
    xml.applyAttributeMap(['item'], 'id', new Map([['01', '01']]), normalize);
    xml.flush();
    expect(await archive.getFile(path)).toContain('id="01"');
    xml.applyAttributeMap(['item'], 'id', new Map([['01', '01']]), normalize);
    xml.flush();
    expect(setFile).toHaveBeenCalledTimes(1);
  });
});
