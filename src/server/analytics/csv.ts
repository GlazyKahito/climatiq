/**
 * RFC 4180 CSV writer used by the /api/v1/export/*.csv endpoints.
 *
 *  - Records are separated by CRLF; the file ends with a CRLF.
 *  - A field is quoted when it contains a comma, double quote, CR or LF (or leading/trailing spaces);
 *    embedded double quotes are doubled.
 *  - Numbers are written in plain decimal notation (no thousands separators, no exponent for normal ranges);
 *    null / undefined / NaN / ±Infinity become an empty field.
 *  - Dates are written as ISO-8601 UTC timestamps.
 *  - Spreadsheet formula injection guard (OWASP): TEXT values starting with = + - @ TAB or CR are prefixed with a
 *    single quote. Numeric values are never altered, so negative numbers stay numeric.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  // Avoid binary-float noise such as 0.30000000000000004 while keeping full useful precision.
  const s = String(Number(n.toPrecision(12)));
  if (!/e/i.test(s)) return s;
  return n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}

export function csvCell(value: CsvValue): string {
  if (value == null) return '';
  let s: string;
  if (typeof value === 'number') s = formatNumber(value);
  else if (typeof value === 'boolean') s = value ? 'true' : 'false';
  else if (value instanceof Date) s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  else {
    s = value;
    if (FORMULA_START.test(s)) s = `'${s}`;
  }
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',');
}

/** Serialises a header row plus data rows. Every row must have the same number of fields as the header. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const out: string[] = [csvRow(headers)];
  for (const r of rows) {
    if (r.length !== headers.length) throw new Error(`CSV row has ${r.length} fields, expected ${headers.length}`);
    out.push(csvRow(r));
  }
  return out.join('\r\n') + '\r\n';
}

/** Safe ASCII filename for Content-Disposition (letters, digits, dot, dash, underscore). */
export function csvFilename(...parts: (string | number | null | undefined)[]): string {
  const base = parts
    .filter((p) => p != null && String(p).length > 0)
    .map((p) =>
      String(p)
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean)
    .join('_')
    .slice(0, 120);
  return `${base || 'export'}.csv`;
}

/** text/csv response with an attachment Content-Disposition. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8; header=present',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
