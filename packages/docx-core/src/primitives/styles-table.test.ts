import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import { extractEffectiveRunFormatting, parseStylesXml, type RunFormatting } from './styles.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Effective Run Formatting',
});

const STYLES = (inner: string): string =>
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  inner;

const TABLE_STYLE = (styleId: string, body: string, extra = ''): string =>
  `<w:style w:type="table" w:styleId="${styleId}"${extra}><w:name w:val="${styleId}"/>${body}</w:style>`;

const COND = (type: string, rPr: string): string => `<w:tblStylePr w:type="${type}"><w:rPr>${rPr}</w:rPr></w:tblStylePr>`;

type Cell = { rPr?: string; pStyle?: string; pPrExtra?: string; tcPr?: string };

/**
 * Build a document with one table (rows × cols of single-run cells, each run
 * holding its "r,c" coordinates as text) plus a paragraph outside the table,
 * and resolve every run.
 */
function resolveTable(
  stylesInner: string,
  opts: {
    tblPr?: string;
    rows?: number;
    cols?: number;
    cell?: (r: number, c: number) => Cell;
    trPr?: (r: number) => string;
    tblPrEx?: (r: number) => string;
    gridCols?: number;
  } = {},
): { cells: RunFormatting[][]; outside: RunFormatting } {
  const rows = opts.rows ?? 1;
  const cols = opts.cols ?? 1;
  const paragraph = (text: string, cell: Cell = {}): string => {
    const pPrInner = (cell.pStyle ? `<w:pStyle w:val="${cell.pStyle}"/>` : '') + (cell.pPrExtra ?? '');
    return (
      `<w:p>${pPrInner ? `<w:pPr>${pPrInner}</w:pPr>` : ''}` +
      `<w:r><w:rPr>${cell.rPr ?? ''}</w:rPr><w:t>${text}</w:t></w:r></w:p>`
    );
  };
  let table = `<w:tbl><w:tblPr>${opts.tblPr ?? ''}</w:tblPr>`;
  if (opts.gridCols) table += `<w:tblGrid>${'<w:gridCol/>'.repeat(opts.gridCols)}</w:tblGrid>`;
  for (let r = 0; r < rows; r++) {
    const ex = opts.tblPrEx?.(r);
    table += `<w:tr>${ex ? `<w:tblPrEx>${ex}</w:tblPrEx>` : ''}${opts.trPr ? `<w:trPr>${opts.trPr(r)}</w:trPr>` : ''}`;
    for (let c = 0; c < cols; c++) {
      const cell = opts.cell?.(r, c) ?? {};
      table += `<w:tc>${cell.tcPr ? `<w:tcPr>${cell.tcPr}</w:tcPr>` : ''}${paragraph(`${r},${c}`, cell)}</w:tc>`;
    }
    table += '</w:tr>';
  }
  table += '</w:tbl>';
  const document = parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body>${paragraph('outside')}${table}</w:body></w:document>`,
  );
  const styles = parseStylesXml(parseXml(`<w:styles xmlns:w="${OOXML.W_NS}">${stylesInner}</w:styles>`));
  const resolved = new Map<string, RunFormatting>();
  for (const run of Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'r'))) {
    const p = run.parentNode as Element;
    const pPr = Array.from(p.childNodes).find((n) => (n as Element).localName === 'pPr') as Element | undefined;
    const pStyle = pPr?.getElementsByTagNameNS(OOXML.W_NS, 'pStyle').item(0);
    resolved.set(
      run.textContent ?? '',
      extractEffectiveRunFormatting({
        run,
        paragraphPPr: pPr ?? null,
        paragraphStyleId: pStyle?.getAttributeNS(OOXML.W_NS, 'val') ?? null,
        styles,
      }),
    );
  }
  const cells: RunFormatting[][] = [];
  for (let r = 0; r < rows; r++) {
    cells.push([]);
    for (let c = 0; c < cols; c++) cells[r]!.push(resolved.get(`${r},${c}`)!);
  }
  return { cells, outside: resolved.get('outside')! };
}

const LOOK_ALL_ON = '<w:tblLook w:firstRow="1" w:lastRow="1" w:firstColumn="1" w:lastColumn="1" w:noHBand="0" w:noVBand="0"/>';
const LOOK_ALL_OFF = '<w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>';

describe('table-style effective run formatting (#1159)', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.2' })(
      'a table style rPr sits between docDefaults and the paragraph style',
      async ({ given, when, then }: AllureBddContext) => {
        let result!: ReturnType<typeof resolveTable>;
        await given('a table style declaring Arial 9pt red, and a paragraph style declaring 14pt', async () => {});
        await when('runs inside and outside the table are resolved', async () => {
          result = resolveTable(
            STYLES(
              TABLE_STYLE('Grid', '<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="18"/><w:color w:val="FF0000"/></w:rPr>') +
                `<w:style w:type="paragraph" w:styleId="Big"><w:rPr><w:sz w:val="28"/></w:rPr></w:style>`,
            ),
            { tblPr: '<w:tblStyle w:val="Grid"/>', cols: 2, cell: (_r, c) => (c === 1 ? { pStyle: 'Big' } : {}) },
          );
        });
        await then('the table style supplies what the paragraph style leaves undeclared', async () => {
          expect(result.cells[0]![0]).toMatchObject({ fontName: 'Arial', fontSizePt: 9, colorHex: 'FF0000' });
          expect(result.cells[0]![1]).toMatchObject({ fontName: 'Arial', fontSizePt: 14, colorHex: 'FF0000' });
          expect(result.outside).toMatchObject({ fontName: 'Calibri', fontSizePt: 11, colorHex: 'auto' });
        });
      },
    );

  test('direct run formatting overrides the table style', async ({ given, when, then }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('a table style declaring Arial bold, and a run declaring Verdana and bold off', async () => {});
    await when('the run is resolved', async () => {
      result = resolveTable(STYLES(TABLE_STYLE('Grid', '<w:rPr><w:rFonts w:ascii="Arial"/><w:b/></w:rPr>')), {
        tblPr: '<w:tblStyle w:val="Grid"/>',
        cell: () => ({ rPr: '<w:rFonts w:ascii="Verdana"/><w:b w:val="0"/>' }),
      });
    });
    await then('the direct values win', async () => {
      expect(result.cells[0]![0]).toMatchObject({ fontName: 'Verdana', bold: false, fontSizePt: 11 });
    });
  });

  test('a basedOn table style contributes what the derived style leaves undeclared', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('a base table style declaring Arial 9pt and a derived one declaring only 10pt', async () => {});
    await when('a run in a table using the derived style is resolved', async () => {
      result = resolveTable(
        STYLES(
          TABLE_STYLE('Base', '<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="18"/></w:rPr>') +
            TABLE_STYLE('Derived', '<w:basedOn w:val="Base"/><w:rPr><w:sz w:val="20"/></w:rPr>'),
        ),
        { tblPr: '<w:tblStyle w:val="Derived"/>' },
      );
    });
    await then('each property resolves independently along the chain', async () => {
      expect(result.cells[0]![0]).toMatchObject({ fontName: 'Arial', fontSizePt: 10 });
    });
  });

  test('a table with no tblStyle uses the default table style', async ({ given, when, then }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('a default table style declaring Arial', async () => {});
    await when('a run in an unstyled table is resolved', async () => {
      result = resolveTable(
        STYLES(TABLE_STYLE('TableNormal', '<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>', ' w:default="1"')),
      );
    });
    await then('the default table style applies', async () => {
      expect(result.cells[0]![0]!.fontName).toBe('Arial');
      expect(result.outside.fontName).toBe('Calibri');
    });
  });

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.6' })(
      'a firstRow conditional applies only when tblLook enables it',
      async ({ given, when, then, and }: AllureBddContext) => {
        const styles = STYLES(TABLE_STYLE('Grid', COND('firstRow', '<w:b/><w:color w:val="FFFFFF"/>')));
        let on!: ReturnType<typeof resolveTable>;
        let off!: ReturnType<typeof resolveTable>;
        let legacyOn!: ReturnType<typeof resolveTable>;
        let legacyOff!: ReturnType<typeof resolveTable>;
        await given('a table style whose firstRow condition sets bold white', async () => {});
        await when('two-row tables with the switch on and off are resolved', async () => {
          on = resolveTable(styles, { tblPr: `<w:tblStyle w:val="Grid"/>${LOOK_ALL_ON}`, rows: 2 });
          off = resolveTable(styles, { tblPr: `<w:tblStyle w:val="Grid"/>${LOOK_ALL_OFF}`, rows: 2 });
          legacyOn = resolveTable(styles, { tblPr: '<w:tblStyle w:val="Grid"/><w:tblLook w:val="0020"/>', rows: 2 });
          legacyOff = resolveTable(styles, { tblPr: '<w:tblStyle w:val="Grid"/><w:tblLook w:val="0600"/>', rows: 2 });
        });
        await then('with the switch on, only the first row takes the condition', async () => {
          expect(on.cells[0]![0]).toMatchObject({ bold: true, colorHex: 'FFFFFF' });
          expect(on.cells[1]![0]).toMatchObject({ bold: false, colorHex: 'auto' });
        });
        await and('with the switch off, no row takes it', async () => {
          expect(off.cells[0]![0]).toMatchObject({ bold: false, colorHex: 'auto' });
          expect(off.cells[1]![0]).toMatchObject({ bold: false, colorHex: 'auto' });
        });
        await and('the transitional w:val bitmask is read the same way', async () => {
          expect(legacyOn.cells[0]![0]!.bold).toBe(true);
          expect(legacyOn.cells[1]![0]!.bold).toBe(false);
          expect(legacyOff.cells[0]![0]!.bold).toBe(false);
        });
      },
    );

  test('banded rows alternate after the header row, in groups of the row band size', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const styles = STYLES(
      TABLE_STYLE(
        'Banded',
        COND('band1Horz', '<w:color w:val="111111"/>') + COND('band2Horz', '<w:color w:val="222222"/>') +
          COND('firstRow', '<w:color w:val="000000"/>'),
      ),
    );
    let withHeader!: ReturnType<typeof resolveTable>;
    let noHeader!: ReturnType<typeof resolveTable>;
    let pairs!: ReturnType<typeof resolveTable>;
    let noBanding!: ReturnType<typeof resolveTable>;
    await given('a table style with odd, even and first-row colours', async () => {});
    await when('tables with and without the header row, a band size of 2 and banding off are resolved', async () => {
      const look = (firstRow: string, noHBand: string): string =>
        `<w:tblStyle w:val="Banded"/><w:tblLook w:firstRow="${firstRow}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="${noHBand}" w:noVBand="1"/>`;
      withHeader = resolveTable(styles, { tblPr: look('1', '0'), rows: 4 });
      noHeader = resolveTable(styles, { tblPr: look('0', '0'), rows: 3 });
      pairs = resolveTable(styles, { tblPr: `${look('0', '0')}<w:tblStyleRowBandSize w:val="2"/>`, rows: 4 });
      noBanding = resolveTable(styles, { tblPr: look('0', '1'), rows: 2 });
    });
    await then('the header row takes its own colour and banding starts below it', async () => {
      expect(withHeader.cells.map((row) => row[0]!.colorHex)).toEqual(['000000', '111111', '222222', '111111']);
      expect(noHeader.cells.map((row) => row[0]!.colorHex)).toEqual(['111111', '222222', '111111']);
    });
    await and('the band size groups rows, and noHBand turns banding off', async () => {
      expect(pairs.cells.map((row) => row[0]!.colorHex)).toEqual(['111111', '111111', '222222', '222222']);
      expect(noBanding.cells.map((row) => row[0]!.colorHex)).toEqual(['auto', 'auto']);
    });
  });

  test('later conditional types override earlier ones, and the corner overrides both edges', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('a style whose firstCol, firstRow and nwCell conditions each set a colour', async () => {});
    await when('a 2x2 table with every switch on is resolved', async () => {
      result = resolveTable(
        STYLES(
          TABLE_STYLE(
            'Grid',
            '<w:rPr><w:sz w:val="18"/></w:rPr>' +
              COND('band1Horz', '<w:color w:val="AAAAAA"/><w:i/>') +
              COND('firstCol', '<w:color w:val="00FF00"/>') +
              COND('firstRow', '<w:color w:val="FF0000"/>') +
              COND('nwCell', '<w:color w:val="0000FF"/>'),
          ),
        ),
        { tblPr: `<w:tblStyle w:val="Grid"/>${LOOK_ALL_ON}`, rows: 3, cols: 2 },
      );
    });
    await then('each cell takes the highest-precedence applicable condition per property', async () => {
      expect(result.cells[0]![0]!.colorHex).toBe('0000FF'); // nwCell
      expect(result.cells[0]![1]!.colorHex).toBe('FF0000'); // firstRow
      expect(result.cells[1]![0]!).toMatchObject({ colorHex: '00FF00', italic: true }); // firstCol over band1Horz
      expect(result.cells[1]![1]!).toMatchObject({ colorHex: 'AAAAAA', italic: true }); // band1Horz
      // Row 2 is the last row, which declares nothing; band2Horz declares nothing either.
      expect(result.cells[2]![1]!).toMatchObject({ colorHex: 'auto', italic: false, fontSizePt: 9 });
    });
  });

  test('a table without tblLook takes Word\'s default look: first row and first column, row banding only', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('a table style with first-row, first-column, last-row and banding conditions', async () => {});
    await when('a 3x3 table with no tblLook is resolved', async () => {
      result = resolveTable(
        STYLES(
          TABLE_STYLE(
            'Grid',
            COND('firstRow', '<w:b/>') +
              COND('firstCol', '<w:i/>') +
              COND('lastRow', '<w:caps/>') +
              COND('band1Horz', '<w:color w:val="111111"/>') +
              COND('band1Vert', '<w:u w:val="single"/>'),
          ),
        ),
        { tblPr: '<w:tblStyle w:val="Grid"/>', rows: 3, cols: 3 },
      );
    });
    await then('0x04A0 applies: firstRow, firstColumn and row bands on; lastRow and column bands off', async () => {
      expect(result.cells[0]![1]).toMatchObject({ bold: true, italic: false, colorHex: 'auto' });
      expect(result.cells[1]![0]).toMatchObject({ bold: false, italic: true, colorHex: '111111' });
      expect(result.cells[2]![2]).toMatchObject({ caps: false, underline: false, colorHex: 'auto' });
    });
  });

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.3' })(
      'a table-style toggle resets the value, and a paragraph style above it still toggles',
      async ({ given, when, then }: AllureBddContext) => {
        let result!: ReturnType<typeof resolveTable>;
        let boldDefaults!: ReturnType<typeof resolveTable>;
        await given('bold-on and bold-off table styles, a bold paragraph style, and bold document defaults', async () => {});
        await when('runs are resolved with and without the paragraph style and bold defaults', async () => {
          result = resolveTable(
            STYLES(
              TABLE_STYLE('Grid', '<w:rPr><w:b/></w:rPr>') +
                `<w:style w:type="paragraph" w:styleId="Strong"><w:rPr><w:b/></w:rPr></w:style>`,
            ),
            { tblPr: '<w:tblStyle w:val="Grid"/>', cols: 2, cell: (_r, c) => (c === 1 ? { pStyle: 'Strong' } : {}) },
          );
          const defaults =
            '<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>';
          boldDefaults = resolveTable(
            defaults + TABLE_STYLE('On', '<w:rPr><w:b/></w:rPr>') + TABLE_STYLE('Off', '<w:rPr><w:b w:val="0"/></w:rPr>'),
            { tblPr: '<w:tblStyle w:val="On"/>' },
          );
          boldDefaults.cells.push(
            resolveTable(
              defaults + TABLE_STYLE('Off', '<w:rPr><w:b w:val="0"/></w:rPr>'),
              { tblPr: '<w:tblStyle w:val="Off"/>' },
            ).cells[0]!,
          );
        });
        await then('the table style assigns its value (Word), and the paragraph style toggles it', async () => {
          expect(result.cells[0]![0]!.bold).toBe(true);
          expect(result.cells[0]![1]!.bold).toBe(false);
          // Over bold document defaults, a bold-on table style stays bold
          // rather than toggling off, and a bold-off one turns it off.
          expect(boldDefaults.cells[0]![0]!.bold).toBe(true);
          expect(boldDefaults.cells[1]![0]!.bold).toBe(false);
        });
      },
    );

  test('tracked table-property changes are the previous state and are not read', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let removedStyle!: ReturnType<typeof resolveTable>;
    let removedLook!: ReturnType<typeof resolveTable>;
    await given('a table whose w:tblPrChange records an older style and look', async () => {});
    await when('runs in tables with those tracked changes are resolved', async () => {
      const lookOff = LOOK_ALL_OFF;
      removedStyle = resolveTable(STYLES(TABLE_STYLE('Old', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')), {
        tblPr: '<w:tblPrChange w:id="1" w:author="R"><w:tblPr><w:tblStyle w:val="Old"/></w:tblPr></w:tblPrChange>',
      });
      removedLook = resolveTable(STYLES(TABLE_STYLE('Grid', COND('firstRow', '<w:color w:val="FF0000"/>'))), {
        tblPr: `<w:tblStyle w:val="Grid"/><w:tblPrChange w:id="1" w:author="R"><w:tblPr>${lookOff}</w:tblPr></w:tblPrChange>`,
      });
    });
    await then('only the current table properties count', async () => {
      expect(removedStyle.cells[0]![0]!.colorHex).toBe('auto');
      // No current tblLook: Word's default turns the first row on.
      expect(removedLook.cells[0]![0]!.colorHex).toBe('FF0000');
    });
  });

  test('columns are grid columns: gridBefore and gridSpan move a cell off the first or last column', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('first- and last-column conditions on a three-column grid', async () => {});
    await when('a row skipping one grid column, and a row whose first cell spans two columns, are resolved', async () => {
      result = resolveTable(
        STYLES(
          TABLE_STYLE(
            'Grid',
            COND('firstCol', '<w:color w:val="FF0000"/>') + COND('lastCol', '<w:color w:val="0000FF"/>'),
          ),
        ),
        {
          tblPr: '<w:tblStyle w:val="Grid"/><w:tblLook w:firstColumn="1" w:lastColumn="1" w:noHBand="1" w:noVBand="1"/>',
          gridCols: 3,
          rows: 2,
          cols: 2,
          trPr: (r) => (r === 0 ? '<w:gridBefore w:val="1"/>' : ''),
          cell: (r, c) => (r === 1 && c === 0 ? { tcPr: '<w:gridSpan w:val="2"/>' } : {}),
        },
      );
    });
    await then('the cell after gridBefore is not the first column; spans reach the last column', async () => {
      expect(result.cells[0]!.map((f) => f.colorHex)).toEqual(['auto', '0000FF']);
      expect(result.cells[1]!.map((f) => f.colorHex)).toEqual(['FF0000', '0000FF']);
    });
  });

  test('a row-level tblPrEx look overrides the table look for that row', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('a first-row condition switched on by the table but off by the first row\'s exception', async () => {});
    await when('the table is resolved', async () => {
      result = resolveTable(STYLES(TABLE_STYLE('Grid', COND('firstRow', '<w:color w:val="FF0000"/>'))), {
        tblPr: `<w:tblStyle w:val="Grid"/>${LOOK_ALL_ON}`,
        rows: 2,
        tblPrEx: (r) => (r === 0 ? LOOK_ALL_OFF : ''),
      });
    });
    await then('the first row takes no first-row formatting', async () => {
      expect(result.cells[0]![0]!.colorHex).toBe('auto');
    });
  });

  test('the last of several default table styles is the default', async ({ given, when, then }: AllureBddContext) => {
    let result!: ReturnType<typeof resolveTable>;
    await given('two table styles both marked default', async () => {});
    await when('a run in an unstyled table is resolved', async () => {
      result = resolveTable(
        STYLES(
          TABLE_STYLE('First', '<w:rPr><w:color w:val="111111"/></w:rPr>', ' w:default="1"') +
            TABLE_STYLE('Last', '<w:rPr><w:color w:val="222222"/></w:rPr>', ' w:default="1"'),
        ),
      );
    });
    await then('the later one applies', async () => {
      expect(result.cells[0]![0]!.colorHex).toBe('222222');
    });
  });

  test('a run in a nested table takes the innermost table style', async ({ given, when, then }: AllureBddContext) => {
    let inner!: RunFormatting;
    let outer!: RunFormatting;
    await given('an outer table styled Arial containing an inner table styled Georgia', async () => {});
    await when('runs in both tables are resolved', async () => {
      const styles = parseStylesXml(
        parseXml(
          `<w:styles xmlns:w="${OOXML.W_NS}">` +
            TABLE_STYLE('Outer', '<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>') +
            TABLE_STYLE('Inner', '<w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr>') +
            `</w:styles>`,
        ),
      );
      const document = parseXml(
        `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:tbl><w:tblPr><w:tblStyle w:val="Outer"/></w:tblPr>` +
          `<w:tr><w:tc><w:p><w:r><w:t>outer</w:t></w:r></w:p>` +
          `<w:tbl><w:tblPr><w:tblStyle w:val="Inner"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
          `</w:tc></w:tr></w:tbl></w:body></w:document>`,
      );
      const [outerRun, innerRun] = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'r'));
      const resolve = (run: Element): RunFormatting =>
        extractEffectiveRunFormatting({ run, paragraphPPr: null, paragraphStyleId: null, styles });
      outer = resolve(outerRun!);
      inner = resolve(innerRun!);
    });
    await then('each run follows its own table', async () => {
      expect(outer.fontName).toBe('Arial');
      expect(inner.fontName).toBe('Georgia');
    });
  });
});
