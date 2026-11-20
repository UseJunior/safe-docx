import { assertRevisionFidelity, readRevisionFidelityParts } from '@usejunior/docx-core';
import { renameBookmarkTargetsInXml } from './bookmarkProjectionCompatibility.js';
import { resolveEffectiveStoryBindings } from './effectiveStoryBindings.js';
import { normalizeVolatilePagerefCachesForComparison } from '../fieldComparisonSemantics.js';
import { acceptAllChanges, rejectAllChanges, normalizeLayoutPreservingText } from './trackChangesAcceptorAst.js';

/** Validate final published bytes using comparison's established field and revision projections. */
export async function assertComparisonRevisionFidelity(
  source: Uint8Array,
  intended: Uint8Array,
  output: Uint8Array,
  originalBookmarkNames: ReadonlyMap<string, string>,
): Promise<void> {
  const [sourceParts, intendedParts, outputParts] = await Promise.all([
    readRevisionFidelityParts(source), readRevisionFidelityParts(intended), readRevisionFidelityParts(output),
  ]);
  assertRevisionFidelity({source:sourceParts,intended:intendedParts,output:outputParts},{
    project:(xml,side) => side === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml),
    normalizeXml: (xml, side) => {
      const restored = side === 'reject' && originalBookmarkNames.size > 0
        ? renameBookmarkTargetsInXml(xml, originalBookmarkNames).xml
        : xml;
      return /PAGEREF/iu.test(restored) ? normalizeVolatilePagerefCachesForComparison(restored) : restored;
    },
    normalizeText:normalizeLayoutPreservingText,
    checkFormatting: false,
    resolveStoryBindings: (documentXml, parts) => resolveEffectiveStoryBindings({
      documentXml,
      relationshipsXml: parts['word/_rels/document.xml.rels'],
      settingsXml: parts['word/settings.xml'],
    }).slots.flatMap(slot => slot.targetPath ? [{ ...slot, targetPath: slot.targetPath }] : []),
  });
}
