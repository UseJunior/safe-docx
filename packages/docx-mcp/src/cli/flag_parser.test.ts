import { describe, expect } from 'vitest';
import { itAllure } from '../testing/allure-test.js';
import { parseToolFlags, generateToolHelp } from './flag_parser.js';

const it = itAllure.epic('Document Editing').withLabels({ feature: 'CLI Flag Parser' });

describe('parseToolFlags', () => {
  describe('basic types', () => {
    it('parses string flags for read_file', () => {
      const { args } = parseToolFlags(['test.docx', '--format', 'json'], 'read_file');
      expect(args.file_path).toBe('test.docx');
      expect(args.format).toBe('json');
    });

    it('parses number flags', () => {
      const { args } = parseToolFlags(['test.docx', '--offset', '5', '--limit', '10'], 'read_file');
      expect(args.offset).toBe(5);
      expect(args.limit).toBe(10);
    });

    it('parses boolean flags with explicit values', () => {
      const { args } = parseToolFlags(['test.docx', '--show-formatting', 'false'], 'read_file');
      expect(args.show_formatting).toBe(false);
    });

    it('parses boolean flags as bare flags (true)', () => {
      const { args } = parseToolFlags(['test.docx', '--show-formatting'], 'read_file');
      expect(args.show_formatting).toBe(true);
    });

    it('parses enum flags and rejects invalid values', () => {
      const { args } = parseToolFlags(['test.docx', '--format', 'toon'], 'read_file');
      expect(args.format).toBe('toon');

      expect(() => parseToolFlags(['test.docx', '--format', 'invalid'], 'read_file')).toThrow(
        'Invalid value for --format',
      );
    });
  });

  describe('array flags', () => {
    it('collects repeatable array flags', () => {
      const { args } = parseToolFlags(
        ['test.docx', '--patterns', 'foo', '--patterns', 'bar'],
        'grep',
      );
      expect(args.patterns).toEqual(['foo', 'bar']);
    });

    it('supports single array value', () => {
      const { args } = parseToolFlags(['test.docx', '--patterns', 'hello'], 'grep');
      expect(args.patterns).toEqual(['hello']);
    });
  });

  describe('object flags (JSON strings)', () => {
    it('parses JSON string for nested object params', () => {
      const { args } = parseToolFlags(
        ['test.docx', '--paragraph-spacing', '{"before_twips": 120}'],
        'format_layout',
      );
      expect(args.paragraph_spacing).toEqual({ before_twips: 120 });
    });

    it('rejects invalid JSON', () => {
      expect(() =>
        parseToolFlags(['test.docx', '--paragraph-spacing', 'not-json'], 'format_layout'),
      ).toThrow('Invalid JSON');
    });
  });

  describe('positional file_path extraction', () => {
    it('treats first positional arg as file_path', () => {
      const { args } = parseToolFlags(['/path/to/doc.docx'], 'read_file');
      expect(args.file_path).toBe('/path/to/doc.docx');
    });

    it('uses --file-path flag when explicitly provided', () => {
      const { args } = parseToolFlags(['--file-path', '/explicit.docx'], 'read_file');
      expect(args.file_path).toBe('/explicit.docx');
    });

    it('does not consume positional as file_path for tools without that param', () => {
      expect(() => parseToolFlags(['extra-arg'], 'merge_plans')).toThrow(
        'Unexpected positional argument',
      );
    });
  });

  describe('short alias resolution', () => {
    it('resolves --para alias for replace_text', () => {
      const { args } = parseToolFlags(
        ['test.docx', '--para', '_bk_x', '--old', 'hello', '--new', 'world', '--instruction', 'fix'],
        'replace_text',
      );
      expect(args.target_paragraph_id).toBe('_bk_x');
      expect(args.old_string).toBe('hello');
      expect(args.new_string).toBe('world');
    });

    it('resolves -o alias for save', () => {
      const { args } = parseToolFlags(['test.docx', '-o', '/out.docx'], 'save');
      expect(args.save_to_local_path).toBe('/out.docx');
    });

    it('resolves global --session alias', () => {
      const { args } = parseToolFlags(['--session', 'ses_abc123def456'], 'read_file');
      expect(args.session_id).toBe('ses_abc123def456');
    });
  });

  describe('required field validation', () => {
    it('throws on missing required fields', () => {
      expect(() => parseToolFlags(['test.docx'], 'replace_text')).toThrow(
        'Missing required parameter',
      );
    });

    it('does not throw when all required fields are provided', () => {
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
    it('rejects flags not in the schema', () => {
      expect(() => parseToolFlags(['test.docx', '--bogus', 'val'], 'read_file')).toThrow(
        'Unknown flag: --bogus',
      );
    });
  });

  describe('help flag detection', () => {
    it('detects --help', () => {
      const { help } = parseToolFlags(['--help'], 'read_file');
      expect(help).toBe(true);
    });

    it('detects -h', () => {
      const { help } = parseToolFlags(['-h'], 'read_file');
      expect(help).toBe(true);
    });

    it('skips required field validation when help is requested', () => {
      expect(() => parseToolFlags(['--help'], 'replace_text')).not.toThrow();
    });
  });

  describe('number coercion', () => {
    it('rejects NaN for number flags', () => {
      expect(() => parseToolFlags(['test.docx', '--offset', 'abc'], 'read_file')).toThrow(
        'Invalid number',
      );
    });

    it('parses negative numbers', () => {
      const { args } = parseToolFlags(['test.docx', '--offset', '-5'], 'read_file');
      expect(args.offset).toBe(-5);
    });
  });
});

describe('generateToolHelp', () => {
  it('produces help text for read_file with description and flags', () => {
    const help = generateToolHelp('read_file');
    expect(help).toContain('safe-docx read-file');
    expect(help).toContain('Read document content');
    expect(help).toContain('--format');
    expect(help).toContain('--offset');
    expect(help).toContain('--limit');
  });

  it('marks required params', () => {
    const help = generateToolHelp('replace_text');
    expect(help).toContain('(required)');
    expect(help).toContain('--target-paragraph-id');
  });

  it('shows aliases', () => {
    const help = generateToolHelp('save');
    expect(help).toContain('-o');
  });

  it('throws for unknown tool', () => {
    expect(() => generateToolHelp('nonexistent_tool')).toThrow('Unknown tool');
  });
});
