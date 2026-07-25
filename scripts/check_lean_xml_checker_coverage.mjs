#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ledgerPath = join(root, 'verification/registry/lean-xml-checker-coverage.json');
const leanPath = join(root, 'verification/lean/Tier2/XmlTripleChecker.lean');
const selectorPath = join(root, 'verification/lean/Tier2/RelationshipStorySelector.lean');
const executablePath = join(root, 'verification/lean/LeanDocxChecker.lean');
const maximumShapePath = join(root, 'verification/lean/ProtocolV4MaximumShape.lean');
const decoderPath = join(root, 'packages/docx-compare/src/baselines/atomizer/leanXmlVerifier.ts');

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const lean = readFileSync(leanPath, 'utf8');
const selector = readFileSync(selectorPath, 'utf8');
const executable = readFileSync(executablePath, 'utf8');
const maximumShape = readFileSync(maximumShapePath, 'utf8');
const decoder = readFileSync(decoderPath, 'utf8');

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
  const localName = element.replace(/^w:/, '');
  if (!lean.includes(`localName == "${localName}"`) &&
      !selector.includes(`localName == "${localName}"`)) {
    errors.push(`ledger element ${element} is not referenced by the Lean parser or selector`);
  }
}

for (const value of ledger.parsedWordprocessingML?.attributeValues?.['w:fldCharType'] ?? []) {
  if (!lean.includes(`tagAttribute attributes "w:fldCharType" == "${value}"`)) {
    errors.push(`ledger fldCharType value ${value} is not referenced by XmlTripleChecker.lean`);
  }
}

const namedEntityPatterns = {
  '&lt;': "| ['l', 't']",
  '&gt;': "| ['g', 't']",
  '&quot;': "| ['q', 'u', 'o', 't']",
  '&apos;': "| ['a', 'p', 'o', 's']",
  '&amp;': "| ['a', 'm', 'p']",
};
for (const entity of ledger.parsedWordprocessingML?.xmlEntitiesDecoded ?? []) {
  if (!namedEntityPatterns[entity] || !lean.includes(namedEntityPatterns[entity])) {
    errors.push(`ledger XML entity ${entity} is not decoded by XmlTripleChecker.lean`);
  }
}

const numericReferences = ledger.parsedWordprocessingML?.numericCharacterReferencesDecoded ?? [];
if (!numericReferences.includes('decimal') || !lean.includes('malformed decimal XML reference')) {
  errors.push('ledger and Lean checker must cover decimal XML numeric character references');
}
if (!numericReferences.includes('hexadecimal') || !lean.includes('malformed hexadecimal XML reference')) {
  errors.push('ledger and Lean checker must cover hexadecimal XML numeric character references');
}
for (const required of ['isLegalXmlChar', 'duplicate XML attribute name',
  'duplicate XML attribute expanded name', '.afterValue =>', 'parseQName',
  'isValidNcName', 'validateNamespaceDeclaration', 'parseXmlDeclaration',
  'ExpandedXmlAttribute', 'expandOrdinaryAttributes', 'canonicalizeAttributes',
  'resolveAttributeQName', 'validateUniqueExpandedAttributes', 'isUtf8Encoding',
  'stripLeadingUtf8Bom', 'decodeXmlAttributeValueAux',
  'decodeXmlAttributeValue value', "| '\\r' :: '\\n' :: rest",
  'let decodedPayload ← decodeXmlText payload',
  'non-whitespace content outside the XML root',
  'processing instructions are outside the accepted XML subset']) {
  if (!lean.includes(required)) {
    errors.push(`fail-closed XML attribute parser coverage requires ${required}`);
  }
}

if (!ledger.scope?.reconstructionModes?.covered?.includes('inplace')) {
  errors.push('ledger must mark inplace as covered');
}
if (!ledger.scope?.reconstructionModes?.outOfScope?.includes('rebuild')) {
  errors.push('ledger must mark rebuild as out of scope');
}

if (ledger.protocolVersion !== 4 || !executable.includes('protocolVersion != 4')) {
  errors.push('ledger and Lean executable must agree on protocol version 4');
}
if (!executable.includes('String.fromUTF8?')) {
  errors.push('accepted XML subset requires strict UTF-8 package-part decoding');
}
for (const required of [
  'relationshipMetadataPlan',
  'maxCumulativeCompressedBytes',
  'maxCumulativeExpandedBytes',
  'loadOptionalStories packages usage selectedAggregateStopped',
]) {
  if (!executable.includes(required)) {
    errors.push(`canonical resource admission requires ${required}`);
  }
}
if (executable.indexOf('let metadataPlan := relationshipMetadataPlan') >
    executable.indexOf('let optional ← loadOptionalStories')) {
  errors.push('relationship metadata/work must precede optional-story loading');
}
for (const required of [
  'parseXmlEventsForRootBounded',
  'parseXmlEventsForRootBoundedTyped',
  'XmlEventParseFailureKind',
  'completedEvents',
  'observedEvents',
  'tokensFromXmlEvents',
]) {
  if (!lean.includes(required) || !executable.includes(required)) {
    if (!lean.includes(required) ||
        (['parseXmlEventsForRootBoundedTyped', 'tokensFromXmlEvents'].includes(required) &&
          !executable.includes(required))) {
      errors.push(`incrementally bounded XML tokenization requires ${required}`);
    }
  }
}
if (!executable.includes('failure.kind == .eventLimit && remaining <= maxXmlEventsPerPart') ||
    executable.includes('detail.contains "event limit" && remaining')) {
  errors.push('event-limit classification must be typed and aggregate-inclusive at equality');
}
if (ledger.limits?.uniqueSelectedPartsPerSide !== 256 ||
    ledger.limits?.cumulativeCompressedXmlBytesPerSide !== 16 * 1024 * 1024 ||
    ledger.limits?.cumulativeExpandedXmlBytesPerSide !== 32 * 1024 * 1024 ||
    ledger.limits?.xmlEventsPerSide !== 1000000) {
  errors.push('coverage ledger must pin selected path, byte, and XML-event aggregate limits');
}

for (const part of ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']) {
  if (!executable.includes(`"${part}"`)) {
    errors.push(`Lean executable does not own fixed story extraction for ${part}`);
  }
  for (const input of ledger.scope?.inputs ?? []) {
    if (!input.packageParts?.includes(part)) {
      errors.push(`ledger input ${input.name} does not include fixed story ${part}`);
    }
  }
}

if (!lean.includes('projectUserNoteTokens') || !lean.includes('story_collection_checker_sound') ||
    !lean.includes('validateMoveRanges')) {
  errors.push('Lean checker must retain the reserved-note projection, move-range validation, and collection theorem');
}

for (const value of ledger.parsedWordprocessingML?.attributeValues?.['w:type'] ?? []) {
  if (!lean.includes(`tagAttribute attributes "w:type" == "${value}"`)) {
    errors.push(`ledger reserved note type ${value} is not recognized by the Lean checker`);
  }
}

for (const required of [
  'resolveQName',
  'wmlNamespace',
  'maxPackageBytes',
  'maxPartCompressedBytes',
  'maxPartExpandedBytes',
]) {
  if (!lean.includes(required) && !selector.includes(required) && !executable.includes(required)) {
    errors.push(`coverage claim requires ${required} in the Lean checker path`);
  }
}

for (const required of [
  'UNSUPPORTED_SECTION_PLACEMENT',
  'INDIRECT_SECTION_BINDING',
  'state.ancestors ==',
  'directBodyCount',
  'terminalBodySectionSeen',
  'assignPhysicalStoriesChecked',
  'directSelectionCompleteB',
  'canonicalLocatorsForPhysicalStory',
  'loadedTripleCorrespondsB',
  'projectLoadedSelection',
  'validateAggregateSelection',
  'namedStoryTripleForPhysicalStory',
]) {
  if (!selector.includes(required)) {
    errors.push(`reviewed protocol-v4 selector behavior requires ${required}`);
  }
}
if (selector.includes('selectionCompleteProof') || selector.includes('structure SelectorResult')) {
  errors.push('selector theorem results must not carry caller-supplied proof fields');
}
if (!selector.includes('if isDirectory then throw')) {
  errors.push('classic ZIP policy must explicitly reject directory records');
}
if (ledger.limits?.maximumShapeEvidence?.producer !==
    'verification/lean/ProtocolV4MaximumShape.lean' ||
    !maximumShape.includes('protocolV4ResponseJson false') ||
    !decoder.includes('.size > 256')) {
  errors.push('maximum-shape ledger evidence must match the compiled producer and strict 256-path decoder');
}

for (const required of [
  'buildZipIndex',
  'parseDocumentInventory',
  'parseRelationships',
  'normalizeTarget',
  'assignPhysicalStories',
  'direct_binding_selection_complete',
  'aligned_slot_unique_work_item',
  'dedup_preserves_selector_locators',
  'relationship_story_aggregate_sound',
]) {
  if (!selector.includes(required)) {
    errors.push(`protocol v4 selector coverage requires ${required}`);
  }
}

if (errors.length > 0) {
  console.error('Lean XML checker coverage ledger drift detected:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Lean XML checker coverage ledger is consistent with XmlTripleChecker.lean');
