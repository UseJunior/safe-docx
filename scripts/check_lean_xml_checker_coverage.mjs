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
const typedCommentIntegrityPath = join(root,
  'verification/lean/Tier2/CommentReferenceIntegrity/TypedSemantics.lean');
const typedCommentStackWitnessPath = join(root,
  'verification/lean/TypedCommentStackSafetyWitnesses.lean');
const typedCommentAxiomAuditPath = join(root,
  'verification/lean/TypedCommentAxiomAudit.lean');
const commentMemoryPath = join(root,
  'scripts/check_lean_comment_memory.mjs');
const commentDependencyAuditPath = join(root,
  'scripts/check_lean_comment_semantics_dependencies.mjs');
const auditFreshnessPath = join(root,
  'scripts/check_lean_audit_freshness.mjs');
const axiomAuditRunnerPath = join(root,
  'scripts/run_lean_axiom_audit.mjs');
const leanWorkflowPath = join(root, '.github/workflows/lean-build.yml');
const noteWitnessesPath = join(root, 'verification/lean/Tier2/NoteReferenceIntegrityWitnesses.lean');
const executablePath = join(root, 'verification/lean/LeanDocxChecker.lean');
const ordinaryEnvelopePath = join(root, 'verification/lean/ProtocolV7OrdinaryEnvelopeWitness.lean');
const protocolV7ProjectionDriftWitnessesPath = join(
  root, 'verification/lean/ProtocolV7ProjectionDriftWitnesses.lean');
const decoderPath = join(root, 'packages/docx-compare/src/baselines/atomizer/leanXmlVerifier.ts');

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const lean = readFileSync(leanPath, 'utf8');
const selector = readFileSync(selectorPath, 'utf8');
const noteIntegrity = readFileSync(noteIntegrityPath, 'utf8');
const commentIntegrity = readFileSync(commentIntegrityPath, 'utf8');
const typedCommentIntegrity = readFileSync(typedCommentIntegrityPath, 'utf8');
const typedCommentStackWitness = readFileSync(typedCommentStackWitnessPath, 'utf8');
const typedCommentAxiomAudit = readFileSync(typedCommentAxiomAuditPath, 'utf8');
const commentMemory = readFileSync(commentMemoryPath, 'utf8');
const commentDependencyAudit = readFileSync(commentDependencyAuditPath, 'utf8');
const auditFreshness = readFileSync(auditFreshnessPath, 'utf8');
const axiomAuditRunner = readFileSync(axiomAuditRunnerPath, 'utf8');
const leanWorkflow = readFileSync(leanWorkflowPath, 'utf8');
const noteWitnesses = readFileSync(noteWitnessesPath, 'utf8');
const executable = readFileSync(executablePath, 'utf8');
const ordinaryEnvelope = readFileSync(ordinaryEnvelopePath, 'utf8');
const protocolV7ProjectionDriftWitnesses = readFileSync(
  protocolV7ProjectionDriftWitnessesPath, 'utf8');
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
      !commentIntegrity.includes(`localName == "${localName}"`) &&
      !executable.includes(`localName == "${localName}"`)) {
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

if (ledger.protocolVersion !== 7 || !executable.includes('protocolVersion != 7')) {
  errors.push('ledger and Lean executable must agree on protocol version 7');
}
for (const marker of ['w:commentRangeStart', 'w:commentRangeEnd']) {
  if (!ledger.parsedWordprocessingML?.elements?.includes(marker)) {
    errors.push(`protocol-v7 coverage ledger omits ${marker}`);
  }
}
if (ledger.scope?.documentSurfaces?.outOfScope?.some((entry) =>
  entry.includes('comment range'))) {
  errors.push('protocol-v7 coverage ledger still describes comment ranges as out of scope');
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
    'verification/lean/ProtocolV7OrdinaryEnvelopeWitness.lean' ||
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

const typedExtractionBody = typedCommentIntegrity.slice(
  typedCommentIntegrity.indexOf('def typedExtractionCheck'),
  typedCommentIntegrity.indexOf('def TypedExtractionOf'),
);
const typedParsedPartBody = typedCommentIntegrity.slice(
  typedCommentIntegrity.indexOf('def typedParsedPartCheck'),
  typedCommentIntegrity.indexOf('def TypedParsedPartOf'),
);
const typedProductionEventBody = executable.slice(
  executable.indexOf('def typedXmlAttributeOfProduction'),
  executable.indexOf('def typedJsonOfProductionFuel'),
);
if (/\.data\.toList\s*=\s*/u.test(typedExtractionBody) ||
    /\.data\.toList\s*=\s*/u.test(typedParsedPartBody)) {
  errors.push('typed package/part admission must not use structural List equality');
}
if (/\.events\.(?:map|mapTR)\s+typedXmlEventIdentity/u.test(typedParsedPartBody)) {
  errors.push('typed parsed-part admission must use the custom event-sequence comparator');
}
if (/attributes\.map\s/u.test(typedProductionEventBody) ||
    !/attributes\.mapTR\s/u.test(typedProductionEventBody)) {
  errors.push('production XML attribute conversion must use List.mapTR');
}
for (const comparator of [
  'typedByteArrayEqLoop',
  'typedByteListEqCheck',
  'typedXmlAttributeListEqCheck',
  'typedXmlEventEqCheck',
  'typedXmlEventListEqCheck',
]) {
  const guarded = new RegExp(
    `set_option backward\\.match\\.sparseCases false in\\s+def ${comparator}\\b`,
    'u',
  );
  if (!guarded.test(typedCommentIntegrity)) {
    errors.push(`${comparator} must disable sparse-case code generation`);
  }
}
if (!typedCommentIntegrity.includes('value : BoundedByteArray') ||
    !typedProductionEventBody.includes(
      'value := typedBoundedByteArrayOfString item.value')) {
  errors.push('typed XML attribute values must remain ByteArray-backed on admission');
}
if (!typedCommentIntegrity.includes(
  'typedByteArrayEqLoop left right left.size') ||
    typedCommentIntegrity.includes(
      'typedByteListEqCheck left.data.toList right.data.toList')) {
  errors.push('typed ByteArray equality must use the indexed comparator without List conversion');
}
if (!/def typedByteArrayGetFast[\s\S]{0,180}bytes\.get! index/u
    .test(typedCommentIntegrity) ||
    !/@\[implemented_by typedByteArrayGetFast\][\s\S]{0,100}def typedByteArrayGet\b/u
      .test(typedCommentIntegrity)) {
  errors.push('typed ByteArray equality must compile to the bounded constant-time accessor');
}
for (const required of [
  'asciiXmlLiteralFast',
  'xml.drop 1 |>.toString',
]) {
  if (!lean.includes(required)) {
    errors.push(`large XML parser path requires ${required}`);
  }
}
if (/def stripLeadingUtf8Bom[\s\S]{0,180}xml\.toList/u.test(lean)) {
  errors.push('BOM handling must not convert the complete XML input to List');
}
for (const required of [
  'readBoundedChunks',
  'ByteArray.emptyWithCapacity total',
  'crc32Loop bytes bytes.size 0',
]) {
  if (!executable.includes(required)) {
    errors.push(`bounded extraction path requires ${required}`);
  }
}
for (const required of [
  'PAYLOAD_BYTES = 16_775_168',
  "SAFE_DOCX_IRRELEVANT_EVENT_COUNT ?? '200000'",
  'IRRELEVANT_EVENT_COUNT / 8',
  'MAX_RSS_BYTES = 1.5 * 1024 * 1024 * 1024',
  'TIMEOUT_MS = 120_000',
  "'nvca-comment-topology',",
  'tests/test_documents/nvca-regression/source.docx',
  "'maximum-markers',",
  "'irrelevant-events',",
  "'missing-relationship-early',",
  'COMMENT_RELATIONSHIP_REQUIRED',
  "'early-crossing',",
  "'late-crossing',",
  'ulimit -s 8192',
]) {
  if (!commentMemory.includes(required)) {
    errors.push(`near-limit memory acceptance requires ${required}`);
  }
}

const retainedMarkerScannerBody = executable.slice(
  executable.indexOf('def scanRetainedCommentStoryEventsV7'),
  executable.indexOf('structure RetainedCommentMarkerScanRun'),
);
for (const forbidden of ['zipIdx', '.toList', '.filter ', '.filterMap ']) {
  if (retainedMarkerScannerBody.includes(forbidden)) {
    errors.push(`protocol-v7 retained marker scanner contains forbidden ${forbidden}`);
  }
}
const productionCommentEvidenceBody = executable.slice(
  executable.indexOf('def productionCommentEvidencePass'),
  executable.indexOf('def commentSelectionResultEq'),
);
if (productionCommentEvidenceBody.includes(
  'retainedCommentMarkerScanForRelationshipV7')) {
  errors.push('production comment admission must consume the retained exact run without rescanning sources');
}
for (const required of [
  'structure RetainedCommentMarkerScanRun',
  'setExact',
  'resultExact',
  'markerScanRun',
  'processedEventCount',
  'processedStoryCount',
  'retained_comment_event_scan_stops_at_crossing_witness',
  'retained_comment_story_scan_does_not_enter_later_stories',
  'retained_missing_relationship_scan_stops_at_first_marker_witness',
  'commentMarkerKindCandidateV7',
  'scanRetainedCommentMarkersForRelationshipV7',
  'retained_marker_scan_run_result_substitution_rejected',
  'executable_marker_scan_invocation_substitution_rejected',
  'executable_marker_scan_retained_evidence_substitution_rejected',
]) {
  if (!executable.includes(required)) {
    errors.push(`single-pass protocol-v7 retained evidence requires ${required}`);
  }
}
for (const required of [
  '"outcome-pass"',
  '"outcome-evaluated-fail"',
  '"outcome-incomplete-before-scan"',
  '"outcome-incomplete-after-scan"',
  '"outcome-forged-pass"',
  '"outcome-forged-fail"',
  '"outcome-forged-incomplete"',
]) {
  if (!protocolV7ProjectionDriftWitnesses.includes(required)) {
    errors.push(`protocol-v7 production drift witnesses omit ${required}`);
  }
}
for (const required of [
  'typed_duplicate_reference_aggregate_witness_rejected',
  'typed_orphan_endpoint_aggregate_witness_rejected',
  'typed_reversed_range_aggregate_witness_rejected',
  'typed_cross_story_range_aggregate_witness_rejected',
  'typed_invalid_topology_witnesses_are_canonical',
  'typedTopologyDefinitionRealization',
]) {
  if (!typedCommentIntegrity.includes(required)) {
    errors.push(`non-vacuous protocol-v7 aggregate witness requires ${required}`);
  }
}
for (const theorem of [
  'typed_duplicate_reference_aggregate_witness_rejected',
  'typed_orphan_endpoint_aggregate_witness_rejected',
  'typed_reversed_range_aggregate_witness_rejected',
  'typed_cross_story_range_aggregate_witness_rejected',
]) {
  const start = typedCommentIntegrity.indexOf(`theorem ${theorem}`);
  const end = typedCommentIntegrity.indexOf('\ntheorem ', start + 1);
  const body = typedCommentIntegrity.slice(start, end);
  if (start < 0 || body.includes('(hScan') || body.includes('(hDefinitions')) {
    errors.push(`${theorem} must reject a concrete canonical request without premises`);
  }
}
const runRequestCoreV7Body = executable.slice(
  executable.indexOf('def runRequestCoreV7'),
  executable.indexOf('def ProductionRunRequestV7RefinesSemanticOf'),
);
if (runRequestCoreV7Body.includes('typedProtocolV6ResponseOfJson')) {
  errors.push('protocol-v7 production adapter must not use the protocol-v6 JSON decoder');
}
const productionTypedCommentChecksV7Body = executable.slice(
  executable.indexOf('def productionTypedCommentChecksV7'),
  executable.indexOf('def runRequestCoreV7'),
);
for (const forbidden of [
  'typedRequestOfRunRequestCoreV7',
  'typedRequestOfProductionV7',
  'productionActualBridgeRefinementChecksV7',
  'productionXmlEventsExactCheckFrom',
  'typedXmlEventsOfProduction',
  'typedAllCommentRangeSidesPassV7',
]) {
  if (productionTypedCommentChecksV7Body.includes(forbidden)) {
    errors.push(
      `protocol-v7 runtime gate must not copy or rescan whole typed events via ${forbidden}`,
    );
  }
}
for (const required of [
  'productionCommentOutcomeChecksV7',
  'result.typedProjectionCheck',
  'protocolV6JsonProjectionCheck result.response result.responsePassed',
  'result.response.compress.toUTF8.data.toList',
]) {
  if (!productionTypedCommentChecksV7Body.includes(required)) {
    errors.push(`protocol-v7 runtime gate omits ${required}`);
  }
}
const productionCommentOutcomeCheckV7Body = executable.slice(
  executable.indexOf('def productionCommentOutcomeCheckAtV7'),
  executable.indexOf('def productionCommentOutcomeChecksV7'),
);
for (const required of [
  'if evidence.complete',
  'evidence.productionIntegrityPassed',
  'evidence.inventory.status == "passed"',
  'evidence.inventory.status == "failed"',
  'evidence.inventory.status == "not_evaluated"',
  'evidence.markerScanInvocationCount == 0',
  'evidence.markerScanInvocationCount == 1',
  'evidence.markerScan.any (·.crossing.isSome)',
]) {
  if (!productionCommentOutcomeCheckV7Body.includes(required)) {
    errors.push(`protocol-v7 outcome-sensitive runtime gate omits ${required}`);
  }
}
if (productionTypedCommentChecksV7Body.includes('!result.responsePassed ||')) {
  errors.push('protocol-v7 runtime refinements must not be skipped on failed responses');
}
for (const theorem of [
  'typedByteArrayEqCheck_true_iff',
  'typedXmlEventListEqCheck_true_iff',
]) {
  if (!typedCommentAxiomAudit.includes(`#print axioms Tier2.CommentReferenceIntegrity.Typed.${theorem}`)) {
    errors.push(`typed comment axiom audit omits ${theorem}`);
  }
}
if (!typedCommentStackWitness.includes('stackWitnessPayloadSize : Nat := 400000') ||
    !typedCommentStackWitness.includes('typedByteListEqCheck_true_iff') ||
    !typedCommentStackWitness.includes('typedXmlEventListEqCheck_true_iff') ||
    typedCommentStackWitness.includes('native_decide')) {
  errors.push('typed comment stack witness must be kernel-checked over 400000-byte payloads');
}
const typedProtocolV7Body = typedCommentIntegrity.slice(
  typedCommentIntegrity.indexOf('/- Protocol v7 independently models'),
);
if (typedProtocolV7Body.includes('native_decide')) {
  errors.push('protocol-v7 typed semantics and witnesses must not use native_decide');
}
const missingRelationshipWitnessBody = executable.slice(
  executable.indexOf('def retainedMissingRelationshipEarlyStopCheckV7'),
  executable.indexOf('def retainedCommentMarkerSourceSetV7'),
);
if (missingRelationshipWitnessBody.includes('native_decide')) {
  errors.push('missing-relationship structural witness must not use native_decide');
}
for (const target of [
  'typed_invalid_topology_witnesses_are_canonical',
  'typed_duplicate_reference_aggregate_witness_rejected',
  'typed_orphan_endpoint_aggregate_witness_rejected',
  'typed_reversed_range_aggregate_witness_rejected',
  'typed_cross_story_range_aggregate_witness_rejected',
]) {
  if (!typedCommentAxiomAudit.includes(
    `#print axioms Tier2.CommentReferenceIntegrity.Typed.${target}`)) {
    errors.push(`typed comment axiom audit omits concrete witness ${target}`);
  }
}
if (!commentDependencyAudit.includes("buildTargets: ['LeanDocxChecker']") ||
    !commentDependencyAudit.includes('runFreshLeanAudit')) {
  errors.push('comment dependency audit must build current project sources before audit import');
}
if (!axiomAuditRunner.includes("buildTargets: ['LeanDocxChecker']") ||
    !auditFreshness.includes('stale direct-import acceptance')) {
  errors.push('Lean axiom audit freshness runner/regression is incomplete');
}
for (const command of [
  'lake env lean TypedCommentStackSafetyWitnesses.lean',
  'npm run check:lean-comment-memory',
  'src/integration/nvca-structural-regression.test.ts',
  "SAFE_DOCX_REQUIRE_LEAN_CHECKER: '1'",
]) {
  if (!leanWorkflow.includes(command)) {
    errors.push(`Lean CI workflow omits required stack-safety gate: ${command}`);
  }
}

if (!executable.includes('production_run_request_core_v7_refinement_sound')) {
  errors.push('protocol v7 production refinement theorem is missing from LeanDocxChecker');
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
