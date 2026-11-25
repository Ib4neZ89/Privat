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

## Übertragung ins neue Konto

Jeder Lauf schreibt zusätzlich den Ordner `uebertragung/`:

```
LIES-MICH.md          die drei Schritte im neuen Konto
auswahl.csv           alle Kandidaten; Spalte "anlegen" (ja/nein) in Excel bearbeiten
sessions.json         die mit "ja" markierten Sitzungen samt Startkontext
IMPORT-PROMPT.md      Auftrag für eine Code-Session im neuen Konto, die sessions.json abarbeitet
projekte/<Name>/      flacher Ordner je Projekt zum Hochladen ins Projektwissen
```

Ablauf: Tool starten, `auswahl.csv` bearbeiten, Tool mit `--auswahl <Datei>` erneut starten. Im neuen Konto die Projekte von Hand anlegen und die Ordner hochladen; für die Sitzungen eine Code-Session öffnen, `sessions.json` hochladen und `IMPORT-PROMPT.md` als Auftrag geben.

Weitere Parameter:

- `--auswahl <auswahl.csv>`: übernimmt die bearbeitete Spalte `anlegen`. Ohne die Datei gilt `ja` für alles, dessen letzte Aktivität höchstens 30 Tage vor dem jüngsten Eintrag liegt.
- `--cloud-sessions <Datei.json>`: Liste der Cloud-Sessions des alten Kontos, die nicht im Export stehen. Format: `[{"id", "art", "titel", "repo", "zweig", "erstellt", "geaendert", "stand", "hinweis"}]`. Die Liste erzeugt eine Session im alten Konto.
- `--pdf-ordner <Ordner>`: eigene Zusammenfassungen, je Projekt ein Unterordner mit Dateien (zum Beispiel ein PDF je Chat und ein Projektkontext). Die Dateien landen mit dem Vorsatz „Zusammenfassung“ im Hochlade-Ordner des Projekts. Der Ordnername darf vom Projektnamen abweichen, wo Windows ein Zeichen nicht erlaubt („Phishing u Co“ für „Phishing & Co“). Ordner ohne passendes Projekt stehen im Bericht unter Hinweise.
- `--projektwissen kurz|voll`: `kurz` (Vorgabe) legt in den Hochlade-Ordner je Projekt nur Stand, Gedächtnis und Wissensdateien; die vollständigen Verläufe liegen im Unterordner `Verlaeufe - nur bei Bedarf`, damit das Projektwissen klein bleibt. `voll` legt alles flach ab.
- `--einbetten <Zeichen>`: so viel Verlauf steht höchstens im Startkontext einer Sitzung (Vorgabe 40000); längere Verläufe werden in der Mitte gekürzt.

Geprüft am 24.11.2026: Eine Code-Session mit Repo und Zweig und eine Sitzung ohne Repo mit eingebettetem Stand ließen sich per Werkzeug anlegen. Nicht geprüft: Anlegen ohne Startnachricht (nur Systemkontext), Anlegen in Ordnern auf einem PC (Remote Control), Cowork-Sitzungen. Klassische Chats und Projekte in claude.ai kann kein Werkzeug anlegen.

## Grenzen

- Hochgeladene Originaldateien und Bilder stehen nicht im Export.
- Projektanweisungen waren im geprüften Export leer; in der App nachsehen.
- Cloud-Sessions von Claude Code stehen nicht im Export.
- Mit `--werkzeuge voll` werden Werkzeugaufrufe ungekürzt übernommen, mit `aus` weggelassen.
