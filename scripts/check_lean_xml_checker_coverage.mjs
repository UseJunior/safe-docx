#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ledgerPath = join(root, 'verification/registry/lean-xml-checker-coverage.json');
const leanPath = join(root, 'verification/lean/Tier2/XmlTripleChecker.lean');
const selectorPath = join(root, 'verification/lean/Tier2/RelationshipStorySelector.lean');
const noteIntegrityPath = join(root,
  'verification/lean/Tier2/NoteReferenceIntegrity/Semantics.lean');
const commentIntegrityPath = join(root,
  'verification/lean/Tier2/CommentReferenceIntegrity/Semantics.lean');
const noteWitnessesPath = join(root, 'verification/lean/Tier2/NoteReferenceIntegrityWitnesses.lean');
const executablePath = join(root, 'verification/lean/LeanDocxChecker.lean');
const ordinaryEnvelopePath = join(root, 'verification/lean/ProtocolV6OrdinaryEnvelopeWitness.lean');
const decoderPath = join(root, 'packages/docx-compare/src/baselines/atomizer/leanXmlVerifier.ts');

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const lean = readFileSync(leanPath, 'utf8');
const selector = readFileSync(selectorPath, 'utf8');
const noteIntegrity = readFileSync(noteIntegrityPath, 'utf8');
const commentIntegrity = readFileSync(commentIntegrityPath, 'utf8');
const noteWitnesses = readFileSync(noteWitnessesPath, 'utf8');
const executable = readFileSync(executablePath, 'utf8');
const ordinaryEnvelope = readFileSync(ordinaryEnvelopePath, 'utf8');
const decoder = readFileSync(decoderPath, 'utf8');

const errors = [];

for (const required of [
  'internalExternalPackage',
  'forgedRequest',
  'admittedIncompleteCause forgedRequest .original = none',
  'missingMainPackage',
  'undecodedMainPart',
  'unparsedMainPart',
  'partialMainPart',
  'absentWithReferenceScans',
  'missingSelectedPartPackage',
  'omittedPhysicalPackage',
  'forgedLocalRequest',
  'forgedSkippedRequest',
  'duplicateInventory',
  'failedGenericRequest',
  'parseDecimalId "+001"',
  'parseDecimalId "-0"',
]) {
  if (!noteWitnesses.includes(required)) {
    errors.push(`note-integrity negative witness coverage requires ${required}`);
  }
}

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
      !selector.includes(`localName == "${localName}"`) &&
      !noteIntegrity.includes(`localName == "${localName}"`) &&
      !noteIntegrity.includes(`=> "${localName}"`) &&
      !commentIntegrity.includes(`localName == "${localName}"`)) {
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

if (ledger.protocolVersion !== 6 || !executable.includes('protocolVersion != 6')) {
  errors.push('ledger and Lean executable must agree on protocol version 6');
}
if (!executable.includes('String.fromUTF8?')) {
  errors.push('accepted XML subset requires strict UTF-8 package-part decoding');
}
for (const required of [
  'relationshipMetadataPlan',
  'maxCumulativeCompressedBytes',
  'maxCumulativeExpandedBytes',
  'buildNoteSideEvidence',
  'selectConventionalMainNote',
  'selectConventionalMainComment',
  'buildCommentSideEvidence',
]) {
  if (!executable.includes(required)) {
    errors.push(`canonical resource admission requires ${required}`);
  }
}
if (executable.indexOf('let metadataPlan := relationshipMetadataPlan') >
    executable.indexOf('buildNoteSideEvidence originalPackage')) {
  errors.push('relationship metadata/work must precede semantic note-story loading');
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

for (const part of ['word/document.xml', 'word/_rels/document.xml.rels']) {
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
  if (!lean.includes(`tagAttribute attributes "w:type" == "${value}"`) &&
      !noteIntegrity.includes(`some "${value}"`)) {
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
if (ledger.limits?.ordinaryEnvelopeEvidence?.producer !==
    'verification/lean/ProtocolV6OrdinaryEnvelopeWitness.lean' ||
    !ordinaryEnvelope.includes('ordinaryLegalUpperEnvelope') ||
    !decoder.includes('.size > 256')) {
  errors.push('ordinary-envelope ledger evidence must match the compiled producer and strict 256-path decoder');
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

for (const required of [
  'selected_note_identity_sound',
  'admitted_source_partition_complete',
  'parsed_inventory_evidence_exact',
  'package_note_reference_integrity_sound',
  'incomplete_partition_zero_evidence_sound',
  'note_integrity_aggregate_pass_sound',
  'maxReferenceOccurrences',
  'maxUniqueReferenceIds',
  'maxDefinitions',
  'maxPoisonReferences',
]) {
  if (!noteIntegrity.includes(required)) {
    errors.push(`protocol v6 note-integrity coverage requires ${required}`);
  }
}

for (const required of [
  'comment_selector_result_sound',
  'comment_selection_to_realization_sound',
  'admitted_comment_source_set_complete',
  'parsed_comment_inventory_evidence_exact',
  'package_comment_reference_integrity_sound',
  'incomplete_comment_partition_zero_evidence_sound',
  'comment_integrity_aggregate_pass_sound',
]) {
  if (!commentIntegrity.includes(required)) {
    errors.push(`protocol v6 comment-integrity coverage requires ${required}`);
  }
}

if (!executable.includes('production_run_request_core_v6_refinement_sound')) {
  errors.push('protocol v6 production refinement theorem is missing from LeanDocxChecker');
}

for (const required of [
  'semanticProtocolV6Projection',
  'SemanticProtocolV6ProjectionOf',
  'packageReadCount',
  'parseInvocationCount',
  'scanInvocationCount',
  'parseResultExact',
  'outputExact',
]) {
  if (!executable.includes(required)) {
    errors.push(`single-pass production refinement requires ${required}`);
  }
}

for (const required of [
  'snapshotExtractionEvidenceCheck',
  'SnapshotExtractionEvidenceOf',
  'snapshotWriteCount',
  'extractionInvocationCount',
  'valueDependencyClosure',
]) {
  if (!executable.includes(required) &&
      !readFileSync(join(root, 'verification/lean/NoteSemanticDependencyAudit.lean'), 'utf8')
        .includes(required)) {
    errors.push(`single-pass semantic call-graph audit requires ${required}`);
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
