import { assertRevisionFidelity, readRevisionFidelityParts } from '@usejunior/docx-core';
import { resolveEffectiveStoryBindings } from './effectiveStoryBindings.js';
import { normalizeVolatilePagerefCachesForComparison } from '../fieldComparisonSemantics.js';
import { acceptAllChanges, rejectAllChanges, normalizeLayoutPreservingText } from './trackChangesAcceptorAst.js';

/** Validate final published bytes using comparison's established field and revision projections. */
export async function assertComparisonRevisionFidelity(source: Uint8Array, intended: Uint8Array, output: Uint8Array): Promise<void> {
  const [sourceParts, intendedParts, outputParts] = await Promise.all([
    readRevisionFidelityParts(source), readRevisionFidelityParts(intended), readRevisionFidelityParts(output),
  ]);
  assertRevisionFidelity({source:sourceParts,intended:intendedParts,output:outputParts},{
    project:(xml,side) => side === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml),
    normalizeXml:xml => /PAGEREF/iu.test(xml) ? normalizeVolatilePagerefCachesForComparison(xml) : xml,
    normalizeText:normalizeLayoutPreservingText,
    checkFormatting: false,
    resolveStoryBindings: (documentXml, parts) => resolveEffectiveStoryBindings({
      documentXml,
      relationshipsXml: parts['word/_rels/document.xml.rels'],
      settingsXml: parts['word/settings.xml'],
    }).slots.flatMap(slot => slot.targetPath ? [{ ...slot, targetPath: slot.targetPath }] : []),
  });
}
