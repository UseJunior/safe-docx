import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
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
  if (packageParts.some((part) => part.includes('header'))) stories.push('headers');
  if (packageParts.some((part) => part.includes('footer'))) stories.push('footers');
  return stories.length > 0 ? stories : ['main'];
}

function validateNeutralResult(claim, summary, mappings) {
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
  for (const scenarioId of row.scenarioIds) {
    const mapped = mappings.mappings.some((mapping) =>
      mapping.scenarioId === scenarioId
      && mapping.capabilityId === claim.capabilityId
      && (claim.axis === 'crossPlatform' || mapping.axis === claim.axis)
    );
    assert(mapped, `${claim.capabilityId}/${claim.axis}: result scenario is absent from pinned mappings: ${scenarioId}`);
  }
  if (claim.axis === 'crossPlatform') {
    const passingAdapters = Object.values(row.outcomes).filter(
      (outcome) => outcome.denominator > 0 && outcome.passLike === outcome.denominator
    );
    assert(passingAdapters.length >= 2, `${claim.capabilityId}/crossPlatform: fewer than two passing adapters`);
  }
}

async function validateEvidence(claim, summary, mappings, leanCoverage, repositoryRoot) {
  if (!POSITIVE_STATUSES.has(claim.status)) {
    assert(claim.evidence.length === 0, `${claim.capabilityId}/${claim.axis}: non-positive status must not carry evidence`);
    return;
  }
  assert(claim.evidence.length > 0, `${claim.capabilityId}/${claim.axis}: positive status requires executable evidence`);
  let executable = false;
  for (const evidence of claim.evidence) {
    const absolute = path.resolve(repositoryRoot, evidence.path);
    assert(
      absolute.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`),
      `${claim.capabilityId}/${claim.axis}: evidence path escapes repository`
    );
    await access(absolute);
    if (evidence.kind === 'local-test') {
      assert(evidence.implementationVersion === claim.implementationVersion, `${claim.capabilityId}/${claim.axis}: local evidence version disagrees with claim`);
      assert(evidence.lastVerifiedCommit === claim.lastVerifiedCommit, `${claim.capabilityId}/${claim.axis}: local evidence commit disagrees with claim`);
      const source = await readFile(absolute, 'utf8');
      assert(source.includes(evidence.selector), `${claim.capabilityId}/${claim.axis}: test selector not found: ${evidence.selector}`);
      executable = true;
    } else if (evidence.kind === 'neutral-result') {
      const adapterVersion = summary.sourceResults.implementations.find((item) => item.adapterName === 'safe-docx')?.adapterVersion;
      const match = /^(\d+\.\d+\.\d+)\+git\.([a-f0-9]{7,40})$/.exec(adapterVersion ?? '');
      assert(match, `${claim.capabilityId}/${claim.axis}: pinned neutral result lacks SafeDocX version provenance`);
      assert(evidence.implementationVersion === match[1], `${claim.capabilityId}/${claim.axis}: neutral evidence version disagrees with result`);
      assert(evidence.lastVerifiedCommit.startsWith(match[2]), `${claim.capabilityId}/${claim.axis}: neutral evidence commit disagrees with result`);
      const expectedClass = claim.axis === 'crossPlatform' ? 'cross-implementation-differential' : 'normative-behavioral-scenario';
      assert(evidence.evidenceClass === expectedClass, `${claim.capabilityId}/${claim.axis}: neutral evidence class must be ${expectedClass}`);
      validateNeutralResult(claim, summary, mappings);
      executable = true;
    } else if (evidence.kind === 'lean-checker') {
      assert(
        claim.capabilityId === 'word.revisions.content' && claim.axis === 'acceptReject',
        `${claim.capabilityId}/${claim.axis}: Lean checker does not cover this capability axis`
      );
      const coveredModes = new Set(leanCoverage.scope.reconstructionModes.covered);
      for (const mode of evidence.reconstructionModes) {
        assert(coveredModes.has(mode), `${claim.capabilityId}/${claim.axis}: Lean does not cover ${mode} mode`);
      }
      const coveredStories = new Set(['main', 'footnotes', 'endnotes']);
      for (const story of evidence.stories) {
        assert(coveredStories.has(story), `${claim.capabilityId}/${claim.axis}: Lean does not cover ${story}`);
      }
      executable = true;
    }
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
  const { pin, capabilities, profiles, mappings, summary, projection, leanCoverage } = inputs;
  assert(capabilities.schemaVersion === pin.registrySchemaVersion, 'capabilities schemaVersion disagrees with pin');
  assert(capabilities.registryVersion === pin.registryVersion, 'capabilities registryVersion disagrees with pin');
  assert(profiles.schemaVersion === pin.registrySchemaVersion, 'profiles schemaVersion disagrees with pin');
  assert(profiles.registryVersion === pin.registryVersion, 'profiles registryVersion disagrees with pin');
  assert(mappings.registryVersion === pin.registryVersion, 'mapping registryVersion disagrees with pin');
  assert(summary.registryVersion === pin.registryVersion, 'result registryVersion disagrees with pin');
  assert(projection.profileId === pin.profileId, 'projection profileId disagrees with pin');

  const capabilityById = new Map(capabilities.capabilities.map((capability) => [capability.id, capability]));
  assert(capabilityById.size === capabilities.capabilities.length, 'neutral capabilities contain duplicate IDs');
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
    assert(
      JSON.stringify(claim.scope.packageParts) === JSON.stringify(capability.packageParts),
      `${claim.capabilityId}/${claim.axis}: package-part scope disagrees with neutral capability`
    );
    assert(
      JSON.stringify(claim.scope.stories) === JSON.stringify(expectedStories(capability.packageParts)),
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
    await validateEvidence(claim, summary, mappings, leanCoverage, repositoryRoot);
  }
  const missing = [...expected].filter((key) => !actual.has(key)).map((key) => key.replace('\u0000', '/'));
  const extra = [...actual].filter((key) => !expected.has(key)).map((key) => key.replace('\u0000', '/'));
  assert(missing.length === 0, `projection is missing denominator pairs: ${missing.join(', ')}`);
  assert(extra.length === 0, `projection has extra denominator pairs: ${extra.join(', ')}`);
  return { profile, capabilityById, denominator: expected.size };
}

function generateReport(pin, profile, capabilityById, mappings, summary, projection) {
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
  const report = generateReport(pin, validated.profile, validated.capabilityById, mappings, summary, projection);
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
