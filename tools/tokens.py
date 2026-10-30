#!/usr/bin/env python3
"""
Tokenzählung für die Fortschrittsseite (Skill session-fortschritt, Abschnitt 5 Kurzfassung; Regelwerk Tokens v11,
Regelwerk Tokens v12, docs/token-regeln.md: meta/zaehlung, Kompensationstask k01, meta/tokens.hours).

Python statt tools/tokens.ps1, weil die Cloud-Session kein PowerShell hat. Nur Standardbibliothek,
keine Geheimnisse, gibt keine Protokollinhalte aus – nur Zählwerte und Zeitstempel.

Aufruf:
  python3 tools/tokens.py dedup
      Dedup-Prüfung: Zählzeilen vs. Schlüssel, usage je Schlüssel identisch?
  python3 tools/tokens.py run --tasks <Ordner mit tasks/*.json> --seit <ISO> [--now <ISO>] [--out <Datei>]
      Vollständiger Durchlauf: tokensUsed/tokensPartial/tokensForecast je Auftrag und meta/tokens.
      <Ordner> ist das out_dir eines ArtifactData-list der Sammlung "tasks".
      --versions "t01=5,t02=5,…" übernimmt die Dokumentversionen aus der list-Antwort (für if_version).
      --zaehlung <ISO|leer> = meta/zaehlung.seit (Zählbeginn, von Phillip auf der Seite gesetzt). Nur wenn gesetzt,
      gibt es den Kompensationstask k01 (bis zum Zählbeginn); sonst wird ein vorhandener k01 gelöscht.
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


def zuordnen(msgs, tasks, now):
    seg = {tid: segmente(t['data'], now) for tid, t in tasks.items() if not ausgenommen(t['data'])}
    seg = {k: v for k, v in seg.items() if v}
    created = {tid: parse(t['data']['created']) for tid, t in tasks.items() if t['data'].get('created') and not ausgenommen(t['data'])}
    registered = {tid: parse(t['data']['registered']) for tid, t in tasks.items() if t['data'].get('registered') and not ausgenommen(t['data'])}
    # Nachlauf-Fenster je Auftrag mit Segmenten
    nach = {}
    for tid, ss in seg.items():
        ende = max(e for _, e in ss)
        grenzen = [created[o] for o in created if o != tid and registered.get(o) and registered[o] > ende and created[o] >= ende]
        nach[tid] = (ende, min([ende + NACHLAUF_MAX] + grenzen))
    vor = {tid: (created[tid], min(s for s, _ in ss)) for tid, ss in seg.items() if tid in created}
    used = {tid: 0 for tid in seg}
    rest = []
    for ts, u in msgs:
        n = sum(u.values())
        drin = [(s, num(tid), tid) for tid, ss in seg.items() for s, e in ss if s <= ts < e]
        if drin:
            used[max(drin)[2]] += n
            continue
        kand = [(a, num(tid), tid) for tid, (a, b) in vor.items() if a <= ts < b]
        kand += [(a, num(tid), tid) for tid, (a, b) in nach.items() if a <= ts < b]
        if kand:
            used[max(kand)[2]] += n
        else:
            rest.append((ts, n))
    return used, rest


def kompensation(d):
    return d.get('kind') == 'kompensation'


def ausgenommen(d):
    """Von der Zuordnung ausgenommen: Cloud-Aufträge mit Vermerk „created = Anlage“ und der Kompensationstask."""
    return 'created = Anlage' in (d.get('note') or '') or kompensation(d)


def worked_min(d, now):
    return sum((e - s).total_seconds() for s, e in segmente(d, now)) / 60


def run(args):
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
    zbeginn = parse(args.zaehlung) if args.zaehlung else None
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
    pf_msgs = [(t, u) for t, u in msgs if t >= seit]
    pf_used, _ = zuordnen(pf_msgs, tasks, now)
    pf_total = sum(sum(u.values()) for _, u in pf_msgs)
    pf_assigned = sum(pf_used.values())

    task_out = {}
    for tid, t in tasks.items():
        d = t['data']
        if kompensation(d):
            task_out[tid] = {'version': t['version'], 'delete': zbeginn is None, 'fields': {} if zbeginn is None else {
                'tokensUsed': komp, 'from': iso(log_start) if log_start else None, 'to': iso(zbeginn)}}
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
        'pflege': {'seit': iso(seit), 'total': pf_total, 'assigned': pf_assigned, 'unassigned': pf_total - pf_assigned},
        'updatedAt': iso(now),
    }
    # Zählbeginn gesetzt, aber noch kein k01: Dokument zum Anlegen ausgeben (Regelwerk v12 Abschnitt 2)
    if zbeginn is not None and komp_id is None:
        task_out['k01'] = {'version': None, 'create': {
            'kind': 'kompensation', 'title': 'Kompensation: nicht zugeordnete Tokens vor dem Zählbeginn',
            'note': 'Sammelt alle Tokens, die vor Beginn der Segmentpflege keinem Auftrag zuzuordnen sind, damit Gesamt und Zugeordnet aufgehen.',
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
    r.add_argument('--zaehlung', default='')
    r.set_defaults(fn=run)
    a = p.parse_args()
    a.fn(a)
