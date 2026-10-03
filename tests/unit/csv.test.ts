import { describe, expect, it } from 'vitest';
import { csvCell, csvFilename, csvResponse, formatNumber, toCsv } from '@/server/analytics/csv';

describe('csvCell (RFC 4180)', () => {
  it('leaves simple values unquoted', () => {
    expect(csvCell('Jaipur')).toBe('Jaipur');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(true)).toBe('true');
  });

  it('quotes fields containing commas, quotes, CR or LF and doubles embedded quotes', () => {
    expect(csvCell('Churu, Rajasthan')).toBe('"Churu, Rajasthan"');
    expect(csvCell('He said "hot"')).toBe('"He said ""hot"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it('quotes fields with leading or trailing whitespace so they survive round-trips', () => {
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvCell('padded ')).toBe('"padded "');
  });

  it('writes empty fields for null, undefined, NaN and Infinity', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('formats numbers without float noise or exponents and keeps negatives numeric', () => {
    expect(csvCell(0.1 + 0.2)).toBe('0.3');
    expect(csvCell(-3.25)).toBe('-3.25');
    expect(csvCell(46.8)).toBe('46.8');
    expect(formatNumber(1e-7)).toBe('0.0000001');
  });

  it('writes dates as ISO-8601 UTC timestamps', () => {
    expect(csvCell(new Date('2024-05-26T06:30:00+05:30'))).toBe('2024-05-26T01:00:00.000Z');
  });

  it('neutralises spreadsheet formula injection in text fields only', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91')).toBe("'+91");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell(-2)).toBe('-2');
  });
});

describe('toCsv', () => {
  it('joins records with CRLF and ends with CRLF', () => {
    const csv = toCsv(['region_code', 'tmax_c'], [
      ['IN-RJ', 45.1],
      ['IN-UP', null],
    ]);
    expect(csv).toBe('region_code,tmax_c\r\nIN-RJ,45.1\r\nIN-UP,\r\n');
  });

  it('rejects rows with the wrong number of fields', () => {
    expect(() => toCsv(['a', 'b'], [['only one']])).toThrow(/expected 2/);
  });

  it('round-trips through a minimal RFC 4180 parser', () => {
    const rows = [
      ['IN-RJ-CHURU', 'Churu, "the hottest"', 'line\nbreak', 50.5],
      ['IN-DL', 'Delhi', '', -0.4],
    ];
    const csv = toCsv(['code', 'name', 'note', 'departure_c'], rows);
    expect(parseCsv(csv)).toEqual([['code', 'name', 'note', 'departure_c'], ...rows.map((r) => r.map(String))]);
  });
});

describe('csvFilename / csvResponse', () => {
  it('builds a safe ASCII filename', () => {
    expect(csvFilename('climatiq', 'history', 'IN-RJ', '2024-05-01', '2024-05-31')).toBe('climatiq_history_IN-RJ_2024-05-01_2024-05-31.csv');
    expect(csvFilename('Rājasthān / "x"')).toBe('Rajasthan-x.csv');
    expect(csvFilename()).toBe('export.csv');
  });

  it('sets text/csv and an attachment disposition', async () => {
    const res = csvResponse('a\r\n', 'x.csv');
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="x.csv"');
    expect(await res.text()).toBe('a\r\n');
  });
});

/** Minimal RFC 4180 parser used only to verify round-trips. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return out;
}
