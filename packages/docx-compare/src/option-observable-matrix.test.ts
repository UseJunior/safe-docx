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
  const declarations = sourceFile.statements.filter(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  if (declarations.length !== 1) {
    throw new Error(`Expected one exported interface ${interfaceName}, found ${declarations.length}`);
  }
  const declaration = declarations[0]!;
  if (declaration.heritageClauses?.length) {
    throw new Error(`Unsupported inherited option interface ${interfaceName}`);
  }
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

function stringArrayConstant(source: string, constantName: string): string[] {
  const sourceFile = ts.createSourceFile(
    `${constantName}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => Array.from(statement.declarationList.declarations))
    .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === constantName);
  if (declarations.length !== 1) {
    throw new Error(`Expected one array constant ${constantName}, found ${declarations.length}`);
  }
  let initializer = declarations[0]!.initializer;
  while (initializer && (
    ts.isAsExpression(initializer) ||
    ts.isSatisfiesExpression(initializer) ||
    ts.isParenthesizedExpression(initializer)
  )) {
    initializer = initializer.expression;
  }
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new Error(`Expected ${constantName} to be an array literal`);
  }
  return initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element)) {
      throw new Error(`Expected ${constantName} to contain only string literals`);
    }
    return element.text;
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

function documentedSettings(
  rows: Array<{ setting: string; surface: string }>,
  surface: 'Public' | 'low-level',
): string[] {
  return Array.from(new Set(
    rows
      .filter((row) => row.surface.toLowerCase().includes(surface.toLowerCase()))
      .flatMap((row) => Array.from(row.setting.matchAll(/`([^`]+)`/g)))
      .map((match) => match[1]!),
  )).sort();
}

describe('tagged option-to-observable matrix freshness', () => {
  test('tracks the current public and low-level option interfaces', () => {
    const markdown = readFileSync(matrixPath, 'utf8');
    const rows = matrixRows(markdown);
    const compareTypes = readFileSync(resolve(sourceDirectory, 'compare-types.ts'), 'utf8');
    const pipeline = readFileSync(resolve(sourceDirectory, 'tagged/pipeline.ts'), 'utf8');
    const coreTypes = readFileSync(
      resolve(packageDirectory, '../docx-core/src/core-types.ts'),
      'utf8',
    );
    const numberingIntegration = readFileSync(
      resolve(sourceDirectory, 'tagged/numberingIntegration.ts'),
      'utf8',
    );
    const nestedLowLevelOptions = new Map<string, string[]>([
      ['moveDetection', interfaceProperties(coreTypes, 'MoveDetectionSettings')],
      ['formatDetection', interfaceProperties(coreTypes, 'FormatDetectionSettings')],
      ['numbering', interfaceProperties(numberingIntegration, 'NumberingIntegrationOptions')],
    ]);
    const lowLevelSettings = interfaceProperties(pipeline, 'AtomizerOptions')
      .flatMap((property) => {
        const nested = nestedLowLevelOptions.get(property);
        return nested ? nested.map((name) => `${property}.${name}`) : [property];
      })
      .sort();
    const settingsByRow = rows.flatMap((row) =>
      Array.from(row.setting.matchAll(/`([^`]+)`/g), (match) => match[1]!),
    );

    expect(settingsByRow).toHaveLength(new Set(settingsByRow).size);
    expect(documentedSettings(rows, 'Public')).toEqual(
      interfaceProperties(compareTypes, 'CompareOptions'),
    );
    expect(documentedSettings(rows, 'low-level')).toEqual(lowLevelSettings);
  });

  test('contains no retired selector or migration-phase promises', () => {
    const markdown = readFileSync(matrixPath, 'utf8');
    const documentedSettings = matrixRows(markdown)
      .map((row) => row.setting)
      .join('\n');
    const publicFacade = readFileSync(resolve(sourceDirectory, 'index.ts'), 'utf8');
    for (const retiredSelector of stringArrayConstant(
      publicFacade,
      'REMOVED_COMPARISON_OPTIONS',
    )) {
      expect(documentedSettings).not.toContain(`\`${retiredSelector}\``);
    }
    expect(markdown).not.toMatch(/Phase \d|Scheduled removal|legacy/i);
  });

  test('ties result metadata and disabled-formatting claims to current implementation', () => {
    const markdown = readFileSync(matrixPath, 'utf8');
    const compareTypes = readFileSync(resolve(sourceDirectory, 'compare-types.ts'), 'utf8');
    const pipeline = readFileSync(resolve(sourceDirectory, 'tagged/pipeline.ts'), 'utf8');
    const removalPolicy = JSON.parse(
      readFileSync(resolve(packageDirectory, 'api-removal-policy.json'), 'utf8'),
    ) as {
      publicResultFields: Record<string, string[]>;
    };
    const activeResultFields = [
      ...removalPolicy.publicResultFields['stable compatibility']!,
      ...removalPolicy.publicResultFields['truthful tagged replacement']!,
    ].sort();

    expect(markdown).toContain("Successful stable results report `engine: 'tagged-tree'`");
    expect(interfaceProperties(compareTypes, 'CompareResult')).toEqual(activeResultFields);
    expect(compareTypes).toContain("engine: 'tagged-tree';");
    expect(markdown).toContain('revised/Accept formatting projection');
    expect(pipeline).toContain(': formattingFidelity.accept.score === 1;');
    expect(pipeline).not.toContain('!options.formatDetection.detectFormatChanges ||');
  });

  test('links only to durable repository records', () => {
    const markdown = readFileSync(matrixPath, 'utf8');
    const links = Array.from(markdown.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g))
      .map((match) => match[1]!);

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(existsSync(resolve(packageDirectory, link)), link).toBe(true);
    }

    const evidencePaths = Array.from(
      markdown.matchAll(/`([^`\s]*\/[^`\s]+?\.test\.ts)`/g),
      (match) => match[1]!,
    );
    expect(evidencePaths.length).toBeGreaterThan(0);
    for (const evidencePath of evidencePaths) {
      expect(existsSync(resolve(packageDirectory, evidencePath)), evidencePath).toBe(true);
    }
  });
});
