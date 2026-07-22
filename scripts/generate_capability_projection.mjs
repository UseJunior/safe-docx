import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const paths = {
  pin: 'spec-compliance/capabilities/upstream-pin.json',
  capabilities: 'spec-compliance/capabilities/upstream/capabilities.json',
  capabilitiesSchema: 'spec-compliance/capabilities/upstream/capabilities.schema.json',
  profiles: 'spec-compliance/capabilities/upstream/profiles.json',
  profilesSchema: 'spec-compliance/capabilities/upstream/profiles.schema.json',
  mappings: 'spec-compliance/capabilities/upstream/scenario-capabilities.json',
  mappingsSchema: 'spec-compliance/capabilities/upstream/scenario-capabilities.schema.json',
  summary: 'spec-compliance/capabilities/upstream/capability-summary.json',
  projection: 'spec-compliance/capabilities/safe-docx-projection.json',
  projectionSchema: 'spec-compliance/capabilities/safe-docx-projection.schema.json',
  leanCoverage: 'verification/registry/lean-xml-checker-coverage.json',
  jsonOutput: 'spec-compliance/generated/safe-docx-capability-projection.json',
  markdownOutput: 'spec-compliance/generated/safe-docx-capability-projection.md',
};

const POSITIVE_STATUSES = new Set(['supported', 'partial', 'preservation-only']);
const execFileAsync = promisify(execFile);
const REQUIRED_PINNED_FILES = new Set([
  paths.capabilities,
  paths.capabilitiesSchema,
  paths.profiles,
  paths.profilesSchema,
  paths.mappings,
  paths.mappingsSchema,
  paths.summary,
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function compileSchema(schema, label) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  return (value) => {
    if (!validate(value)) {
      throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }
  };
}

export function verifyPinnedContent(pin, contentByPath) {
  assert(pin.schemaVersion === 1, 'pin: unsupported schemaVersion');
  assert(pin.repository === 'open-agreements/docx-platform-tests', 'pin: unexpected upstream repository');
  assert(/^[a-f0-9]{40}$/.test(pin.commit), 'pin: commit must be a full Git SHA');
  const seen = new Set();
  for (const file of pin.files) {
    assert(!seen.has(file.path), `pin: duplicate file ${file.path}`);
    seen.add(file.path);
    const content = contentByPath.get(file.path);
    assert(content !== undefined, `pin: missing vendored file ${file.path}`);
    const actual = sha256(content);
    assert(actual === file.sha256, `pin drift: ${file.path} expected ${file.sha256}, got ${actual}`);
  }
  const missing = [...REQUIRED_PINNED_FILES].filter((file) => !seen.has(file));
  const extra = [...seen].filter((file) => !REQUIRED_PINNED_FILES.has(file));
  assert(missing.length === 0, `pin: required files are missing: ${missing.join(', ')}`);
  assert(extra.length === 0, `pin: unexpected files are listed: ${extra.join(', ')}`);
}

function pairKey(capabilityId, axis) {
  return `${capabilityId}\u0000${axis}`;
}

function expectedStories(packageParts) {
  const stories = [];
  if (packageParts.some((part) => part === 'word/document.xml' || part.includes('numbering.xml') || part.includes('styles.xml'))) stories.push('main');
  if (packageParts.some((part) => part.includes('comments.xml'))) stories.push('comments');
  if (packageParts.some((part) => part.includes('footnotes.xml'))) stories.push('footnotes');
  if (packageParts.some((part) => part.includes('endnotes.xml'))) stories.push('endnotes');
  if (packageParts.some((part) => part.includes('header'))) stories.push('headers');
  if (packageParts.some((part) => part.includes('footer'))) stories.push('footers');
  return stories.length > 0 ? stories : ['main'];
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateSummary(capabilityById, mappings, summary) {
  const mappingKeys = new Set();
  const knownScenarioIds = new Set();
  for (const mapping of mappings.mappings) {
    const capability = capabilityById.get(mapping.capabilityId);
    assert(capability, `mapping references unknown capability ${mapping.capabilityId}`);
    assert(capability.applicableAxes.includes(mapping.axis), `${mapping.capabilityId}: mapping axis ${mapping.axis} is not applicable`);
    const key = `${mapping.scenarioId}\u0000${mapping.capabilityId}\u0000${mapping.axis}`;
    assert(!mappingKeys.has(key), `duplicate scenario mapping ${mapping.scenarioId}/${mapping.capabilityId}/${mapping.axis}`);
    mappingKeys.add(key);
    knownScenarioIds.add(mapping.scenarioId);
  }

  const unmeasured = new Set(summary.unmeasuredScenarioIds);
  assert(unmeasured.size === summary.unmeasuredScenarioIds.length, 'summary contains duplicate unmeasured scenario IDs');
  for (const scenarioId of unmeasured) {
    assert(knownScenarioIds.has(scenarioId), `summary references unknown unmeasured scenario ${scenarioId}`);
  }
  const measured = new Set([...knownScenarioIds].filter((scenarioId) => !unmeasured.has(scenarioId)));
  assert(summary.sourceResults.scenarioCount === measured.size, 'summary scenarioCount disagrees with measured scenario inventory');

  const expectedRows = new Map();
  for (const mapping of mappings.mappings) {
    if (!measured.has(mapping.scenarioId)) continue;
    const authoredKey = pairKey(mapping.capabilityId, mapping.axis);
    if (!expectedRows.has(authoredKey)) expectedRows.set(authoredKey, new Set());
    expectedRows.get(authoredKey).add(mapping.scenarioId);
    const crossPlatformKey = pairKey(mapping.capabilityId, 'crossPlatform');
    if (!expectedRows.has(crossPlatformKey)) expectedRows.set(crossPlatformKey, new Set());
    expectedRows.get(crossPlatformKey).add(mapping.scenarioId);
  }

  const implementationNames = summary.sourceResults.implementations.map((item) => item.adapterName);
  assert(new Set(implementationNames).size === implementationNames.length, 'summary contains duplicate implementation adapters');
  const knownImplementations = new Set(implementationNames);
  const rowKeys = new Set();
  for (const row of summary.capabilities) {
    const capability = capabilityById.get(row.capabilityId);
    assert(capability, `summary references unknown capability ${row.capabilityId}`);
    assert(row.axis === 'crossPlatform' || capability.applicableAxes.includes(row.axis), `${row.capabilityId}: summary axis ${row.axis} is not applicable`);
    const key = pairKey(row.capabilityId, row.axis);
    assert(!rowKeys.has(key), `duplicate summary row ${row.capabilityId}/${row.axis}`);
    rowKeys.add(key);

    const expectedScenarioIds = expectedRows.get(key);
    assert(expectedScenarioIds, `unexpected summary row ${row.capabilityId}/${row.axis}`);

    const scenarioIds = new Set(row.scenarioIds);
    assert(scenarioIds.size === row.scenarioIds.length, `${row.capabilityId}/${row.axis}: duplicate result scenario ID`);
    for (const scenarioId of scenarioIds) {
      assert(knownScenarioIds.has(scenarioId), `${row.capabilityId}/${row.axis}: unknown result scenario ${scenarioId}`);
      assert(measured.has(scenarioId), `${row.capabilityId}/${row.axis}: result includes unmeasured scenario ${scenarioId}`);
    }
    assert(setsEqual(scenarioIds, expectedScenarioIds), `${row.capabilityId}/${row.axis}: result scenarios do not exactly match mapped measured scenarios`);

    for (const [adapterName, outcome] of Object.entries(row.outcomes)) {
      assert(knownImplementations.has(adapterName), `${row.capabilityId}/${row.axis}: outcome references unknown adapter ${adapterName}`);
      assert(Number.isInteger(outcome.denominator) && outcome.denominator >= 0, `${row.capabilityId}/${row.axis}/${adapterName}: denominator must be a nonnegative integer`);
      assert(Number.isInteger(outcome.passLike) && outcome.passLike >= 0, `${row.capabilityId}/${row.axis}/${adapterName}: passLike must be a nonnegative integer`);
      const countValues = Object.values(outcome.counts);
      assert(countValues.every((count) => Number.isInteger(count) && count >= 0), `${row.capabilityId}/${row.axis}/${adapterName}: counts must be nonnegative integers`);
      assert(countValues.reduce((total, count) => total + count, 0) === outcome.denominator, `${row.capabilityId}/${row.axis}/${adapterName}: counts do not sum to denominator`);
      assert(outcome.denominator === scenarioIds.size, `${row.capabilityId}/${row.axis}/${adapterName}: denominator does not cover every row scenario`);
      assert(outcome.passLike <= outcome.denominator, `${row.capabilityId}/${row.axis}/${adapterName}: passLike exceeds denominator`);
    }
  }
  const missingRows = [...expectedRows.keys()]
    .filter((key) => !rowKeys.has(key))
    .map((key) => key.replace('\u0000', '/'));
  assert(missingRows.length === 0, `summary is missing measured rows: ${missingRows.join(', ')}`);
}

async function git(repositoryRoot, args, label) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch {
    throw new Error(label);
  }
}

async function resolveCommit(repositoryRoot, revision, label) {
  const commit = await git(repositoryRoot, ['rev-parse', '--verify', `${revision}^{commit}`], label);
  assert(/^[a-f0-9]{40}$/.test(commit), label);
  return commit;
}

async function readAtCommit(repositoryRoot, commit, relativePath, label) {
  return git(repositoryRoot, ['show', `${commit}:${relativePath}`], label);
}

function validateNeutralResult(claim, summary) {
  const row = summary.capabilities.find(
    (candidate) => candidate.capabilityId === claim.capabilityId && candidate.axis === claim.axis
  );
  assert(row, `${claim.capabilityId}/${claim.axis}: no pinned neutral result row`);
  const safeDocx = row.outcomes?.['safe-docx'];
  assert(safeDocx?.denominator > 0, `${claim.capabilityId}/${claim.axis}: neutral SafeDocX denominator is empty`);
  assert(
    safeDocx.passLike === safeDocx.denominator,
    `${claim.capabilityId}/${claim.axis}: neutral SafeDocX result is not fully pass-like`
  );
  if (claim.axis === 'crossPlatform') {
    const secondAdapter = Object.entries(row.outcomes).find(
      ([adapterName, outcome]) => adapterName !== 'safe-docx' && outcome.denominator === row.scenarioIds.length && outcome.passLike === outcome.denominator
    );
    assert(secondAdapter, `${claim.capabilityId}/crossPlatform: no second adapter passes every row scenario`);
  }
}

async function validateEvidence(claim, summary, repositoryRoot) {
  if (!POSITIVE_STATUSES.has(claim.status)) {
    assert(claim.evidence.length === 0, `${claim.capabilityId}/${claim.axis}: non-positive status must not carry evidence`);
    return;
  }
  assert(claim.evidence.length > 0, `${claim.capabilityId}/${claim.axis}: positive status requires executable evidence`);
  let executable = false;
  for (const evidence of claim.evidence) {
    assert(evidence.kind === 'neutral-result', `${claim.capabilityId}/${claim.axis}: unsupported positive evidence kind ${evidence.kind}`);
    const absolute = path.resolve(repositoryRoot, evidence.path);
    assert(
      absolute.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`),
      `${claim.capabilityId}/${claim.axis}: evidence path escapes repository`
    );
    assert(evidence.path === paths.summary, `${claim.capabilityId}/${claim.axis}: neutral evidence must reference the pinned summary`);
    await access(absolute);
    const adapterVersion = summary.sourceResults.implementations.find((item) => item.adapterName === 'safe-docx')?.adapterVersion;
    const match = /^(\d+\.\d+\.\d+)\+git\.([a-f0-9]{7,40})$/.exec(adapterVersion ?? '');
    assert(match, `${claim.capabilityId}/${claim.axis}: pinned neutral result lacks SafeDocX version provenance`);
    const fullCommit = await resolveCommit(repositoryRoot, match[2], `${claim.capabilityId}/${claim.axis}: pinned neutral SafeDocX commit does not resolve uniquely`);
    assert(evidence.implementationVersion === match[1], `${claim.capabilityId}/${claim.axis}: neutral evidence version disagrees with result`);
    assert(evidence.lastVerifiedCommit === fullCommit, `${claim.capabilityId}/${claim.axis}: neutral evidence commit disagrees with resolved result commit`);
    const packageSource = await readAtCommit(repositoryRoot, fullCommit, 'packages/docx-core/package.json', `${claim.capabilityId}/${claim.axis}: neutral adapter package is absent at resolved commit`);
    assert(JSON.parse(packageSource).version === match[1], `${claim.capabilityId}/${claim.axis}: neutral adapter version disagrees with package version at resolved commit`);
    const expectedClass = claim.axis === 'crossPlatform' ? 'cross-implementation-differential' : 'normative-behavioral-scenario';
    assert(evidence.evidenceClass === expectedClass, `${claim.capabilityId}/${claim.axis}: neutral evidence class must be ${expectedClass}`);
    validateNeutralResult(claim, summary);
    executable = true;
  }
  assert(executable, `${claim.capabilityId}/${claim.axis}: no executable evidence`);
  assert(
    claim.evidence.some((evidence) =>
      evidence.implementationVersion === claim.implementationVersion
      && evidence.lastVerifiedCommit === claim.lastVerifiedCommit
    ),
    `${claim.capabilityId}/${claim.axis}: positive claim lacks evidence matching its version and verified commit`
  );
  if (claim.status === 'partial') {
    assert(/limit|only|subset|bounded|current/i.test(claim.rationale), `${claim.capabilityId}/${claim.axis}: partial status must state its limit`);
  }
  if (claim.status === 'preservation-only') {
    assert(claim.axis === 'preserve', `${claim.capabilityId}/${claim.axis}: preservation-only is valid only for preserve`);
  }
}

export async function validateProjection(inputs, repositoryRoot = root) {
  const { pin, capabilities, profiles, mappings, summary, projection } = inputs;
  assert(capabilities.schemaVersion === pin.registrySchemaVersion, 'capabilities schemaVersion disagrees with pin');
  assert(capabilities.registryVersion === pin.registryVersion, 'capabilities registryVersion disagrees with pin');
  assert(profiles.schemaVersion === pin.registrySchemaVersion, 'profiles schemaVersion disagrees with pin');
  assert(profiles.registryVersion === pin.registryVersion, 'profiles registryVersion disagrees with pin');
  assert(mappings.registryVersion === pin.registryVersion, 'mapping registryVersion disagrees with pin');
  assert(summary.registryVersion === pin.registryVersion, 'result registryVersion disagrees with pin');
  assert(projection.profileId === pin.profileId, 'projection profileId disagrees with pin');

  const capabilityById = new Map(capabilities.capabilities.map((capability) => [capability.id, capability]));
  assert(capabilityById.size === capabilities.capabilities.length, 'neutral capabilities contain duplicate IDs');
  validateSummary(capabilityById, mappings, summary);
  const profile = profiles.profiles.find((candidate) => candidate.id === pin.profileId);
  assert(profile, `unknown pinned profile ${pin.profileId}`);

  const expected = new Set();
  for (const capabilityId of profile.capabilityIds) {
    const capability = capabilityById.get(capabilityId);
    assert(capability, `profile references unknown capability ${capabilityId}`);
    for (const axis of profile.axes) {
      if (capability.applicableAxes.includes(axis)) expected.add(pairKey(capabilityId, axis));
    }
  }

  const actual = new Set();
  for (const claim of projection.claims) {
    const capability = capabilityById.get(claim.capabilityId);
    assert(capability, `projection references unknown capability ${claim.capabilityId}`);
    assert(profile.capabilityIds.includes(claim.capabilityId), `projection capability is outside profile: ${claim.capabilityId}`);
    assert(profile.axes.includes(claim.axis), `${claim.capabilityId}: axis ${claim.axis} is outside profile`);
    assert(capability.applicableAxes.includes(claim.axis), `${claim.capabilityId}: axis ${claim.axis} is not applicable`);
    assert(claim.scope.packageParts.every((part) => capability.packageParts.includes(part)), `${claim.capabilityId}/${claim.axis}: package-part scope is not a subset of the neutral capability`);
    assert(
      JSON.stringify(claim.scope.stories) === JSON.stringify(expectedStories(claim.scope.packageParts)),
      `${claim.capabilityId}/${claim.axis}: story scope disagrees with package parts`
    );
    const modesRelevant = claim.axis === 'compare' || claim.axis === 'preserve';
    if (modesRelevant) {
      assert(!claim.scope.reconstructionModes.includes('not-applicable'), `${claim.capabilityId}/${claim.axis}: reconstruction mode is required`);
    } else {
      assert(
        JSON.stringify(claim.scope.reconstructionModes) === JSON.stringify(['not-applicable']),
        `${claim.capabilityId}/${claim.axis}: reconstruction mode must be not-applicable for this axis`
      );
    }
    const key = pairKey(claim.capabilityId, claim.axis);
    assert(!actual.has(key), `duplicate projection pair ${claim.capabilityId}/${claim.axis}`);
    actual.add(key);
    await validateEvidence(claim, summary, repositoryRoot);
  }
  const missing = [...expected].filter((key) => !actual.has(key)).map((key) => key.replace('\u0000', '/'));
  const extra = [...actual].filter((key) => !expected.has(key)).map((key) => key.replace('\u0000', '/'));
  assert(missing.length === 0, `projection is missing denominator pairs: ${missing.join(', ')}`);
  assert(extra.length === 0, `projection has extra denominator pairs: ${extra.join(', ')}`);
  return { profile, capabilityById, denominator: expected.size };
}

function formalAssuranceBoundary(leanCoverage) {
  return {
    establishesCapabilityClaims: false,
    checkerRegistry: paths.leanCoverage,
    reconstructionModes: {
      covered: [...leanCoverage.scope.reconstructionModes.covered],
      excluded: [...leanCoverage.scope.reconstructionModes.outOfScope],
    },
    stories: ['main', 'footnotes', 'endnotes'],
    projections: ['text', 'field markers'],
    documentSurfaces: {
      covered: [...leanCoverage.scope.documentSurfaces.covered],
      excluded: [...leanCoverage.scope.documentSurfaces.outOfScope],
    },
    knownUncheckedAreas: [...leanCoverage.knownUncheckedAreas],
  };
}

function generateReport(pin, profile, capabilityById, mappings, summary, projection, leanCoverage) {
  const claims = [...projection.claims]
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId) || a.axis.localeCompare(b.axis))
    .map((claim) => ({
      ...claim,
      title: capabilityById.get(claim.capabilityId).title,
      family: capabilityById.get(claim.capabilityId).family,
    }));
  const byAxis = Object.fromEntries(profile.axes.map((axis) => [axis, claims.filter((claim) => claim.axis === axis).length]));
  const byStatus = Object.fromEntries(
    ['supported', 'partial', 'preservation-only', 'gap', 'non-goal', 'untested'].map((status) => [
      status,
      claims.filter((claim) => claim.status === status).length,
    ])
  );
  const authoredMappingPairs = new Set(mappings.mappings.map((mapping) => pairKey(mapping.capabilityId, mapping.axis))).size;
  const mappedCapabilities = new Set(mappings.mappings.map((mapping) => mapping.capabilityId)).size;
  const expectedCompleteSummaryRows = authoredMappingPairs + mappedCapabilities;
  assert(summary.sourceResults.scenarioCount + summary.unmeasuredScenarioIds.length === mappings.mappings.reduce(
    (ids, mapping) => ids.add(mapping.scenarioId), new Set()
  ).size, 'pinned measured and unmeasured scenarios disagree with authored scenario inventory');
  assert(summary.capabilities.length <= expectedCompleteSummaryRows, 'pinned result summary exceeds its authored evidence inventory');
  return {
    schemaVersion: 1,
    generatedFrom: {
      repository: pin.repository,
      commit: pin.commit,
      registryVersion: pin.registryVersion,
      profileId: profile.id,
    },
    profileDenominator: { capabilityAxisPairs: claims.length, byAxis },
    evidenceInventory: {
      authoredMappingPairs,
      crossPlatformDerivedPairsInCompleteRun: mappedCapabilities,
      expectedCompleteSummaryRows,
      pinnedMeasuredSummaryRows: summary.capabilities.length,
      pinnedMeasuredScenarios: summary.sourceResults.scenarioCount,
      pinnedUnmeasuredScenarios: summary.unmeasuredScenarioIds.length,
    },
    statusCounts: byStatus,
    formalAssuranceBoundary: formalAssuranceBoundary(leanCoverage),
    claims,
  };
}

function markdown(report) {
  const lines = [
    '# SafeDocX Capability Projection',
    '',
    `Pinned neutral registry: \`${report.generatedFrom.repository}@${report.generatedFrom.commit}\``,
    '',
    `Profile: \`${report.generatedFrom.profileId}\` (registry version ${report.generatedFrom.registryVersion})`,
    '',
    'This report preserves the upstream profile denominator. It does not claim full ECMA-376 coverage, and a positive row applies only to the listed evidence and scope.',
    '',
    '## Formal Assurance Boundary',
    '',
    `The registry \`${report.formalAssuranceBoundary.checkerRegistry}\` is scope metadata only and establishes **no capability row** in this projection.`,
    '',
    `Covered reconstruction mode: ${report.formalAssuranceBoundary.reconstructionModes.covered.join(', ')}. Excluded mode: ${report.formalAssuranceBoundary.reconstructionModes.excluded.join(', ')}.`,
    '',
    `Covered stories: ${report.formalAssuranceBoundary.stories.join(', ')}. Projections: ${report.formalAssuranceBoundary.projections.join(' and ')} only.`,
    '',
    `Exact covered surfaces: ${report.formalAssuranceBoundary.documentSurfaces.covered.join('; ')}.`,
    '',
    `Exact excluded surfaces: ${report.formalAssuranceBoundary.documentSurfaces.excluded.join('; ')}.`,
    '',
    `Exact known unchecked areas: ${report.formalAssuranceBoundary.knownUncheckedAreas.join('; ')}.`,
    '',
    '## Denominator',
    '',
    `Profile capability/axis pairs: **${report.profileDenominator.capabilityAxisPairs}**`,
    '',
    '| Axis | Pairs |',
    '|---|---:|',
    ...Object.entries(report.profileDenominator.byAxis).map(([axis, count]) => `| ${axis} | ${count} |`),
    '',
    '## Evidence Inventory',
    '',
    'These counts are not interchangeable denominators. The profile cross-product includes explicit untested and gap rows; the summary contains only authored or measured evidence rows.',
    '',
    '| Count | Value | Meaning |',
    '|---|---:|---|',
    `| Profile capability/axis pairs | ${report.profileDenominator.capabilityAxisPairs} | Every applicable pair selected by the pinned profile |`,
    `| Authored mapping pairs | ${report.evidenceInventory.authoredMappingPairs} | Distinct capability/axis pairs with neutral scenarios |`,
    `| Complete-run derived cross-platform pairs | ${report.evidenceInventory.crossPlatformDerivedPairsInCompleteRun} | One potential cross-platform row per mapped capability |`,
    `| Expected complete summary rows | ${report.evidenceInventory.expectedCompleteSummaryRows} | ${report.evidenceInventory.authoredMappingPairs} authored plus ${report.evidenceInventory.crossPlatformDerivedPairsInCompleteRun} derived rows |`,
    `| Pinned measured summary rows | ${report.evidenceInventory.pinnedMeasuredSummaryRows} | Rows actually backed by the pinned result snapshot |`,
    `| Pinned measured / unmeasured scenarios | ${report.evidenceInventory.pinnedMeasuredScenarios} / ${report.evidenceInventory.pinnedUnmeasuredScenarios} | Result-snapshot state at the pinned commit |`,
    '',
    '## Status Counts',
    '',
    '| Status | Pairs |',
    '|---|---:|',
    ...Object.entries(report.statusCounts).map(([status, count]) => `| ${status} | ${count} |`),
    '',
    '## Evidence Projection',
    '',
    '| Capability | Axis | Status | Scope | Version / verified commit | Evidence | Rationale |',
    '|---|---|---|---|---|---|---|',
    ...report.claims.map((claim) => {
      const evidence = claim.evidence.length === 0
        ? 'none'
        : claim.evidence.map((item) => `${item.evidenceClass}: \`${item.path}\`${item.selector ? ` (${item.selector})` : ''}<br>${item.implementationVersion} / \`${item.lastVerifiedCommit}\``).join('<br>');
      const scope = `${claim.scope.packageParts.map((part) => `\`${part}\``).join(', ')}<br>stories: ${claim.scope.stories.join(', ')}<br>mode: ${claim.scope.reconstructionModes.join(', ')}`;
      return `| \`${claim.capabilityId}\` | ${claim.axis} | ${claim.status} | ${scope} | ${claim.implementationVersion} / \`${claim.lastVerifiedCommit}\` | ${evidence} | ${claim.rationale.replaceAll('|', '\\|')} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const [pin, capabilities, capabilitiesSchema, profiles, profilesSchema, mappings, mappingsSchema, summary, projection, projectionSchema, leanCoverage] = await Promise.all([
    readJson(paths.pin), readJson(paths.capabilities), readJson(paths.capabilitiesSchema), readJson(paths.profiles),
    readJson(paths.profilesSchema), readJson(paths.mappings), readJson(paths.mappingsSchema), readJson(paths.summary),
    readJson(paths.projection), readJson(paths.projectionSchema), readJson(paths.leanCoverage),
  ]);
  const contents = new Map(await Promise.all(pin.files.map(async (file) => {
    const absolute = path.resolve(root, file.path);
    assert(absolute.startsWith(`${root}${path.sep}`), `pin: path escapes repository: ${file.path}`);
    return [file.path, await readFile(absolute)];
  })));
  verifyPinnedContent(pin, contents);
  compileSchema(capabilitiesSchema, 'capabilities schema')(capabilities);
  compileSchema(profilesSchema, 'profiles schema')(profiles);
  compileSchema(mappingsSchema, 'scenario mappings schema')(mappings);
  compileSchema(projectionSchema, 'SafeDocX projection schema')(projection);
  const validated = await validateProjection({ pin, capabilities, profiles, mappings, summary, projection, leanCoverage });
  const report = generateReport(pin, validated.profile, validated.capabilityById, mappings, summary, projection, leanCoverage);
  const outputs = new Map([
    [paths.jsonOutput, stableJson(report)],
    [paths.markdownOutput, markdown(report)],
  ]);
  for (const [relativePath, content] of outputs) {
    const absolute = path.join(root, relativePath);
    if (checkOnly) {
      const existing = await readFile(absolute, 'utf8').catch(() => '');
      assert(existing === content, `${relativePath} is stale; run npm run generate:capability-projection`);
    } else {
      await writeFile(absolute, content);
    }
  }
  console.log(`SafeDocX capability projection valid: ${report.profileDenominator.capabilityAxisPairs} profile pairs; ${report.evidenceInventory.expectedCompleteSummaryRows} complete-run evidence rows`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
