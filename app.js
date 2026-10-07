/*
 * Abrechnung – Oberfläche. Alle Daten liegen ausschließlich im localStorage dieses Geräts.
 * Austausch mit anderen erfolgt nur über Links (Daten im #-Teil der URL, der nie an einen Server geht).
 */
(function () {
  'use strict';
  const { parseEuro, formatEuro, summarize, evaluateExpense } = window.Calc;

  const STORE_KEY = 'abrechnung.v1';
  // Muss zu VERSION in sw.js passen (wird per Test geprüft).
  const APP_VERSION = 6;
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
    go(`#/b/${incoming.id}/uebersicht`);
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
    view = m && store.bills[m[1]] ? { bill: m[1], tab: m[2] || 'uebersicht' } : { home: true };
    closeDialog();
    render();
  }
  window.addEventListener('hashchange', route);

  function render() {
    if (view.home) renderHome();
    else renderBill(store.bills[view.bill], view.tab);
  }

  // ---------- Darstellung: Bausteine ----------
  const CATS = [
    { id: 'shop', icon: '🛒', label: 'Einkauf', re: /einkauf|supermarkt|lidl|aldi|rewe|edeka|netto|penny|kaufland|lebensmittel|markt|drogerie|dm\b/i },
    { id: 'food', icon: '🍽️', label: 'Essen & Trinken', re: /essen|restaurant|pizza|döner|burger|imbiss|frühstück|mittag|abend|café|cafe|kaffee|bar\b|bier|getränk|wein|drinks?|kneipe|grill/i },
    { id: 'stay', icon: '🏠', label: 'Unterkunft', re: /unterkunft|hotel|hütte|huette|airbnb|ferienwohnung|fewo|camping|zimmer|miete|übernachtung|hostel/i },
    { id: 'travel', icon: '🚗', label: 'Fahrt', re: /tank|sprit|benzin|diesel|maut|vignette|parken|park|zug|bahn|bus|taxi|uber|flug|fähre|mietwagen|auto|fahrt|ticket/i },
    { id: 'fun', icon: '🎟️', label: 'Aktivitäten', re: /eintritt|skipass|lift|kino|museum|tour|kurs|ausflug|aktivität|konzert|party|club|spa|therme|boot/i },
    { id: 'other', icon: '📦', label: 'Sonstiges', re: null },
  ];
  const catOf = (e) => CATS.find((c) => c.id === e.category) || CATS.find((c) => c.re && c.re.test(e.title || '')) || CATS[CATS.length - 1];
  const guessCat = (title) => (CATS.find((c) => c.re && c.re.test(title || '')) || CATS[CATS.length - 1]).id;

  const me = (bill) => (bill.viewerAs && bill.people.some((p) => p.id === bill.viewerAs) ? bill.viewerAs : null);
  const initials = (name) => {
    const parts = String(name).trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || ''))).toUpperCase();
  };
  function avatar(bill, id, size = '') {
    const i = bill.people.findIndex((p) => p.id === id);
    const p = bill.people[i];
    return `<span class="av ${size}" style="--av:var(--c${(i % 8) + 1})" aria-hidden="true">${esc(p ? initials(p.name) : '?')}</span>`;
  }
  const dateLabel = (iso) => {
    if (!iso) return 'Ohne Datum';
    const d = new Date(iso + 'T12:00:00');
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
  };

  function statusBanner(bill, s) {
    if (!bill.people.length) return '';
    if (s.invalid) return `<a class="status bad" href="#/b/${bill.id}/ausgaben">✗ <span><b>Unstimmig:</b> ${s.invalid} Ausgabe${s.invalid > 1 ? 'n sind' : ' ist'} fehlerhaft und ${s.invalid > 1 ? 'werden' : 'wird'} nicht berücksichtigt.</span></a>`;
    if (!s.consistent) return `<div class="status bad">✗ <b>Unstimmig:</b> Vorkasse ${formatEuro(s.paidTotal)} ≠ Verbrauch ${formatEuro(s.owedTotal)}</div>`;
    return '';
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
      ${bills.length ? `<div class="bill-cards">${bills.map((b) => {
        const s = summarize(b);
        const badge = !s.consistent ? '<span class="pill neg">✗ Unstimmig</span>'
          : s.allSettled && s.total ? '<span class="pill zero">✓ Ausgeglichen</span>'
            : s.suggestions.length ? `<span class="pill muted">${s.suggestions.length} offen</span>` : '';
        const m = me(b);
        const mine = m && s.per[m] ? s.per[m].open : null;
        return `<a class="bill-card" href="#/b/${b.id}">
          <div class="bill-card-top"><span class="bill-name">${esc(b.name)}</span>${badge}</div>
          <div class="bill-total">${formatEuro(s.total)}</div>
          <div class="bill-card-bottom"><span class="av-stack">${b.people.slice(0, 6).map((p) => avatar(b, p.id, 'sm')).join('')}${b.people.length > 6 ? `<span class="av sm more">+${b.people.length - 6}</span>` : ''}</span>
          <span class="muted-s">${mine === null || mine === undefined ? `${b.expenses.length} Ausgaben${isAdmin(b) ? '' : ' · geteilt'}` : mine === 0 ? 'Du: ausgeglichen' : `Du: <b class="${cls(mine)}">${signed(mine)}</b>`}</span></div>
        </a>`;
      }).join('')}</div>` : `<div class="empty-hero"><div class="empty-icon">🧾</div><b>Noch keine Abrechnung</b><p>Lege eine an – zum Beispiel für den nächsten Urlaub oder Ausflug.</p></div>`}
      <div class="btn-row center"><button class="btn" data-action="import">Datei importieren</button></div>
      <p class="footer-note">🔒 Alle Daten bleiben ausschließlich auf diesem Gerät.<br>Sicherung und Übertragung: Export als Datei oder per Link.</p>
      <div class="version-row"><span>Version ${APP_VERSION}</span>
        <button class="btn small" data-action="check-update">⟳ Nach Update suchen</button></div>
      <button class="fab home" data-action="new-bill">+ Neue Abrechnung</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>`;
    app.querySelector('#import-file').addEventListener('change', importFile);
  }

  async function newBill() {
    const name = await promptDialog('Neue Abrechnung', '', 'Anlegen');
    if (!name) return;
    const bill = { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), people: [], expenses: [], payments: [], role: 'admin' };
    store.bills[bill.id] = bill;
    save();
    location.hash = `#/b/${bill.id}/uebersicht`;
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

  function downloadReport(bill) {
    try {
      const bytes = window.Report.buildReport(bill);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Abrechnung-${bill.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Abrechnung wird heruntergeladen');
    } catch (e) {
      toast('Erstellen fehlgeschlagen: ' + e.message, true);
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
  const TABS = [
    ['uebersicht', 'Übersicht', '<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5"/>'],
    ['ausgaben', 'Ausgaben', '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/>'],
    ['abrechnung', 'Abrechnung', '<path d="M4 4h16v16H4zM4 9h16M4 14.5h16M9.5 4v16"/>'],
    ['ausgleich', 'Ausgleich', '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>'],
  ];

  function renderBill(bill, tab) {
    if (tab === 'teilnehmer') tab = 'uebersicht';
    if (!TABS.some(([k]) => k === tab)) tab = 'uebersicht';
    document.title = bill.name + ' – Abrechnung';
    const s = summarize(bill);
    const admin = isAdmin(bill);

    let body = '';
    if (tab === 'ausgaben') body = renderExpenses(bill, s, admin);
    else if (tab === 'abrechnung') body = renderSheet(bill, s);
    else if (tab === 'ausgleich') body = renderSettlement(bill, s, admin);
    else body = renderOverview(bill, s, admin);

    const viewerNote = admin ? '' : '<div class="status warn">👀 Geteilte Ansicht – nur der Admin kann Ausgaben ändern.</div>';
    const fab = admin && bill.people.length && (tab === 'uebersicht' || tab === 'ausgaben') ? '<button class="fab" data-action="new-expense">+ Ausgabe</button>' : '';

    app.innerHTML = `
      <header class="bar"><a class="icon-btn" href="#/" aria-label="Zur Übersicht aller Abrechnungen">‹</a>
        <h1>${esc(bill.name)}</h1>
        <button class="icon-btn" data-action="bill-menu" aria-label="Menü">⋯</button></header>
      ${viewerNote}${statusBanner(bill, s)}
      ${body}${fab}
      <nav class="bottom-nav" aria-label="Bereiche">${TABS.map(([k, l, icon]) => `<a href="#/b/${bill.id}/${k}" ${k === tab ? 'aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${l}</span>${k === 'ausgleich' && s.suggestions.length ? `<i class="dot">${s.suggestions.length}</i>` : ''}</a>`).join('')}</nav>`;

    // KittySplit-Prinzip: Wer einen geteilten Link öffnet, wird zuerst gefragt, wer er ist.
    if (!admin && !me(bill) && bill.people.length && !dlg.open && !bill.askedMe) {
      bill.askedMe = true; save();
      askWhoAmI(bill);
    }
  }

  function askWhoAmI(bill) {
    openDialog(`<div class="dlg-body"><h3>Wer bist du?</h3>
      <p class="hint">Dann siehst du sofort, was du bekommst oder zahlen musst, und kannst erhaltene Überweisungen bestätigen.</p>
      <div class="who-list">${bill.people.map((p) => `<button class="who" data-who="${p.id}">${avatar(bill, p.id)}<span>${esc(p.name)}</span></button>`).join('')}</div></div>
      <div class="dlg-actions"><button class="btn" data-who="">Nur ansehen</button></div>`, (d) => {
      d.addEventListener('click', (e) => {
        const b = e.target.closest('[data-who]');
        if (!b) return;
        bill.viewerAs = b.dataset.who || null;
        save(); closeDialog(); render();
      });
    });
  }

  // ----- Übersicht -----
  function renderOverview(bill, s, admin) {
    const m = me(bill);
    const n = bill.people.length;
    const dates = bill.expenses.map((e) => e.date).filter(Boolean).sort();
    const span = dates.length ? (dates[0] === dates[dates.length - 1] ? fmtDate(dates[0]) : `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`) : '';

    const hero = `<section class="hero">
      <div class="hero-label">Gesamtausgaben</div>
      <div class="hero-num">${formatEuro(s.total)}</div>
      <div class="hero-sub">${bill.expenses.length} Ausgabe${bill.expenses.length === 1 ? '' : 'n'} · ${n} Person${n === 1 ? '' : 'en'}${n ? ` · Ø ${formatEuro(Math.round(s.total / n))} p. P.` : ''}${span ? ` · ${span}` : ''}</div>
      ${s.total && s.consistent ? `<div class="hero-chip ${s.allSettled ? 'ok' : ''}">${s.allSettled ? '✓ Ausgeglichen' : `✓ Stimmig · ${s.suggestions.length} Überweisung${s.suggestions.length === 1 ? '' : 'en'} offen`}</div>` : ''}
    </section>`;

    // Persönliche Kachel (Splitwise-Prinzip)
    let mine = '';
    if (n) {
      if (m) {
        const x = s.per[m];
        const mineT = s.suggestions.filter((t) => t.from === m || t.to === m);
        const headline = x.open > 0 ? `Du bekommst <b class="pos">${formatEuro(x.open)}</b>` : x.open < 0 ? `Du zahlst <b class="neg">${formatEuro(-x.open)}</b>` : '<b class="pos">Du bist ausgeglichen ✓</b>';
        mine = `<section class="card me-card">
          <div class="me-head">${avatar(bill, m, 'lg')}<div class="me-text"><div class="me-name">${esc(personName(bill, m))} <button class="link" data-action="who">ändern</button></div>
          <div class="me-line">${headline}</div></div></div>
          <div class="me-stats"><div><span>Bezahlt</span><b>${formatEuro(x.paid)}</b></div><div><span>Dein Anteil</span><b>${formatEuro(x.owed)}</b></div><div><span>Überwiesen</span><b>${formatEuro(x.sent - x.received)}</b></div></div>
          ${mineT.length ? `<ul class="me-todo">${mineT.map((t) => t.from === m
            ? `<li>Du zahlst an ${avatar(bill, t.to, 'xs')} <b>${esc(personName(bill, t.to))}</b><em>${formatEuro(t.amount)}</em></li>`
            : `<li>${avatar(bill, t.from, 'xs')} <b>${esc(personName(bill, t.from))}</b> zahlt dir<em>${formatEuro(t.amount)}</em></li>`).join('')}</ul>` : ''}
        </section>`;
      } else {
        mine = `<button class="card who-prompt" data-action="who"><span class="who-q">🙋</span><span><b>Wer bist du?</b><br><span class="muted-s">Wähle dich aus, um deinen persönlichen Stand zu sehen.</span></span></button>`;
      }
    }

    // Salden als divergierende Balken
    const maxAbs = Math.max(1, ...bill.people.map((p) => Math.abs(s.per[p.id].open)));
    const balances = n ? `<section class="card">
      <div class="card-head"><h2>Offene Salden</h2><a class="link" href="#/b/${bill.id}/ausgleich">Ausgleich →</a></div>
      <ul class="bal-list">${bill.people.map((p) => {
        const v = s.per[p.id].open;
        const w = Math.round((Math.abs(v) / maxAbs) * 100);
        return `<li class="${p.id === m ? 'is-me' : ''}" title="${esc(p.name)}: ${signed(v)}">${avatar(bill, p.id, 'sm')}<span class="bal-name">${esc(p.name)}</span>
          <span class="bal-track"><span class="bal-half neg-half">${v < 0 ? `<i style="width:${w}%"></i>` : ''}</span><span class="bal-half pos-half">${v > 0 ? `<i style="width:${w}%"></i>` : ''}</span></span>
          <span class="bal-val ${cls(v)}">${v === 0 ? '✓ 0,00 €' : signed(v)}</span></li>`;
      }).join('')}</ul>
      <p class="hint small">Grün: bekommt Geld · Rot: muss zahlen · bereits erfolgte Überweisungen sind verrechnet.</p>
    </section>` : '';

    // Teilnehmer
    const people = `<section class="card">
      <div class="card-head"><h2>Teilnehmer (${n})</h2></div>
      ${n ? `<div class="people-chips">${bill.people.map((p) => `<button class="person-chip" ${admin ? `data-action="person-menu" data-id="${p.id}"` : 'disabled'}>${avatar(bill, p.id, 'sm')}<span>${esc(p.name)}</span></button>`).join('')}</div>` : '<p class="hint">Füge alle hinzu, die mitmachen.</p>'}
      ${admin ? `<form class="inline-form" data-form="add-person" style="margin-top:12px">
        <input name="name" placeholder="Name hinzufügen" autocomplete="off" required aria-label="Name">
        <button class="btn primary">Hinzufügen</button></form>` : ''}
    </section>`;

    // Kategorien (gestapelter Balken + Legende mit Werten)
    let cats = '';
    if (s.total) {
      const sums = CATS.map((c, i) => ({ ...c, i, sum: 0 }));
      for (const e of bill.expenses) if (s.results[e.id].ok) sums[CATS.indexOf(catOf(e))].sum += e.amount;
      const used = sums.filter((c) => c.sum > 0);
      cats = `<section class="card">
        <div class="card-head"><h2>Wofür?</h2></div>
        <div class="stack" role="img" aria-label="Ausgaben nach Kategorie">${used.map((c) => `<span style="flex:${c.sum};background:var(--c${c.i + 1})" title="${c.label}: ${formatEuro(c.sum)}"></span>`).join('')}</div>
        <ul class="legend">${used.sort((a, b) => b.sum - a.sum).map((c) => `<li><i style="background:var(--c${c.i + 1})"></i>${c.icon} ${c.label}<span>${formatEuro(c.sum)}</span><em>${Math.round((c.sum / s.total) * 100)} %</em></li>`).join('')}</ul>
      </section>`;
    }

    if (!n) return hero + people;
    return hero + mine + balances + cats + people;
  }

  // ----- Ausgaben -----
  let expenseQuery = '';
  function renderExpenses(bill, s, admin) {
    if (!bill.people.length) return `<div class="empty-hero"><div class="empty-icon">👥</div><b>Noch keine Teilnehmer</b><p><a href="#/b/${bill.id}/uebersicht">Zuerst Teilnehmer anlegen</a></p></div>`;
    if (!bill.expenses.length) return `<div class="empty-hero"><div class="empty-icon">🧾</div><b>Noch keine Ausgaben</b><p>${admin ? 'Tippe auf „+ Ausgabe“, um die erste zu erfassen.' : 'Der Admin hat noch nichts eingetragen.'}</p></div>`;
    const m = me(bill);
    const q = expenseQuery.trim().toLowerCase();
    const list = bill.expenses.map((e, i) => ({ e, i }))
      .filter(({ e }) => !q || (e.title || '').toLowerCase().includes(q) || catOf(e).label.toLowerCase().includes(q));
    const groups = new Map();
    for (const it of list.sort((a, b) => (b.e.date || '').localeCompare(a.e.date || '') || b.i - a.i)) {
      const k = it.e.date || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : b.localeCompare(a)));
    const html = keys.map((k) => {
      const items = groups.get(k);
      const daySum = items.reduce((sum, { e }) => sum + (s.results[e.id].ok ? e.amount : 0), 0);
      return `<div class="day-head"><span>${dateLabel(k)}</span><span>${formatEuro(daySum)}</span></div>
      <ul class="list">${items.map(({ e, i }) => {
        const r = s.results[e.id];
        const c = catOf(e);
        const payerIds = Object.keys(r.paid);
        const payers = payerIds.length === 1 ? `${esc(personName(bill, payerIds[0]))} hat bezahlt` : `${payerIds.length} haben bezahlt`;
        const nShare = Object.keys(r.owed).length;
        const share = nShare === bill.people.length ? 'alle' : `${nShare} Pers.`;
        let mineLine = '';
        if (m && r.ok) {
          const net = (r.paid[m] || 0) - (r.owed[m] || 0);
          mineLine = net > 0 ? `<span class="pos">du bekommst ${formatEuro(net)}</span>` : net < 0 ? `<span class="neg">dein Anteil ${formatEuro(-net)}</span>` : '<span class="muted-s">nicht beteiligt</span>';
          if (!(r.paid[m] || r.owed[m])) mineLine = '<span class="muted-s">nicht beteiligt</span>';
        }
        return `<li class="${r.ok ? '' : 'bad'}"><button class="row-btn" data-action="edit-expense" data-id="${e.id}">
          <span class="cat-tile" style="--cat:var(--c${CATS.indexOf(c) + 1})" title="${c.label}">${c.icon}</span>
          <div class="row-main"><div class="row-title"><span class="num">${i + 1}</span>${esc(e.title || 'Ohne Bezeichnung')}</div>
          <div class="row-sub">${r.ok ? `${payers} · geteilt auf ${share}` : '⚠ ' + esc(r.errors.join(' · '))}</div></div>
          <div class="row-right"><span class="row-amount">${formatEuro(e.amount || 0)}</span>${mineLine ? `<span class="row-mine">${mineLine}</span>` : ''}</div></button></li>`;
      }).join('')}</ul>`;
    }).join('');
    return `
      <div class="search"><input type="search" data-input="expense-search" placeholder="🔍 Ausgaben durchsuchen" value="${esc(expenseQuery)}" aria-label="Ausgaben durchsuchen"></div>
      ${html || '<div class="empty">Keine Treffer.</div>'}
      <div class="sum-bar"><span>Σ ${bill.expenses.length - s.invalid} Ausgaben${s.invalid ? ` <span class="neg">(+${s.invalid} fehlerhaft)</span>` : ''}</span><b>${formatEuro(s.total)}</b></div>`;
  }

  // ----- Abrechnung (Aufbau wie die Excel-Vorlage) -----
  let sheetMode = 'paid';
  function renderSheet(bill, s) {
    const people = bill.people;
    if (!people.length) return '<div class="empty">Noch keine Teilnehmer.</div>';
    const modes = { paid: 'Vorkasse (Σ1)', owed: 'Verbrauch (Σ2)', net: 'Saldo' };
    const colTot = people.map(() => 0);
    let grand = 0;
    const rows = bill.expenses.map((e, k) => {
      const r = s.results[e.id];
      let rowSum = 0;
      const cells = people.map((p, i) => {
        const v = sheetMode === 'paid' ? (r.paid[p.id] || 0) : sheetMode === 'owed' ? (r.owed[p.id] || 0) : (r.paid[p.id] || 0) - (r.owed[p.id] || 0);
        if (r.ok) { colTot[i] += v; rowSum += v; }
        return `<td class="${sheetMode === 'net' ? cls(v) : ''}">${v ? (sheetMode === 'net' ? signed(v) : formatEuro(v)) : '<span class="faint">–</span>'}</td>`;
      }).join('');
      const paid = Object.values(r.paid).reduce((a, b) => a + b, 0);
      const owed = Object.values(r.owed).reduce((a, b) => a + b, 0);
      const diff = paid - owed;
      if (r.ok) grand += rowSum;
      return `<tr class="${r.ok ? '' : 'row-bad'}"><td class="sticky num-c">${k + 1}</td><td class="sticky2 name-c">${catOf(e).icon} ${esc(e.title || 'Ohne Bezeichnung')}</td>
        <td>${formatEuro(e.amount || 0)}</td>${cells}<td class="${r.ok && diff === 0 ? 'cell-ok' : 'cell-bad'}">${r.ok && diff === 0 ? '✓' : formatEuro(diff)}</td></tr>`;
    }).join('');
    const totLabel = sheetMode === 'paid' ? 'Σ1 Vorkasse' : sheetMode === 'owed' ? 'Σ2 Verbrauch' : 'ΣVV Guthaben';
    const matrix = `<div class="table-wrap"><table class="sheet">
      <thead><tr><th class="sticky">#</th><th class="sticky2 name-c">Leistung</th><th>Betrag</th>${people.map((p) => `<th>${esc(p.name)}</th>`).join('')}<th>Kontrolle</th></tr></thead>
      <tbody>${rows || `<tr><td class="sticky"></td><td class="sticky2 name-c faint">Noch keine Ausgaben</td><td colspan="${people.length + 2}"></td></tr>`}</tbody>
      <tfoot><tr><td class="sticky"></td><td class="sticky2 name-c">${totLabel}</td><td>${formatEuro(s.total)}</td>${colTot.map((v) => `<td class="${sheetMode === 'net' ? cls(v) : ''}">${sheetMode === 'net' ? signed(v) : formatEuro(v)}</td>`).join('')}
      <td class="${(sheetMode === 'net' ? grand === 0 : grand === s.total) ? 'cell-ok' : 'cell-bad'}">${(sheetMode === 'net' ? grand === 0 : grand === s.total) ? '✓' : '✗'}</td></tr></tfoot>
    </table></div>`;

    // Bilanz
    let tVV = 0; let tA = 0; let tG = 0;
    const bil = people.map((p) => {
      const x = s.per[p.id];
      const a = x.received - x.sent;
      tVV += x.balance; tA += a; tG += x.open;
      return `<tr><td class="name-c">${avatar(bill, p.id, 'xs')} ${esc(p.name)}</td><td>${formatEuro(x.paid)}</td><td>${formatEuro(x.owed)}</td>
        <td class="${cls(x.balance)}">${signed(x.balance)}</td><td>${a ? signed(a) : '<span class="faint">–</span>'}</td>
        <td class="${x.open === 0 ? 'cell-ok' : cls(x.open)}">${x.open === 0 ? '✓ 0,00 €' : signed(x.open)}</td></tr>`;
    }).join('');
    const bilanz = `<div class="table-wrap"><table class="sheet">
      <thead><tr><th class="name-c">Teilnehmer</th><th>Vorkasse Σ1</th><th>Verbrauch Σ2</th><th>Guthaben ΣVV<small>Σ1 − Σ2</small></th><th>Ausgleich ΣA<small>erhalten − gesendet</small></th><th>Offen Σges<small>ΣVV − ΣA</small></th></tr></thead>
      <tbody>${bil}</tbody>
      <tfoot><tr><td class="name-c">Σ Kontrolle</td><td>${formatEuro(s.paidTotal)}</td><td>${formatEuro(s.owedTotal)}</td>
      <td class="${tVV === 0 ? 'cell-ok' : 'cell-bad'}">${formatEuro(tVV)}</td><td>${formatEuro(tA)}</td><td class="${tG === 0 ? 'cell-ok' : 'cell-bad'}">${formatEuro(tG)}</td></tr></tfoot>
    </table></div>`;

    // Ausgleichsmatrix (erledigt + offen)
    const idx = Object.fromEntries(people.map((p, i) => [p.id, i]));
    const mat = people.map(() => people.map(() => ({ done: 0, open: 0 })));
    for (const p of bill.payments) if (idx[p.from] !== undefined && idx[p.to] !== undefined) mat[idx[p.from]][idx[p.to]].done += p.amount;
    for (const t of s.suggestions) mat[idx[t.from]][idx[t.to]].open += t.amount;
    const sumOf = (c) => c.done + c.open;
    const mrows = people.map((p, i) => `<tr><td class="name-c">${avatar(bill, p.id, 'xs')} ${esc(p.name)}</td>${people.map((q, j) => {
      const c = mat[i][j];
      if (i === j) return '<td class="diag"></td>';
      if (!sumOf(c)) return '<td><span class="faint">–</span></td>';
      return `<td class="${c.open ? 'mx-open' : 'mx-done'}" title="${c.done ? 'erledigt ' + formatEuro(c.done) : ''}${c.done && c.open ? ' · ' : ''}${c.open ? 'offen ' + formatEuro(c.open) : ''}">${formatEuro(sumOf(c))}${c.open ? '' : ' ✓'}</td>`;
    }).join('')}<td><b>${formatEuro(mat[i].reduce((a, c) => a + sumOf(c), 0))}</b></td></tr>`).join('');
    const colSums = people.map((q, j) => mat.reduce((a, row) => a + sumOf(row[j]), 0));
    const matrixHtml = `<div class="table-wrap"><table class="sheet">
      <thead><tr><th class="name-c">von \\ an</th>${people.map((p) => `<th>${esc(p.name)}</th>`).join('')}<th>Σ von</th></tr></thead>
      <tbody>${mrows}</tbody>
      <tfoot><tr><td class="name-c">Σ an</td>${colSums.map((v) => `<td>${formatEuro(v)}</td>`).join('')}<td class="cell-ok">✓</td></tr></tfoot>
    </table></div>`;

    // Statistik
    const valid = bill.expenses.filter((e) => s.results[e.id].ok);
    const top = valid.slice().sort((a, b) => b.amount - a.amount)[0];
    const dates = valid.map((e) => e.date).filter(Boolean).sort();
    const days = dates.length ? Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000) + 1 : 0;
    const topPayer = people.slice().sort((a, b) => s.per[b.id].paid - s.per[a.id].paid)[0];
    const stats = `<div class="tiles">
      <div class="tile"><span>Ø pro Person</span><b>${formatEuro(Math.round(s.total / people.length))}</b></div>
      <div class="tile"><span>Ø pro Ausgabe</span><b>${valid.length ? formatEuro(Math.round(s.total / valid.length)) : '–'}</b></div>
      <div class="tile"><span>${days ? `Ø pro Tag (${days} Tag${days === 1 ? '' : 'e'})` : 'Ø pro Tag'}</span><b>${days ? formatEuro(Math.round(s.total / days)) : '–'}</b></div>
      <div class="tile"><span>Größte Ausgabe</span><b>${top ? formatEuro(top.amount) : '–'}</b><small>${top ? esc(top.title || '') : ''}</small></div>
      <div class="tile"><span>Hat am meisten ausgelegt</span><b>${topPayer && s.per[topPayer.id].paid ? esc(topPayer.name) : '–'}</b><small>${topPayer && s.per[topPayer.id].paid ? formatEuro(s.per[topPayer.id].paid) : ''}</small></div>
      <div class="tile"><span>Überweisungen nötig</span><b>${s.suggestions.length + bill.payments.length}</b><small>${bill.payments.length} erledigt</small></div>
    </div>`;

    return `
      <div class="sheet-actions"><button class="btn primary" data-action="download-report">📊 Als Excel herunterladen</button></div>
      <h2>1 · Ausgaben je Teilnehmer</h2>
      <div class="seg" role="group" aria-label="Ansicht">${Object.entries(modes).map(([k, l]) => `<button type="button" data-action="sheet-mode" data-mode="${k}" aria-pressed="${sheetMode === k}">${l}</button>`).join('')}</div>
      ${matrix}
      <p class="hint small">${sheetMode === 'paid' ? 'Wer hat bei welcher Ausgabe wie viel ausgelegt.' : sheetMode === 'owed' ? 'Welcher Anteil jeder Ausgabe auf wen entfällt.' : 'Ausgelegt minus Anteil je Ausgabe – die Zeilensumme ist immer 0.'} Kontrolle ✓: Vorkasse = Verbrauch.</p>
      <h2>2 · Bilanz</h2>${bilanz}
      <h2>3 · Ausgleichszahlungen <small>(Zeile zahlt an Spalte)</small></h2>${matrixHtml}
      <p class="hint small">✓ = erledigt · orange = noch offen.</p>
      <h2>4 · Statistik</h2>${stats}`;
  }

  // ----- Ausgleich -----
  function renderSettlement(bill, s, admin) {
    if (!bill.people.length) return '<div class="empty">Noch keine Teilnehmer.</div>';
    const m = me(bill);
    const openSum = s.suggestions.reduce((a, t) => a + t.amount, 0);
    const hero = s.suggestions.length
      ? `<section class="hero compact"><div class="hero-label">Noch offen</div><div class="hero-num">${s.suggestions.length} Überweisung${s.suggestions.length === 1 ? '' : 'en'}</div><div class="hero-sub">insgesamt ${formatEuro(openSum)} · so wenige wie möglich</div></section>`
      : `<section class="hero compact ok"><div class="hero-num">${s.total ? '✓ Alles ausgeglichen' : 'Noch nichts abzurechnen'}</div>${s.total ? '<div class="hero-sub">Alle stehen bei 0,00 €.</div>' : ''}</section>`;

    const open = s.suggestions.map((t, i) => {
      const canTick = admin || (m && m === t.to);
      const mine = m && (t.from === m || t.to === m);
      return `<li class="tcard ${mine ? 'is-me' : ''}">
        <div class="tflow">${avatar(bill, t.from)}<span class="tarrow"><b>${formatEuro(t.amount)}</b><i></i></span>${avatar(bill, t.to)}</div>
        <div class="tnames"><span>${esc(personName(bill, t.from))}${t.from === m ? ' (du)' : ''}</span><span>${esc(personName(bill, t.to))}${t.to === m ? ' (du)' : ''}</span></div>
        ${canTick ? `<button class="btn small primary block" data-action="tick" data-i="${i}">✓ Erhalten</button>` : ''}</li>`;
    }).join('');

    const done = bill.payments.slice().reverse().map((p) => {
      const who = p.by && p.by !== 'admin' ? personName(bill, p.by) : 'Admin';
      const canUndo = admin || (p.pending && p.by === m);
      return `<li class="transfer done">${avatar(bill, p.from, 'sm')}<div class="who"><b>${esc(personName(bill, p.from))}</b><span class="arrow">→</span><b>${esc(personName(bill, p.to))}</b>
        <div class="row-sub">${p.pending ? '⏳ wartet auf Verbuchung durch Admin' : `✓ bestätigt von ${esc(who)}`} · ${fmtTime(p.at)}</div></div>
        <span class="row-amount">${formatEuro(p.amount)}</span>
        ${p.pending ? `<button class="btn small" data-action="resend" data-id="${p.id}" aria-label="Bestätigung erneut senden">Senden</button>` : ''}
        ${canUndo ? `<button class="icon-btn" data-action="undo-payment" data-id="${p.id}" aria-label="Rückgängig">↺</button>` : ''}</li>`;
    }).join('');

    let tickHint = '';
    if (!admin && s.suggestions.length) {
      tickHint = m ? '<p class="hint">Du kannst Überweisungen abhaken, die du erhalten hast. Danach schickst du dem Admin die Bestätigung.</p>'
        : '<p class="hint"><button class="link" data-action="who">Wähle aus, wer du bist</button>, um erhaltene Überweisungen abzuhaken.</p>';
    }

    return `${hero}
      ${s.suggestions.length ? `<ul class="tlist">${open}</ul>${tickHint}` : ''}
      ${bill.payments.length ? `<h2>Erledigt</h2><ul class="list">${done}</ul>` : ''}
      <div class="action-grid">
        <button class="btn" data-action="share-result">💬 Ergebnis teilen</button>
        ${admin ? '<button class="btn" data-action="share-bill">🔗 Link an Gruppe</button>' : ''}
        <button class="btn" data-action="download-report">📊 Excel</button>
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
      category: e.category || '',
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
      return { id: e.id, title: d.title.trim(), amount: Number.isNaN(amount) ? 0 : amount, date: d.date, category: d.category || guessCat(d.title), payers, split: { mode: d.mode, values } };
    }

    const payerSection = () => d.multi
      ? people.map((p) => `<div class="split-row"><div class="name">${avatar(bill, p.id, 'xs')}<span>${esc(p.name)}</span></div><span></span>
          <input inputmode="decimal" data-payer="${p.id}" value="${esc(d.payerIn[p.id])}" placeholder="0,00" aria-label="Gezahlt von ${esc(p.name)}"></div>`).join('')
      : `<div class="chips">${people.map((p) => `<label class="chip"><input type="radio" name="single" value="${p.id}" ${d.single === p.id ? 'checked' : ''}><span>${avatar(bill, p.id, 'xs')}${esc(p.name)}</span></label>`).join('')}</div>`;

    const splitSection = () => people.map((p) => {
      let input = '';
      if (d.mode === 'shares') input = `<input inputmode="decimal" data-share="${p.id}" value="${esc(d.shares[p.id])}" aria-label="Anteile ${esc(p.name)}">`;
      else if (d.mode === 'exact') input = `<input inputmode="decimal" data-exact="${p.id}" value="${esc(d.exact[p.id])}" placeholder="0,00" aria-label="Betrag ${esc(p.name)}">`;
      else input = '<span></span>';
      const box = d.mode === 'equal' ? `<input type="checkbox" data-member="${p.id}" ${d.members.has(p.id) ? 'checked' : ''} aria-label="${esc(p.name)} beteiligt">` : '';
      return `<div class="split-row" data-row="${p.id}"><label class="name">${box}${avatar(bill, p.id, 'xs')}<span>${esc(p.name)}</span></label>${input}<span class="calc" data-calc="${p.id}"></span></div>`;
    }).join('');

    const modeLabel = { equal: 'Gleich', shares: 'Anteile', exact: 'Beträge' };
    openDialog(`
      <form id="xf" class="dlg-body" novalidate>
        <h3>${isNew ? 'Neue Ausgabe' : admin ? 'Ausgabe bearbeiten' : 'Ausgabe'}</h3>
        <fieldset ${admin ? '' : 'disabled'} style="margin:0">
        <div class="field"><label>Bezeichnung<input name="title" value="${esc(d.title)}" placeholder="z. B. Supermarkt, Unterkunft …" autocomplete="off"></label></div>
        <div class="cat-chips" role="group" aria-label="Kategorie">${CATS.map((c) => `<button type="button" data-cat="${c.id}" aria-pressed="false" style="--cat:var(--c${CATS.indexOf(c) + 1})">${c.icon}<span>${c.label}</span></button>`).join('')}</div>
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

      function markCat() {
        const cur = d.category || guessCat(d.title);
        root.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cur)));
      }
      markCat();
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
        if (t.name === 'title') { d.title = t.value; markCat(); }
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
        if (b.dataset.cat) { d.category = b.dataset.cat; markCat(); return; }
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
    if (a === 'download-report') return downloadReport(bill);
    if (a === 'who') return askWhoAmI(bill);
    if (a === 'sheet-mode') { sheetMode = el.dataset.mode; return render(); }
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
        <button class="btn" data-m="report">📊 Abrechnung als Excel herunterladen</button>
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
          if (k === 'report') { closeDialog(); return downloadReport(bill); }
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

  document.addEventListener('input', (ev) => {
    if (ev.target.dataset.input !== 'expense-search') return;
    expenseQuery = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const inp = app.querySelector('[data-input="expense-search"]');
    if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) { /* type=search */ } }
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

  let updateRequested = false;
  function applyUpdate() {
    updateRequested = true;
    const waiting = swReg && swReg.waiting;
    if (!waiting) { location.reload(); return; }
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  if (swSupported) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Nur nach „Jetzt aktualisieren“ neu laden – nicht, wenn der Service Worker beim ersten Besuch übernimmt.
      if (reloading || !updateRequested) return;
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
