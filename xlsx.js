/*
 * Minimaler XLSX-Schreiber ohne Fremdbibliothek: Zellen mit Werten, Formeln (inkl. berechnetem Wert),
 * Formatvorlagen, bedingter Formatierung, verbundenen Zellen, Spaltenbreiten und fixierten Bereichen.
 * Die Datei wird als unkomprimiertes ZIP erzeugt (Excel, LibreOffice und Google Sheets lesen das problemlos).
 */
(function (root) {
  'use strict';

  const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    // In XML 1.0 unzulässige Steuerzeichen entfernen
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  /** 0 -> "A", 26 -> "AA" */
  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  const ref = (col, row) => colName(col) + row;

  // ---------- ZIP (Methode "stored") ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8-Dateinamen
      local.setUint16(8, 0, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cenSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // ---------- Arbeitsblatt ----------
  class Sheet {
    constructor(name) {
      this.name = name;
      this.rows = new Map(); // row -> Map(col -> cell)
      this.cols = [];        // Spaltenbreiten
      this.merges = [];
      this.cf = [];          // bedingte Formatierung
      this.freeze = null;    // { col, row }
      this.rowHeights = {};
    }
    /** cell: { v: Zahl|String|null, f: Formel ohne "=", s: Stilname } */
    set(col, row, cell) {
      if (!this.rows.has(row)) this.rows.set(row, new Map());
      this.rows.get(row).set(col, cell);
      return ref(col, row);
    }
    width(col, w) { this.cols[col] = w; }
    merge(c1, r1, c2, r2) { this.merges.push(`${ref(c1, r1)}:${ref(c2, r2)}`); }
    /** rule: { type: 'cellIs', op: 'equal'|'notEqual'|'lessThan'|'greaterThan', formula: '0', style: 'good'|'bad' } */
    condFormat(range, rules) { this.cf.push({ range, rules }); }
  }

  // ---------- Formatvorlagen ----------
  // Feste Palette, angelehnt an die App (Petrol) und die Excel-Vorlage (Gelb = Eingabe).
  const C = { teal: 'FF0F766E', tealSoft: 'FFD6EFEC', ink: 'FF17201E', muted: 'FF5D6B68', line: 'FFD3DCDA',
    zebra: 'FFF6F8F7', total: 'FFE9EFED', input: 'FFFFFBE6', good: 'FF15803D', goodBg: 'FFDCFCE7', bad: 'FFB91C1C', badBg: 'FFFEE2E2', white: 'FFFFFFFF' };
  const FONTS = [
    `<font><sz val="10.5"/><color rgb="${C.ink}"/><name val="Calibri"/><family val="2"/></font>`, // 0
    `<font><b/><sz val="10.5"/><color rgb="${C.ink}"/><name val="Calibri"/><family val="2"/></font>`, // 1 fett
    `<font><b/><sz val="20"/><color rgb="${C.teal}"/><name val="Calibri"/><family val="2"/></font>`, // 2 Titel
    `<font><b/><sz val="12"/><color rgb="${C.teal}"/><name val="Calibri"/><family val="2"/></font>`, // 3 Abschnitt
    `<font><b/><sz val="10.5"/><color rgb="${C.white}"/><name val="Calibri"/><family val="2"/></font>`, // 4 Kopf
    `<font><sz val="9.5"/><color rgb="${C.muted}"/><name val="Calibri"/><family val="2"/></font>`, // 5 Hinweis
    `<font><sz val="10.5"/><color rgb="${C.bad}"/><name val="Calibri"/><family val="2"/></font>`, // 6 Fehler
    `<font><b/><sz val="10.5"/><color rgb="${C.good}"/><name val="Calibri"/><family val="2"/></font>`, // 7 grün fett
  ];
  const solid = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    solid(C.teal), solid(C.zebra), solid(C.total), solid(C.input), solid(C.tealSoft), solid(C.goodBg), solid(C.badBg)];
  const FILL = { none: 0, teal: 2, zebra: 3, total: 4, input: 5, tealSoft: 6, good: 7, bad: 8 };
  const BORDERS = ['<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border><left style="thin"><color rgb="${C.line}"/></left><right style="thin"><color rgb="${C.line}"/></right><top style="thin"><color rgb="${C.line}"/></top><bottom style="thin"><color rgb="${C.line}"/></bottom><diagonal/></border>`,
    `<border><left style="thin"><color rgb="${C.line}"/></left><right style="thin"><color rgb="${C.line}"/></right><top style="medium"><color rgb="${C.teal}"/></top><bottom style="thin"><color rgb="${C.line}"/></bottom><diagonal/></border>`];
  const NUMFMTS = { euro: 164, date: 165, signed: 166 };
  const NUMFMT_XML = `<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;;\\-#,##0.00\\ &quot;€&quot;"/>`
    + '<numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/>'
    + `<numFmt numFmtId="166" formatCode="\\+#,##0.00\\ &quot;€&quot;;\\-#,##0.00\\ &quot;€&quot;;0.00\\ &quot;€&quot;"/></numFmts>`;

  // name -> [fontId, fillId, borderId, numFmtId, horizontal, wrap]
  const STYLE_DEFS = {
    default: [0, 0, 0, 0],
    title: [2, 0, 0, 0],
    section: [3, 0, 0, 0],
    note: [5, 0, 0, 0, null, true],
    noteNoWrap: [5, 0, 0, 0],
    head: [4, FILL.teal, 1, 0, 'center', true],
    headLeft: [4, FILL.teal, 1, 0, 'left'],
    text: [0, 0, 1, 0],
    textZebra: [0, FILL.zebra, 1, 0],
    textBold: [1, 0, 1, 0],
    num: [5, 0, 1, 0, 'center'],
    numZebra: [5, FILL.zebra, 1, 0, 'center'],
    date: [0, 0, 1, NUMFMTS.date, 'center'],
    dateZebra: [0, FILL.zebra, 1, NUMFMTS.date, 'center'],
    euro: [0, 0, 1, NUMFMTS.euro],
    euroZebra: [0, FILL.zebra, 1, NUMFMTS.euro],
    euroInput: [0, FILL.input, 1, NUMFMTS.euro],
    euroBold: [1, 0, 1, NUMFMTS.euro],
    signed: [1, 0, 1, NUMFMTS.signed],
    totalLabel: [1, FILL.total, 2, 0],
    totalEuro: [1, FILL.total, 2, NUMFMTS.euro],
    totalSigned: [1, FILL.total, 2, NUMFMTS.signed],
    error: [6, 0, 1, 0, null, true],
    errorZebra: [6, FILL.zebra, 1, 0, null, true],
    okText: [7, 0, 1, 0],
    statusOk: [7, FILL.good, 0, 0],
    statusBad: [6, FILL.bad, 0, 0],
    rowLabel: [1, FILL.tealSoft, 1, 0],
    legendInput: [0, FILL.input, 1, 0],
    legendGood: [7, FILL.good, 1, 0],
    legendBad: [6, FILL.bad, 1, 0],
    corner: [1, FILL.tealSoft, 1, 0, 'center'],
  };
  const STYLE_NAMES = Object.keys(STYLE_DEFS);
  const STYLE_ID = Object.fromEntries(STYLE_NAMES.map((n, i) => [n, i]));

  function stylesXml() {
    const xfs = STYLE_NAMES.map((n) => {
      const [font, fill, border, fmt, h, wrap] = STYLE_DEFS[n];
      const align = h || wrap ? `<alignment${h ? ` horizontal="${h}"` : ''} vertical="center"${wrap ? ' wrapText="1"' : ''}/>` : '<alignment vertical="center"/>';
      return `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
    }).join('');
    const dxf = (color, bg) => `<dxf><font><b/><color rgb="${color}"/></font><fill><patternFill><bgColor rgb="${bg}"/></patternFill></fill></dxf>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${NUMFMT_XML}
<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>
<fills count="${FILLS.length}">${FILLS.join('')}</fills>
<borders count="${BORDERS.length}">${BORDERS.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${STYLE_NAMES.length}">${xfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="2">${dxf(C.good, C.goodBg)}${dxf(C.bad, C.badBg)}</dxfs>
</styleSheet>`;
  }
  const DXF = { good: 0, bad: 1 };

  function sheetXml(sh) {
    const rowsXml = [...sh.rows.keys()].sort((a, b) => a - b).map((r) => {
      const cells = sh.rows.get(r);
      const cx = [...cells.keys()].sort((a, b) => a - b).map((c) => {
        const cell = cells.get(c);
        const s = STYLE_ID[cell.s || 'default'];
        if (s === undefined) throw new Error('Unbekannter Stil ' + cell.s);
        const at = `r="${ref(c, r)}" s="${s}"`;
        const f = cell.f ? `<f>${xmlEsc(cell.f)}</f>` : '';
        if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c ${at}>${f}<v>${cell.v}</v></c>`;
        if (cell.v === null || cell.v === undefined || cell.v === '') return f ? `<c ${at}>${f}</c>` : `<c ${at}/>`;
        if (f) return `<c ${at} t="str">${f}<v>${xmlEsc(cell.v)}</v></c>`;
        return `<c ${at} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
      }).join('');
      const ht = sh.rowHeights[r] ? ` ht="${sh.rowHeights[r]}" customHeight="1"` : '';
      return `<row r="${r}"${ht}>${cx}</row>`;
    }).join('');
    const cols = sh.cols.map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '')).join('');
    let pane = '';
    if (sh.freeze) {
      const { col, row } = sh.freeze;
      const tl = ref(col, row + 1);
      const which = col && row ? 'bottomRight' : row ? 'bottomLeft' : 'topRight';
      pane = `<pane${col ? ` xSplit="${col}"` : ''}${row ? ` ySplit="${row}"` : ''} topLeftCell="${tl}" activePane="${which}" state="frozen"/><selection pane="${which}" activeCell="${tl}" sqref="${tl}"/>`;
    }
    let prio = 1;
    const cf = sh.cf.map(({ range, rules }) => `<conditionalFormatting sqref="${range}">${rules.map((ru) =>
      `<cfRule type="cellIs" dxfId="${DXF[ru.style]}" priority="${prio++}" operator="${ru.op}"><formula>${xmlEsc(ru.formula)}</formula></cfRule>`).join('')}</conditionalFormatting>`).join('');
    const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16.5"/>${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rowsXml}</sheetData>${merges}${cf}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }

  /** sheets: [Sheet] -> Uint8Array (XLSX) */
  function build(sheets, meta = {}) {
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` },
      { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEsc(meta.title || '')}</dc:title><dc:creator>Abrechnung</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
</cp:coreProperties>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
      { name: 'xl/styles.xml', data: stylesXml() },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    ];
    return zip(files);
  }

  const Xlsx = { Sheet, build, colName, ref, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Xlsx;
  else root.Xlsx = Xlsx;
})(typeof globalThis !== 'undefined' ? globalThis : this);
