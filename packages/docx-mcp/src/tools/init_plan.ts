import { randomBytes } from 'node:crypto';
import { errorCode, errorMessage } from "../error_utils.js";
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';

function createPlanContextId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(12);
  let suffix = '';
  for (let i = 0; i < 12; i += 1) {
    suffix += alphabet[bytes[i]! % alphabet.length];
  }
  return `plctx_${suffix}`;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function initPlan(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    plan_name?: string;
    orchestrator_id?: string;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'init_plan' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    return ok(mergeSessionResolutionMetadata({
      plan_context_id: createPlanContextId(),
      session_id: session.sessionId,
      base_revision: session.editRevision,
      edit_count: session.editCount,
      created_at: new Date().toISOString(),
      plan_context: {
        plan_name: optionalString(params.plan_name) ?? null,
        orchestrator_id: optionalString(params.orchestrator_id) ?? null,
        document_filename: session.filename,
      },
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('PLAN_INIT_ERROR', `Failed to initialize plan context: ${msg}`);
  }
}
