import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildManifest,
  generateManifest,
  loadInputs,
  resolveSchemaDeclaration,
  stableJson,
  validateAgainstSchema,
  validateManifestSemantics,
} from './generate_conformance_explorer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function clone(value) {
  return structuredClone(value);
}

test('the committed sources generate a schema-valid deterministic v1 manifest', () => {
  const inputs = loadInputs(root);
  const first = generateManifest(root);
  const second = generateManifest(root);
  assert.equal(stableJson(first), stableJson(second));
  assert.equal(first.contract, 'safe-docx-conformance-explorer/v1');
  assert.equal(first.sections.length, inputs.registry.entries.length + inputs.registry.nonGoals.length);
  assert.equal(first.capabilityClaims.length, inputs.projection.claims.length);
});

test('the v1 schema fixture covers every capability status', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'spec-compliance/conformance-explorer.schema.json'), 'utf8'));
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'spec-compliance/fixtures/conformance-explorer-v1.json'), 'utf8'));
  validateAgainstSchema(fixture, schema);
  assert.deepEqual(
    [...new Set(fixture.capabilityClaims.map((claim) => claim.status))].sort(),
    ['gap', 'non-goal', 'partial', 'preservation-only', 'supported', 'untested']
  );
});

test('the v1 schema rejects malformed status values', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'spec-compliance/conformance-explorer.schema.json'), 'utf8'));
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'spec-compliance/fixtures/conformance-explorer-v1.json'), 'utf8'));
  fixture.capabilityClaims[0].status = 'probably-supported';
  assert.throws(() => validateAgainstSchema(fixture, schema), /schema validation failed/);
});

test('schema declaration resolution preserves reused local-name contexts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-docx-explorer-'));
  const relative = 'spec-compliance/ecma-376/schemas/transitional/reused.xsd';
  const absolute = path.join(temp, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `<?xml version="1.0"?>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:test">
      <xs:complexType name="CT_One"><xs:sequence><xs:element name="item" type="xs:string"/></xs:sequence></xs:complexType>
      <xs:complexType name="CT_Two"><xs:sequence><xs:element name="item" type="xs:integer"/></xs:sequence></xs:complexType>
    </xs:schema>`);
  const declaration = resolveSchemaDeclaration(`${relative}#element:item`, temp);
  assert.equal(declaration.occurrences.length, 2);
  assert.notEqual(declaration.occurrences[0].contextPath, declaration.occurrences[1].contextPath);
  assert.deepEqual(declaration.occurrences.map((item) => item.declaredType).sort(), ['xs:integer', 'xs:string']);
});

test('an unresolved schema declaration is rejected', () => {
  assert.throws(
    () => resolveSchemaDeclaration(
      'spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:notReal',
      root
    ),
    /schemaRef target not found/
  );
});

test('duplicate section identities are rejected', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  manifest.sections.push(clone(manifest.sections[0]));
  assert.throws(() => validateManifestSemantics(manifest, inputs), /duplicate section ID/);
});

test('missing section identities are rejected', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  manifest.sections.pop();
  assert.throws(() => validateManifestSemantics(manifest, inputs), /section inventory length mismatch/);
});

test('duplicate schema declaration identities are rejected', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  manifest.schemaDeclarations.push(clone(manifest.schemaDeclarations[0]));
  assert.throws(() => validateManifestSemantics(manifest, inputs), /duplicate schema declaration ID/);
});

test('duplicate capability-axis claims are rejected', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  manifest.capabilityClaims.push(clone(manifest.capabilityClaims[0]));
  assert.throws(() => validateManifestSemantics(manifest, inputs), /duplicate capability\/axis pair/);
});

test('unknown capability-axis claims are rejected', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  manifest.capabilityClaims[0].capabilityId = 'word.fabricated.capability';
  assert.throws(() => validateManifestSemantics(manifest, inputs), /unknown capability claim/);
});

test('scenario mapping drift is rejected', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  const claim = manifest.capabilityClaims.find((candidate) => candidate.mappedScenarioIds.length > 0);
  claim.mappedScenarioIds.push('fabricatedScenario');
  assert.throws(() => validateManifestSemantics(manifest, inputs), /capability source or scenario mapping drift/);
});

test('duplicate evidence identities are rejected', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  const claim = manifest.capabilityClaims.find((candidate) => candidate.evidence.length > 0);
  claim.evidence.push(clone(claim.evidence[0]));
  assert.throws(
    () => validateManifestSemantics(manifest, inputs),
    /duplicate .* evidence identity/
  );
});

test('non-positive claims cannot retain evidence', () => {
  const inputs = loadInputs(root);
  const manifest = buildManifest(inputs, root);
  const claim = manifest.capabilityClaims.find((candidate) => candidate.status === 'untested');
  claim.evidence.push({
    kind: 'neutral-result',
    evidenceClass: 'normative-behavioral-scenario',
    path: 'spec-compliance/capabilities/upstream/capability-summary.json',
    implementationVersion: '0.15.0',
    lastVerifiedCommit: '459051c072da16cf02d8406c439d81281d382f00',
  });
  assert.throws(() => validateManifestSemantics(manifest, inputs), /non-positive claim carries evidence/);
});

test('evidence paths cannot escape the repository', () => {
  const inputs = loadInputs(root);
  const entry = inputs.registry.entries.find((candidate) => candidate.meta.verifiedBy);
  entry.meta.verifiedBy = '../outside.ts';
  assert.throws(() => buildManifest(inputs, root), /evidence path escapes repository/);
});

test('unresolved evidence paths are rejected', () => {
  const inputs = loadInputs(root);
  const claim = inputs.projection.claims.find((candidate) => candidate.evidence.length > 0);
  claim.evidence[0].path = 'spec-compliance/evidence/not-present.json';
  assert.throws(() => buildManifest(inputs, root), /evidence path not found/);
});
