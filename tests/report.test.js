const test = require('node:test');
const assert = require('node:assert');
const Xlsx = require('../xlsx.js');
const Report = require('../report.js');

test('Spaltennamen', () => {
  assert.deepStrictEqual([0, 25, 26, 27, 701, 702].map(Xlsx.colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
});

test('Excel-Abrechnung ist ein gültiges ZIP mit Arbeitsblatt und Formeln', () => {
  const people = ['A', 'B', 'C'].map((name, i) => ({ id: 'p' + i, name }));
  const bytes = Report.buildReport({
    id: 'x', name: 'Test & <Sonderzeichen>', people,
    expenses: [{ id: 'e', title: 'Essen', amount: 1000, date: '2026-10-01', payers: { p0: 1000 }, split: { mode: 'equal', values: { p0: 1, p1: 1, p2: 1 } } }],
    payments: [],
  });
  const buf = Buffer.from(bytes);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50);
  assert.strictEqual(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  const text = buf.toString('utf8');
  assert.ok(text.includes('xl/worksheets/sheet1.xml'));
  assert.ok(text.includes('<f>ROUND(SUM('));
  assert.ok(text.includes('Test &amp; &lt;Sonderzeichen&gt;'));
  // Einträge prüfen: CRC jeder Datei stimmt
  let pos = 0;
  while (buf.readUInt32LE(pos) === 0x04034b50) {
    const crc = buf.readUInt32LE(pos + 14); const size = buf.readUInt32LE(pos + 18); const nameLen = buf.readUInt16LE(pos + 26);
    const data = buf.subarray(pos + 30 + nameLen, pos + 30 + nameLen + size);
    assert.strictEqual(Xlsx.crc32(data), crc);
    pos += 30 + nameLen + size;
  }
});
