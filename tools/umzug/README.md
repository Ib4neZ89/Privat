# Umzugs-Sicherung für Claude-Konten

`umzug.py` liest die Daten eines Claude-Kontos aus drei Quellen und legt sie als Textdateien in einem Ordner ab. Es braucht nur Python 3 (Standardbibliothek) und ändert die Quellen nicht.

## Quellen

| Quelle | Woher | Parameter |
|---|---|---|
| Datenexport von claude.ai | Einstellungen → Datenschutz → Daten exportieren; alle ZIP-Dateien in einen Ordner legen | `--export` |
| Lokale Cowork-Sitzungen | Ordner `local-agent-mode-sessions` der Desktop-App, je PC | `--cowork` (mehrfach möglich) |
| Lokale Code-Sessions | `%USERPROFILE%\.claude\projects`, je PC | `--code` (mehrfach möglich) |

Der Export enthält nicht, welcher Chat zu welchem Projekt gehört. Das liefert eine Textdatei (`--zuordnung`):

```
# Projekt: Beispielprojekt
Titel des ersten Chats
Titel eines doppelt vorhandenen Chats | 2026-10-12
```

## Aufruf

```
python umzug.py --ziel D:\Claude-Sicherung --export D:\Export --cowork D:\PC1\local-agent-mode-sessions --code D:\PC1\projects --zuordnung D:\zuordnung.txt
```

Der Zielordner wird bei jedem Lauf neu geschrieben. Er muss leer sein oder aus einem früheren Lauf stammen.

## Ergebnis

```
BERICHT.md            Umfang, Zuordnung, fehlende Chats, Hinweise
index.csv             alle Einträge mit Art, Titel, Projekt, Zeitraum, Ordner
fehlend.txt           Chats aus der Zuordnung, die in keiner Quelle stehen
projekte/<Name>/      projekt.md (Anweisungen, Projekt-Gedächtnis), wissen/, chats/
ohne-projekt/         Chats ohne Zuordnung
cowork-lokal/         lokale Cowork-Sitzungen mit outputs/ und uploads/
code-sessions/        lokale Code-Sessions je Projektordner, dazu _memory/
gedaechtnis/          globales Gedächtnis und Gedächtnisdateien
artifacts/            Datenbankinhalte der Artifacts (unverändert)
geplante-aufgaben/    geplante Aufgaben (unverändert)
```

Je Chat oder Session: `verlauf.md`, wenn vorhanden `zusammenfassung.md`, `anhaenge/` (nur als Text), `fehlende-dateien.txt` (im Export nur dem Namen nach) und `startprompt.txt` für die Fortsetzung im neuen Konto.

## Grenzen

- Hochgeladene Originaldateien und Bilder stehen nicht im Export.
- Projektanweisungen waren im geprüften Export leer; in der App nachsehen.
- Cloud-Sessions von Claude Code stehen nicht im Export.
- Mit `--werkzeuge voll` werden Werkzeugaufrufe ungekürzt übernommen, mit `aus` weggelassen.
