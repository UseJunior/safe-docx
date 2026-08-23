import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(sourceDirectory, '..');
const matrixPath = resolve(packageDirectory, 'TAGGED_OPTION_OBSERVABLE_MATRIX.md');

function interfaceProperties(source: string, interfaceName: string): string[] {
  const declaration = source.match(
    new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`),
  );
  if (!declaration) throw new Error(`Missing exported interface ${interfaceName}`);
  return Array.from(declaration[1]!.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/gm))
    .map((match) => match[1]!)
    .sort();
}

function matrixRows(markdown: string): Array<{ setting: string; surface: string }> {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return { setting: cells[1]!, surface: cells[2]! };
    });
}

function documentedRoots(
  rows: Array<{ setting: string; surface: string }>,
  surface: 'Public' | 'low-level',
): string[] {
  return Array.from(new Set(
    rows
      .filter((row) => row.surface.toLowerCase().includes(surface.toLowerCase()))
      .flatMap((row) => Array.from(row.setting.matchAll(/`([^`]+)`/g)))
      .map((match) => match[1]!.split('.')[0]!),
  )).sort();
}

describe('tagged option-to-observable matrix freshness', () => {
  test('tracks the current public and low-level option interfaces', () => {
    const markdown = readFileSync(matrixPath, 'utf8');
    const rows = matrixRows(markdown);
    const compareTypes = readFileSync(resolve(sourceDirectory, 'compare-types.ts'), 'utf8');
    const pipeline = readFileSync(resolve(sourceDirectory, 'tagged/pipeline.ts'), 'utf8');

    expect(documentedRoots(rows, 'Public')).toEqual(
      interfaceProperties(compareTypes, 'CompareOptions'),
    );
    expect(documentedRoots(rows, 'low-level')).toEqual(
      interfaceProperties(pipeline, 'AtomizerOptions'),
    );
  });

  test('contains no retired selector or migration-phase promises', () => {
    const markdown = readFileSync(matrixPath, 'utf8');
    const documentedSettings = matrixRows(markdown)
      .map((row) => row.setting)
      .join('\n');
    for (const retiredSelector of [
      'comparisonStrategy',
      'engine',
      'reconstructionMode',
      'premergeRuns',
      'maxWordRefinementChangeRanges',
    ]) {
      expect(documentedSettings).not.toContain(`\`${retiredSelector}\``);
    }
    expect(markdown).not.toMatch(/Phase \d|Scheduled removal|legacy (?:assembly|path|pass)/i);
  });

  test('links to the durable archived migration record', () => {
    const markdown = readFileSync(matrixPath, 'utf8');
    const link = markdown.match(
      /\[archived tagged-tree change\]\(([^)]+)\)/,
    )?.[1];

    expect(link).toBeDefined();
    expect(existsSync(resolve(packageDirectory, link!))).toBe(true);
  });
});
