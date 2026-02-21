import { SessionManager } from '../session/manager.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const TRACKED_CHANGE_LOCALS = ['ins', 'del', 'moveFrom', 'moveTo'] as const;
const PROPERTY_CHANGE_LOCALS = [
  'rPrChange', 'pPrChange', 'sectPrChange',
  'tblPrChange', 'trPrChange', 'tcPrChange',
] as const;

type TrackedChangeMarkerStats = {
  total_markers: number;
  content_markers: number;
  property_markers: number;
  insertions: number;
  deletions: number;
  move_from: number;
  move_to: number;
  rpr_changes: number;
  ppr_changes: number;
  sectpr_changes: number;
  tblpr_changes: number;
  trpr_changes: number;
  tcpr_changes: number;
};

function countMarkers(doc: Document): TrackedChangeMarkerStats {
  const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0) as Element | null;
  if (!body) {
    return {
      total_markers: 0,
      content_markers: 0,
      property_markers: 0,
      insertions: 0,
      deletions: 0,
      move_from: 0,
      move_to: 0,
      rpr_changes: 0,
      ppr_changes: 0,
      sectpr_changes: 0,
      tblpr_changes: 0,
      trpr_changes: 0,
      tcpr_changes: 0,
    };
  }

  const countByLocal = (localName: string): number => body.getElementsByTagNameNS(W_NS, localName).length;

  const contentCounts = {
    insertions: countByLocal(TRACKED_CHANGE_LOCALS[0]),
    deletions: countByLocal(TRACKED_CHANGE_LOCALS[1]),
    move_from: countByLocal(TRACKED_CHANGE_LOCALS[2]),
    move_to: countByLocal(TRACKED_CHANGE_LOCALS[3]),
  };

  const propertyCounts = {
    rpr_changes: countByLocal(PROPERTY_CHANGE_LOCALS[0]),
    ppr_changes: countByLocal(PROPERTY_CHANGE_LOCALS[1]),
    sectpr_changes: countByLocal(PROPERTY_CHANGE_LOCALS[2]),
    tblpr_changes: countByLocal(PROPERTY_CHANGE_LOCALS[3]),
    trpr_changes: countByLocal(PROPERTY_CHANGE_LOCALS[4]),
    tcpr_changes: countByLocal(PROPERTY_CHANGE_LOCALS[5]),
  };

  const content_markers = Object.values(contentCounts).reduce((sum, value) => sum + value, 0);
  const property_markers = Object.values(propertyCounts).reduce((sum, value) => sum + value, 0);

  return {
    total_markers: content_markers + property_markers,
    content_markers,
    property_markers,
    ...contentCounts,
    ...propertyCounts,
  };
}

export async function hasTrackedChanges_tool(
  manager: SessionManager,
  params: { session_id?: string; file_path?: string },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'has_tracked_changes' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const docClone = session.doc.getDocumentXmlClone();
    const marker_stats = countMarkers(docClone);

    return ok(mergeSessionResolutionMetadata({
      session_id: session.sessionId,
      edit_revision: session.editRevision,
      has_tracked_changes: marker_stats.total_markers > 0,
      scope: 'document_body',
      marker_stats,
    }, metadata));
  } catch (e: any) {
    return err('TRACKED_CHANGES_CHECK_ERROR', e?.message ?? String(e));
  }
}
