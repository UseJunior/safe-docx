import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseToolFlags, generateToolHelp } from './flag_parser.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'CLI Flag Parser' });

describe('parseToolFlags', () => {
  describe('basic types', () => {
    test('parses string flags for read_file', () => {
      const { args } = parseToolFlags(['test.docx', '--format', 'json'], 'read_file');
      expect(args.file_path).toBe('test.docx');
      expect(args.format).toBe('json');
    });

    test('parses number flags', () => {
      const { args } = parseToolFlags(['test.docx', '--offset', '5', '--limit', '10'], 'read_file');
      expect(args.offset).toBe(5);
      expect(args.limit).toBe(10);
    });

    test('parses boolean flags with explicit values', () => {
      const { args } = parseToolFlags(['test.docx', '--show-formatting', 'false'], 'read_file');
      expect(args.show_formatting).toBe(false);
    });

    test('parses boolean flags as bare flags (true)', () => {
      const { args } = parseToolFlags(['test.docx', '--show-formatting'], 'read_file');
      expect(args.show_formatting).toBe(true);
    });

    test('parses enum flags and rejects invalid values', () => {
      const { args } = parseToolFlags(['test.docx', '--format', 'toon'], 'read_file');
      expect(args.format).toBe('toon');

      expect(() => parseToolFlags(['test.docx', '--format', 'invalid'], 'read_file')).toThrow(
        'Invalid value for --format',
      );
    });
  });

  describe('array flags', () => {
    test('collects repeatable array flags', () => {
      const { args } = parseToolFlags(
        ['test.docx', '--patterns', 'foo', '--patterns', 'bar'],
        'grep',
      );
      expect(args.patterns).toEqual(['foo', 'bar']);
    });

    test('supports single array value', () => {
      const { args } = parseToolFlags(['test.docx', '--patterns', 'hello'], 'grep');
      expect(args.patterns).toEqual(['hello']);
    });
  });

  describe('object flags (JSON strings)', () => {
    test('parses JSON string for nested object params', () => {
      const { args } = parseToolFlags(
        ['test.docx', '--paragraph-spacing', '{"before_twips": 120}'],
        'format_layout',
      );
      expect(args.paragraph_spacing).toEqual({ before_twips: 120 });
    });

    test('rejects invalid JSON', () => {
      expect(() =>
        parseToolFlags(['test.docx', '--paragraph-spacing', 'not-json'], 'format_layout'),
      ).toThrow('Invalid JSON');
    });
  });

  describe('positional file_path extraction', () => {
    test('treats first positional arg as file_path', () => {
      const { args } = parseToolFlags(['/path/to/doc.docx'], 'read_file');
      expect(args.file_path).toBe('/path/to/doc.docx');
    });

    test('uses --file-path flag when explicitly provided', () => {
      const { args } = parseToolFlags(['--file-path', '/explicit.docx'], 'read_file');
      expect(args.file_path).toBe('/explicit.docx');
    });

    test('does not consume positional as file_path for tools without that param', () => {
      expect(() => parseToolFlags(['extra-arg'], 'merge_plans')).toThrow(
        'Unexpected positional argument',
      );
    });
  });

  describe('short alias resolution', () => {
    test('resolves --para alias for replace_text', () => {
      const { args } = parseToolFlags(
        ['test.docx', '--para', '_bk_x', '--old', 'hello', '--new', 'world', '--instruction', 'fix'],
        'replace_text',
      );
      expect(args.target_paragraph_id).toBe('_bk_x');
      expect(args.old_string).toBe('hello');
      expect(args.new_string).toBe('world');
    });

    test('resolves -o alias for save', () => {
      const { args } = parseToolFlags(['test.docx', '-o', '/out.docx'], 'save');
      expect(args.save_to_local_path).toBe('/out.docx');
    });

    test('resolves global --session alias', () => {
      const { args } = parseToolFlags(['--session', 'ses_abc123def456'], 'read_file');
      expect(args.session_id).toBe('ses_abc123def456');
    });
  });

  describe('required field validation', () => {
    test('throws on missing required fields', () => {
      expect(() => parseToolFlags(['test.docx'], 'replace_text')).toThrow(
        'Missing required parameter',
      );
    });

    test('does not throw when all required fields are provided', () => {
      expect(() =>
        parseToolFlags(
          [
            'test.docx',
            '--target-paragraph-id', '_bk_1',
            '--old-string', 'a',
            '--new-string', 'b',
            '--instruction', 'fix',
          ],
          'replace_text',
        ),
      ).not.toThrow();
    });
  });

  describe('unknown flag rejection', () => {
    test('rejects flags not in the schema', () => {
      expect(() => parseToolFlags(['test.docx', '--bogus', 'val'], 'read_file')).toThrow(
        'Unknown flag: --bogus',
      );
    });
  });

  describe('help flag detection', () => {
    test('detects --help', () => {
      const { help } = parseToolFlags(['--help'], 'read_file');
      expect(help).toBe(true);
    });

    test('detects -h', () => {
      const { help } = parseToolFlags(['-h'], 'read_file');
      expect(help).toBe(true);
    });

    test('skips required field validation when help is requested', () => {
      expect(() => parseToolFlags(['--help'], 'replace_text')).not.toThrow();
    });
  });

  describe('number coercion', () => {
    test('rejects NaN for number flags', () => {
      expect(() => parseToolFlags(['test.docx', '--offset', 'abc'], 'read_file')).toThrow(
        'Invalid number',
      );
    });

    test('parses negative numbers', () => {
      const { args } = parseToolFlags(['test.docx', '--offset', '-5'], 'read_file');
      expect(args.offset).toBe(-5);
    });
  });
});

describe('generateToolHelp', () => {
  test('produces help text for read_file with description and flags', () => {
    const help = generateToolHelp('read_file');
    expect(help).toContain('safe-docx read-file');
    expect(help).toContain('Read document content');
    expect(help).toContain('--format');
    expect(help).toContain('--offset');
    expect(help).toContain('--limit');
  });

  test('marks required params', () => {
    const help = generateToolHelp('replace_text');
    expect(help).toContain('(required)');
    expect(help).toContain('--target-paragraph-id');
  });

  test('shows aliases', () => {
    const help = generateToolHelp('save');
    expect(help).toContain('-o');
  });

  test('throws for unknown tool', () => {
    expect(() => generateToolHelp('nonexistent_tool')).toThrow('Unknown tool');
  });
});
