import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { describe, expect } from 'vitest';
import { testAllure } from './testing/allure-test.js';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(sourceDirectory, '..');
const matrixPath = resolve(packageDirectory, 'TAGGED_OPTION_OBSERVABLE_MATRIX.md');
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Tagged Option Matrix', story: 'Documentation Freshness' });

function interfaceProperties(source: string, interfaceName: string): string[] {
  const sourceFile = ts.createSourceFile(
    `${interfaceName}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  if (!declaration) throw new Error(`Missing exported interface ${interfaceName}`);
  return declaration.members.map((member) => {
    if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) {
      throw new Error(`Unsupported ${interfaceName} member: ${member.getText(sourceFile)}`);
    }
    const { name } = member;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    throw new Error(`Unsupported computed ${interfaceName} member: ${name.getText(sourceFile)}`);
  }).sort();
}

function matrixRows(markdown: string): Array<{ setting: string; surface: string }> {
  const optionTable = markdown.split('\n## Identity audit')[0]!;
  return optionTable
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
