const test = require('node:test');
const assert = require('node:assert');
const Calc = require('../calc.js');

const people = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));

test('parseEuro versteht deutsche und englische Schreibweise', () => {
  assert.strictEqual(Calc.parseEuro('12,50'), 1250);
  assert.strictEqual(Calc.parseEuro('12.5'), 1250);
  assert.strictEqual(Calc.parseEuro('1.234,56 €'), 123456);
  assert.strictEqual(Calc.parseEuro('0,1'), 10);
  assert.ok(Number.isNaN(Calc.parseEuro('abc')));
  assert.ok(Number.isNaN(Calc.parseEuro('')));
});

test('distribute verteilt Restcents ohne Verlust', () => {
  const r = Calc.distribute(1000, { a: 1, b: 1, c: 1 });
  assert.deepStrictEqual(Object.values(r).reduce((s, v) => s + v, 0), 1000);
  assert.deepStrictEqual(Object.values(r).sort(), [333, 333, 334]);
  const w = Calc.distribute(1000, { a: 2, b: 1, c: 1 });
  assert.deepStrictEqual(w, { a: 500, b: 250, c: 250 });
});

test('evaluateExpense meldet unstimmige Eingaben', () => {
  const bad = Calc.evaluateExpense(
    { amount: 1000, payers: { a: 900 }, split: { mode: 'exact', values: { a: 500, b: 400 } } },
    people,
  );
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.errors.length, 2);
  const none = Calc.evaluateExpense({ amount: 1000, payers: { a: 1000 }, split: { mode: 'equal', values: {} } }, people);
  assert.strictEqual(none.ok, false);
});

test('summarize: Guthaben summieren sich zu 0, Ausgleichszahlungen werden verrechnet', () => {
  const bill = {
    people,
    expenses: [
      { id: '1', amount: 70000, payers: { a: 45000, b: 25000 }, split: { mode: 'equal', values: { a: 1, b: 1, c: 1 } } },
      { id: '2', amount: 11000, payers: { c: 11000 }, split: { mode: 'shares', values: { a: 2, b: 1, c: 1, d: 1 } } },
    ],
    payments: [],
  };
  const s = Calc.summarize(bill);
  assert.ok(s.consistent);
  assert.strictEqual(s.balanceSum, 0);
  assert.ok(s.suggestions.length <= 3);
  // Alle Vorschläge als bezahlt markieren -> alles ausgeglichen
  bill.payments = s.suggestions.map((t) => ({ ...t }));
  const after = Calc.summarize(bill);
  assert.ok(after.allSettled);
  assert.strictEqual(after.suggestions.length, 0);
});

function applyTransfers(balances, transfers) {
  const b = { ...balances };
  for (const t of transfers) {
    assert.ok(t.amount > 0);
    b[t.from] += t.amount;
    b[t.to] -= t.amount;
  }
  return b;
}

/** Brute-Force-Referenz: n − maximale Anzahl disjunkter Nullsummen-Gruppen */
function bruteMin(values) {
  const vals = values.filter((v) => v !== 0);
  let best = 0;
  (function rec(rest, groups) {
    if (!rest.length) { best = Math.max(best, groups); return; }
    const [first, ...others] = rest;
    const n = others.length;
    for (let m = 0; m < 1 << n; m++) {
      let s = first;
      const pick = [];
      const keep = [];
      others.forEach((v, i) => ((m >> i) & 1 ? (s += v, pick.push(v)) : keep.push(v)));
      if (s === 0) rec(keep, groups + 1);
    }
  })(vals, 0);
  return vals.length - best;
}

test('settle gleicht vollständig aus und ist minimal', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 300; round++) {
    const n = 2 + Math.floor(rnd() * 7);
    const vals = [];
    for (let i = 0; i < n - 1; i++) vals.push(Math.round((rnd() - 0.5) * 8) * 500);
    vals.push(-vals.reduce((s, v) => s + v, 0));
    const balances = Object.fromEntries(vals.map((v, i) => ['p' + i, v]));
    const t = Calc.settle(balances);
    const rest = applyTransfers(balances, t);
    assert.ok(Object.values(rest).every((v) => v === 0), 'nicht ausgeglichen');
    assert.strictEqual(t.length, bruteMin(vals), `nicht minimal für ${vals}`);
  }
});

test('settle nutzt Teilgruppen: 2 statt 3 Überweisungen', () => {
  const t = Calc.settle({ a: 1000, b: -1000, c: 500, d: -500 });
  assert.strictEqual(t.length, 2);
});

test('settle bei großer Gruppe fällt auf Greedy zurück und gleicht aus', () => {
  const balances = {};
  let sum = 0;
  for (let i = 0; i < 25; i++) { const v = (i % 7) * 137 - 300; balances['p' + i] = v; sum += v; }
  balances.p0 -= sum;
  const rest = applyTransfers(balances, Calc.settle(balances));
  assert.ok(Object.values(rest).every((v) => v === 0));
});

test('App-Version und Service-Worker-Version stimmen überein', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').match(/APP_VERSION = (\d+)/)[1];
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8').match(/VERSION = (\d+)/)[1];
  assert.strictEqual(app, sw);
});
