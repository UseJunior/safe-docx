#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import Ajv2020 from 'ajv/dist/2020.js';
import { loadRegistry } from './lib/conformance-registry.mjs';

const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = {
  schema: 'spec-compliance/conformance-explorer.schema.json',
  projection: 'spec-compliance/capabilities/safe-docx-projection.json',
  neutralPin: 'spec-compliance/capabilities/upstream-pin.json',
  mappings: 'spec-compliance/capabilities/upstream/scenario-capabilities.json',
  output: 'spec-compliance/generated/conformance-explorer.json',
};
const POSITIVE_STATUSES = new Set(['supported', 'partial', 'preservation-only']);

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseSchemaRef(schemaRef) {
  const match = /^(.+?\.xsd)#(element|type|attribute):(.+)$/.exec(schemaRef);
  assert(match, `bad schemaRef syntax: ${schemaRef}`);
  return { schemaPath: match[1], kind: match[2], name: match[3] };
}

function conformanceClass(schemaPath) {
  if (schemaPath.includes('/strict/')) return 'strict';
  if (schemaPath.includes('/transitional/')) return 'transitional';
  if (schemaPath.includes('/opc/')) return 'opc';
  return 'other';
}

function xsdKind(localName) {
  if (localName === 'element') return 'element';
  if (localName === 'attribute') return 'attribute';
  if (localName === 'complexType' || localName === 'simpleType') return 'type';
  return null;
}

function namedSegment(node) {
  const kind = xsdKind(node.localName) ?? node.localName;
  const name = node.getAttribute?.('name') || node.getAttribute?.('ref');
  return name ? `${kind}:${name}` : kind;
}

function declarationContext(node) {
  const segments = [];
  let current = node;
  while (current?.nodeType === 1) {
    if (current.namespaceURI === XSD_NS) segments.push(namedSegment(current));
    current = current.parentNode;
  }
  return segments.reverse().join('/');
}

function optionalAttribute(target, node, sourceName, targetName = sourceName) {
  const value = node.getAttribute(sourceName);
  if (value) target[targetName] = value;
}

export function resolveSchemaDeclaration(schemaRef, root = REPO_ROOT) {
  const { schemaPath, kind, name } = parseSchemaRef(schemaRef);
  const absolute = path.resolve(root, schemaPath);
  assert(
    absolute.startsWith(`${path.resolve(root)}${path.sep}`),
    `schemaRef path escapes repository: ${schemaPath}`
  );
  assert(fs.existsSync(absolute), `schemaRef path not found: ${schemaPath}`);
  // The official OPC relationship schema is UTF-8 with a leading BOM. xmldom
  // treats that decoded U+FEFF as content before the XML declaration, so
  // normalize only the transport marker before parsing the vendored bytes.
  const xmlSource = fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/u, '');
  const document = new DOMParser().parseFromString(xmlSource, 'application/xml');
  const schema = document.documentElement;
  assert(schema?.namespaceURI === XSD_NS && schema.localName === 'schema', `not an XSD schema: ${schemaPath}`);
  const targetNamespace = schema.getAttribute('targetNamespace');
  assert(targetNamespace, `XSD has no targetNamespace: ${schemaPath}`);
  const occurrences = [];
  const candidates = kind === 'type'
    ? [...document.getElementsByTagNameNS(XSD_NS, 'complexType'), ...document.getElementsByTagNameNS(XSD_NS, 'simpleType')]
    : [...document.getElementsByTagNameNS(XSD_NS, kind)];
  for (const candidate of candidates) {
    if (candidate.getAttribute('name') !== name) continue;
    const occurrence = { contextPath: declarationContext(candidate) };
    optionalAttribute(occurrence, candidate, 'type', 'declaredType');
    optionalAttribute(occurrence, candidate, 'ref');
    optionalAttribute(occurrence, candidate, 'use');
    optionalAttribute(occurrence, candidate, 'minOccurs');
    optionalAttribute(occurrence, candidate, 'maxOccurs');
    occurrences.push(occurrence);
  }
  assert(occurrences.length > 0, `schemaRef target not found: ${kind}:${name} in ${schemaPath}`);
  occurrences.sort((a, b) => a.contextPath.localeCompare(b.contextPath));
  return {
    id: schemaRef,
    schemaPath,
    conformanceClass: conformanceClass(schemaPath),
    targetNamespace,
    kind,
    name,
    occurrences,
  };
}

function classifyEvidencePath(relativePath) {
  if (relativePath.startsWith('verification/')) return 'formal-verification';
  if (relativePath.startsWith('spec-compliance/evidence/')) return 'generated-evidence';
  if (relativePath.startsWith('spec-compliance/registry/')) return 'registry';
  if (relativePath.endsWith('.md')) return 'documentation';
  if (/\.test\.[cm]?[jt]sx?$/.test(relativePath) || relativePath.includes('/__tests__/')) return 'test';
  return 'source';
}

function evidenceForEntry(entry, root) {
  const values = (entry.meta.verifiedBy ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.map((relativePath) => {
    const absolute = path.resolve(root, relativePath);
    assert(
      absolute.startsWith(`${path.resolve(root)}${path.sep}`),
      `${entry.id}: evidence path escapes repository: ${relativePath}`
    );
    assert(fs.existsSync(absolute), `${entry.id}: evidence path not found: ${relativePath}`);
    return { kind: classifyEvidencePath(relativePath), path: relativePath };
  });
}

function sectionRecord(entry, classification, root) {
  const edition = Number(entry.meta.edition);
  const part = Number(entry.meta.part);
  assert(Number.isInteger(edition) && edition > 0, `${entry.id}: invalid edition`);
  assert(Number.isInteger(part) && part > 0, `${entry.id}: invalid part`);
  assert(/^[0-9]+(?:\.[0-9]+)*$/.test(entry.meta.section ?? ''), `${entry.id}: invalid section`);
  assert(entry.meta.url, `${entry.id}: missing canonical URL`);
  assert(entry.meta.schemaRef, `${entry.id}: missing schemaRef`);
  const claimRationale = entry.prose.join('\n').trim();
  assert(claimRationale, `${entry.id}: missing claim rationale`);
  return {
    id: entry.id,
    title: entry.title,
    classification,
    citation: {
      standard: 'ECMA-376',
      edition,
      part,
      section: entry.meta.section,
    },
    canonicalUrl: entry.meta.url,
    schemaRef: entry.meta.schemaRef,
    claimRationale,
    evidence: classification === 'targeted' ? evidenceForEntry(entry, root) : [],
  };
}

function pairKey(capabilityId, axis) {
  return `${capabilityId}\u0000${axis}`;
}

function mappedScenarios(mappings) {
  const byPair = new Map();
  for (const mapping of mappings.mappings) {
    const key = pairKey(mapping.capabilityId, mapping.axis);
    if (!byPair.has(key)) byPair.set(key, new Set());
    byPair.get(key).add(mapping.scenarioId);
  }
  return byPair;
}

function capabilityClaimRecord(claim, scenarios, root) {
  for (const evidence of claim.evidence) {
    const absolute = path.resolve(root, evidence.path);
    assert(
      absolute.startsWith(`${path.resolve(root)}${path.sep}`),
      `${claim.capabilityId}/${claim.axis}: evidence path escapes repository`
    );
    assert(fs.existsSync(absolute), `${claim.capabilityId}/${claim.axis}: evidence path not found`);
  }
  if (POSITIVE_STATUSES.has(claim.status)) {
    assert(claim.evidence.length > 0, `${claim.capabilityId}/${claim.axis}: positive claim has no evidence`);
  } else {
    assert(claim.evidence.length === 0, `${claim.capabilityId}/${claim.axis}: non-positive claim carries evidence`);
  }
  return {
    capabilityId: claim.capabilityId,
    axis: claim.axis,
    status: claim.status,
    implementationVersion: claim.implementationVersion,
    lastVerifiedCommit: claim.lastVerifiedCommit,
    scope: claim.scope,
    rationale: claim.rationale,
    evidence: claim.evidence,
    mappedScenarioIds: [...(scenarios.get(pairKey(claim.capabilityId, claim.axis)) ?? [])].sort(),
  };
}

export function buildManifest({ registry, projection, neutralPin, mappings }, root = REPO_ROOT) {
  assert((registry.errors ?? []).length === 0, `registry errors: ${JSON.stringify(registry.errors)}`);
  const sections = [
    ...registry.entries.map((entry) => sectionRecord(entry, 'targeted', root)),
    ...registry.nonGoals.map((entry) => sectionRecord(entry, 'non-goal', root)),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const schemaRefs = [...new Set(sections.map((section) => section.schemaRef))].sort();
  const scenarios = mappedScenarios(mappings);
  const capabilityClaims = projection.claims
    .map((claim) => capabilityClaimRecord(claim, scenarios, root))
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId) || a.axis.localeCompare(b.axis));
  return {
    contract: 'safe-docx-conformance-explorer/v1',
    product: { id: 'safe-docx', name: 'Safe DOCX' },
    sources: {
      registries: [...registry.sources].sort(),
      neutralProjection: {
        repository: neutralPin.repository,
        commit: neutralPin.commit,
        registryVersion: neutralPin.registryVersion,
        profileId: neutralPin.profileId,
      },
    },
    sections,
    schemaDeclarations: schemaRefs.map((schemaRef) => resolveSchemaDeclaration(schemaRef, root)),
    capabilityClaims,
  };
}

function assertUnique(values, label) {
  assert(new Set(values).size === values.length, `duplicate ${label}`);
}

export function validateManifestSemantics(manifest, inputs, root = REPO_ROOT) {
  const { registry, projection, mappings } = inputs;
  assertUnique(manifest.sections.map((section) => section.id), 'section ID');
  const expectedSections = new Map([
    ...registry.entries.map((entry) => [entry.id, sectionRecord(entry, 'targeted', root)]),
    ...registry.nonGoals.map((entry) => [entry.id, sectionRecord(entry, 'non-goal', root)]),
  ]);
  assert(manifest.sections.length === expectedSections.size, 'section inventory length mismatch');
  for (const section of manifest.sections) {
    assertUnique(
      section.evidence.map((item) => `${item.kind}\u0000${item.path}`),
      `${section.id} evidence identity`
    );
    const expected = expectedSections.get(section.id);
    assert(expected, `${section.id}: unknown section`);
    assert.deepEqual(section, expected, `${section.id}: section source drift`);
  }

  assertUnique(manifest.schemaDeclarations.map((declaration) => declaration.id), 'schema declaration ID');
  const declarationIds = new Set(manifest.schemaDeclarations.map((declaration) => declaration.id));
  const expectedDeclarationIds = new Set(manifest.sections.map((section) => section.schemaRef));
  assert.deepEqual(declarationIds, expectedDeclarationIds, 'schema declaration inventory drift');
  for (const declaration of manifest.schemaDeclarations) {
    assert.deepEqual(
      declaration,
      resolveSchemaDeclaration(declaration.id, root),
      `${declaration.id}: schema declaration drift`
    );
    assert(declaration.occurrences.length > 0, `${declaration.id}: declaration has no occurrence`);
    assertUnique(declaration.occurrences.map((item) => item.contextPath), `${declaration.id} context path`);
  }

  assertUnique(
    manifest.capabilityClaims.map((claim) => pairKey(claim.capabilityId, claim.axis)),
    'capability/axis pair'
  );
  const expectedClaims = new Map(
    projection.claims.map((claim) => [pairKey(claim.capabilityId, claim.axis), claim])
  );
  assert(manifest.capabilityClaims.length === expectedClaims.size, 'capability claim inventory length mismatch');
  const scenarios = mappedScenarios(mappings);
  for (const claim of manifest.capabilityClaims) {
    const key = pairKey(claim.capabilityId, claim.axis);
    const source = expectedClaims.get(key);
    assert(source, `${claim.capabilityId}/${claim.axis}: unknown capability claim`);
    assertUnique(
      claim.evidence.map((item) => [
        item.kind,
        item.evidenceClass,
        item.path,
        item.implementationVersion,
        item.lastVerifiedCommit,
      ].join('\u0000')),
      `${claim.capabilityId}/${claim.axis} evidence identity`
    );
    assert.deepEqual(
      claim,
      capabilityClaimRecord(source, scenarios, root),
      `${claim.capabilityId}/${claim.axis}: capability source or scenario mapping drift`
    );
    if (POSITIVE_STATUSES.has(claim.status)) {
      assert(claim.evidence.length > 0, `${claim.capabilityId}/${claim.axis}: positive claim has no evidence`);
    } else {
      assert(claim.evidence.length === 0, `${claim.capabilityId}/${claim.axis}: non-positive claim carries evidence`);
    }
  }
}

export function validateAgainstSchema(manifest, schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  assert(validate(manifest), `conformance explorer schema validation failed: ${ajv.errorsText(validate.errors)}`);
}

export function loadInputs(root = REPO_ROOT) {
  return {
    registry: loadRegistry(),
    projection: readJson(root, PATHS.projection),
    neutralPin: readJson(root, PATHS.neutralPin),
    mappings: readJson(root, PATHS.mappings),
  };
}

export function generateManifest(root = REPO_ROOT) {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  validateAgainstSchema(manifest, readJson(root, PATHS.schema));
  validateManifestSemantics(manifest, inputs, root);
  return manifest;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const manifest = generateManifest(REPO_ROOT);
  const content = stableJson(manifest);
  const output = path.join(REPO_ROOT, PATHS.output);
  if (checkOnly) {
    const existing = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
    assert(existing === content, `${PATHS.output} is stale; run npm run generate:conformance-explorer`);
  } else {
    fs.writeFileSync(output, content);
  }
  console.log(
    `conformance explorer valid: ${manifest.sections.length} sections, `
    + `${manifest.schemaDeclarations.length} declarations, `
    + `${manifest.capabilityClaims.length} capability claims`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
