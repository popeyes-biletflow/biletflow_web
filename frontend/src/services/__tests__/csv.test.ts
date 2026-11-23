import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas', () => {
    for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) expect(csvCell(v).startsWith("'") || csvCell(v).startsWith('"\'')).toBe(true);
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });

  it('renders null and numbers plainly and ends with CRLF', () => {
    expect(toCsv(['a', 'b'], [[null, 3]])).toBe('a,b\r\n,3\r\n');
  });
});
