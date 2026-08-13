import type { DraftCompletenessReport, MarkdocEditIR } from './types.js';

export function assessDraftCompleteness(
  ir: MarkdocEditIR,
  appliedOperationIds: Iterable<string>,
  revisedText?: string,
): DraftCompletenessReport {
  const applied = new Set(appliedOperationIds);
  const waiverByRequirement = new Map((ir.waivers ?? []).map((waiver) => [waiver.requirementId, waiver]));

  const changeSets = (ir.changeSets ?? []).map((set) => {
    const appliedOperations = set.operationIds.filter((id) => applied.has(id));
    const missingOperations = set.operationIds.filter((id) => !applied.has(id));
    return { id: set.id, complete: missingOperations.length === 0, appliedOperations, missingOperations };
  });

  const requirements = (ir.requirements ?? []).map((requirement) => {
    const satisfiedBy = requirement.satisfiedBy.filter((id) => applied.has(id));
    const missingOperations = requirement.satisfiedBy.filter((id) => !applied.has(id));
    const satisfied = requirement.mode === 'any' ? satisfiedBy.length > 0 : missingOperations.length === 0;
    const waiver = waiverByRequirement.get(requirement.id);
    return {
      id: requirement.id,
      status: satisfied ? 'satisfied' as const : waiver ? 'waived' as const : 'blocked' as const,
      satisfiedBy,
      missingOperations,
      waiver: satisfied ? undefined : waiver,
    };
  });

  const assertions = (ir.assertions ?? []).map((assertion) => {
    const found = revisedText === undefined ? false : revisedText.includes(assertion.text);
    return { ...assertion, passed: revisedText !== undefined && (assertion.kind === 'present' ? found : !found) };
  });
  const passed = changeSets.every((set) => set.complete)
    && requirements.every((requirement) => requirement.status !== 'blocked')
    && assertions.every((assertion) => assertion.passed);
  return { requirements, changeSets, assertions, passed };
}
