/*
 * Abrechnung – Oberfläche. Alle Daten liegen ausschließlich im localStorage dieses Geräts.
 * Austausch mit anderen erfolgt nur über Links (Daten im #-Teil der URL, der nie an einen Server geht).
 */
(function () {
  'use strict';
  const { parseEuro, formatEuro, summarize, evaluateExpense } = window.Calc;

  const STORE_KEY = 'abrechnung.v1';
  // Muss zu VERSION in sw.js passen (wird per Test geprüft).
  const APP_VERSION = 4;
  const app = document.getElementById('app');
  const dlg = document.getElementById('dlg');

  // ---------- Speicher ----------
  let store = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.bills) return s;
    } catch (e) { /* leer oder defekt */ }
    return { bills: {} };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
  }
  function touch(bill) { bill.updatedAt = Date.now(); save(); }

  // ---------- Helfer ----------
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const centsToInput = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
  const signed = (c) => (c > 0 ? '+' : '') + formatEuro(c);
  const cls = (c) => (c > 0 ? 'pos' : c < 0 ? 'neg' : 'zero');
  const parseWeight = (s) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : 0; };
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
  const fmtTime = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  let toastTimer;
  function toast(msg, bad) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, 3200);
  }

  function personName(bill, id) {
    const p = bill.people.find((x) => x.id === id);
    return p ? p.name : '?';
  }
  const isAdmin = (bill) => bill.role !== 'viewer';

  // ---------- Dialoge ----------
  /**
   * Öffnet den (einzigen) Dialog. Der Inhalt steckt in einem frischen Wrapper, damit Event-Listener
   * aus onMount mit dem Inhalt verschwinden und sich nicht am <dialog> ansammeln.
   * options.lock: kein Schließen durch Tippen auf den Hintergrund; options.onCancel: Zurück/Escape abfangen.
   */
  let dialogOptions = {};
  function openDialog(html, onMount, options = {}) {
    dialogOptions = options;
    dlg.innerHTML = '<div class="dlg-inner">' + html + '</div>';
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    if (onMount) onMount(dlg.firstElementChild);
  }
  function closeDialog() { dialogOptions = {}; if (dlg.open) dlg.close(); dlg.innerHTML = ''; }

  // Schließen per Hintergrund nur bei einem echten Tipp daneben: Aufsetzen UND Loslassen außerhalb des Dialogs.
  // (Ein "click" landet sonst auch dann auf dem <dialog>, wenn Inhalt während der Berührung verspringt –
  // z. B. wenn die Bildschirmtastatur zuklappt – oder wenn man beim Markieren von Text nach außen zieht.)
  const outside = (e) => {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dlg.addEventListener('pointerdown', (e) => { downOutside = e.target === dlg && outside(e); });
  dlg.addEventListener('click', (e) => {
    const ok = downOutside && e.target === dlg && outside(e) && !dialogOptions.lock;
    downOutside = false;
    if (ok) closeDialog();
  });
  // Escape bzw. Android-Zurück
  dlg.addEventListener('cancel', (e) => {
    if (dialogOptions.onCancel && dialogOptions.onCancel() === false) e.preventDefault();
    else { e.preventDefault(); closeDialog(); }
  });

  function confirmDialog(text, okLabel = 'OK', danger = false) {
    return new Promise((resolve) => {
      openDialog(`<div class="dlg-body"><p>${text}</p></div>
        <div class="dlg-actions"><button class="btn" data-r="0">Abbrechen</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(okLabel)}</button></div>`, (d) => {
        d.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { closeDialog(); resolve(b.dataset.r === '1'); }));
        dlg.addEventListener('close', () => resolve(false), { once: true });
      });
    });
  }

  function promptDialog(title, value = '', okLabel = 'Speichern') {
    return new Promise((resolve) => {
      openDialog(`<form class="dlg-body" method="dialog" id="pf"><h3>${esc(title)}</h3>
        <input id="pv" value="${esc(value)}" required autocomplete="off"></form>
        <div class="dlg-actions"><button class="btn" data-c>Abbrechen</button>
        <button class="btn primary" form="pf">${esc(okLabel)}</button></div>`, (d) => {
        const input = d.querySelector('#pv');
        input.focus(); input.select();
        d.querySelector('[data-c]').addEventListener('click', () => { closeDialog(); resolve(null); });
        d.querySelector('#pf').addEventListener('submit', (e) => {
          e.preventDefault();
          const v = input.value.trim();
          closeDialog();
          resolve(v || null);
        });
      });
    });
  }

  // ---------- Links (Teilen / Bestätigen) ----------
  const b64url = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

  async function pack(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if ('CompressionStream' in window) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return 'z' + b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
      } catch (e) { /* Fallback unten */ }
    }
    return 'j' + b64url(bytes);
  }
  async function unpack(str) {
    const kind = str[0];
    let bytes = unb64url(str.slice(1));
    if (kind === 'z') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (kind !== 'j') throw new Error('Unbekanntes Format');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const baseUrl = () => location.origin + location.pathname;
  /** Navigiert ohne hashchange-Event (sonst würde route() einen gleich danach geöffneten Dialog schließen). */
  function go(hash) { history.replaceState(null, '', baseUrl() + hash); route(); }

  function publicBill(bill) {
    return {
      id: bill.id, name: bill.name, createdAt: bill.createdAt, updatedAt: bill.updatedAt,
      people: bill.people, expenses: bill.expenses,
      payments: bill.payments.filter((p) => !p.pending).map(({ pending, ...p }) => p),
    };
  }

  async function shareUrl(title, text, url) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const full = url ? `${text}\n${url}` : text;
    try { await navigator.clipboard.writeText(full); toast('In die Zwischenablage kopiert'); } catch (e) {
      openDialog(`<div class="dlg-body"><h3>${esc(title)}</h3><p class="hint">Text kopieren und versenden:</p>
        <textarea readonly style="width:100%;min-height:160px">${esc(full)}</textarea></div>
        <div class="dlg-actions"><button class="btn primary" data-c>Schließen</button></div>`,
      (d) => d.querySelector('[data-c]').addEventListener('click', closeDialog));
    }
  }

  async function shareBill(bill) {
    const url = baseUrl() + '#share=' + (await pack({ v: 1, bill: publicBill(bill) }));
    await shareUrl(`Abrechnung „${bill.name}“`, `Abrechnung „${bill.name}“ – hier kannst du alles ansehen und erhaltene Überweisungen bestätigen:`, url);
  }

  async function sendConfirmation(bill, payment) {
    const { pending, ...p } = payment;
    const url = baseUrl() + '#confirm=' + (await pack({ v: 1, billId: bill.id, billName: bill.name, payment: p }));
    const text = `${personName(bill, p.to)} bestätigt: ${formatEuro(p.amount)} von ${personName(bill, p.from)} erhalten (Abrechnung „${bill.name}“). Zum Verbuchen öffnen:`;
    await shareUrl('Zahlung bestätigt', text, url);
  }

  async function handleShare(data) {
    history.replaceState(null, '', baseUrl());
    let payload;
    try { payload = await unpack(data); } catch (e) { toast('Link ist ungültig oder unvollständig', true); return route(); }
    const incoming = payload && payload.bill;
    if (!incoming || !incoming.id || !Array.isArray(incoming.people)) { toast('Link enthält keine Abrechnung', true); return route(); }
    const local = store.bills[incoming.id];
    if (local && isAdmin(local)) {
      toast('Das ist deine eigene Abrechnung');
    } else {
      const ids = new Set((incoming.payments || []).map((p) => p.id));
      const stillPending = local ? local.payments.filter((p) => p.pending && !ids.has(p.id)) : [];
      store.bills[incoming.id] = {
        ...incoming,
        expenses: incoming.expenses || [],
        payments: [...(incoming.payments || []), ...stillPending],
        role: 'viewer',
        viewerAs: local ? local.viewerAs : null,
      };
      save();
      toast(local ? 'Abrechnung aktualisiert' : 'Abrechnung geöffnet');
    }
    go(`#/b/${incoming.id}/ausgleich`);
  }

  async function handleConfirm(data) {
    history.replaceState(null, '', baseUrl());
    let payload;
    try { payload = await unpack(data); } catch (e) { toast('Bestätigungslink ist ungültig', true); return route(); }
    const bill = payload && store.bills[payload.billId];
    const p = payload && payload.payment;
    if (!bill || !isAdmin(bill)) {
      toast(`Abrechnung „${(payload && payload.billName) || '?'}“ ist auf diesem Gerät nicht als Admin vorhanden`, true);
      return route();
    }
    go(`#/b/${bill.id}/ausgleich`);
    if (!p || !p.id || !bill.people.some((x) => x.id === p.from) || !bill.people.some((x) => x.id === p.to) || !(p.amount > 0)) {
      toast('Bestätigung passt nicht zu dieser Abrechnung', true); return;
    }
    if (bill.payments.some((x) => x.id === p.id)) { toast('Diese Zahlung ist bereits verbucht'); return; }
    const ok = await confirmDialog(`<b>${esc(personName(bill, p.to))}</b> bestätigt den Erhalt von <b>${formatEuro(p.amount)}</b>
      von <b>${esc(personName(bill, p.from))}</b>.<br><br>Zahlung in „${esc(bill.name)}“ verbuchen?`, 'Verbuchen');
    if (!ok) return;
    bill.payments.push({ id: p.id, from: p.from, to: p.to, amount: p.amount, at: p.at || Date.now(), by: p.by || p.to });
    touch(bill);
    toast('Zahlung verbucht');
    render();
  }

  // ---------- Routing ----------
  let view = { home: true };
  function route() {
    const h = location.hash;
    if (h.startsWith('#share=')) return handleShare(h.slice(7));
    if (h.startsWith('#confirm=')) return handleConfirm(h.slice(9));
    const m = h.match(/^#\/b\/([^/]+)(?:\/(\w+))?/);
    view = m && store.bills[m[1]] ? { bill: m[1], tab: m[2] || 'ausgaben' } : { home: true };
    closeDialog();
    render();
  }
  window.addEventListener('hashchange', route);

  function render() {
    if (view.home) renderHome();
    else renderBill(store.bills[view.bill], view.tab);
  }

  // ---------- Startseite ----------
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (view.home) render(); });

  function renderHome() {
    document.title = 'Abrechnung';
    const bills = Object.values(store.bills).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    app.innerHTML = `
      <div class="home-head"><h1>Abrechnung</h1><p>Ausgaben teilen, fair ausgleichen.</p></div>
      ${installPrompt ? '<div class="btn-row"><button class="btn" data-action="install">📲 App installieren</button></div>' : ''}
      ${bills.length ? `<ul class="list">${bills.map((b) => {
        const s = summarize(b);
        const badge = !s.consistent ? '<span class="pill neg">Unstimmig</span>'
          : s.allSettled && s.total ? '<span class="pill zero">Ausgeglichen</span>'
            : `<span class="pill muted">${s.suggestions.length} offen</span>`;
        return `<li><a class="row-btn" href="#/b/${b.id}">
          <div class="row-main"><div class="row-title">${esc(b.name)}</div>
          <div class="row-sub">${b.people.length} Personen · ${formatEuro(s.total)}${isAdmin(b) ? '' : ' · geteilt'}</div></div>${badge}</a></li>`;
      }).join('')}</ul>` : '<div class="empty">Noch keine Abrechnung angelegt.</div>'}
      <div class="btn-row">
        <button class="btn" data-action="import">Datei importieren</button>
      </div>
      <p class="footer-note">🔒 Alle Daten bleiben ausschließlich auf diesem Gerät.<br>Sicherung und Übertragung: Export als Datei oder per Link.</p>
      <div class="version-row"><span>Version ${APP_VERSION}</span>
        <button class="btn small" data-action="check-update">⟳ Nach Update suchen</button></div>
      <button class="fab" data-action="new-bill">+ Neue Abrechnung</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>`;
    app.querySelector('#import-file').addEventListener('change', importFile);
  }

  async function newBill() {
    const name = await promptDialog('Neue Abrechnung', '', 'Anlegen');
    if (!name) return;
    const bill = { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), people: [], expenses: [], payments: [], role: 'admin' };
    store.bills[bill.id] = bill;
    save();
    location.hash = `#/b/${bill.id}/teilnehmer`;
  }

  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const bill = data.bill || data;
      if (!bill.id || !Array.isArray(bill.people) || !Array.isArray(bill.expenses)) throw new Error('kein gültiges Format');
      if (store.bills[bill.id] && !(await confirmDialog(`„${esc(bill.name)}“ existiert bereits. Ersetzen?`, 'Ersetzen', true))) return;
      store.bills[bill.id] = { payments: [], ...bill, role: 'admin' };
      delete store.bills[bill.id].viewerAs;
      save();
      toast('Importiert');
      location.hash = `#/b/${bill.id}`;
    } catch (err) {
      toast('Import fehlgeschlagen: ' + err.message, true);
    }
  }

  function exportBill(bill) {
    const blob = new Blob([JSON.stringify({ app: 'abrechnung', v: 1, bill: publicBill(bill) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `abrechnung-${bill.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Abrechnung ----------
  function renderBill(bill, tab) {
    document.title = bill.name + ' – Abrechnung';
    const s = summarize(bill);
    const admin = isAdmin(bill);
    const tabs = [['teilnehmer', 'Teilnehmer'], ['ausgaben', 'Ausgaben'], ['ausgleich', 'Ausgleich']];

    let status;
    if (!bill.people.length) status = '<div class="status info">Lege zuerst die Teilnehmer an.</div>';
    else if (s.invalid) status = `<div class="status bad">✗ <span><b>Unstimmig:</b> ${s.invalid} Ausgabe${s.invalid > 1 ? 'n sind' : ' ist'} fehlerhaft und ${s.invalid > 1 ? 'werden' : 'wird'} nicht berücksichtigt.</span></div>`;
    else if (!s.consistent) status = `<div class="status bad">✗ <b>Unstimmig:</b> Vorkasse ${formatEuro(s.paidTotal)} ≠ Verbrauch ${formatEuro(s.owedTotal)}</div>`;
    else if (s.total && s.allSettled) status = '<div class="status ok">✓ <span><b>Ausgeglichen</b> – alle stehen bei 0,00 €.</span></div>';
    else status = `<div class="status ok">✓ <span><b>Stimmig:</b> Vorkasse = Verbrauch = ${formatEuro(s.total)}</span></div>`;

    let viewerBar = '';
    if (!admin) {
      viewerBar = `<div class="status warn" style="flex-wrap:wrap"><span style="flex:1 1 180px">Geteilte Ansicht – nur der Admin kann Ausgaben ändern.</span>
        <label style="flex:1 1 160px;color:inherit">Ich bin
        <select data-change="viewer-as"><option value="">– bitte wählen –</option>
        ${bill.people.map((p) => `<option value="${p.id}" ${bill.viewerAs === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label></div>`;
    }

    let body = '';
    if (tab === 'teilnehmer') body = renderPeople(bill, s, admin);
    else if (tab === 'ausgleich') body = renderSettlement(bill, s, admin);
    else body = renderExpenses(bill, s, admin);

    app.innerHTML = `
      <header class="bar"><a class="icon-btn" href="#/" aria-label="Zur Übersicht">‹</a>
        <h1>${esc(bill.name)}</h1>
        <button class="icon-btn" data-action="bill-menu" aria-label="Menü">⋯</button></header>
      ${viewerBar}${status}
      <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/b/${bill.id}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      ${body}`;
  }

  function renderPeople(bill, s, admin) {
    const rows = bill.people.map((p) => {
      const x = s.per[p.id];
      return `<li><div class="row-btn">
        <div class="row-main"><div class="row-title">${esc(p.name)}</div>
        <div class="row-sub">Vorkasse ${formatEuro(x.paid)} · Verbrauch ${formatEuro(x.owed)}</div></div>
        <span class="pill ${cls(x.balance)}">${signed(x.balance)}</span>
        ${admin ? `<button class="icon-btn" data-action="person-menu" data-id="${p.id}" aria-label="${esc(p.name)} bearbeiten">⋯</button>` : ''}
      </div></li>`;
    }).join('');
    return `
      ${admin ? `<form class="card inline-form" data-form="add-person">
        <input name="name" placeholder="Name hinzufügen" autocomplete="off" required aria-label="Name">
        <button class="btn primary">Hinzufügen</button></form>` : ''}
      ${bill.people.length ? `<ul class="list">${rows}</ul>
        <p class="hint">Grün = Guthaben (bekommt Geld), Rot = Schulden (muss zahlen). Guthaben = Vorkasse − Verbrauch.</p>`
        : '<div class="empty">Noch keine Teilnehmer.</div>'}`;
  }

  function splitSummary(bill, e) {
    const vals = Object.keys((e.split && e.split.values) || {});
    if (vals.length === bill.people.length && e.split.mode === 'equal') return 'alle';
    const names = vals.map((id) => personName(bill, id)).join(', ');
    if (e.split.mode === 'shares') return 'Anteile: ' + vals.map((id) => `${personName(bill, id)} ${e.split.values[id]}`).join(', ');
    if (e.split.mode === 'exact') return 'Beträge: ' + names;
    return names || '–';
  }

  function renderExpenses(bill, s, admin) {
    if (!bill.people.length) return `<div class="empty">Zuerst <a href="#/b/${bill.id}/teilnehmer">Teilnehmer anlegen</a>.</div>`;
    const items = bill.expenses.map((e, i) => {
      const r = s.results[e.id];
      const payers = Object.keys(e.payers || {}).map((id) => personName(bill, id)).join(', ') || '–';
      return `<li class="${r.ok ? '' : 'bad'}"><button class="row-btn" data-action="edit-expense" data-id="${e.id}">
        <span class="num">${i + 1}</span>
        <div class="row-main"><div class="row-title">${esc(e.title || 'Ohne Bezeichnung')}</div>
        <div class="row-sub">${r.ok ? `${esc(payers)} → ${esc(splitSummary(bill, e))}${e.date ? ' · ' + fmtDate(e.date) : ''}` : '⚠ ' + esc(r.errors.join(' · '))}</div></div>
        <span class="row-amount">${formatEuro(e.amount || 0)}</span></button></li>`;
    }).join('');
    return `
      ${bill.expenses.length ? `<ul class="list">${items}
        <li class="totals"><span>Σ ${bill.expenses.length - s.invalid} Ausgaben${s.invalid ? ` <span class="neg">(+${s.invalid} fehlerhaft)</span>` : ''}</span><span>${formatEuro(s.total)}</span></li></ul>`
        : `<div class="empty">Noch keine Ausgaben.${admin ? '<br>Tippe auf „+ Ausgabe“.' : ''}</div>`}
      ${admin ? '<button class="fab" data-action="new-expense">+ Ausgabe</button>' : ''}`;
  }

  function renderSettlement(bill, s, admin) {
    if (!bill.people.length) return '<div class="empty">Noch keine Teilnehmer.</div>';
    let sumBal = 0; let sumTr = 0; let sumOpen = 0;
    const rows = bill.people.map((p) => {
      const x = s.per[p.id];
      const tr = x.sent - x.received;
      sumBal += x.balance; sumTr += tr; sumOpen += x.open;
      return `<tr><td>${esc(p.name)}</td>
        <td class="${cls(x.balance)}">${signed(x.balance)}</td>
        <td>${tr ? signed(tr) : '–'}</td>
        <td class="${x.open === 0 ? 'cell-ok' : cls(x.open)}">${x.open === 0 ? '✓ 0,00 €' : signed(x.open)}</td></tr>`;
    }).join('');
    const table = `<div class="table-wrap"><table>
      <thead><tr><th>Person</th><th>Guthaben</th><th>Überwiesen</th><th>Offen</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Σ Kontrolle</td><td class="${sumBal === 0 ? 'cell-ok' : 'cell-bad'}">${formatEuro(sumBal)}</td>
      <td>${formatEuro(sumTr)}</td><td class="${sumOpen === 0 ? 'cell-ok' : 'cell-bad'}">${formatEuro(sumOpen)}</td></tr></tfoot>
      </table></div>`;

    const me = bill.viewerAs;
    const open = s.suggestions.map((t, i) => {
      const canTick = admin || (me && me === t.to);
      return `<li class="transfer"><div class="who"><b>${esc(personName(bill, t.from))}</b><span class="arrow">→</span><b>${esc(personName(bill, t.to))}</b></div>
        <span class="row-amount">${formatEuro(t.amount)}</span>
        ${canTick ? `<button class="btn small primary" data-action="tick" data-i="${i}">✓ Erhalten</button>` : ''}</li>`;
    }).join('');

    const done = bill.payments.slice().reverse().map((p) => {
      const who = p.by && p.by !== 'admin' ? personName(bill, p.by) : 'Admin';
      const canUndo = admin || (p.pending && p.by === me);
      return `<li class="transfer done"><div class="who"><b>${esc(personName(bill, p.from))}</b><span class="arrow">→</span><b>${esc(personName(bill, p.to))}</b>
        <div class="row-sub">${p.pending ? '⏳ wartet auf Verbuchung durch Admin' : `✓ bestätigt von ${esc(who)}`} · ${fmtTime(p.at)}</div></div>
        <span class="row-amount">${formatEuro(p.amount)}</span>
        ${p.pending ? `<button class="btn small" data-action="resend" data-id="${p.id}" aria-label="Bestätigung erneut senden">Senden</button>` : ''}
        ${canUndo ? `<button class="icon-btn" data-action="undo-payment" data-id="${p.id}" aria-label="Rückgängig">↺</button>` : ''}</li>`;
    }).join('');

    let tickHint = '';
    if (!admin && s.suggestions.length) {
      tickHint = me ? '<p class="hint">Du kannst Überweisungen abhaken, die du erhalten hast. Danach schickst du dem Admin die Bestätigung.</p>'
        : '<p class="hint">Wähle oben aus, wer du bist, um erhaltene Überweisungen abzuhaken.</p>';
    }

    return `
      <h2>Bilanz</h2>${table}
      <p class="hint">Guthaben = Vorkasse − Verbrauch. Offen = Guthaben nach bereits erfolgten Ausgleichszahlungen. Ziel: überall ✓ 0,00 €.</p>
      <h2>${s.suggestions.length ? `Offene Überweisungen (${s.suggestions.length})` : 'Offene Überweisungen'}</h2>
      ${s.suggestions.length ? `<ul class="list">${open}</ul>${tickHint}` : `<div class="card">${s.total ? '✓ Nichts mehr offen – alles ausgeglichen.' : 'Noch keine Ausgaben erfasst.'}</div>`}
      ${bill.payments.length ? `<h2>Erledigt</h2><ul class="list">${done}</ul>` : ''}
      <div class="btn-row">
        <button class="btn" data-action="share-result">Ergebnis als Text teilen</button>
        ${admin ? '<button class="btn" data-action="share-bill">Link an Gruppe senden</button>' : ''}
      </div>`;
  }

  function resultText(bill) {
    const s = summarize(bill);
    const lines = [`Abrechnung „${bill.name}“`, `Gesamt: ${formatEuro(s.total)}`, '', 'Guthaben (Vorkasse − Verbrauch):'];
    for (const p of bill.people) lines.push(`• ${p.name}: ${signed(s.per[p.id].balance)}`);
    lines.push('');
    if (s.suggestions.length) {
      lines.push('Offene Überweisungen:');
      for (const t of s.suggestions) lines.push(`• ${personName(bill, t.from)} → ${personName(bill, t.to)}: ${formatEuro(t.amount)}`);
    } else lines.push('✓ Alles ausgeglichen.');
    return lines.join('\n');
  }

  // ---------- Ausgabe bearbeiten ----------
  function openExpense(bill, expense) {
    const admin = isAdmin(bill);
    const people = bill.people;
    const isNew = !expense;
    const e = expense || {
      id: uid(), title: '', amount: 0, date: new Date().toISOString().slice(0, 10),
      payers: { [bill.lastPayer && people.some((p) => p.id === bill.lastPayer) ? bill.lastPayer : people[0].id]: 0 },
      split: { mode: 'equal', values: Object.fromEntries(people.map((p) => [p.id, 1])) },
    };
    const payerIds = Object.keys(e.payers || {});
    const d = {
      title: e.title, amount: centsToInput(e.amount), date: e.date || '',
      multi: payerIds.length > 1 || (payerIds.length === 1 && e.amount && e.payers[payerIds[0]] !== e.amount),
      single: payerIds[0] || people[0].id,
      payerIn: Object.fromEntries(people.map((p) => [p.id, centsToInput(e.payers[p.id])])),
      mode: e.split.mode,
      members: new Set(Object.keys(e.split.values).filter((id) => e.split.values[id] > 0)),
      shares: Object.fromEntries(people.map((p) => [p.id, e.split.mode === 'shares' && e.split.values[p.id] ? String(e.split.values[p.id]).replace('.', ',') : '1'])),
      exact: Object.fromEntries(people.map((p) => [p.id, e.split.mode === 'exact' ? centsToInput(e.split.values[p.id]) : ''])),
    };
    if (e.split.mode === 'shares') for (const p of people) if (!e.split.values[p.id]) d.shares[p.id] = '0';

    function build() {
      const amount = parseEuro(d.amount);
      let payers;
      if (d.multi) {
        payers = {};
        for (const p of people) { const c = parseEuro(d.payerIn[p.id]); if (c > 0) payers[p.id] = c; }
      } else payers = { [d.single]: Number.isNaN(amount) ? 0 : amount };
      const values = {};
      for (const p of people) {
        if (d.mode === 'equal' && d.members.has(p.id)) values[p.id] = 1;
        if (d.mode === 'shares') { const w = parseWeight(d.shares[p.id]); if (w > 0) values[p.id] = w; }
        if (d.mode === 'exact') { const c = parseEuro(d.exact[p.id]); if (c > 0) values[p.id] = c; }
      }
      return { id: e.id, title: d.title.trim(), amount: Number.isNaN(amount) ? 0 : amount, date: d.date, payers, split: { mode: d.mode, values } };
    }

    const payerSection = () => d.multi
      ? people.map((p) => `<div class="split-row"><div class="name"><span>${esc(p.name)}</span></div><span></span>
          <input inputmode="decimal" data-payer="${p.id}" value="${esc(d.payerIn[p.id])}" placeholder="0,00" aria-label="Gezahlt von ${esc(p.name)}"></div>`).join('')
      : `<div class="chips">${people.map((p) => `<label class="chip"><input type="radio" name="single" value="${p.id}" ${d.single === p.id ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}</div>`;

    const splitSection = () => people.map((p) => {
      let input = '';
      if (d.mode === 'shares') input = `<input inputmode="decimal" data-share="${p.id}" value="${esc(d.shares[p.id])}" aria-label="Anteile ${esc(p.name)}">`;
      else if (d.mode === 'exact') input = `<input inputmode="decimal" data-exact="${p.id}" value="${esc(d.exact[p.id])}" placeholder="0,00" aria-label="Betrag ${esc(p.name)}">`;
      else input = '<span></span>';
      const box = d.mode === 'equal' ? `<input type="checkbox" data-member="${p.id}" ${d.members.has(p.id) ? 'checked' : ''} aria-label="${esc(p.name)} beteiligt">` : '';
      return `<div class="split-row" data-row="${p.id}"><label class="name">${box}<span>${esc(p.name)}</span></label>${input}<span class="calc" data-calc="${p.id}"></span></div>`;
    }).join('');

    const modeLabel = { equal: 'Gleich', shares: 'Anteile', exact: 'Beträge' };
    openDialog(`
      <form id="xf" class="dlg-body" novalidate>
        <h3>${isNew ? 'Neue Ausgabe' : admin ? 'Ausgabe bearbeiten' : 'Ausgabe'}</h3>
        <fieldset ${admin ? '' : 'disabled'} style="margin:0">
        <div class="field"><label>Bezeichnung<input name="title" value="${esc(d.title)}" placeholder="z. B. Supermarkt, Unterkunft …" autocomplete="off"></label></div>
        <div class="grid2 field">
          <label>Betrag (€)<input name="amount" inputmode="decimal" value="${esc(d.amount)}" placeholder="0,00" autocomplete="off"></label>
          <label>Datum<input type="date" name="date" value="${esc(d.date)}"></label>
        </div>
        <fieldset>
          <div class="legend-row"><legend>Bezahlt von</legend>
            <label class="chip"><input type="checkbox" name="multi" ${d.multi ? 'checked' : ''}><span>Mehrere</span></label></div>
          <div id="payers">${payerSection()}</div>
          <div class="check" id="payer-check"></div>
        </fieldset>
        <fieldset>
          <legend>Geteilt von</legend>
          <div class="seg" role="group" aria-label="Aufteilung">${Object.entries(modeLabel).map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${d.mode === k}">${l}</button>`).join('')}</div>
          <div class="btn-row" style="margin:0 0 6px" id="quick">${d.mode === 'equal' ? '<button type="button" class="btn small" data-quick="all">Alle</button><button type="button" class="btn small" data-quick="none">Keiner</button>' : ''}</div>
          <div id="split">${splitSection()}</div>
          <div class="check" id="split-check"></div>
        </fieldset>
        </fieldset>
        <div class="check" id="save-errors"></div>
      </form>
      <div class="dlg-actions">
        ${admin && !isNew ? '<button class="btn danger" data-act="delete">Löschen</button>' : ''}
        <span class="spacer"></span>
        <button class="btn" data-act="cancel">${admin ? 'Abbrechen' : 'Schließen'}</button>
        ${admin ? '<button class="btn primary" data-act="save">Speichern</button>' : ''}
      </div>`, (root) => {
      const form = root.querySelector('#xf');
      let forced = false;
      let dirty = false;
      let cancelArmed = false;
      form.addEventListener('input', () => { dirty = true; cancelArmed = false; }, true);
      form.addEventListener('change', () => { dirty = true; cancelArmed = false; }, true);
      form.addEventListener('click', (ev) => { if (ev.target.closest('button')) { dirty = true; cancelArmed = false; } }, true);
      dialogOptions.onCancel = () => {
        // Zurück-Taste/Escape: Ungespeicherte Eingaben erst nach zweitem Zurück verwerfen.
        if (!admin || !dirty || cancelArmed) return true;
        cancelArmed = true;
        toast('Ungespeicherte Eingaben – nochmal Zurück zum Verwerfen');
        return false;
      };

      function refresh() {
        const x = build();
        const r = evaluateExpense(x, people);
        const amountOk = x.amount > 0;
        form.amount.classList.toggle('invalid', !amountOk && d.amount !== '');
        // Zahler prüfen
        const pc = root.querySelector('#payer-check');
        const paidSum = Object.values(x.payers).reduce((a, b) => a + b, 0);
        if (d.multi) {
          const diff = x.amount - paidSum;
          pc.className = 'check ' + (diff === 0 && paidSum > 0 ? 'ok' : 'bad');
          pc.textContent = diff === 0 && paidSum > 0 ? `✓ Summe ${formatEuro(paidSum)}` : `Summe ${formatEuro(paidSum)} – ${diff > 0 ? 'noch ' + formatEuro(diff) + ' offen' : formatEuro(-diff) + ' zu viel'}`;
        } else { pc.textContent = ''; pc.className = 'check'; }
        // Aufteilung prüfen
        const sc = root.querySelector('#split-check');
        for (const p of people) {
          const c = root.querySelector(`[data-calc="${p.id}"]`);
          const v = r.owed[p.id];
          c.textContent = d.mode === 'exact' ? '' : v ? formatEuro(v) : '–';
          root.querySelector(`[data-row="${p.id}"]`).classList.toggle('off', !v);
        }
        const owedSum = Object.values(r.owed).reduce((a, b) => a + b, 0);
        const nMembers = Object.keys(x.split.values).length;
        if (!nMembers) { sc.className = 'check bad'; sc.textContent = 'Niemand ausgewählt'; }
        else if (d.mode === 'exact') {
          const diff = x.amount - owedSum;
          sc.className = 'check ' + (diff === 0 ? 'ok' : 'bad');
          sc.textContent = diff === 0 ? `✓ Aufgeteilt: ${formatEuro(owedSum)}` : `Aufgeteilt ${formatEuro(owedSum)} – ${diff > 0 ? 'noch ' + formatEuro(diff) + ' zu verteilen' : formatEuro(-diff) + ' zu viel'}`;
        } else {
          sc.className = 'check ' + (amountOk ? 'ok' : 'bad');
          sc.textContent = amountOk ? `✓ ${nMembers} Person${nMembers > 1 ? 'en' : ''} · ${formatEuro(owedSum)}` : 'Betrag fehlt';
        }
        // Restbetrag grau (Platzhalter) in allen noch leeren Feldern anzeigen – wird nicht übernommen
        showRemainder('[data-payer]', x.amount);
        showRemainder('[data-exact]', x.amount);
        // Eingabefelder rot markieren
        root.querySelectorAll('[data-payer]').forEach((i) => i.classList.toggle('invalid', i.value.trim() !== '' && Number.isNaN(parseEuro(i.value))));
        root.querySelectorAll('[data-exact]').forEach((i) => i.classList.toggle('invalid', i.value.trim() !== '' && Number.isNaN(parseEuro(i.value))));
        root.querySelectorAll('[data-share]').forEach((i) => i.classList.toggle('invalid', i.value.trim() !== '' && i.value.trim() !== '0' && !parseWeight(i.value)));
        return { x, r };
      }

      const resetSave = () => {
        const sb = root.querySelector('[data-act="save"]');
        if (sb) sb.textContent = 'Speichern';
        root.querySelector('#save-errors').className = 'check';
        root.querySelector('#save-errors').textContent = '';
        forced = false;
      };
      function showRemainder(selector, amount) {
        const inputs = [...root.querySelectorAll(selector)];
        if (!inputs.length) return;
        const filled = inputs.reduce((sum, i) => { const c = parseEuro(i.value); return sum + (c > 0 ? c : 0); }, 0);
        const rest = amount - filled;
        for (const i of inputs) i.placeholder = !i.value.trim() && rest > 0 ? centsToInput(rest) : '';
      }

      const rerenderSplit = () => {
        resetSave();
        root.querySelector('#split').innerHTML = splitSection();
        root.querySelector('#quick').innerHTML = d.mode === 'equal' ? '<button type="button" class="btn small" data-quick="all">Alle</button><button type="button" class="btn small" data-quick="none">Keiner</button>' : '';
        root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === d.mode)));
        refresh();
      };

      form.addEventListener('input', (ev) => {
        const t = ev.target;
        if (t.name === 'title') d.title = t.value;
        else if (t.name === 'amount') d.amount = t.value;
        else if (t.name === 'date') d.date = t.value;
        else if (t.dataset.payer) d.payerIn[t.dataset.payer] = t.value;
        else if (t.dataset.share) d.shares[t.dataset.share] = t.value;
        else if (t.dataset.exact) d.exact[t.dataset.exact] = t.value;
        resetSave();
        refresh();
      });
      form.addEventListener('change', (ev) => {
        const t = ev.target;
        if (t.name === 'single') d.single = t.value;
        else if (t.name === 'multi') {
          d.multi = t.checked;
          if (d.multi && !Object.values(d.payerIn).some((v) => v)) d.payerIn[d.single] = d.amount;
          root.querySelector('#payers').innerHTML = payerSection();
        } else if (t.dataset.member) {
          if (t.checked) d.members.add(t.dataset.member); else d.members.delete(t.dataset.member);
        }
        resetSave();
        refresh();
      });
      form.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.dataset.mode) {
          d.mode = b.dataset.mode;
          rerenderSplit();
        } else if (b.dataset.quick) {
          d.members = new Set(b.dataset.quick === 'all' ? people.map((p) => p.id) : []);
          rerenderSplit();
        }
      });
      form.addEventListener('submit', (ev) => ev.preventDefault());

      root.querySelector('[data-act="cancel"]').addEventListener('click', closeDialog);
      const del = root.querySelector('[data-act="delete"]');
      if (del) del.addEventListener('click', async () => {
        if (!(await confirmDialog(`Ausgabe „${esc(e.title || 'Ohne Bezeichnung')}“ löschen?`, 'Löschen', true))) return openExpense(bill, expense);
        bill.expenses = bill.expenses.filter((x) => x.id !== e.id);
        touch(bill); render();
      });
      const saveBtn = root.querySelector('[data-act="save"]');
      if (saveBtn) saveBtn.addEventListener('click', () => {
        const { x, r } = refresh();
        const errBox = root.querySelector('#save-errors');
        if (!r.ok && !forced) {
          // Erst warnen; ein zweiter Klick speichert trotzdem (Ausgabe wird dann rot markiert und nicht berücksichtigt).
          errBox.className = 'check bad';
          errBox.innerHTML = '⚠ Unstimmig:<br>• ' + r.errors.map(esc).join('<br>• ') + '<br>Erneut tippen, um trotzdem zu speichern.';
          errBox.scrollIntoView({ block: 'nearest' });
          saveBtn.textContent = 'Trotzdem speichern';
          forced = true;
          return;
        }
        const idx = bill.expenses.findIndex((y) => y.id === x.id);
        if (idx >= 0) bill.expenses[idx] = x; else bill.expenses.push(x);
        if (!d.multi) bill.lastPayer = d.single;
        touch(bill);
        closeDialog();
        render();
        toast(isNew ? 'Ausgabe hinzugefügt' : 'Gespeichert');
      });
      refresh();
      if (isNew) form.title.focus();
    }, { lock: admin });
  }

  // ---------- Aktionen ----------
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const bill = view.bill && store.bills[view.bill];

    if (a === 'new-bill') return newBill();
    if (a === 'check-update') return checkForUpdate(true);
    if (a === 'apply-update') return applyUpdate();
    if (a === 'import') return app.querySelector('#import-file').click();
    if (a === 'install' && installPrompt) { installPrompt.prompt(); installPrompt = null; return render(); }
    if (!bill) return;

    if (a === 'new-expense') return openExpense(bill, null);
    if (a === 'edit-expense') return openExpense(bill, bill.expenses.find((x) => x.id === el.dataset.id));
    if (a === 'share-result') return shareUrl(`Abrechnung „${bill.name}“`, resultText(bill));
    if (a === 'share-bill') return shareBill(bill);

    if (a === 'tick') {
      const t = summarize(bill).suggestions[+el.dataset.i];
      if (!t) return;
      const admin = isAdmin(bill);
      if (!admin && bill.viewerAs !== t.to) return;
      const ok = await confirmDialog(`Hat <b>${esc(personName(bill, t.to))}</b> <b>${formatEuro(t.amount)}</b> von <b>${esc(personName(bill, t.from))}</b> erhalten?`, 'Ja, erhalten');
      if (!ok) return;
      const p = { id: uid(), from: t.from, to: t.to, amount: t.amount, at: Date.now(), by: admin ? 'admin' : bill.viewerAs };
      if (!admin) p.pending = true;
      bill.payments.push(p);
      touch(bill); render();
      if (!admin) {
        openDialog(`<div class="dlg-body"><h3>Bestätigung senden</h3>
          <p>Damit die Zahlung in der Abrechnung verbucht wird, schick dem Admin jetzt die Bestätigung (z. B. per WhatsApp).</p></div>
          <div class="dlg-actions"><button class="btn" data-c>Später</button><button class="btn primary" data-s>Bestätigung senden</button></div>`, (d) => {
          d.querySelector('[data-c]').addEventListener('click', closeDialog);
          d.querySelector('[data-s]').addEventListener('click', () => { closeDialog(); sendConfirmation(bill, p); });
        });
      } else toast('Als erhalten markiert');
      return;
    }
    if (a === 'resend') {
      const p = bill.payments.find((x) => x.id === el.dataset.id);
      if (p) sendConfirmation(bill, p);
      return;
    }
    if (a === 'undo-payment') {
      const p = bill.payments.find((x) => x.id === el.dataset.id);
      if (!p) return;
      if (!(await confirmDialog(`Zahlung ${esc(personName(bill, p.from))} → ${esc(personName(bill, p.to))} (${formatEuro(p.amount)}) wieder als offen markieren?`, 'Rückgängig', true))) return;
      bill.payments = bill.payments.filter((x) => x.id !== p.id);
      touch(bill); render();
      return;
    }

    if (a === 'person-menu') {
      const person = bill.people.find((p) => p.id === el.dataset.id);
      openDialog(`<div class="dlg-body"><h3>${esc(person.name)}</h3><div class="menu-list">
        <button class="btn" data-m="rename">✎ Umbenennen</button>
        <button class="btn danger" data-m="delete">🗑 Entfernen</button></div></div>
        <div class="dlg-actions"><button class="btn" data-m="close">Schließen</button></div>`, (d) => {
        d.addEventListener('click', async (e2) => {
          const m = e2.target.closest('[data-m]');
          if (!m) return;
          if (m.dataset.m === 'close') return closeDialog();
          if (m.dataset.m === 'rename') {
            const name = await promptDialog('Umbenennen', person.name);
            if (name) { person.name = name; touch(bill); }
            return render();
          }
          if (m.dataset.m === 'delete') {
            const used = bill.expenses.some((x) => (x.payers && x.payers[person.id]) || (x.split && x.split.values[person.id]))
              || bill.payments.some((x) => x.from === person.id || x.to === person.id);
            if (used) {
              closeDialog();
              return toast(`${person.name} ist in Ausgaben oder Zahlungen enthalten und kann nicht entfernt werden`, true);
            }
            bill.people = bill.people.filter((p) => p.id !== person.id);
            touch(bill); closeDialog(); render();
          }
        });
      });
      return;
    }

    if (a === 'bill-menu') {
      const admin = isAdmin(bill);
      openDialog(`<div class="dlg-body"><h3>${esc(bill.name)}</h3><div class="menu-list">
        ${admin ? '<button class="btn" data-m="share">🔗 Link an Gruppe senden</button>' : ''}
        <button class="btn" data-m="text">💬 Ergebnis als Text teilen</button>
        <button class="btn" data-m="export">⬇ Als Datei exportieren (Sicherung)</button>
        ${admin ? '<button class="btn" data-m="rename">✎ Umbenennen</button>' : ''}
        <button class="btn danger" data-m="delete">🗑 Von diesem Gerät löschen</button></div>
        ${admin ? '' : '<p class="hint">Dies ist eine geteilte Ansicht. Öffne einen neueren Link vom Admin, um sie zu aktualisieren.</p>'}</div>
        <div class="dlg-actions"><button class="btn" data-m="close">Schließen</button></div>`, (d) => {
        d.addEventListener('click', async (e2) => {
          const m = e2.target.closest('[data-m]');
          if (!m) return;
          const k = m.dataset.m;
          if (k === 'close') return closeDialog();
          if (k === 'share') { closeDialog(); return shareBill(bill); }
          if (k === 'text') { closeDialog(); return shareUrl(`Abrechnung „${bill.name}“`, resultText(bill)); }
          if (k === 'export') { closeDialog(); return exportBill(bill); }
          if (k === 'rename') {
            const name = await promptDialog('Abrechnung umbenennen', bill.name);
            if (name) { bill.name = name; touch(bill); }
            return render();
          }
          if (k === 'delete') {
            if (!(await confirmDialog(`„${esc(bill.name)}“ endgültig von diesem Gerät löschen?`, 'Löschen', true))) return;
            delete store.bills[bill.id]; save();
            location.hash = '#/';
          }
        });
      });
    }
  });

  document.addEventListener('submit', (ev) => {
    const f = ev.target.closest('[data-form="add-person"]');
    if (!f) return;
    ev.preventDefault();
    const bill = store.bills[view.bill];
    const name = f.name.value.trim();
    if (!name) return;
    if (bill.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return toast(`„${name}“ gibt es schon`, true);
    const id = uid();
    bill.people.push({ id, name });
    // Neue Person nimmt bei bestehenden "Gleich"-Ausgaben NICHT automatisch teil – das bleibt bewusst manuell.
    touch(bill);
    render();
    const input = app.querySelector('[data-form="add-person"] input');
    if (input) input.focus();
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.dataset.change === 'viewer-as') {
      const bill = store.bills[view.bill];
      bill.viewerAs = ev.target.value || null;
      save(); render();
    }
  });

  // ---------- Start ----------
  // ---------- Updates ----------
  let swReg = null;
  const swSupported = 'serviceWorker' in navigator && location.protocol.startsWith('http');

  function showUpdateBar() {
    if (document.getElementById('update-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.innerHTML = '<span>Neue Version verfügbar</span><button class="btn small primary" data-action="apply-update">Jetzt aktualisieren</button>';
    document.body.appendChild(bar);
  }

  /** Meldet eine neue Version, sobald sie fertig geladen ist und wartet. */
  function watchInstalling(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar();
    });
  }

  async function checkForUpdate(manual) {
    if (!swSupported || !swReg) {
      if (manual) toast('Updates sind nur in der installierten bzw. online geöffneten App möglich', true);
      return;
    }
    if (swReg.waiting) return showUpdateBar();
    try {
      if (manual) toast('Suche nach Updates …');
      await swReg.update();
    } catch (e) {
      if (manual) toast('Keine Verbindung – Update-Suche nicht möglich', true);
      return;
    }
    if (swReg.waiting) return showUpdateBar();
    if (swReg.installing) {
      if (manual) toast('Neue Version wird geladen …');
      return;
    }
    if (manual) toast(`Du hast die neueste Version (${APP_VERSION})`);
  }

  function applyUpdate() {
    const waiting = swReg && swReg.waiting;
    if (!waiting) { location.reload(); return; }
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  if (swSupported) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar();
      watchInstalling(reg.installing);
      reg.addEventListener('updatefound', () => watchInstalling(reg.installing));
      checkForUpdate(false);
    }).catch(() => {});
    // Beim Zurückkehren in die App erneut prüfen
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(false); });
  }
  route();
})();
