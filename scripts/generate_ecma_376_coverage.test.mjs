import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertUniqueValues,
  collectDeclarationLocators,
  validateReferenceRegistryConsistency,
} from './generate_ecma_376_coverage.mjs';

test('rejects duplicate stable IDs and vocabulary constants', () => {
  assert.throws(
    () => assertUniqueValues([{ id: 'same' }, { id: 'same' }], 'id', 'spec-reference ID'),
    /Duplicate spec-reference ID: same/
  );
  assert.throws(
    () => assertUniqueValues([{ constant: 'FLD_CHAR' }, { constant: 'FLD_CHAR' }], 'constant', 'vocabulary constant'),
    /Duplicate vocabulary constant: FLD_CHAR/
  );
});

test('requires manifest references to agree with canonical registry metadata', () => {
  const registry = new Map([[
    'ECMA-PART1-17-16-13',
    { meta: { edition: '5', part: '1', section: '17.16.13' } },
  ]]);
  const artifacts = new Map([[
    'part1.zip',
    { edition: 5, part: 1 },
  ]]);
  const valid = {
    id: 'deleted-field-code',
    edition: 5,
    part: 1,
    section: '17.16.13',
    sourceArtifact: 'part1.zip',
    relatedRegistryIds: ['ECMA-PART1-17-16-13'],
  };

  assert.doesNotThrow(() => validateReferenceRegistryConsistency(valid, registry, artifacts));
  assert.throws(
    () => validateReferenceRegistryConsistency({ ...valid, section: '17.16.5' }, registry, artifacts),
    /edition\/part\/section disagrees/
  );
  assert.throws(
    () => validateReferenceRegistryConsistency({ ...valid, sourceArtifact: 'missing.zip' }, registry, artifacts),
    /sourceArtifact is absent/
  );
});

test('records every owning declaration path for ambiguous XSD names', () => {
  const parsed = {
    'xsd:schema': {
      'xsd:complexType': [
        { '@_name': 'CT_First', 'xsd:attribute': { '@_name': 'id' } },
        { '@_name': 'CT_Second', 'xsd:attribute': { '@_name': 'id' } },
      ],
    },
  };

  assert.deepEqual(
    [...collectDeclarationLocators(parsed, 'attribute', 'id')].sort(),
    ['complexType:CT_First/attribute:id', 'complexType:CT_Second/attribute:id']
  );
});
