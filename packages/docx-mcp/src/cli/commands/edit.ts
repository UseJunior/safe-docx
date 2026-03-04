/**
 * Batched edit command. Converts repeatable --replace/--insert-after/--insert-before
 * flags into apply_plan steps, then calls dispatchToolCall.
 */
import { SessionManager } from '../../session/manager.js';
import { dispatchToolCall } from '../../server.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplaceStep {
  paragraph_id: string;
  old_string: string;
  new_string: string;
}

export interface InsertStep {
  anchor_id: string;
  text: string;
  position: 'BEFORE' | 'AFTER';
}

export interface EditCommandArgs {
  file_path: string;
  replaces: ReplaceStep[];
  inserts: InsertStep[];
  instruction?: string;
  output_path?: string;
}

// ---------------------------------------------------------------------------
// Argv parser
// ---------------------------------------------------------------------------

export function parseEditArgs(argv: string[]): EditCommandArgs {
  const replaces: ReplaceStep[] = [];
  const inserts: InsertStep[] = [];
  let file_path: string | undefined;
  let instruction: string | undefined;
  let output_path: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;

    if (!token.startsWith('-') && file_path === undefined) {
      file_path = token;
      i++;
      continue;
    }

    switch (token) {
      case '--replace': {
        const paraId = argv[i + 1];
        const oldStr = argv[i + 2];
        const newStr = argv[i + 3];
        if (!paraId || !oldStr || newStr === undefined) {
          throw new Error('--replace requires 3 arguments: <paragraph_id> <old_string> <new_string>');
        }
        replaces.push({ paragraph_id: paraId, old_string: oldStr, new_string: newStr });
        i += 4;
        break;
      }
      case '--insert-after': {
        const anchorId = argv[i + 1];
        const text = argv[i + 2];
        if (!anchorId || text === undefined) {
          throw new Error('--insert-after requires 2 arguments: <anchor_id> <text>');
        }
        inserts.push({ anchor_id: anchorId, text, position: 'AFTER' });
        i += 3;
        break;
      }
      case '--insert-before': {
        const anchorId = argv[i + 1];
        const text = argv[i + 2];
        if (!anchorId || text === undefined) {
          throw new Error('--insert-before requires 2 arguments: <anchor_id> <text>');
        }
        inserts.push({ anchor_id: anchorId, text, position: 'BEFORE' });
        i += 3;
        break;
      }
      case '--instruction': {
        const val = argv[i + 1];
        if (!val) throw new Error('--instruction requires a value');
        instruction = val;
        i += 2;
        break;
      }
      case '-o':
      case '--output': {
        const val = argv[i + 1];
        if (!val) throw new Error(`${token} requires a value`);
        output_path = val;
        i += 2;
        break;
      }
      case '--help':
      case '-h':
        // Handled by caller — just skip
        i++;
        break;
      default:
        throw new Error(`Unknown edit flag: ${token}`);
    }
  }

  if (!file_path) {
    throw new Error('edit requires a file path as the first positional argument');
  }

  if (replaces.length === 0 && inserts.length === 0) {
    throw new Error('edit requires at least one --replace, --insert-after, or --insert-before');
  }

  return { file_path, replaces, inserts, instruction, output_path };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface EditCommandIO {
  write: (line: string) => void;
  writeError: (line: string) => void;
}

export async function runEditCommand(args: EditCommandArgs, opts: EditCommandIO): Promise<void> {
  const mgr = new SessionManager();
  const defaultInstruction = args.instruction ?? 'CLI batch edit';

  // Build apply_plan steps
  let stepCounter = 0;
  const steps: Record<string, unknown>[] = [];

  for (const r of args.replaces) {
    stepCounter++;
    steps.push({
      step_id: `cli_replace_${stepCounter}`,
      operation: 'replace_text',
      target_paragraph_id: r.paragraph_id,
      old_string: r.old_string,
      new_string: r.new_string,
      instruction: defaultInstruction,
    });
  }

  for (const ins of args.inserts) {
    stepCounter++;
    steps.push({
      step_id: `cli_insert_${stepCounter}`,
      operation: 'insert_paragraph',
      positional_anchor_node_id: ins.anchor_id,
      new_string: ins.text,
      instruction: defaultInstruction,
      position: ins.position,
    });
  }

  // Apply plan
  const applyResult = await dispatchToolCall(mgr, 'apply_plan', {
    file_path: args.file_path,
    steps,
  });

  const applySuccess = (applyResult as { success?: boolean }).success;
  if (applySuccess === false) {
    opts.writeError(JSON.stringify(applyResult, null, 2));
    throw new Error('Edit apply_plan failed');
  }

  // Save if output path specified
  if (args.output_path) {
    const saveResult = await dispatchToolCall(mgr, 'save', {
      file_path: args.file_path,
      save_to_local_path: args.output_path,
    });

    const saveSuccess = (saveResult as { success?: boolean }).success;
    if (saveSuccess === false) {
      opts.writeError(JSON.stringify(saveResult, null, 2));
      throw new Error('Edit save failed');
    }

    opts.write(JSON.stringify({ apply: applyResult, save: saveResult }, null, 2));
  } else {
    opts.write(JSON.stringify(applyResult, null, 2));
  }
}
