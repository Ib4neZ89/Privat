/*
 * Rechenkern der Abrechnung – ohne DOM, damit er im Browser und in Node (Tests) läuft.
 * Alle Beträge werden intern in Cent (ganze Zahlen) geführt, um Rundungsfehler zu vermeiden.
 */
(function (root) {
  'use strict';

  /** "12,50" | "12.5" | "1.234,56" -> 1250 (Cent) oder NaN */
  function parseEuro(text) {
    if (typeof text === 'number') return Math.round(text * 100);
    let s = String(text || '').trim().replace(/\s|€/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }

  const fmt = typeof Intl !== 'undefined'
    ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
    : null;

  /** 1250 -> "12,50 €" */
  function formatEuro(cents) {
    const v = (cents || 0) / 100;
    return fmt ? fmt.format(v) : v.toFixed(2).replace('.', ',') + ' €';
  }

  /**
   * Verteilt `total` Cent nach Gewichten (Restgrößenverfahren), sodass die Summe exakt stimmt.
   * weights: { id: Zahl >= 0 } -> { id: Cent }
   */
  function distribute(total, weights) {
    const ids = Object.keys(weights).filter((id) => weights[id] > 0);
    const sumW = ids.reduce((s, id) => s + weights[id], 0);
    const out = {};
    if (!ids.length || sumW <= 0) return out;
    let assigned = 0;
    const rest = ids.map((id, i) => {
      const exact = (total * weights[id]) / sumW;
      const base = Math.floor(exact);
      out[id] = base;
      assigned += base;
      return { id, frac: exact - base, i };
    });
    rest.sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < total - assigned; k++) out[rest[k % rest.length].id] += 1;
    return out;
  }

  /**
   * Prüft eine Ausgabe und berechnet Vorkasse- und Verbrauchsanteile.
   * expense: { amount, payers: {pid: cent}, split: { mode: 'equal'|'shares'|'exact', values: {pid: zahl} } }
   * Rückgabe: { ok, errors: [..], paid: {pid: cent}, owed: {pid: cent} }
   */
  function evaluateExpense(expense, people) {
    const errors = [];
    const valid = new Set(people.map((p) => p.id));
    const amount = expense.amount;
    if (!Number.isInteger(amount) || amount <= 0) errors.push('Betrag fehlt oder ist nicht positiv');

    const paid = {};
    let paidSum = 0;
    for (const [pid, c] of Object.entries(expense.payers || {})) {
      if (!valid.has(pid) || !c) continue;
      paid[pid] = c;
      paidSum += c;
    }
    if (!Object.keys(paid).length) errors.push('Kein Zahler angegeben');
    else if (paidSum !== amount) {
      errors.push(`Zahler ergeben ${formatEuro(paidSum)} statt ${formatEuro(amount)}`);
    }

    const split = expense.split || { mode: 'equal', values: {} };
    const values = {};
    for (const [pid, v] of Object.entries(split.values || {})) {
      if (valid.has(pid) && v > 0) values[pid] = v;
    }
    let owed = {};
    if (!Object.keys(values).length) {
      errors.push('Niemand teilt sich diese Ausgabe');
    } else if (split.mode === 'exact') {
      owed = values;
      const s = Object.values(values).reduce((a, b) => a + b, 0);
      if (s !== amount) errors.push(`Aufteilung ergibt ${formatEuro(s)} statt ${formatEuro(amount)}`);
    } else {
      const w = {};
      for (const pid of Object.keys(values)) w[pid] = split.mode === 'shares' ? values[pid] : 1;
      owed = distribute(Number.isInteger(amount) && amount > 0 ? amount : 0, w);
    }
    return { ok: errors.length === 0, errors, paid, owed };
  }

  /**
   * Gesamtauswertung einer Abrechnung.
   * Gibt je Person: paid (Vorkasse Σ1), owed (Verbrauch Σ2), balance (ΣVV = Σ1 − Σ2),
   * transfers (ΣA: bereits geleistete Ausgleichszahlungen, erhalten − gesendet) und open (Σges = ΣVV − ΣA).
   */
  function summarize(bill) {
    const people = bill.people || [];
    const per = {};
    for (const p of people) per[p.id] = { paid: 0, owed: 0, balance: 0, sent: 0, received: 0, open: 0 };
    const results = {};
    let invalid = 0;
    let total = 0;
    for (const e of bill.expenses || []) {
      const r = evaluateExpense(e, people);
      results[e.id] = r;
      if (!r.ok) { invalid++; continue; }
      total += e.amount;
      for (const [pid, c] of Object.entries(r.paid)) per[pid].paid += c;
      for (const [pid, c] of Object.entries(r.owed)) per[pid].owed += c;
    }
    for (const t of bill.payments || []) {
      if (per[t.from]) per[t.from].sent += t.amount;
      if (per[t.to]) per[t.to].received += t.amount;
    }
    let balanceSum = 0;
    for (const pid of Object.keys(per)) {
      const x = per[pid];
      x.balance = x.paid - x.owed;
      // Eine gesendete Überweisung erhöht das Guthaben, eine empfangene senkt es.
      x.open = x.balance + x.sent - x.received;
      balanceSum += x.balance;
    }
    const paidTotal = Object.values(per).reduce((s, x) => s + x.paid, 0);
    const owedTotal = Object.values(per).reduce((s, x) => s + x.owed, 0);
    const openBalances = {};
    for (const pid of Object.keys(per)) openBalances[pid] = per[pid].open;
    const suggestions = settle(openBalances);
    return {
      per, results, invalid, total, paidTotal, owedTotal, balanceSum,
      suggestions,
      allSettled: Object.values(per).every((x) => x.open === 0),
      consistent: invalid === 0 && balanceSum === 0 && paidTotal === owedTotal,
    };
  }

  /** Gierig: größter Schuldner zahlt an größten Gläubiger. Höchstens k−1 Überweisungen für k Personen. */
  function greedy(entries) {
    const cred = entries.filter((e) => e.v > 0).map((e) => ({ ...e }));
    const debt = entries.filter((e) => e.v < 0).map((e) => ({ id: e.id, v: -e.v }));
    const out = [];
    while (cred.length && debt.length) {
      cred.sort((a, b) => b.v - a.v);
      debt.sort((a, b) => b.v - a.v);
      const c = cred[0];
      const d = debt[0];
      const x = Math.min(c.v, d.v);
      out.push({ from: d.id, to: c.id, amount: x });
      c.v -= x;
      d.v -= x;
      if (!c.v) cred.shift();
      if (!d.v) debt.shift();
    }
    return out;
  }

  const EXACT_LIMIT = 18;

  /**
   * Minimale Anzahl an Überweisungen: Die Personen werden in möglichst viele
   * Gruppen mit Summe 0 zerlegt (Teilmengen-DP). Jede Gruppe mit k Personen braucht k−1 Überweisungen.
   * balances: { pid: cent }, Summe muss 0 sein. Rückgabe: [{from, to, amount}]
   */
  function settle(balances) {
    const entries = Object.entries(balances).filter(([, v]) => v !== 0).map(([id, v]) => ({ id, v }));
    const sum = entries.reduce((s, e) => s + e.v, 0);
    if (sum !== 0 || !entries.length) return [];
    const n = entries.length;
    if (n > EXACT_LIMIT) return greedy(entries);

    const full = (1 << n) - 1;
    const sums = new Int32Array(1 << n);
    for (let m = 1; m <= full; m++) {
      const low = m & -m;
      sums[m] = sums[m ^ low] + entries[31 - Math.clz32(low)].v;
    }
    const dp = new Int8Array(1 << n);
    const choice = new Int8Array(1 << n);
    for (let m = 1; m <= full; m++) {
      let best = -1;
      let bi = 0;
      for (let i = 0; i < n; i++) {
        if (m & (1 << i) && dp[m ^ (1 << i)] > best) { best = dp[m ^ (1 << i)]; bi = i; }
      }
      dp[m] = best + (sums[m] === 0 ? 1 : 0);
      choice[m] = bi;
    }
    // Rückverfolgung: Entfernte Elemente zwischen zwei Masken mit Summe 0 bilden eine Gruppe.
    const groups = [];
    let current = [];
    let m = full;
    while (m) {
      const i = choice[m];
      current.push(entries[i]);
      m ^= 1 << i;
      if (sums[m] === 0) { groups.push(current); current = []; }
    }
    return groups.flatMap(greedy);
  }

  const Calc = { parseEuro, formatEuro, distribute, evaluateExpense, summarize, settle, greedy };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
