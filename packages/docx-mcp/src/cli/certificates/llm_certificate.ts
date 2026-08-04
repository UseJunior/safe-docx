import type {
  DocumentIntegrityCertificate,
  DocumentIntegrityCheckCertificate,
  DocumentIntegrityCheckStatus,
  DocumentIntegrityRelationshipStory,
  DocumentIntegrityStoryCertificate,
} from '@usejunior/docx-compare';

export type CertificateFormat = 'full' | 'llm';

export const LLM_CERTIFICATE_SCHEMA_ID = 'safe-docx.llm-verification-certificate' as const;

const INVARIANTS = [
  {
    id: 'accept_all_matches_revised',
    claim: 'Accepting all tracked changes yields the revised story text.',
  },
  {
    id: 'reject_all_matches_original',
    claim: 'Rejecting all tracked changes yields the original story text.',
  },
  {
    id: 'accept_all_fields_valid',
    claim: 'Accepting all tracked changes preserves valid field structure.',
  },
  {
    id: 'reject_all_fields_valid',
    claim: 'Rejecting all tracked changes preserves valid field structure.',
  },
  {
    id: 'no_field_markers_in_deletions',
    claim: 'The compared story has no field markers inside deletions.',
  },
  {
    id: 'move_ranges_paired',
    claim: 'Tracked move ranges are correctly paired.',
  },
] as const;

export type LlmInvariantId = (typeof INVARIANTS)[number]['id'];

type TokenCounts = { original: number; revised: number; compared: number };

interface LlmFixedStory {
  id: string;
  category: 'fixed';
  name: DocumentIntegrityStoryCertificate['name'];
  status: DocumentIntegrityStoryCertificate['status'];
  presence?: DocumentIntegrityStoryCertificate['presence'];
  parsedTokenCounts?: TokenCounts;
}

interface LlmRelationshipStory {
  id: string;
  category: 'relationship';
  kind: DocumentIntegrityRelationshipStory['kind'];
  physicalStoryOrdinal: number;
  status: DocumentIntegrityRelationshipStory['status'];
  partPaths: {
    original: string;
    revised: string;
    compared: string;
  };
  selectingSlotOrdinals: number[];
  parsedTokenCounts: TokenCounts;
}

export interface LlmVerificationCertificate {
  schemaId: typeof LLM_CERTIFICATE_SCHEMA_ID;
  schemaVersion: 1;
  verdict: DocumentIntegrityCertificate['status'];
  reconstructionMode: DocumentIntegrityCertificate['reconstructionMode'];
  scope: {
    fixedStories: number;
    relationshipStories: number;
    noteStories: number;
    commentStories: number;
    exclusions: string[];
  };
  statusSummary: {
    genericStories: { passed: number; failed: number };
    invariantRelations: Record<DocumentIntegrityCheckStatus, number>;
    noteStories: Record<'passed' | 'failed' | 'not_evaluated', number>;
    commentStories: Record<'passed' | 'failed' | 'not_evaluated', number>;
  };
  anomalies: {
    presenceMismatches: NonNullable<DocumentIntegrityCertificate['presenceMismatches']>;
    fixedStoryFailures: NonNullable<DocumentIntegrityCertificate['fixedStoryFailures']>;
    relationshipSelectionFailures: NonNullable<
      DocumentIntegrityCertificate['relationshipSelectionFailures']
    >;
    noteIntegrityFailures: NonNullable<DocumentIntegrityCertificate['noteIntegrityFailures']>;
    commentIntegrityFailures: NonNullable<
      DocumentIntegrityCertificate['commentIntegrityFailures']
    >;
  };
  reason?: string;
  verifier: {
    name: DocumentIntegrityCertificate['verifier'];
    publicCertificateProtocolVersion: DocumentIntegrityCertificate['protocolVersion'];
    checkerProtocolVersion?: NonNullable<DocumentIntegrityCertificate['checkerProtocolVersion']>;
  };
  hashes: {
    mainDocumentXml: DocumentIntegrityCertificate['inputSha256'];
    packages?: NonNullable<DocumentIntegrityCertificate['inputPackageSha256']>;
  };
  invariantDefinitions: ReadonlyArray<(typeof INVARIANTS)[number]>;
  stories: Array<LlmFixedStory | LlmRelationshipStory>;
  resultSets: Array<{
    storyIds: string[];
    passedInvariantIds: LlmInvariantId[];
    failedInvariantIds: LlmInvariantId[];
    notEvaluatedInvariantIds: LlmInvariantId[];
  }>;
  protocolEvidence: {
    fixedStoryScope?: DocumentIntegrityCertificate['fixedStoryScope'];
    relationshipStoryScope?: DocumentIntegrityCertificate['relationshipStoryScope'];
    relationshipSlots: NonNullable<DocumentIntegrityCertificate['relationshipSlots']>;
    noteStoryScope?: DocumentIntegrityCertificate['noteStoryScope'];
    referenceSourcePartitions: NonNullable<
      DocumentIntegrityCertificate['referenceSourcePartitions']
    >;
    noteStories: NonNullable<DocumentIntegrityCertificate['noteStories']>;
    noteInventories: NonNullable<DocumentIntegrityCertificate['noteInventories']>;
    commentStoryScope?: DocumentIntegrityCertificate['commentStoryScope'];
    commentRangeTopology?: DocumentIntegrityCertificate['commentRangeTopology'];
    commentStory?: DocumentIntegrityCertificate['commentStory'];
    commentInventories: NonNullable<DocumentIntegrityCertificate['commentInventories']>;
  };
}

type GenericChecks = {
  acceptingAllTrackedChangesMatchesRevisedText: DocumentIntegrityCheckCertificate;
  rejectingAllTrackedChangesMatchesOriginalText: DocumentIntegrityCheckCertificate;
  acceptingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityCheckCertificate;
  rejectingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityCheckCertificate;
  comparedStoryHasNoFieldMarkersInsideDeletions?: DocumentIntegrityCheckCertificate;
  comparedDocumentHasNoFieldMarkersInsideDeletions?: DocumentIntegrityCheckCertificate;
  trackedMoveRangesAreCorrectlyPaired?: DocumentIntegrityCheckCertificate;
};

function checkStatuses(checks: GenericChecks): Record<LlmInvariantId, DocumentIntegrityCheckStatus> {
  const fieldMarkerCheck =
    checks.comparedStoryHasNoFieldMarkersInsideDeletions ??
    checks.comparedDocumentHasNoFieldMarkersInsideDeletions;
  return {
    accept_all_matches_revised: checks.acceptingAllTrackedChangesMatchesRevisedText.status,
    reject_all_matches_original: checks.rejectingAllTrackedChangesMatchesOriginalText.status,
    accept_all_fields_valid: checks.acceptingAllTrackedChangesKeepsValidFieldStructure.status,
    reject_all_fields_valid: checks.rejectingAllTrackedChangesKeepsValidFieldStructure.status,
    no_field_markers_in_deletions: fieldMarkerCheck?.status ?? 'not_evaluated',
    move_ranges_paired: checks.trackedMoveRangesAreCorrectlyPaired?.status ?? 'not_evaluated',
  };
}

function fixedStories(certificate: DocumentIntegrityCertificate): DocumentIntegrityStoryCertificate[] {
  if (certificate.stories && certificate.stories.length > 0) return certificate.stories;
  return [
    {
      name: 'main',
      status: certificate.status === 'passed' ? 'passed' : 'failed',
      checks: {
        ...certificate.checks,
        comparedStoryHasNoFieldMarkersInsideDeletions:
          certificate.checks.comparedDocumentHasNoFieldMarkersInsideDeletions,
      },
      parsedTokenCounts: certificate.parsedTokenCounts ?? { original: 0, revised: 0, compared: 0 },
      presence: { original: true, revised: true, compared: true },
    },
  ];
}

function incrementStatus<T extends string>(counts: Record<T, number>, status: T): void {
  counts[status] += 1;
}

export function projectLlmVerificationCertificate(
  certificate: DocumentIntegrityCertificate,
): LlmVerificationCertificate {
  const fixed = fixedStories(certificate);
  const relationships = certificate.relationshipStories ?? [];
  const notes = certificate.noteStories ?? [];
  const comments = certificate.commentStory ? [certificate.commentStory] : [];
  const stories: LlmVerificationCertificate['stories'] = [];
  const evaluated: Array<{
    storyId: string;
    statuses: Record<LlmInvariantId, DocumentIntegrityCheckStatus>;
  }> = [];

  for (const story of fixed) {
    const id = `fixed:${story.name}`;
    stories.push({
      id,
      category: 'fixed',
      name: story.name,
      status: story.status,
      presence: story.presence,
      parsedTokenCounts: story.parsedTokenCounts,
    });
    evaluated.push({ storyId: id, statuses: checkStatuses(story.checks) });
  }

  for (const story of relationships) {
    const id = `relationship:${story.physicalStoryOrdinal}:${story.kind}`;
    stories.push({
      id,
      category: 'relationship',
      kind: story.kind,
      physicalStoryOrdinal: story.physicalStoryOrdinal,
      status: story.status,
      partPaths: {
        original: story.originalPartPath,
        revised: story.revisedPartPath,
        compared: story.comparedPartPath,
      },
      selectingSlotOrdinals: story.selectingSlotOrdinals,
      parsedTokenCounts: story.parsedTokenCounts,
    });
    evaluated.push({ storyId: id, statuses: checkStatuses(story.checks) });
  }

  const invariantRelations: Record<DocumentIntegrityCheckStatus, number> = {
    passed: 0,
    failed: 0,
    not_evaluated: 0,
  };
  const grouped = new Map<
    string,
    LlmVerificationCertificate['resultSets'][number]
  >();
  for (const story of evaluated) {
    const passedInvariantIds: LlmInvariantId[] = [];
    const failedInvariantIds: LlmInvariantId[] = [];
    const notEvaluatedInvariantIds: LlmInvariantId[] = [];
    for (const invariant of INVARIANTS) {
      const status = story.statuses[invariant.id];
      incrementStatus(invariantRelations, status);
      if (status === 'passed') passedInvariantIds.push(invariant.id);
      else if (status === 'failed') failedInvariantIds.push(invariant.id);
      else notEvaluatedInvariantIds.push(invariant.id);
    }
    const key = JSON.stringify([passedInvariantIds, failedInvariantIds, notEvaluatedInvariantIds]);
    const existing = grouped.get(key);
    if (existing) existing.storyIds.push(story.storyId);
    else {
      grouped.set(key, {
        storyIds: [story.storyId],
        passedInvariantIds,
        failedInvariantIds,
        notEvaluatedInvariantIds,
      });
    }
  }

  const genericStories = { passed: 0, failed: 0 };
  for (const story of [...fixed, ...relationships]) incrementStatus(genericStories, story.status);
  const noteStories = { passed: 0, failed: 0, not_evaluated: 0 };
  for (const story of notes) incrementStatus(noteStories, story.status);
  const commentStories = { passed: 0, failed: 0, not_evaluated: 0 };
  for (const story of comments) incrementStatus(commentStories, story.status);

  return {
    schemaId: LLM_CERTIFICATE_SCHEMA_ID,
    schemaVersion: 1,
    verdict: certificate.status,
    reconstructionMode: certificate.reconstructionMode,
    scope: {
      fixedStories: fixed.length,
      relationshipStories: relationships.length,
      noteStories: notes.length,
      commentStories: comments.length,
      exclusions: certificate.exclusions ?? [],
    },
    statusSummary: { genericStories, invariantRelations, noteStories, commentStories },
    anomalies: {
      presenceMismatches: certificate.presenceMismatches ?? [],
      fixedStoryFailures: certificate.fixedStoryFailures ?? [],
      relationshipSelectionFailures: certificate.relationshipSelectionFailures ?? [],
      noteIntegrityFailures: certificate.noteIntegrityFailures ?? [],
      commentIntegrityFailures: certificate.commentIntegrityFailures ?? [],
    },
    ...(certificate.reason === undefined ? {} : { reason: certificate.reason }),
    verifier: {
      name: certificate.verifier,
      publicCertificateProtocolVersion: certificate.protocolVersion,
      ...(certificate.checkerProtocolVersion === undefined
        ? {}
        : { checkerProtocolVersion: certificate.checkerProtocolVersion }),
    },
    hashes: {
      mainDocumentXml: certificate.inputSha256,
      ...(certificate.inputPackageSha256 === undefined
        ? {}
        : { packages: certificate.inputPackageSha256 }),
    },
    invariantDefinitions: INVARIANTS,
    stories,
    resultSets: [...grouped.values()],
    protocolEvidence: {
      ...(certificate.fixedStoryScope === undefined
        ? {}
        : { fixedStoryScope: certificate.fixedStoryScope }),
      ...(certificate.relationshipStoryScope === undefined
        ? {}
        : { relationshipStoryScope: certificate.relationshipStoryScope }),
      relationshipSlots: certificate.relationshipSlots ?? [],
      ...(certificate.noteStoryScope === undefined ? {} : { noteStoryScope: certificate.noteStoryScope }),
      referenceSourcePartitions: certificate.referenceSourcePartitions ?? [],
      noteStories: notes,
      noteInventories: certificate.noteInventories ?? [],
      ...(certificate.commentStoryScope === undefined
        ? {}
        : { commentStoryScope: certificate.commentStoryScope }),
      ...(certificate.commentRangeTopology === undefined
        ? {}
        : { commentRangeTopology: certificate.commentRangeTopology }),
      ...(certificate.commentStory === undefined ? {} : { commentStory: certificate.commentStory }),
      commentInventories: certificate.commentInventories ?? [],
    },
  };
}
