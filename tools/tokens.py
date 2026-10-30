#!/usr/bin/env python3
"""
Tokenzählung für die Fortschrittsseite (Skill session-fortschritt, Abschnitt 5 Kurzfassung; Regelwerk Tokens v11,
Regelwerk Tokens v15, docs/token-regeln.md: Nachlauf je Segmentende, pflege ohne k01 + stabilAb,
Postfach aktionen, Auftragszustände blockiert/abgebrochen, Prüfregeln bis P27).

Python statt tools/tokens.ps1, weil die Cloud-Session kein PowerShell hat. Nur Standardbibliothek,
keine Geheimnisse, gibt keine Protokollinhalte aus – nur Zählwerte und Zeitstempel.

Aufruf:
  python3 tools/tokens.py dedup
      Dedup-Prüfung: Zählzeilen vs. Schlüssel, usage je Schlüssel identisch?
  python3 tools/tokens.py run --tasks <Ordner mit tasks/*.json> --seit <ISO> [--now <ISO>] [--out <Datei>]
      Vollständiger Durchlauf: tokensUsed/tokensPartial/tokensForecast je Auftrag und meta/tokens.
      <Ordner> ist das out_dir eines ArtifactData-list der Sammlung "tasks".
      --versions "t01=5,t02=5,…" übernimmt die Dokumentversionen aus der list-Antwort (für if_version).
      --zaehlung-live '<Dokument meta/zaehlung, wie eben gelesen>' | fehlt  --gelesen <ISO, Zeitpunkt des Lesens>
      Zählbeginn (Abschnitt 2/6): unmittelbar vor dem Aufruf live aus der Datenbank gelesen, nie aus einem Export.
      Ohne gültigen, höchstens 120 s alten Lesewert bricht der Durchlauf ab (Exit 1, keine Ausgabe zum Schreiben).
      Nur bei gesetztem seit gibt es den Kompensationstask k01 (bis zum Zählbeginn); sonst wird er gelöscht.
  python3 tools/tokens.py postfach --dir <Ordner mit aktionen/*.json> [--now <ISO>]
      Lesepflicht Postfach (Abschnitt 8): ungesehene Einträge auflisten und die Schreibvorgänge
      gesehen = true / gesehenAt = jetzt ausgeben (die Session löscht nie).
  python3 tools/tokens.py pruefen --dir <Ordner mit tasks/, meta/, aktionen/> --seite <html> [--vorher <meta/tokens.json des
      vorigen Laufs>] [--now <ISO>]
      Selbstprüfung nach Skill Abschnitt 6 und Regelwerk Abschnitt 9 mit Abnahmekriterien. Prüfzeitraum für P27 und
      die Tagesquote: ab meta/zaehlung.seit (ohne Zählbeginn ab pflege.seit) bis meta/tokens.updatedAt.
"""
import argparse
import datetime as dt
import glob
import json
import os
import subprocess
import sys
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Europe/Berlin')
NACHLAUF_MAX = dt.timedelta(minutes=15)
LESE_MAX = dt.timedelta(seconds=120)
K01_TITEL = 'Kompensation: Tokens vor dem Zählbeginn'
K01_NOTE = ('Alle Tokens vor dem Zählbeginn; die Kachel zeigt sie mit Aufteilung zugeordnet / nicht zugeordnet. '
            'tokensUsed ist der nicht zugeordnete Teil.')


def parse(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def iso(d):
    return d.astimezone(TZ).isoformat(timespec='seconds')


# ---------- Quellen ----------
def arbeitsordner():
    pfade = {os.path.realpath(os.getcwd())}
    try:
        out = subprocess.run(['git', 'worktree', 'list', '--porcelain'], capture_output=True, text=True, check=True).stdout
        pfade |= {os.path.realpath(z[9:]) for z in out.splitlines() if z.startswith('worktree ')}
    except (OSError, subprocess.CalledProcessError):
        pass
    return pfade


def quellordner():
    basis = os.path.expanduser('~/.claude/projects')
    kodiert = {p.replace('/', '-').replace('\\', '-').replace(':', '-').replace('.', '-') for p in arbeitsordner()}
    return sorted(os.path.join(basis, d) for d in os.listdir(basis) if any(k in d for k in kodiert)) if os.path.isdir(basis) else []


def zeilen(ordner):
    for o in ordner:
        for f in sorted(glob.glob(os.path.join(o, '**', '*.jsonl'), recursive=True)):
            with open(f, encoding='utf-8') as fh:
                for z in fh:
                    try:
                        yield json.loads(z)
                    except json.JSONDecodeError:
                        continue


FELDER = ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')


def nachrichten(ordner):
    """Dedup nach message.id (sonst uuid): Zeile mit höchstem output_tokens, bei Gleichstand größtem timestamp."""
    beste, log_start, roh, usages = {}, None, 0, {}
    for o in zeilen(ordner):
        ts = o.get('timestamp')
        if ts and (log_start is None or parse(ts) < log_start):
            log_start = parse(ts)
        m = o.get('message') or {}
        if o.get('type') != 'assistant' or not isinstance(m, dict) or not m.get('usage'):
            continue
        roh += 1
        u = {k: int(m['usage'].get(k) or 0) for k in FELDER}
        key = m.get('id') or o.get('uuid')
        usages.setdefault(key, set()).add(tuple(u[k] for k in FELDER))
        kand = (u['output_tokens'], parse(ts), u)
        if key not in beste or kand[:2] > beste[key][:2]:
            beste[key] = kand
    msgs = sorted((t, u) for _, t, u in beste.values())
    return msgs, log_start, roh, usages


# ---------- Aufträge ----------
def lade_tasks(ordner):
    tasks = {}
    for f in glob.glob(os.path.join(ordner, 'tasks', '*.json')):
        o = json.load(open(f, encoding='utf-8'))
        d = o.get('data', o)
        tid = o.get('id') or os.path.basename(f)[:-5]
        tasks[tid] = {'data': d, 'version': o.get('version')}
    return tasks


def num(tid):
    return int(''.join(c for c in tid if c.isdigit()) or 0)


def segmente(d, now):
    return [(parse(s['start']), parse(s['end']) if s.get('end') else now) for s in d.get('segments') or []]


def zuordner(tasks, now):
    """Liefert wem(ts) → Task-id oder None (Segmente vor Vor-/Nachlauf, Abschnitt 4)."""
    seg = {tid: segmente(t['data'], now) for tid, t in tasks.items() if not ausgenommen(t['data'])}
    seg = {k: v for k, v in seg.items() if v}
    created = {tid: parse(t['data']['created']) for tid, t in tasks.items() if t['data'].get('created') and not ausgenommen(t['data'])}
    registered = {tid: parse(t['data']['registered']) for tid, t in tasks.items() if t['data'].get('registered') and not ausgenommen(t['data'])}
    # Nachlauf nach jedem Segmentende (Abschnitt 4): bis zum frühesten created ≥ Ende unter den danach
    # registrierten Aufträgen, höchstens 15 min; ein eigenes späteres Segment beendet ihn ebenfalls.
    nach = []
    for tid, ss in seg.items():
        for _, ende in ss:
            grenzen = [created[o] for o in created if o != tid and registered.get(o) and registered[o] > ende and created[o] >= ende]
            grenzen += [s for s, _ in ss if s >= ende]
            nach.append((tid, ende, min([ende + NACHLAUF_MAX] + grenzen)))
    vor = {tid: (created[tid], min(s for s, _ in ss)) for tid, ss in seg.items() if tid in created}

    def wem(ts):
        drin = [(s, num(tid), tid) for tid, ss in seg.items() for s, e in ss if s <= ts < e]
        if drin:
            return max(drin)[2]
        kand = [(a, num(tid), tid) for tid, (a, b) in vor.items() if a <= ts < b]
        kand += [(a, num(tid), tid) for tid, a, b in nach if a <= ts < b]
        return max(kand)[2] if kand else None
    return wem, list(seg)


def zuordnen(msgs, tasks, now):
    wem, ids = zuordner(tasks, now)
    used = {tid: 0 for tid in ids}
    rest = []
    for ts, u in msgs:
        tid = wem(ts)
        if tid:
            used[tid] += sum(u.values())
        else:
            rest.append((ts, sum(u.values())))
    return used, rest


def runden(ordner):
    """Gesprächsrunden der Haupt-Sessions (ohne Subagenten): Nachricht von Phillip bis zur letzten Antwort vor der
    nächsten. Je Runde (Beginn, Zeitpunkte der Antworten mit Werkzeugaufruf)."""
    R = []
    for o_ in ordner:
        for f in sorted(glob.glob(os.path.join(o_, '*.jsonl'))):
            cur = None
            for z in open(f, encoding='utf-8'):
                try:
                    o = json.loads(z)
                except json.JSONDecodeError:
                    continue
                m = o.get('message') or {}
                c = m.get('content') if isinstance(m, dict) else None
                if o.get('type') == 'user' and not o.get('isMeta') and not o.get('isCompactSummary'):
                    teile = [c] if isinstance(c, str) else [x for x in c or [] if isinstance(x, dict)]
                    if any(isinstance(x, dict) and x.get('type') == 'tool_result' for x in teile):
                        continue
                    text = ''.join(x if isinstance(x, str) else x.get('text', '') for x in teile).strip()
                    if text and not text.startswith('<'):
                        cur = (parse(o['timestamp']), [])
                        R.append(cur)
                elif o.get('type') == 'assistant' and cur and isinstance(c, list):
                    if any(isinstance(x, dict) and x.get('type') == 'tool_use' for x in c):
                        cur[1].append(parse(o['timestamp']))
    return [r for r in R if r[1]]


def kompensation(d):
    return d.get('kind') == 'kompensation'


def ausgenommen(d):
    """Von der Zuordnung ausgenommen: Cloud-Aufträge mit Vermerk „created = Anlage“ und der Kompensationstask."""
    return 'created = Anlage' in (d.get('note') or '') or kompensation(d)


def stabil(pf_msgs, pf_rest, seit, now, grenze=0.03):
    """pflege.stabilAb: Beginn der ersten vollen Stunde ≥ seit, ab der an jedem Kalendertag bis heute der
    nicht zugeordnete Anteil (ohne k01) unter 3 % liegt; sonst bzw. bei weniger als zwei Tagen Daten: seit."""
    stunde = lambda t: t.astimezone(TZ).replace(minute=0, second=0, microsecond=0)
    tot, una = {}, {}
    for t, u in pf_msgs:
        tot[stunde(t)] = tot.get(stunde(t), 0) + sum(u.values())
    for t, n in pf_rest:
        una[stunde(t)] = una.get(stunde(t), 0) + n
    tage = sorted({h.date() for h in tot})
    if len(tage) < 2:
        return seit
    erste = stunde(seit) + (dt.timedelta(hours=1) if stunde(seit) < seit.astimezone(TZ) else dt.timedelta(0))
    for kand in sorted(h for h in tot if h >= erste):
        ok = True
        for tag in (x for x in tage if x >= kand.date()):
            hs = [h for h in tot if h.date() == tag and h >= kand]
            t_sum = sum(tot[h] for h in hs)
            if t_sum and sum(una.get(h, 0) for h in hs) / t_sum >= grenze:
                ok = False
                break
        if ok:
            return kand
    return seit


def worked_min(d, now):
    return sum((e - s).total_seconds() for s, e in segmente(d, now)) / 60


def zaehlbeginn(args):
    """meta/zaehlung live (Abschnitt 2/6): Dokument wie eben aus der Datenbank gelesen oder „fehlt“. Bei fehlendem,
    veraltetem oder unlesbarem Wert kein Durchlauf – nie „nicht gesetzt“ annehmen."""
    roh, jetzt = (args.zaehlung_live or '').strip(), dt.datetime.now(dt.timezone.utc)
    try:
        gelesen = parse(args.gelesen)
    except (TypeError, ValueError):
        sys.exit('Abbruch: --gelesen fehlt oder ist ungültig – Zählbeginn erst live lesen.')
    if not dt.timedelta(seconds=-5) <= jetzt - gelesen <= LESE_MAX:
        sys.exit(f'Abbruch: Zählbeginn vor {(jetzt - gelesen).total_seconds():.0f} s gelesen – unmittelbar vor dem Durchlauf neu lesen.')
    if roh == 'fehlt':
        return None
    if not roh.startswith('{') or os.path.exists(roh):
        sys.exit('Abbruch: --zaehlung-live erwartet das live gelesene Dokument (JSON) oder „fehlt“, keine Datei.')
    try:
        doc = json.loads(roh)
        return parse(doc['seit']) if doc.get('seit') else None
    except (ValueError, KeyError, TypeError):
        sys.exit('Abbruch: Zählbeginn nicht lesbar – kein Durchlauf.')


def run(args):
    zbeginn = zaehlbeginn(args)
    now = parse(args.now) if args.now else dt.datetime.now(dt.timezone.utc)
    ordner = quellordner()
    msgs, log_start, _, _ = nachrichten(ordner)
    msgs = [(t, u) for t, u in msgs if t <= now]
    tasks = lade_tasks(args.tasks)
    for paar in filter(None, (args.versions or '').split(',')):
        tid, v = paar.split('=')
        if tid.strip() in tasks:
            tasks[tid.strip()]['version'] = int(v)
    used, rest = zuordnen(msgs, tasks, now)
    seit = parse(args.seit)
    # Kompensationstask nur bei gesetztem Zählbeginn: nicht zugeordnete Nachrichten davor gehen an k01
    komp = sum(n for ts, n in rest if zbeginn and ts < zbeginn)
    komp_id = next((tid for tid, t in tasks.items() if kompensation(t['data'])), None)

    days, breakdown = {}, {'input': 0, 'cacheCreate': 0, 'cacheRead': 0, 'output': 0}
    for t, u in msgs:
        k = t.astimezone(TZ).date().isoformat()
        days[k] = days.get(k, 0) + sum(u.values())
        breakdown['input'] += u['input_tokens']
        breakdown['cacheCreate'] += u['cache_creation_input_tokens']
        breakdown['cacheRead'] += u['cache_read_input_tokens']
        breakdown['output'] += u['output_tokens']
    total = sum(days.values())
    # Stundensummen {"JJJJ-MM-TTTHH": {t, a}} (Europe/Berlin); a = zugeordnet inkl. Kompensation,
    # damit Σ t = total und Σ a = assigned.
    offen = {}
    for ts, n in rest:
        if not (zbeginn and ts < zbeginn):
            offen[(ts, n)] = offen.get((ts, n), 0) + 1
    hours = {}
    for t, u in msgs:
        n = sum(u.values())
        k = t.astimezone(TZ).strftime('%Y-%m-%dT%H')
        h = hours.setdefault(k, {'t': 0, 'a': 0})
        h['t'] += n
        if offen.get((t, n)):
            offen[(t, n)] -= 1
        else:
            h['a'] += n
    assigned_ohne = sum(used.values())
    assigned = assigned_ohne + komp
    # pflege: nur Nachrichten ≥ seit, ohne Kompensationstask (k01 ist von der Zuordnung ausgenommen)
    pf_msgs = [(t, u) for t, u in msgs if t >= seit]
    pf_used, pf_rest = zuordnen(pf_msgs, tasks, now)
    pf_total = sum(sum(u.values()) for _, u in pf_msgs)
    pf_assigned = sum(pf_used.values())
    stabil_ab = stabil(pf_msgs, pf_rest, seit, now)

    task_out = {}
    for tid, t in tasks.items():
        d = t['data']
        if kompensation(d):
            task_out[tid] = {'version': t['version'], 'delete': zbeginn is None, 'fields': {} if zbeginn is None else {
                'tokensUsed': komp, 'from': iso(log_start) if log_start else None, 'to': iso(zbeginn),
                'title': K01_TITEL, 'note': K01_NOTE}}
            continue
        f = {}
        f['tokensUsed'] = used[tid] if tid in used else {'__delete__': True}
        frueh = [s for s, _ in segmente(d, now)] + ([parse(d['created'])] if d.get('created') else [])
        f['tokensPartial'] = True if (tid in used and log_start and any(x < log_start for x in frueh)) else {'__delete__': True}
        f['tokensForecast'] = {'__delete__': True}
        if d.get('status') in ('in_arbeit', 'pruefung') and tid in used and d.get('durationMin'):
            w = worked_min(d, now)
            if w >= 5 and float(d['durationMin']) - w > 0:
                f['tokensForecast'] = round(used[tid] + (float(d['durationMin']) - w) * used[tid] / w)
        task_out[tid] = {'version': t['version'], 'fields': f}

    meta = {
        'days': dict(sorted(days.items())), 'hours': dict(sorted(hours.items())), 'total': total, 'assigned': assigned, 'unassigned': total - assigned,
        'breakdown': breakdown, 'sources': ordner, 'tz': 'Europe/Berlin',
        'logStart': iso(log_start) if log_start else None,
        'pflege': {'seit': iso(seit), 'total': pf_total, 'assigned': pf_assigned, 'unassigned': pf_total - pf_assigned,
                   'stabilAb': iso(stabil_ab)},
        'updatedAt': iso(now),
    }
    # Zählbeginn gesetzt, aber noch kein k01: Dokument zum Anlegen ausgeben (Abschnitt 2)
    if zbeginn is not None and komp_id is None:
        task_out['k01'] = {'version': None, 'create': {
            'kind': 'kompensation', 'title': K01_TITEL, 'note': K01_NOTE,
            'from': iso(log_start) if log_start else None, 'to': iso(zbeginn), 'created': iso(log_start) if log_start else None,
            'registered': iso(now), 'tokensUsed': komp}, 'fields': {}}
    out = {'tasks': task_out, 'meta': meta,
           'kompensation': {'id': komp_id, 'aktiv': zbeginn is not None, 'tokensUsed': komp if zbeginn else None,
                            'from': meta['logStart'], 'to': iso(zbeginn) if zbeginn else None},
           'ohne_kompensation': {'assigned': assigned_ohne, 'unassigned': total - assigned_ohne}}
    text = json.dumps(out, ensure_ascii=False, indent=1)
    if args.out:
        open(args.out, 'w', encoding='utf-8').write(text)
    print(json.dumps({'total': total, 'assigned': assigned, 'unassigned': total - assigned, 'pflege': meta['pflege'],
                      'kompensation': out['kompensation'], 'ohne_kompensation': out['ohne_kompensation'],
                      'hours': len(hours), 'hours_check': [sum(h['t'] for h in hours.values()), sum(h['a'] for h in hours.values())],
                      'tasks': {k: v['fields'].get('tokensUsed') for k, v in sorted(task_out.items())}}, ensure_ascii=False))


def lade_ordner(ordner, sammlung):
    docs = {}
    for f in glob.glob(os.path.join(ordner, sammlung, '*.json')):
        o = json.load(open(f, encoding='utf-8'))
        docs[o.get('id') or os.path.basename(f)[:-5]] = o.get('data', o)
    return docs


def postfach(args):
    now = parse(args.now) if args.now else dt.datetime.now(dt.timezone.utc)
    akt = lade_ordner(args.dir, 'aktionen')
    neu = {k: v for k, v in akt.items() if not v.get('gesehen')}
    print(json.dumps({'gelesen': len(akt), 'ungesehen': len(neu),
                      'eintraege': [{'id': k, 'typ': v.get('typ'), 'task': v.get('task'), 'grund': v.get('grund')} for k, v in neu.items()],
                      'writes': [{'op': 'update', 'collection': 'aktionen', 'doc_id': k,
                                  'data': {'gesehen': True, 'gesehenAt': iso(now)}} for k in neu]}, ensure_ascii=False))


def pruefen(args):
    import re
    now = parse(args.now) if args.now else dt.datetime.now(dt.timezone.utc)
    T = lade_ordner(args.dir, 'tasks')
    meta = lade_ordner(args.dir, 'meta')
    akt = lade_ordner(args.dir, 'aktionen')
    st, mt, z = meta.get('state', {}), meta.get('tokens', {}), meta.get('zaehlung', {})
    B = []
    ret = lambda d: bool(re.search('rückwirkend|Sammeleintrag', d.get('note') or ''))
    iso_ok = lambda x: isinstance(x, str) and re.match(r'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?([+-]\d\d:\d\d|Z)$', x)
    segs = lambda d: [(parse(s['start']), parse(s['end']) if s.get('end') else now) for s in d.get('segments') or []]
    STATI = ('offen', 'in_arbeit', 'pruefung', 'fertig', 'blockiert', 'abgebrochen')
    for i, d in sorted(T.items()):
        if kompensation(d):
            for k in ('created', 'registered', 'from', 'to'):
                if d.get(k) and not iso_ok(d[k]): B.append(('P03', i, k))
            continue
        for k in ('order', 'title', 'status', 'steps', 'created', 'registered'):
            if d.get(k) in (None, '', []): B.append(('P01', i, k))
        if d.get('status') not in STATI: B.append(('P02', i, d.get('status')))
        zt = [d.get(k) for k in ('created', 'registered', 'plannedStart', 'updated') if d.get(k)]
        zt += [x for s in d.get('segments') or [] for x in (s['start'], s.get('end')) if x]
        for x in zt:
            if not iso_ok(x): B.append(('P03', i, x))
            elif parse(x) > now + dt.timedelta(minutes=1) and not (x == d.get('plannedStart') and d.get('status') == 'offen'): B.append(('P04', i, x))
        if not parse(d['created']) <= parse(d['registered']) <= parse(d.get('plannedStart') or d['registered']): B.append(('P05', i, ''))
        S = segs(d)
        summ = sum((e - s).total_seconds() for s, e in S) / 60
        kzb = 'kein Zeitraum belegbar' in (d.get('note') or '')
        if d['status'] in ('fertig', 'abgebrochen') and not ret(d) and not S and not kzb: B.append(('P26', i, ''))
        if d['status'] == 'fertig' and not ret(d) and not kzb:
            if not d.get('durationMin') or abs(d['durationMin'] - summ) > 2 or d.get('progressNote') or 'tokensForecast' in d or not d.get('notes'):
                B.append(('P06', i, round(summ, 2)))
            if not S: B.append(('P16', i, ''))
        if ret(d) and 'durationMin' in d: B.append(('P06r', i, ''))
        S2 = sorted(S)
        for a, b in zip(S2, S2[1:]):
            if b[0] < a[1]: B.append(('P09', i, 'Überlappung'))
        for s_, e_ in S:
            if not s_ < e_: B.append(('P09', i, 'start>=end'))
        if 'tokensUsed' in d and not d.get('segments'): B.append(('P10a', i, ''))
        if d.get('tokensPartial') is False: B.append(('P10', i, 'tokensPartial false'))
        if 'tokensForecast' in d and d['status'] not in ('in_arbeit', 'pruefung'): B.append(('P10', i, 'Prognose'))
        if not ret(d) and S and min(s for s, _ in S) > parse(d.get('plannedStart')) + dt.timedelta(minutes=2): B.append(('P15', i, ''))
        if d['status'] == 'fertig' and any(not x.get('done') for x in d.get('steps') or []): B.append(('P18', i, ''))
        if d['status'] == 'blockiert':
            n = d.get('note') or ''
            if not all(w in n for w in ('Blockiert:', 'Verantwortlich:', 'Entscheidung:')): B.append(('P22', i, ''))
            letzte = max([parse(d.get('updated') or d['registered'])] + [e for _, e in S])
            if now - letzte > dt.timedelta(days=7) and not any((x.get('name') or '').startswith('Entscheidung') for x in d.get('steps') or []):
                B.append(('P21', i, ''))
        if d['status'] == 'abgebrochen':
            if 'abgebrochen' not in (d.get('note') or '') or not d.get('abortedAt') or any(not s.get('end') for s in d.get('segments') or []) or 'tokensForecast' in d:
                B.append(('P24', i, ''))
    cur = st.get('current')
    offen_seg = [i for i, d in T.items() for s in d.get('segments') or [] if not s.get('end')]
    if cur:
        d = T.get(cur, {})
        if not d.get('progressNote') or now - parse(d.get('updated') or d['registered']) > dt.timedelta(minutes=60): B.append(('P07', cur, ''))
        if d.get('status') not in ('in_arbeit', 'pruefung') or offen_seg != [cur]: B.append(('P08', cur, offen_seg))
    elif offen_seg: B.append(('P08', '-', offen_seg))
    alle = [(s, e, i) for i, d in T.items() if not kompensation(d) for s, e in segs(d)]
    for a in alle:
        for b in alle:
            if a[2] < b[2] and a[0] < b[1] and b[0] < a[1] and not (ret(T[a[2]]) and ret(T[b[2]])): B.append(('P09', a[2] + '/' + b[2], 'Überlappung'))
    if mt:
        tot = sum(mt['days'].values())
        ass = sum(d['tokensUsed'] for d in T.values() if isinstance(d.get('tokensUsed'), int))
        for k in ('days', 'total', 'assigned', 'unassigned', 'breakdown', 'sources', 'tz', 'logStart', 'pflege', 'updatedAt', 'hours'):
            if k not in mt: B.append(('P10', 'meta', k))
        if tot != mt['total'] or ass != mt['assigned'] or mt['assigned'] + mt['unassigned'] != mt['total']: B.append(('P10', 'meta', (tot, ass)))
        pf = mt.get('pflege', {})
        if pf.get('assigned', 0) + pf.get('unassigned', 0) != pf.get('total'): B.append(('P10', 'pflege', ''))
        # P25: pflege.assigned ohne k01 – Gegenrechnung aus dem Protokoll
        msgs, _, _, _ = nachrichten(quellordner())
        seit = parse(pf['seit'])
        pm = [(t, u) for t, u in msgs if seit <= t <= parse(mt['updatedAt'])]
        tasks = {k: {'data': v, 'version': None} for k, v in T.items()}
        pu, _ = zuordnen(pm, tasks, parse(mt['updatedAt']))
        if pf.get('total', 0) - pf.get('unassigned', 0) != sum(pu.values()): B.append(('P25', 'meta', (pf.get('total', 0) - pf.get('unassigned', 0), sum(pu.values()))))
        # Prüfzeitraum (Abschnitt 9): ab meta/zaehlung.seit, ohne Zählbeginn ab pflege.seit; davor ist Kompensation
        ab = parse(z['seit']) if z.get('seit') else seit
        bis = parse(mt['updatedAt'])
        # P27: Gesprächsrunde mit Werkzeugaufruf ohne Auftrag (Runden im Prüfzeitraum bis zum letzten Durchlauf)
        wem, _ = zuordner(tasks, bis)
        rr = [r for r in runden(quellordner()) if ab <= r[0] <= bis]
        p27 = [iso(r[0]) for r in rr if not any(wem(t) for t in r[1])]
        teil27 = [iso(r[0]) for r in rr if not all(wem(t) for t in r[1]) and iso(r[0]) not in p27]
        for x in p27: B.append(('P27', x, ''))
        # Abnahme: nicht zugeordnet im Prüfzeitraum < 3 % je Kalendertag
        quote = {}
        for t, u in msgs:
            if ab <= t <= bis:
                q = quote.setdefault(t.astimezone(TZ).date().isoformat(), [0, 0])
                q[0] += sum(u.values())
                q[1] += 0 if wem(t) else sum(u.values())
        quote = {k: round(100 * b / a, 2) for k, (a, b) in sorted(quote.items()) if a}
    # P17: pflege.seit unverändert gegenüber dem vorigen Lauf
    if args.vorher and mt:
        alt = json.load(open(args.vorher, encoding='utf-8'))
        alt = alt.get('data', alt)
        if (alt.get('pflege') or {}).get('seit') != (mt.get('pflege') or {}).get('seit'): B.append(('P17', 'meta', ((alt.get('pflege') or {}).get('seit'), mt['pflege'].get('seit'))))
    # P19: k01 genau dann, wenn meta/zaehlung.seit gesetzt ist – nur wenn seit setAt ein Durchlauf lief
    if mt and (not z.get('setAt') or parse(mt['updatedAt']) > parse(z['setAt'])):
        if bool(z.get('seit')) != any(kompensation(d) for d in T.values()): B.append(('P19', 'k01', bool(z.get('seit'))))
    # P20: Σ hours.t = total und Σ hours.a = assigned
    if mt and 'hours' in mt:
        ht = sum(h.get('t', 0) for h in mt['hours'].values()); ha = sum(h.get('a', 0) for h in mt['hours'].values())
        if ht != mt['total'] or ha != mt['assigned']: B.append(('P20', 'meta', (ht, mt['total'], ha, mt['assigned'])))
    orders = [d['order'] for d in T.values() if 'order' in d]
    if len(orders) != len(set(orders)): B.append(('P13', '-', ''))
    for i, d in T.items():
        if len(lade_ordner(os.path.join(args.dir, 'tasks', i), 'media')) > 8: B.append(('P12', i, ''))
    for k, v in akt.items():
        if not v.get('gesehen') and mt and parse(v['at']) < parse(mt['updatedAt']): B.append(('P23', k, ''))
    if args.seite:
        m = re.search(r'fortschritt-vorlage" content="(\d+)', open(args.seite, encoding='utf-8').read())
        if not m or int(m.group(1)) < 40: B.append(('P11', 'seite', m.group(1) if m else None))
    abnahme = None
    if mt:
        abnahme = {'pruefzeitraum_ab': iso(ab), 'unassigned_prozent_je_tag': quote,
                   'tagesquote_unter_3': all(v < 3 for v in quote.values()),
                   'blockiert_ohne_entscheidungsschritt': [i for i, d in T.items() if d.get('status') == 'blockiert' and not any((x.get('name') or '').startswith('Entscheidung') for x in d.get('steps') or [])],
                   'fertig_mit_offenen_schritten': [b[1] for b in B if b[0] == 'P18'],
                   'vorlage': m.group(1) if args.seite and m else None,
                   'vorlage_aktuell': bool(args.seite and m and int(m.group(1)) >= 40),
                   'p01_p27_ohne_befund': not B}
        abnahme['bestanden'] = all([abnahme['tagesquote_unter_3'], not abnahme['blockiert_ohne_entscheidungsschritt'],
                                    not abnahme['fertig_mit_offenen_schritten'], abnahme['vorlage_aktuell'], abnahme['p01_p27_ohne_befund']])
    print(json.dumps({'auftraege': len([d for d in T.values() if not kompensation(d)]), 'k01': any(kompensation(d) for d in T.values()),
                      'aktionen': len(akt), 'befunde': B,
                      'p27': {'runden': len(rr), 'teilweise_ohne_auftrag': teil27} if mt else 'nicht geprüft',
                      'abnahme': abnahme,
                      'nicht_geprueft': ['P14 (Vergleich mit dem vorigen Lauf)'] + ([] if args.vorher else ['P17 (ohne --vorher)'])}, ensure_ascii=False))


def dedup(_):
    ordner = quellordner()
    msgs, log_start, roh, usages = nachrichten(ordner)
    abweichend = sum(1 for v in usages.values() if len(v) > 1)
    print(json.dumps({'quellen': ordner, 'zaehlzeilen': roh, 'schluessel': len(usages), 'nachrichten': len(msgs),
                      'schluessel_mit_abweichender_usage': abweichend, 'logStart': iso(log_start) if log_start else None}, ensure_ascii=False))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest='cmd', required=True)
    sp.add_parser('dedup').set_defaults(fn=dedup)
    r = sp.add_parser('run')
    r.add_argument('--tasks', required=True)
    r.add_argument('--seit', required=True)
    r.add_argument('--now')
    r.add_argument('--out')
    r.add_argument('--versions')
    r.add_argument('--zaehlung-live', required=True)
    r.add_argument('--gelesen', required=True)
    r.set_defaults(fn=run)
    pf = sp.add_parser('postfach')
    pf.add_argument('--dir', required=True)
    pf.add_argument('--now')
    pf.set_defaults(fn=postfach)
    pr = sp.add_parser('pruefen')
    pr.add_argument('--dir', required=True)
    pr.add_argument('--seite')
    pr.add_argument('--now')
    pr.add_argument('--vorher')
    pr.set_defaults(fn=pruefen)
    a = p.parse_args()
    a.fn(a)
