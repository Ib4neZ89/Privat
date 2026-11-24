#!/usr/bin/env python3
"""Umzugs-Sicherung für Claude-Konten.

Liest drei Quellen und legt sie strukturiert als Textdateien ab:
  1. den offiziellen Datenexport von claude.ai (ZIP-Dateien oder entpackte Ordner),
  2. lokale Cowork-Sitzungen (Ordner local-agent-mode-sessions),
  3. lokale Claude-Code-Sessions (Ordner .claude/projects).

Nur Python-Standardbibliothek, läuft unter Windows, macOS und Linux.

Aufruf:
  python umzug.py --ziel <Ordner> [--export <Ordner mit den ZIPs>]
                  [--cowork <local-agent-mode-sessions>] [--code <.claude/projects>]
                  [--zuordnung <zuordnung.txt>] [--werkzeuge kurz|voll|aus]

--cowork und --code dürfen mehrfach stehen (ein Ordner je PC). Der Zielordner
wird bei jedem Lauf neu geschrieben; die Quellen bleiben unverändert.

Zuordnungsdatei (Chats zu Projekten, weil der Export sie nicht enthält):
  # Projekt: Beispielprojekt
  Titel des ersten Chats
  Titel eines doppelt vorhandenen Chats | 2026-10-12
Leerzeilen und Zeilen mit ";" am Anfang werden übergangen. Das Datum hinter
"|" ist nur bei doppelten Titeln nötig.
"""
import argparse
import csv
import datetime
import difflib
import json
import os
import re
import shutil
import sys
import zipfile

STARTPROMPT = """Du setzt eine Unterhaltung aus einem anderen Claude-Konto fort.
Der frühere Verlauf liegt als Datei vor, der Verlauf selbst ist hier nicht vorhanden.

1. Lies zuerst "{verlauf}" vollständig{zusatz}.
2. Fasse in höchstens zehn Zeilen zusammen: Ziel, Stand, getroffene Entscheidungen, offene Punkte.
3. Warte dann auf meinen nächsten Auftrag. Beginne nichts von dir aus.

Titel der früheren Unterhaltung: {titel}
Zeitraum: {von} bis {bis}
"""


def sicher(name, laenge=80):
    """Macht aus einem Titel einen Ordner- oder Dateinamen, der unter Windows gilt."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name or "").strip(" .")
    name = re.sub(r"\s+", " ", name)
    return (name[:laenge].rstrip(" .")) or "ohne-titel"


def norm(titel):
    return re.sub(r"[^a-z0-9äöüß]+", " ", (titel or "").lower()).strip()


def schreibe(pfad, text):
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    with open(pfad, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def eindeutig(ordner, name):
    """Hängt -2, -3 … an, wenn es den Unterordner schon gibt."""
    kandidat, n = name, 1
    while os.path.exists(os.path.join(ordner, kandidat)):
        n += 1
        kandidat = "%s-%d" % (name, n)
    return os.path.join(ordner, kandidat)


def kuerze(text, grenze):
    text = text if isinstance(text, str) else json.dumps(text, ensure_ascii=False)
    if grenze and len(text) > grenze:
        return text[:grenze] + "\n… [gekürzt, %d Zeichen insgesamt]" % len(text)
    return text


def tag(zeit):
    return (zeit or "")[:10]


# ---------------------------------------------------------------- Export lesen

def export_bereitstellen(quelle, arbeit):
    """Entpackt alle ZIPs unter quelle nach arbeit; gibt die Suchordner zurück."""
    ordner = [quelle]
    for wurzel, _, dateien in os.walk(quelle):
        for d in dateien:
            if d.lower().endswith(".zip"):
                ziel = os.path.join(arbeit, os.path.splitext(d)[0])
                if not os.path.isdir(ziel):
                    with zipfile.ZipFile(os.path.join(wurzel, d)) as z:
                        z.extractall(ziel)
                ordner.append(ziel)
    return ordner


def finde(ordner, dateiname=None, unterordner=None):
    treffer = []
    for o in ordner:
        for wurzel, _, dateien in os.walk(o):
            for d in dateien:
                teile = os.path.normpath(wurzel).split(os.sep)
                if dateiname and d == dateiname:
                    treffer.append(os.path.join(wurzel, d))
                elif unterordner and unterordner in teile and d.endswith(".json"):
                    treffer.append(os.path.join(wurzel, d))
    return sorted(set(treffer))


def lade(pfad):
    with open(pfad, encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------- Zuordnung lesen

def lies_zuordnung(pfad):
    """Gibt eine Liste (Projekt, Titel, Datum oder None) zurück."""
    eintraege, projekt = [], None
    if not pfad:
        return eintraege
    with open(pfad, encoding="utf-8-sig") as f:
        for zeile in f:
            zeile = zeile.strip()
            if not zeile or zeile.startswith(";"):
                continue
            m = re.match(r"#\s*Projekt\s*:\s*(.+)", zeile, re.I)
            if m:
                projekt = m.group(1).strip()
                continue
            if projekt is None:
                sys.exit("Zuordnung: Zeile vor dem ersten '# Projekt:' – %r" % zeile)
            titel, _, datum = zeile.partition("|")
            eintraege.append((projekt, titel.strip(), datum.strip() or None))
    return eintraege


def ordne_zu(eintraege, chats):
    """chats: Liste von dicts mit 'titel', 'von', 'bis', 'projekt' (wird gesetzt).
    Gibt die Einträge zurück, zu denen kein Chat gefunden wurde."""
    fehlend = []
    frei = lambda c: c.get("projekt") is None
    for projekt, titel, datum in eintraege:
        kandidaten = [c for c in chats if frei(c) and norm(c["titel"]) == norm(titel)]
        if datum:
            genauer = [c for c in kandidaten if datum in (c["von"], c["bis"])]
            kandidaten = genauer or kandidaten
        if not kandidaten:
            # Die App kürzt lange Titel; deshalb auch Anfangsgleichheit und Ähnlichkeit.
            n = norm(titel.rstrip("….").rstrip("."))
            kandidaten = [c for c in chats if frei(c) and n and norm(c["titel"]).startswith(n)]
        if not kandidaten:
            namen = {norm(c["titel"]): c for c in chats if frei(c)}
            nah = difflib.get_close_matches(norm(titel), list(namen), 1, 0.88)
            kandidaten = [namen[nah[0]]] if nah else []
        if kandidaten:
            kandidaten[0]["projekt"] = projekt
        else:
            fehlend.append((projekt, titel, datum))
    return fehlend


# ----------------------------------------------------------- Verläufe rendern

def block_text(block, werkzeuge, grenze):
    """Ein Inhaltsblock aus dem claude.ai-Export oder einer Session-Datei als Text."""
    art = block.get("type")
    if art == "text":
        return block.get("text") or ""
    if art in ("thinking", "redacted_thinking", "token_budget", "injected_prompt_block"):
        return ""
    if art == "tool_use":
        if werkzeuge == "aus":
            return ""
        eingabe = block.get("input")
        return "> **Werkzeug %s**\n> %s" % (
            block.get("name"),
            kuerze(eingabe, grenze).replace("\n", "\n> "),
        )
    if art == "tool_result":
        if werkzeuge == "aus":
            return ""
        inhalt = block.get("content")
        if isinstance(inhalt, list):
            inhalt = "\n".join(
                i.get("text", "") if isinstance(i, dict) else str(i) for i in inhalt
            )
        return "> **Ergebnis**\n> %s" % kuerze(inhalt or "", grenze).replace("\n", "\n> ")
    if art == "image":
        return "*[Bild, im Export nicht enthalten]*"
    if art == "document":
        return "*[Dokument: %s, im Export nicht enthalten]*" % block.get("title")
    return ""


def chat_als_text(chat, werkzeuge, grenze):
    """claude.ai-Chat -> (Markdown, Liste der Anhänge als (Name, Text), Dateinamen)."""
    zeilen = ["# %s" % (chat.get("name") or "(ohne Titel)"), ""]
    zeilen.append("Erstellt %s, zuletzt geändert %s, %d Nachrichten" % (
        chat.get("created_at", "")[:16], chat.get("updated_at", "")[:16],
        len(chat.get("chat_messages") or [])))
    anhaenge, dateien = [], []
    for nachricht in chat.get("chat_messages") or []:
        wer = "Benutzer" if nachricht.get("sender") == "human" else "Claude"
        teile = [block_text(b, werkzeuge, grenze) for b in nachricht.get("content") or []]
        text = "\n\n".join(t for t in teile if t.strip()) or (nachricht.get("text") or "")
        zusatz = []
        for a in nachricht.get("attachments") or []:
            name = a.get("file_name") or "anhang-%d.txt" % (len(anhaenge) + 1)
            if a.get("extracted_content"):
                anhaenge.append((name, a["extracted_content"]))
                zusatz.append("*[Anhang als Text gesichert: %s]*" % name)
        for d in nachricht.get("files") or []:
            if d.get("file_name"):
                dateien.append(d["file_name"])
                zusatz.append("*[Datei, im Export nicht enthalten: %s]*" % d["file_name"])
        if not text.strip() and not zusatz:
            continue
        zeilen += ["", "## %s – %s" % (wer, (nachricht.get("created_at") or "")[:16]), ""]
        zeilen.append(text)
        zeilen += zusatz
    return "\n".join(zeilen) + "\n", anhaenge, dateien


def session_als_text(pfad, werkzeuge, grenze):
    """Claude-Code- oder Cowork-Verlaufsdatei (.jsonl) -> (Markdown, Infos)."""
    zeilen, info = [], {"von": "", "bis": "", "erste": "", "cwd": "", "nachrichten": 0, "titel": ""}
    with open(pfad, encoding="utf-8", errors="replace") as f:
        for roh in f:
            try:
                e = json.loads(roh)
            except ValueError:
                continue
            art = e.get("type")
            if art in ("summary", "custom-title", "ai-title"):
                info["titel"] = e.get("summary") or e.get("title") or e.get("customTitle") or info["titel"]
            if art not in ("user", "assistant") or e.get("isSidechain"):
                continue
            zeit = e.get("timestamp") or ""
            info["von"] = info["von"] or zeit
            info["bis"] = zeit or info["bis"]
            info["cwd"] = info["cwd"] or e.get("cwd") or ""
            inhalt = (e.get("message") or {}).get("content")
            if isinstance(inhalt, str):
                teile, nur_ergebnis = [inhalt], False
            else:
                inhalt = inhalt or []
                teile = [block_text(b, werkzeuge, grenze) for b in inhalt if isinstance(b, dict)]
                nur_ergebnis = bool(inhalt) and all(
                    isinstance(b, dict) and b.get("type") == "tool_result" for b in inhalt)
            text = "\n\n".join(t for t in teile if t and t.strip())
            if not text.strip():
                continue
            if art == "user" and not nur_ergebnis:
                wer = "Benutzer"
                info["erste"] = info["erste"] or text
            else:
                wer = "Claude" if art == "assistant" else "Werkzeugergebnis"
            info["nachrichten"] += 1
            zeilen += ["", "## %s – %s" % (wer, zeit[:16].replace("T", " ")), "", text]
    return "\n".join(zeilen) + "\n", info


# ------------------------------------------------------------------ Hauptlauf

def main():
    p = argparse.ArgumentParser(description="Sichert Claude-Daten strukturiert als Textdateien.")
    p.add_argument("--ziel", required=True, help="Zielordner der Sicherung (wird neu geschrieben)")
    p.add_argument("--export", help="Ordner mit den ZIP-Dateien des Datenexports oder entpackt")
    p.add_argument("--cowork", action="append", default=[], help="Ordner local-agent-mode-sessions")
    p.add_argument("--code", action="append", default=[], help="Ordner .claude/projects")
    p.add_argument("--zuordnung", help="Textdatei: Chats je Projekt")
    p.add_argument("--werkzeuge", choices=["kurz", "voll", "aus"], default="kurz",
                   help="Werkzeugaufrufe im Verlauf: gekürzt (Vorgabe), vollständig oder weglassen")
    a = p.parse_args()
    grenze = {"kurz": 1500, "voll": 0, "aus": 0}[a.werkzeuge]

    ziel = os.path.abspath(a.ziel)
    for quelle in [a.export] + a.cowork + a.code:
        if quelle and os.path.abspath(quelle).startswith(ziel + os.sep):
            sys.exit("Eine Quelle liegt im Zielordner: %s" % quelle)
    marke = os.path.join(ziel, ".umzug-sicherung")
    if os.path.isdir(ziel) and os.listdir(ziel) and not os.path.exists(marke):
        sys.exit("Zielordner ist nicht leer und stammt nicht von diesem Tool: %s" % ziel)
    if os.path.isdir(ziel):
        shutil.rmtree(ziel)
    os.makedirs(ziel)
    schreibe(marke, "Angelegt von umzug.py am %s\n" % datetime.datetime.now().isoformat(timespec="seconds"))

    index = []          # Zeilen für index.csv
    hinweise = []       # Auffälligkeiten für BERICHT.md
    projekte, chats, speicher = [], [], {}

    # --- Export einlesen
    if a.export:
        arbeit = os.path.join(ziel, "_entpackt")
        ordner = export_bereitstellen(a.export, arbeit)
        gesehen = set()  # dieselbe ZIP-Datei kann doppelt im Ordner liegen
        for pfad in finde(ordner, unterordner="projects"):
            pr = lade(pfad)
            if pr.get("uuid") not in gesehen:
                gesehen.add(pr.get("uuid"))
                projekte.append(pr)
        for pfad in finde(ordner, dateiname="conversations.json"):
            for c in lade(pfad):
                if c.get("uuid") in gesehen:
                    continue
                gesehen.add(c.get("uuid"))
                chats.append({"roh": c, "titel": c.get("name") or "", "projekt": None,
                              "von": tag(c.get("created_at")), "bis": tag(c.get("updated_at"))})
        for pfad in finde(ordner, unterordner="memories"):
            speicher = lade(pfad)
        if not chats:
            hinweise.append("Im Export wurde keine conversations.json gefunden.")
    else:
        ordner = []

    # --- Zuordnung anwenden
    eintraege = lies_zuordnung(a.zuordnung)
    fehlend = ordne_zu(eintraege, chats)
    projektnamen = {pr.get("name") for pr in projekte}
    for name in sorted({e[0] for e in eintraege} - projektnamen):
        hinweise.append("Projekt aus der Zuordnung steht nicht im Export: %s" % name)

    # --- Projekte schreiben
    pfad_projekt = {}
    for pr in sorted(projekte, key=lambda x: x.get("name") or ""):
        name = pr.get("name") or "ohne-namen"
        basis = eindeutig(os.path.join(ziel, "projekte"), sicher(name))
        pfad_projekt[name] = basis
        text = ["# Projekt: %s" % name, "",
                "Erstellt %s, geändert %s" % (tag(pr.get("created_at")), tag(pr.get("updated_at"))), ""]
        if pr.get("description"):
            text += ["## Beschreibung", "", pr["description"], ""]
        text += ["## Projektanweisungen", "",
                 pr.get("prompt_template") or "*(im Export leer – in der App prüfen und hier nachtragen)*", ""]
        memo = (speicher.get("project_memories") or {}).get(pr.get("uuid"))
        if memo:
            text += ["## Projekt-Gedächtnis", "", memo, ""]
        docs = pr.get("docs") or []
        text += ["## Wissensdateien im Export", ""]
        text += ["- wissen/%s" % sicher(d.get("filename") or "datei", 120) for d in docs] or ["*(keine)*"]
        schreibe(os.path.join(basis, "projekt.md"), "\n".join(text) + "\n")
        for d in docs:
            schreibe(os.path.join(basis, "wissen", sicher((d.get("filename") or "datei").replace("/", "_"), 120)),
                     d.get("content") or "")
        index.append(["Projekt", name, "", tag(pr.get("created_at")), tag(pr.get("updated_at")),
                      len(docs), os.path.relpath(basis, ziel)])

    # --- Chats schreiben
    for c in sorted(chats, key=lambda x: x["roh"].get("created_at") or ""):
        roh = c["roh"]
        if c["projekt"]:
            wurzel = pfad_projekt.get(c["projekt"]) or os.path.join(ziel, "projekte", sicher(c["projekt"]))
            wurzel = os.path.join(wurzel, "chats")
        else:
            wurzel = os.path.join(ziel, "ohne-projekt")
        basis = eindeutig(wurzel, "%s %s" % (c["von"], sicher(c["titel"], 60)))
        verlauf, anhaenge, dateien = chat_als_text(roh, a.werkzeuge, grenze)
        schreibe(os.path.join(basis, "verlauf.md"), verlauf)
        zusatz = ""
        if roh.get("summary"):
            schreibe(os.path.join(basis, "zusammenfassung.md"), roh["summary"] + "\n")
            zusatz = ' und "zusammenfassung.md"'
        for name, text in anhaenge:
            schreibe(os.path.join(basis, "anhaenge", sicher(name, 100)), text)
        if dateien:
            schreibe(os.path.join(basis, "fehlende-dateien.txt"), "\n".join(dateien) + "\n")
        schreibe(os.path.join(basis, "startprompt.txt"), STARTPROMPT.format(
            verlauf="verlauf.md", zusatz=zusatz, titel=c["titel"] or "(ohne Titel)",
            von=c["von"], bis=c["bis"]))
        index.append(["Chat", c["titel"], c["projekt"] or "", c["von"], c["bis"],
                      len(roh.get("chat_messages") or []), os.path.relpath(basis, ziel)])

    # --- Gedächtnis
    if speicher:
        if speicher.get("conversations_memory"):
            schreibe(os.path.join(ziel, "gedaechtnis", "global.md"), speicher["conversations_memory"] + "\n")
        for d in speicher.get("memory_files") or []:
            teile = [sicher(t) for t in (d.get("path") or "datei").strip("/").split("/")]
            schreibe(os.path.join(ziel, "gedaechtnis", "dateien", *teile), d.get("content") or "")

    # --- Artifact-Daten und geplante Aufgaben unverändert übernehmen
    for o in ordner:
        for wurzel, _, dateien in os.walk(o):
            teile = os.path.normpath(wurzel).split(os.sep)
            for d in dateien:
                if "artifacts" in teile and d == "documents.json":
                    kennung = teile[teile.index("artifacts") + 1]
                    if os.path.exists(os.path.join(ziel, "artifacts", kennung, d)):
                        continue
                    os.makedirs(os.path.join(ziel, "artifacts", kennung), exist_ok=True)
                    shutil.copy2(os.path.join(wurzel, d), os.path.join(ziel, "artifacts", kennung, d))
                    index.append(["Artifact-Daten", kennung, "", "", "", "", "artifacts/" + kennung])
                elif d in ("routines.json", "routine_runs.json"):
                    os.makedirs(os.path.join(ziel, "geplante-aufgaben"), exist_ok=True)
                    shutil.copy2(os.path.join(wurzel, d), os.path.join(ziel, "geplante-aufgaben", d))

    # --- Lokale Cowork-Sitzungen
    for quelle in a.cowork:
        for wurzel, _, dateien in os.walk(quelle):
            for d in dateien:
                if not (d.startswith("local_") and d.endswith(".json")):
                    continue
                meta = lade(os.path.join(wurzel, d))
                sitzung = os.path.join(wurzel, d[:-5])
                titel = meta.get("title") or meta.get("processName") or d[:-5]
                von = datetime.datetime.fromtimestamp((meta.get("createdAt") or 0) / 1000).strftime("%Y-%m-%d")
                bis = datetime.datetime.fromtimestamp((meta.get("lastActivityAt") or 0) / 1000).strftime("%Y-%m-%d")
                basis = eindeutig(os.path.join(ziel, "cowork-lokal"), "%s %s" % (von, sicher(titel, 60)))
                verlaeufe, anzahl = [], 0
                for w2, _, d2 in os.walk(os.path.join(sitzung, ".claude", "projects")):
                    for x in d2:
                        if x.endswith(".jsonl"):
                            text, info = session_als_text(os.path.join(w2, x), a.werkzeuge, grenze)
                            verlaeufe.append(text)
                            anzahl += info["nachrichten"]
                if not verlaeufe:
                    hinweise.append("Cowork-Sitzung ohne Verlaufsdatei: %s" % titel)
                schreibe(os.path.join(basis, "verlauf.md"), "# %s\n\nModell %s, %s bis %s\n%s" % (
                    titel, meta.get("model"), von, bis, "\n".join(verlaeufe)))
                for unter in ("outputs", "uploads"):
                    if os.path.isdir(os.path.join(sitzung, unter)) and os.listdir(os.path.join(sitzung, unter)):
                        shutil.copytree(os.path.join(sitzung, unter), os.path.join(basis, unter))
                schreibe(os.path.join(basis, "startprompt.txt"), STARTPROMPT.format(
                    verlauf="verlauf.md", zusatz="", titel=titel, von=von, bis=bis))
                index.append(["Cowork lokal", titel, "", von, bis, anzahl, os.path.relpath(basis, ziel)])

    # --- Lokale Code-Sessions
    for quelle in a.code:
        for projektordner in sorted(os.listdir(quelle)):
            voll = os.path.join(quelle, projektordner)
            if not os.path.isdir(voll):
                continue
            for d in sorted(os.listdir(voll)):
                if not d.endswith(".jsonl"):
                    continue
                text, info = session_als_text(os.path.join(voll, d), a.werkzeuge, grenze)
                if not info["nachrichten"]:
                    continue
                titel = info["titel"] or " ".join(info["erste"].split())[:60] or d[:-6]
                von, bis = tag(info["von"]), tag(info["bis"])
                basis = eindeutig(os.path.join(ziel, "code-sessions", sicher(projektordner, 100)),
                                  "%s %s" % (von, sicher(titel, 60)))
                schreibe(os.path.join(basis, "verlauf.md"), "# %s\n\nArbeitsordner %s, Session %s, %s bis %s\n%s" % (
                    titel, info["cwd"], d[:-6], von, bis, text))
                schreibe(os.path.join(basis, "startprompt.txt"), STARTPROMPT.format(
                    verlauf="verlauf.md", zusatz="", titel=titel, von=von, bis=bis))
                index.append(["Code-Session", titel, projektordner, von, bis, info["nachrichten"],
                              os.path.relpath(basis, ziel)])
            if os.path.isdir(os.path.join(voll, "memory")):
                shutil.copytree(os.path.join(voll, "memory"),
                                os.path.join(ziel, "code-sessions", sicher(projektordner, 100), "_memory"))

    # --- Fehlende Chats in den lokalen Sitzungen suchen (dort bleibt der Ordner,
    #     nur das Projekt wird im Index eingetragen)
    lokal = {}
    for zeile in index:
        if zeile[0] in ("Cowork lokal", "Code-Session"):
            lokal.setdefault(norm(zeile[1]), []).append(zeile)
    rest = []
    for projekt, titel, datum in fehlend:
        treffer = [z for z in lokal.get(norm(titel), []) if z[0] == "Cowork lokal" and not z[2]]
        if treffer:
            treffer[0][2] = projekt
        else:
            rest.append((projekt, titel, datum))
    lokal_zugeordnet = len(fehlend) - len(rest)
    fehlend = rest

    # --- Index und Bericht
    with open(os.path.join(ziel, "index.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Art", "Titel", "Projekt", "von", "bis", "Nachrichten/Dateien", "Ordner"])
        w.writerows(index)
    zaehler = {}
    for z in index:
        zaehler[z[0]] = zaehler.get(z[0], 0) + 1
    bericht = ["# Sicherung vom %s" % datetime.date.today().isoformat(), "", "## Umfang", ""]
    bericht += ["- %s: %d" % kv for kv in sorted(zaehler.items())]
    zugeordnet = sum(1 for c in chats if c["projekt"])
    bericht += ["", "## Zuordnung", "",
                "- Chats im Export: %d, davon einem Projekt zugeordnet: %d" % (len(chats), zugeordnet),
                "- Einträge in der Zuordnungsdatei: %d" % len(eintraege),
                "- Davon in lokalen Cowork-Sitzungen gefunden: %d" % lokal_zugeordnet,
                "- Davon in keiner Quelle gefunden: %d" % len(fehlend)]
    if fehlend:
        bericht += ["", "## Fehlende Chats (stehen in der App, aber nicht im Export)", ""]
        bericht += ["- %s: %s%s" % (pr, t, " (%s)" % dt if dt else "") for pr, t, dt in fehlend]
        schreibe(os.path.join(ziel, "fehlend.txt"),
                 "\n".join("%s\t%s\t%s" % (pr, t, dt or "") for pr, t, dt in fehlend) + "\n")
    if hinweise:
        bericht += ["", "## Hinweise", ""] + ["- " + h for h in hinweise]
    schreibe(os.path.join(ziel, "BERICHT.md"), "\n".join(bericht) + "\n")
    shutil.rmtree(os.path.join(ziel, "_entpackt"), ignore_errors=True)
    print("\n".join(bericht))


if __name__ == "__main__":
    main()
