#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ledgerPath = join(root, 'verification/registry/lean-xml-checker-coverage.json');
const leanPath = join(root, 'verification/lean/Tier2/XmlTripleChecker.lean');

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const lean = readFileSync(leanPath, 'utf8');

const errors = [];

function requireArray(path, value) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
}

requireArray('parsedWordprocessingML.elements', ledger.parsedWordprocessingML?.elements);
requireArray('checkedProperties', ledger.checkedProperties);
requireArray('knownUncheckedAreas', ledger.knownUncheckedAreas);

for (const element of ledger.parsedWordprocessingML?.elements ?? []) {
  const leanName = element.replace(/^w:/, 'w:');
  if (!lean.includes(`"${leanName}"`)) {
    errors.push(`ledger element ${element} is not referenced by XmlTripleChecker.lean`);
  }
}

for (const value of ledger.parsedWordprocessingML?.attributeValues?.['w:fldCharType'] ?? []) {
  const raw = `w:fldCharType="${value}"`;
  const escaped = `w:fldCharType=\\"${value}\\"`;
  if (!lean.includes(raw) && !lean.includes(escaped)) {
    errors.push(`ledger fldCharType value ${value} is not referenced by XmlTripleChecker.lean`);
  }
}

for (const entity of ledger.parsedWordprocessingML?.xmlEntitiesDecoded ?? []) {
  if (!lean.includes(`"${entity}"`)) {
    errors.push(`ledger XML entity ${entity} is not decoded by XmlTripleChecker.lean`);
  }
}

if (!ledger.scope?.reconstructionModes?.covered?.includes('inplace')) {
  errors.push('ledger must mark inplace as covered');
}
if (!ledger.scope?.reconstructionModes?.outOfScope?.includes('rebuild')) {
  errors.push('ledger must mark rebuild as out of scope');
}

if (errors.length > 0) {
  console.error('Lean XML checker coverage ledger drift detected:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Lean XML checker coverage ledger is consistent with XmlTripleChecker.lean');
