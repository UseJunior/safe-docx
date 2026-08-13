import { createHash } from 'node:crypto';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { loadRegistry } from './lib/conformance-registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const artifactManifestPath = 'spec-compliance/manifests/ecma-376-artifacts.json';
const referenceManifestPath = 'spec-compliance/manifests/ecma-376-spec-references.json';
const vocabularySeedPath = 'spec-compliance/manifests/ecma-376-vocabulary-seed.json';
const advancedRevisionManifestPath = 'spec-compliance/manifests/ecma-376-advanced-revisions.json';
const vocabularyOutputPath = 'spec-compliance/generated/ecma-376-vocabulary.json';
const reportOutputPath = 'spec-compliance/generated/ecma-376-coverage-report.md';
const typescriptOutputPath = 'packages/docx-core/src/generated/ecma-376-vocabulary.ts';

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function assertUniqueValues(records, key, label) {
  const seen = new Set();
  for (const record of records) {
    const value = record[key];
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

export function validateReferenceRegistryConsistency(reference, registryTargets, artifactByPath) {
  const artifact = artifactByPath.get(reference.sourceArtifact);
  if (!artifact) throw new Error(`${reference.id}: sourceArtifact is absent from the artifact manifest`);
  if (artifact.edition !== reference.edition || artifact.part !== reference.part) {
    throw new Error(`${reference.id}: sourceArtifact edition/part disagrees with the reference`);
  }
  if (!Array.isArray(reference.relatedRegistryIds) || reference.relatedRegistryIds.length === 0) {
    throw new Error(`${reference.id}: relatedRegistryIds must name at least one canonical registry entry`);
  }
  for (const registryId of reference.relatedRegistryIds) {
    const registryEntry = registryTargets.get(registryId);
    if (!registryEntry) throw new Error(`${reference.id}: unknown canonical registry ID ${registryId}`);
    const { edition, part, section } = registryEntry.meta;
    if (Number(edition) !== reference.edition || Number(part) !== reference.part || section !== reference.section) {
      throw new Error(`${reference.id}: ${registryId} edition/part/section disagrees with the reference`);
    }
  }
}

async function verifyArtifacts(manifest) {
  const sumsPath = path.join(root, 'spec-compliance/ecma-376/source-artifacts/SHA256SUMS');
  const sums = new Map(
    (await readFile(sumsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
        if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`);
        return [match[2], match[1]];
      })
  );

  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(path.join(root, artifact.path));
    const actual = sha256(bytes);
    const filename = path.basename(artifact.path);
    if (actual !== artifact.sha256) {
      throw new Error(`${artifact.path}: expected ${artifact.sha256}, got ${actual}`);
    }
    if (sums.get(filename) !== actual) {
      throw new Error(`${filename}: SHA256SUMS disagrees with artifact manifest`);
    }
  }
  if (sums.size !== manifest.artifacts.length) {
    throw new Error('SHA256SUMS and artifact manifest contain different artifact counts');
  }
}

async function verifyDerivedSchemas(manifest) {
  const schemaSets = [
    { part: 1, nestedArchive: 'OfficeOpenXML-XMLSchema-Strict.zip', derivedDirectory: 'strict' },
    { part: 2, nestedArchive: 'OpenPackagingConventions-XMLSchema.zip', derivedDirectory: 'opc' },
    { part: 4, nestedArchive: 'OfficeOpenXML-XMLSchema-Transitional.zip', derivedDirectory: 'transitional' },
  ];

  for (const schemaSet of schemaSets) {
    const artifact = manifest.artifacts.find((candidate) => candidate.part === schemaSet.part);
    if (!artifact) throw new Error(`No artifact manifest entry for Part ${schemaSet.part}`);
    const outer = await JSZip.loadAsync(await readFile(path.join(root, artifact.path)));
    const nestedEntry = outer.file(schemaSet.nestedArchive);
    if (!nestedEntry) throw new Error(`${artifact.path} does not contain ${schemaSet.nestedArchive}`);
    const nested = await JSZip.loadAsync(await nestedEntry.async('nodebuffer'));
    const sourceNames = Object.values(nested.files)
      .filter((entry) => !entry.dir && entry.name.endsWith('.xsd'))
      .map((entry) => path.basename(entry.name))
      .sort();
    const derivedPath = path.join(root, 'spec-compliance/ecma-376/schemas', schemaSet.derivedDirectory);
    const derivedNames = (await readdir(derivedPath)).filter((name) => name.endsWith('.xsd')).sort();
    if (JSON.stringify(sourceNames) !== JSON.stringify(derivedNames)) {
      throw new Error(`${schemaSet.derivedDirectory}: extracted XSD file set differs from ${schemaSet.nestedArchive}`);
    }
    for (const name of sourceNames) {
      const sourceEntry = nested.file(name) ?? nested.file(Object.keys(nested.files).find((entryName) => path.basename(entryName) === name));
      const sourceBytes = await sourceEntry.async('nodebuffer');
      const derivedBytes = await readFile(path.join(derivedPath, name));
      if (!sourceBytes.equals(derivedBytes)) {
        throw new Error(`${schemaSet.derivedDirectory}/${name}: bytes differ from ${schemaSet.nestedArchive}`);
      }
    }
  }
}

export function collectDeclarationLocators(node, declarationKind, declarationName, owners = [], found = new Set()) {
  if (Array.isArray(node)) {
    for (const child of node) collectDeclarationLocators(child, declarationKind, declarationName, owners, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;

  for (const [key, value] of Object.entries(node)) {
    const kindMatch = /^(?:xsd|xs):(element|attribute|complexType|simpleType|group|attributeGroup)$/.exec(key);
    if (kindMatch) {
      const declarations = Array.isArray(value) ? value : [value];
      for (const declaration of declarations) {
        if (!declaration || typeof declaration !== 'object') continue;
        const name = declaration['@_name'];
        const kind = kindMatch[1];
        if (kind === declarationKind && name === declarationName) {
          found.add([...owners, `${kind}:${name}`].join('/'));
        }
        const nextOwners = typeof name === 'string' && kind !== 'attribute'
          ? [...owners, `${kind}:${name}`]
          : owners;
        collectDeclarationLocators(declaration, declarationKind, declarationName, nextOwners, found);
      }
      continue;
    }
    collectDeclarationLocators(value, declarationKind, declarationName, owners, found);
  }
  return found;
}

async function validateManifests(artifactManifest, references, seed) {
  assertUniqueValues(artifactManifest.artifacts, 'path', 'artifact path');
  assertUniqueValues(artifactManifest.artifacts, 'part', 'artifact part');
  assertUniqueValues(references.references, 'id', 'spec-reference ID');
  assertUniqueValues(seed.entries, 'constant', 'vocabulary constant');
  const vocabularyNames = seed.entries.map((entry) => ({ key: `${entry.kind}:${entry.localName}` }));
  assertUniqueValues(vocabularyNames, 'key', 'vocabulary declaration');

  const registry = loadRegistry();
  if (registry.errors.length > 0) {
    throw new Error(`Canonical conformance registry is invalid: ${registry.errors.map((error) => error.message).join('; ')}`);
  }
  const artifactByPath = new Map(artifactManifest.artifacts.map((artifact) => [artifact.path, artifact]));
  const denominatorRegistry = new Map([
    ...registry.targets,
    ...registry.nonGoals.map((entry) => [entry.id, entry]),
  ]);
  const zipByPath = new Map();
  for (const reference of references.references) {
    validateReferenceRegistryConsistency(reference, denominatorRegistry, artifactByPath);
    const locator = /^(.+\.pdf)#(\d+(?:\.\d+)*)$/.exec(reference.locator);
    if (!locator || locator[2] !== reference.section) {
      throw new Error(`${reference.id}: locator must name its source PDF and exact section`);
    }
    let zip = zipByPath.get(reference.sourceArtifact);
    if (!zip) {
      zip = await JSZip.loadAsync(await readFile(path.join(root, reference.sourceArtifact)));
      zipByPath.set(reference.sourceArtifact, zip);
    }
    if (!zip.file(locator[1])) throw new Error(`${reference.id}: locator PDF is absent from sourceArtifact`);
  }
}

async function generateVocabulary(artifactManifest, seed) {
  const artifact = artifactManifest.artifacts.find((candidate) => candidate.part === seed.artifactPart);
  if (!artifact) throw new Error(`No artifact manifest entry for Part ${seed.artifactPart}`);

  const outer = await JSZip.loadAsync(await readFile(path.join(root, artifact.path)));
  const nestedEntry = outer.file(seed.nestedSchemaArchive);
  if (!nestedEntry) throw new Error(`${artifact.path} does not contain ${seed.nestedSchemaArchive}`);
  const nested = await JSZip.loadAsync(await nestedEntry.async('nodebuffer'));
  const schemaEntry = nested.file(seed.schemaPath);
  if (!schemaEntry) throw new Error(`${seed.nestedSchemaArchive} does not contain ${seed.schemaPath}`);
  const schemaXml = await schemaEntry.async('string');
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(schemaXml);
  const targetNamespace = parsed['xsd:schema']?.['@_targetNamespace'] ?? parsed['xs:schema']?.['@_targetNamespace'];
  if (targetNamespace !== seed.namespaceUri) {
    throw new Error(`${seed.schemaPath}: expected targetNamespace ${seed.namespaceUri}, got ${targetNamespace}`);
  }

  const entries = seed.entries.map((entry) => {
    const declarationPaths = [...collectDeclarationLocators(parsed, entry.kind, entry.localName)].sort();
    if (declarationPaths.length === 0) {
      throw new Error(`${seed.schemaPath}: missing ${entry.kind} declaration ${entry.localName}`);
    }
    return {
      constant: entry.constant,
      namespaceUri: seed.namespaceUri,
      preferredPrefix: seed.preferredPrefix,
      localName: entry.localName,
      qname: `${seed.preferredPrefix}:${entry.localName}`,
      clarkName: `{${seed.namespaceUri}}${entry.localName}`,
      kind: entry.kind,
      sourceArtifact: artifact.path,
      sourceArtifactSha256: artifact.sha256,
      sourceLocators: declarationPaths.map(
        (declarationPath) => `${seed.nestedSchemaArchive}!/${seed.schemaPath}#${declarationPath}`
      ),
    };
  });

  return {
    schemaVersion: 1,
    generatedFrom: {
      artifact: artifact.path,
      sha256: artifact.sha256,
      nestedSchemaArchive: seed.nestedSchemaArchive,
      schemaPath: seed.schemaPath,
    },
    entries,
  };
}

function generateTypescript(vocabulary) {
  const lines = [
    '// Generated by scripts/generate_ecma_376_coverage.mjs. Do not edit.',
    `// Source: ${vocabulary.generatedFrom.artifact}`,
    `// SHA-256: ${vocabulary.generatedFrom.sha256}`,
    '',
    'export interface OoxmlVocabularyEntry {',
    '  readonly namespaceUri: string;',
    '  readonly preferredPrefix: string;',
    '  readonly localName: string;',
    '  readonly qname: string;',
    '  readonly clarkName: string;',
    "  readonly kind: 'element' | 'attribute';",
    '  readonly sourceLocators: readonly string[];',
    '}',
    '',
    'export const WML = {',
  ];
  for (const entry of vocabulary.entries) {
    lines.push(`  ${entry.constant}: {`);
    for (const key of ['namespaceUri', 'preferredPrefix', 'localName', 'qname', 'clarkName', 'kind', 'sourceLocators']) {
      lines.push(`    ${key}: ${JSON.stringify(entry[key])},`);
    }
    lines.push('  },');
  }
  lines.push('} as const satisfies Record<string, OoxmlVocabularyEntry>;', '');
  return lines.join('\n');
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(fullPath));
    else if (/\.(?:ts|md)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

async function generateReport(references, vocabulary, advancedRevisions) {
  const scanRoots = ['packages/docx-core/src', 'packages/docx-compare/src'];
  const files = (await Promise.all(scanRoots.map((scanRoot) => sourceFiles(path.join(root, scanRoot))))).flat();
  const source = await Promise.all(files.map(async (file) => ({
    path: path.relative(root, file),
    text: await readFile(file, 'utf8'),
  })));

  const statusCounts = new Map();
  const allowedStatuses = new Set([
    'covered',
    'partial',
    'out-of-scope',
    'not-yet-covered',
    'implementation-note',
  ]);
  for (const reference of references.references) {
    if (!allowedStatuses.has(reference.coverageStatus)) {
      throw new Error(`${reference.id}: invalid coverage status ${reference.coverageStatus}`);
    }
    for (const relatedPath of [...reference.relatedSource, ...reference.relatedTests]) {
      await access(path.join(root, relatedPath));
    }
    statusCounts.set(reference.coverageStatus, (statusCounts.get(reference.coverageStatus) ?? 0) + 1);
    const linked = reference.relatedSource.some((relatedPath) => {
      const file = source.find((candidate) => candidate.path === relatedPath);
      return file?.text.includes(`@ooxmlSpec ${reference.id}`);
    });
    if (!linked) throw new Error(`No source @ooxmlSpec linkage for ${reference.id}`);
  }

  const usedEntries = vocabulary.entries.map((entry) => {
    const token = `WML.${entry.constant}`;
    const tokenPattern = new RegExp(`\\b${token.replace('.', '\\.')}(?![A-Z0-9_])`);
    const usedBy = source.filter((file) => tokenPattern.test(file.text)).map((file) => file.path);
    return { ...entry, usedBy };
  });
  for (const required of ['FLD_CHAR', 'INSTR_TEXT', 'DEL_INSTR_TEXT']) {
    const entry = usedEntries.find((candidate) => candidate.constant === required);
    if (!entry || entry.usedBy.length === 0) throw new Error(`Generated vocabulary constant WML.${required} is unused`);
  }

  const flattenOperationStatuses = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
    const operation = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'string' ? [[operation, child]] : flattenOperationStatuses(child, operation);
  });

  const lines = [
    '<!-- Generated by scripts/generate_ecma_376_coverage.mjs. Do not edit. -->',
    '# ECMA-376 coverage denominator report',
    '',
    `Official artifacts verified: **${new Set(references.references.map((entry) => entry.sourceArtifact)).size} referenced / 4 vendored**.`,
    `Initial spec references classified: **${references.references.length}**.`,
    `Generated vocabulary entries: **${vocabulary.entries.length}**.`,
    '',
    'This initial denominator classifies only seeded references. Unlisted ECMA-376 prose requirements remain `not-yet-covered`; this report does not claim full standard coverage.',
    '',
    '## Coverage statuses',
    '',
    '| Status | References |',
    '| --- | ---: |',
    ...[...statusCounts.entries()].sort().map(([status, count]) => `| \`${status}\` | ${count} |`),
    '',
    '## Spec references',
    '',
    '| ID | Part / locator | Status | Source links |',
    '| --- | --- | --- | --- |',
    ...references.references.map((entry) => `| \`${entry.id}\` | Part ${entry.part}, ${entry.locator} | \`${entry.coverageStatus}\` | ${entry.relatedSource.length} source / ${entry.relatedTests.length} tests |`),
    '',
    '## Advanced revision records',
    '',
    'This operation-specific matrix distinguishes semantic implementation from preservation, known gaps, and non-goals. Independent release-verifier evidence is recorded separately and does not establish these implementation claims.',
    '',
    '| Record | Classification | Operations |',
    '| --- | --- | --- |',
    ...advancedRevisions.records.map((entry) => `| \`${entry.id}\` | \`${entry.classification}\` | ${flattenOperationStatuses(entry.operations).map(([operation, status]) => `${operation}=\`${status}\``).join('<br>')} |`),
    '',
    '## Generated vocabulary use',
    '',
    '| Constant | QName | Kind | Source use |',
    '| --- | --- | --- | --- |',
    ...usedEntries.map((entry) => `| \`WML.${entry.constant}\` | \`${entry.qname}\` | ${entry.kind} | ${entry.usedBy.length > 0 ? entry.usedBy.map((file) => `\`${file}\``).join('<br>') : 'Not yet migrated'} |`),
    '',
    'The field-fragmentation path uses `WML.FLD_CHAR`, `WML.INSTR_TEXT`, and `WML.DEL_INSTR_TEXT`; the remaining generated entries are validated migration targets.',
    '',
  ];
  return lines.join('\n');
}

async function emit(relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  if (checkOnly) {
    let existing;
    try {
      existing = await readFile(absolutePath, 'utf8');
    } catch {
      throw new Error(`${relativePath} is missing; run npm run generate:ecma-376-coverage`);
    }
    if (existing !== content) {
      throw new Error(`${relativePath} is stale; run npm run generate:ecma-376-coverage`);
    }
    return;
  }
  await writeFile(absolutePath, content);
}

export async function main() {
  const artifacts = await readJson(artifactManifestPath);
  const references = await readJson(referenceManifestPath);
  const seed = await readJson(vocabularySeedPath);
  const advancedRevisions = await readJson(advancedRevisionManifestPath);
  await validateManifests(artifacts, references, seed);
  await verifyArtifacts(artifacts);
  await verifyDerivedSchemas(artifacts);
  const vocabulary = await generateVocabulary(artifacts, seed);
  await emit(vocabularyOutputPath, stableJson(vocabulary));
  await emit(typescriptOutputPath, generateTypescript(vocabulary));
  await emit(reportOutputPath, await generateReport(references, vocabulary, advancedRevisions));
  console.log(`${checkOnly ? 'Verified' : 'Generated'} ECMA-376 artifacts, ${references.references.length} references, and ${vocabulary.entries.length} vocabulary entries.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
