/*
 * Erzeugt eine Excel-Abrechnung im Aufbau der ursprünglichen Excel-Vorlage:
 * Vorkasse | Aufteilung/Verbrauch (mit Kontrollen), Bilanz (ΣVV, ΣA, Σges), Ausgleichsmatrix (von \ an), Überweisungen.
 * Alle Summen und Kontrollen sind echte Excel-Formeln mit rot/grüner bedingter Formatierung.
 */
(function (root) {
  'use strict';
  const Calc = root.Calc || (typeof require !== 'undefined' ? require('./calc.js') : null);
  const Xlsx = root.Xlsx || (typeof require !== 'undefined' ? require('./xlsx.js') : null);
  const { ref, colName } = Xlsx;

  const eur = (c) => Math.round(c) / 100;
  const r2 = (x) => Math.round(x * 100) / 100;
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const excelDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000 : null;
  };
  const GOOD_BAD_ZERO = [{ op: 'equal', formula: '0', style: 'good' }, { op: 'notEqual', formula: '0', style: 'bad' }];
  const SIGN = [{ op: 'greaterThan', formula: '0', style: 'good' }, { op: 'lessThan', formula: '0', style: 'bad' }];

  function splitText(bill, e) {
    const name = (id) => (bill.people.find((p) => p.id === id) || { name: '?' }).name;
    const vals = (e.split && e.split.values) || {};
    const ids = Object.keys(vals);
    if (e.split.mode === 'shares') return 'Anteile: ' + ids.map((id) => `${name(id)} ${String(vals[id]).replace('.', ',')}`).join(' · ');
    if (e.split.mode === 'exact') return 'feste Beträge';
    return ids.length === bill.people.length ? 'gleich auf alle' : 'gleich: ' + ids.map(name).join(', ');
  }

  function buildReport(bill, now = new Date()) {
    const people = bill.people;
    const n = people.length;
    const s = Calc.summarize(bill);
    const sh = new Xlsx.Sheet('Abrechnung');

    // ---------- Spalten ----------
    const cNum = 0; const cName = 1; const cDate = 2;
    const cPay = (i) => 3 + i;
    const cPaySum = 3 + n;
    const cGap = 4 + n;
    const cUse = (i) => cGap + 1 + i;
    const cUseSum = cGap + 1 + n;
    const cCheck = cUseSum + 1;
    const cInfo = cCheck + 1;
    sh.width(cNum, 5); sh.width(cName, 28); sh.width(cDate, 12);
    for (let i = 0; i < n; i++) { sh.width(cPay(i), 13); sh.width(cUse(i), 13); }
    sh.width(cPaySum, 13); sh.width(cGap, n <= 2 ? 14 : 3); sh.width(cUseSum, 13); sh.width(cCheck, 12); sh.width(cInfo, 44);

    // ---------- Kopf ----------
    sh.set(cNum, 1, { v: `Abrechnung „${bill.name}“`, s: 'title' });
    sh.rowHeights[1] = 30;
    sh.set(cNum, 2, { v: `Stand ${fmtDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${n} Teilnehmer · ${bill.expenses.length} Ausgaben · Gesamt ${Calc.formatEuro(s.total)}`, s: 'noteNoWrap' });
    sh.set(cNum, 3, s.consistent
      ? { v: s.allSettled && s.total ? '✓ Stimmig und vollständig ausgeglichen' : '✓ Stimmig: Vorkasse = Verbrauch', s: 'statusOk' }
      : { v: `✗ Unstimmig: ${s.invalid} fehlerhafte Ausgabe(n) – siehe rot markierte Zeilen`, s: 'statusBad' });

    // ---------- 1 Vorkasse / 2 Verbrauch ----------
    const secRow = 5; const headRow = 6; const first = 7;
    const m = bill.expenses.length;
    const last = first + Math.max(m, 1) - 1;
    sh.set(cNum, secRow, { v: '1  Vorkasse – wer hat wie viel bezahlt?', s: 'section' });
    sh.set(cUse(0), secRow, { v: '2  Aufteilung / Verbrauch – wer hat wie viel verbraucht?', s: 'section' });
    sh.set(cNum, headRow, { v: '#', s: 'head' });
    sh.set(cName, headRow, { v: 'Leistung', s: 'headLeft' });
    sh.set(cDate, headRow, { v: 'Datum', s: 'head' });
    people.forEach((p, i) => { sh.set(cPay(i), headRow, { v: p.name, s: 'head' }); sh.set(cUse(i), headRow, { v: p.name, s: 'head' }); });
    sh.set(cPaySum, headRow, { v: 'Σ Vorkasse', s: 'head' });
    sh.set(cUseSum, headRow, { v: 'Σ Verbrauch', s: 'head' });
    sh.set(cCheck, headRow, { v: 'Kontrolle', s: 'head' });
    sh.set(cInfo, headRow, { v: 'Aufteilung', s: 'headLeft' });
    sh.rowHeights[headRow] = 30;
    sh.freeze = { col: 3, row: headRow };

    const colPaid = new Array(n).fill(0); const colOwed = new Array(n).fill(0);
    let sumPayRows = 0; let sumUseRows = 0;
    const range = (c) => `${ref(c, first)}:${ref(c, last)}`;
    const rowRange = (a, b, r) => `${ref(a, r)}:${ref(b, r)}`;
    bill.expenses.forEach((e, k) => {
      const row = first + k;
      const z = k % 2 ? 'Zebra' : '';
      const res = s.results[e.id];
      sh.set(cNum, row, { v: k + 1, s: 'num' + z });
      sh.set(cName, row, { v: e.title || 'Ohne Bezeichnung', s: 'text' + z });
      const ds = excelDate(e.date);
      sh.set(cDate, row, ds !== null ? { v: ds, s: 'date' + z } : { v: '', s: 'text' + z });
      let paid = 0; let owed = 0;
      people.forEach((p, i) => {
        const pv = res.paid[p.id] || 0; const ov = res.owed[p.id] || 0;
        paid += pv; owed += ov; colPaid[i] += pv; colOwed[i] += ov;
        sh.set(cPay(i), row, { v: pv ? eur(pv) : null, s: 'euro' + z });
        sh.set(cUse(i), row, { v: ov ? eur(ov) : null, s: 'euro' + z });
      });
      sumPayRows += paid; sumUseRows += owed;
      sh.set(cPaySum, row, { f: `ROUND(SUM(${rowRange(cPay(0), cPay(n - 1), row)}),2)`, v: eur(paid), s: 'euroBold' });
      sh.set(cUseSum, row, { f: `ROUND(SUM(${rowRange(cUse(0), cUse(n - 1), row)}),2)`, v: eur(owed), s: 'euroBold' });
      sh.set(cCheck, row, { f: `ROUND(${ref(cPaySum, row)}-${ref(cUseSum, row)},2)`, v: eur(paid - owed), s: 'euroBold' });
      sh.set(cInfo, row, res.ok ? { v: splitText(bill, e), s: 'text' + z } : { v: '⚠ ' + res.errors.join(' · '), s: 'error' + z });
    });
    if (!m) {
      sh.set(cName, first, { v: 'Noch keine Ausgaben', s: 'text' });
      for (let c = cPay(0); c <= cCheck; c++) if (c !== cGap) sh.set(c, first, { v: null, s: 'euro' });
    }
    // Zeilen- und Gesamtkontrolle (wie I/T bzw. Σges,v/Σges,h in der Vorlage)
    sh.condFormat(`${ref(cCheck, first)}:${ref(cCheck, last)}`, GOOD_BAD_ZERO);
    sh.condFormat(`${ref(cPaySum, first)}:${ref(cPaySum, last)}`, [{ op: 'notEqual', formula: ref(cUseSum, first), style: 'bad' }]);
    sh.condFormat(`${ref(cUseSum, first)}:${ref(cUseSum, last)}`, [{ op: 'notEqual', formula: ref(cPaySum, first), style: 'bad' }]);

    const tot = last + 1;
    sh.set(cNum, tot, { v: '', s: 'totalLabel' });
    sh.set(cName, tot, { v: 'Σ1 Vorkasse je Person', s: 'totalLabel' });
    sh.set(cDate, tot, { v: '', s: 'totalLabel' });
    people.forEach((p, i) => {
      sh.set(cPay(i), tot, { f: `ROUND(SUM(${range(cPay(i))}),2)`, v: eur(colPaid[i]), s: 'totalEuro' });
      sh.set(cUse(i), tot, { f: `ROUND(SUM(${range(cUse(i))}),2)`, v: eur(colOwed[i]), s: 'totalEuro' });
    });
    const paidTotal = colPaid.reduce((a, b) => a + b, 0); const owedTotal = colOwed.reduce((a, b) => a + b, 0);
    sh.set(cPaySum, tot, { f: `ROUND(SUM(${rowRange(cPay(0), cPay(n - 1), tot)}),2)`, v: eur(paidTotal), s: 'totalEuro' });
    sh.set(cUseSum, tot, { f: `ROUND(SUM(${rowRange(cUse(0), cUse(n - 1), tot)}),2)`, v: eur(owedTotal), s: 'totalEuro' });
    sh.set(cCheck, tot, { f: `ROUND(${ref(cPaySum, tot)}-${ref(cUseSum, tot)},2)`, v: eur(paidTotal - owedTotal), s: 'totalEuro' });
    sh.set(cInfo, tot, { v: 'Σ2 Verbrauch je Person ←', s: 'totalLabel' });
    sh.condFormat(ref(cCheck, tot), GOOD_BAD_ZERO);
    // Quersumme über die Zeilen muss der Summe über die Spalten entsprechen
    const cross = tot + 1;
    sh.set(cName, cross, { v: 'Gegenprobe: Summe der Zeilen', s: 'note' });
    sh.set(cPaySum, cross, { f: `ROUND(SUM(${range(cPaySum)}),2)`, v: eur(sumPayRows), s: 'euro' });
    sh.set(cUseSum, cross, { f: `ROUND(SUM(${range(cUseSum)}),2)`, v: eur(sumUseRows), s: 'euro' });
    sh.condFormat(ref(cPaySum, cross), [{ op: 'equal', formula: ref(cPaySum, tot), style: 'good' }, { op: 'notEqual', formula: ref(cPaySum, tot), style: 'bad' }]);
    sh.condFormat(ref(cUseSum, cross), [{ op: 'equal', formula: ref(cUseSum, tot), style: 'good' }, { op: 'notEqual', formula: ref(cUseSum, tot), style: 'bad' }]);

    // ---------- Überweisungen (erledigt + offen) für die Matrix ----------
    const idx = Object.fromEntries(people.map((p, i) => [p.id, i]));
    const transfers = [
      ...(bill.payments || []).filter((p) => idx[p.from] !== undefined && idx[p.to] !== undefined).map((p) => ({ ...p, done: !p.pending, pending: !!p.pending })),
      ...s.suggestions.map((t) => ({ ...t, done: false })),
    ];
    const mat = people.map(() => new Array(n).fill(0));
    for (const t of transfers) mat[idx[t.from]][idx[t.to]] += t.amount;
    const sent = mat.map((row) => row.reduce((a, b) => a + b, 0));
    const recv = people.map((_, j) => mat.reduce((a, row) => a + row[j], 0));

    // ---------- 3 Bilanz ----------
    const bSec = cross + 3; const bHead = bSec + 1; const bFirst = bHead + 1; const bLast = bFirst + n - 1; const bTot = bLast + 1;
    // ---------- 4 Matrix (Positionen vorab, da die Bilanz darauf verweist) ----------
    const mSec = bTot + 3; const mHead = mSec + 1; const mFirst = mHead + 1; const mTot = mFirst + n;
    const cM = (j) => cDate + j; // Spalten "an"
    const cMSum = cDate + n;     // Σ von

    sh.set(cNum, bSec, { v: '3  Bilanz je Teilnehmer', s: 'section' });
    const bCols = ['Teilnehmer', 'Vorkasse Σ1', 'Verbrauch Σ2', 'Guthaben ΣVV = Σ1 − Σ2', 'Ausgleich ΣA = erhalten − gesendet', 'Gesamt Σges = ΣVV − ΣA'];
    bCols.forEach((t, k) => sh.set(cName + k, bHead, { v: t, s: k ? 'head' : 'headLeft' }));
    sh.rowHeights[bHead] = 44;
    let sVV = 0; let sA = 0; let sG = 0;
    people.forEach((p, i) => {
      const row = bFirst + i;
      const vv = colPaid[i] - colOwed[i];
      const a = recv[i] - sent[i];
      sVV += vv; sA += a; sG += vv - a;
      sh.set(cName, row, { v: p.name, s: 'rowLabel' });
      sh.set(cName + 1, row, { f: ref(cPay(i), tot), v: eur(colPaid[i]), s: 'euro' });
      sh.set(cName + 2, row, { f: ref(cUse(i), tot), v: eur(colOwed[i]), s: 'euro' });
      sh.set(cName + 3, row, { f: `ROUND(${ref(cName + 1, row)}-${ref(cName + 2, row)},2)`, v: eur(vv), s: 'signed' });
      sh.set(cName + 4, row, { f: `ROUND(${ref(cM(i), mTot)}-${ref(cMSum, mFirst + i)},2)`, v: eur(a), s: 'signed' });
      sh.set(cName + 5, row, { f: `ROUND(${ref(cName + 3, row)}-${ref(cName + 4, row)},2)`, v: eur(vv - a), s: 'signed' });
    });
    sh.set(cName, bTot, { v: 'Σ Kontrolle (muss 0 sein)', s: 'totalLabel' });
    for (let k = 1; k <= 5; k++) {
      const c = cName + k;
      const v = [0, paidTotal, owedTotal, sVV, sA, sG][k];
      sh.set(c, bTot, { f: `ROUND(SUM(${ref(c, bFirst)}:${ref(c, bLast)}),2)`, v: eur(v), s: k >= 3 ? 'totalSigned' : 'totalEuro' });
    }
    sh.condFormat(`${ref(cName + 3, bFirst)}:${ref(cName + 3, bLast)}`, SIGN);
    sh.condFormat(`${ref(cName + 5, bFirst)}:${ref(cName + 5, bLast)}`, GOOD_BAD_ZERO);
    sh.condFormat(`${ref(cName + 3, bTot)} ${ref(cName + 5, bTot)}`, GOOD_BAD_ZERO);

    // ---------- 4 Ausgleichsmatrix ----------
    sh.set(cNum, mSec, { v: '4  Ausgleichszahlungen – Zeile zahlt an Spalte (erledigt + offen)', s: 'section' });
    sh.set(cName, mHead, { v: 'von \\ an', s: 'corner' });
    people.forEach((p, j) => sh.set(cM(j), mHead, { v: p.name, s: 'head' }));
    sh.set(cMSum, mHead, { v: 'Σ von', s: 'head' });
    sh.rowHeights[mHead] = 30;
    people.forEach((p, i) => {
      const row = mFirst + i;
      sh.set(cName, row, { v: p.name, s: 'rowLabel' });
      people.forEach((q, j) => sh.set(cM(j), row, { v: mat[i][j] ? eur(mat[i][j]) : null, s: i === j ? 'euroZebra' : 'euroInput' }));
      sh.set(cMSum, row, { f: `ROUND(SUM(${ref(cM(0), row)}:${ref(cM(n - 1), row)}),2)`, v: eur(sent[i]), s: 'euroBold' });
    });
    sh.set(cName, mTot, { v: 'Σ an', s: 'totalLabel' });
    people.forEach((p, j) => sh.set(cM(j), mTot, { f: `ROUND(SUM(${ref(cM(j), mFirst)}:${ref(cM(j), mTot - 1)}),2)`, v: eur(recv[j]), s: 'totalEuro' }));
    sh.set(cMSum, mTot, { f: `ROUND(SUM(${ref(cM(0), mTot)}:${ref(cM(n - 1), mTot)})-SUM(${ref(cMSum, mFirst)}:${ref(cMSum, mTot - 1)}),2)`, v: 0, s: 'totalEuro' });
    sh.condFormat(ref(cMSum, mTot), GOOD_BAD_ZERO);

    // ---------- 5 Überweisungen ----------
    const lSec = mTot + 3; const lHead = lSec + 1;
    const name = (id) => people[idx[id]].name;
    sh.set(cNum, lSec, { v: '5  Überweisungen', s: 'section' });
    sh.set(cName, lHead, { v: 'Von → An', s: 'headLeft' });
    sh.set(cDate, lHead, { v: 'Betrag', s: 'head' });
    sh.set(cDate + 1, lHead, { v: 'Status', s: 'headLeft' });
    sh.set(cDate + 2, lHead, { v: '', s: 'headLeft' });
    sh.merge(cDate + 1, lHead, cDate + 2, lHead);
    let row = lHead + 1;
    if (!transfers.length) {
      sh.set(cName, row, { v: s.total ? 'Keine Überweisungen nötig' : 'Noch keine Ausgaben', s: 'text' });
      row++;
    }
    for (const t of transfers) {
      sh.set(cName, row, { v: `${name(t.from)} → ${name(t.to)}`, s: 'text' });
      sh.set(cDate, row, { v: eur(t.amount), s: 'euroBold' });
      const status = t.done ? `✓ erledigt${t.at ? ' am ' + fmtDate(new Date(t.at)) : ''}` : t.pending ? '⏳ bestätigt, noch nicht verbucht' : 'offen';
      sh.set(cDate + 1, row, { v: status, s: t.done ? 'okText' : 'text' });
      sh.set(cDate + 2, row, { v: '', s: 'text' });
      sh.merge(cDate + 1, row, cDate + 2, row);
      row++;
    }

    // ---------- Legende & Erläuterung ----------
    row += 2;
    sh.set(cNum, row, { v: 'Legende', s: 'section' });
    sh.set(cName, row + 1, { v: 'Stimmig / Guthaben (Forderung)', s: 'legendGood' });
    sh.set(cName, row + 2, { v: 'Unstimmig / Schulden', s: 'legendBad' });
    sh.set(cName, row + 3, { v: 'Ausgleichszahlung', s: 'legendInput' });
    const notes = [
      'Σ1 Vorkasse: was jede Person ausgelegt hat · Σ2 Verbrauch: was auf jede Person entfällt.',
      'Kontrolle je Zeile: Vorkasse − Verbrauch muss 0 sein, sonst ist die Ausgabe unstimmig (rot).',
      'Guthaben ΣVV = Σ1 − Σ2: positiv = bekommt Geld, negativ = muss zahlen.',
      'Ausgleich ΣA = erhaltene − gesendete Ausgleichszahlungen; Gesamt Σges = ΣVV − ΣA muss für alle 0 sein.',
      'Die Überweisungen sind so gewählt, dass möglichst wenige Zahlungen nötig sind.',
    ];
    notes.forEach((t, k) => sh.set(cDate + 1, row + 1 + k, { v: t, s: 'noteNoWrap' }));

    return Xlsx.build([sh], { title: `Abrechnung ${bill.name}` });
  }

  const Report = { buildReport, colName };
  if (typeof module !== 'undefined' && module.exports) module.exports = Report;
  else root.Report = Report;
})(typeof globalThis !== 'undefined' ? globalThis : this);
