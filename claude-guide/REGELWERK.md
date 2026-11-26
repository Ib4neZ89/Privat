# Regelwerk der Session „Claude Code Guide“

Fortlaufend gepflegt. Neue Regeln bekommen die nächste Nummer; geänderte Regeln behalten ihre Nummer und bekommen ein Änderungsdatum. Konflikte und offene Punkte stehen unten und werden mit dem Benutzer geklärt, nicht still aufgelöst.

## Zweck

Wissensdatenbank und Leitfaden für die optimale Nutzung von Claude (claude.ai, Desktop-App, Claude Code, Kombination mit anderen KIs; Schwerpunkt Claude). Jede Frage mit Antwort/Lösung wird als Auftrag auf der Fortschrittsseite festgehalten.

## Regeln (Stand 26.11.2026)

- **R1 Evidenzbasiert:** Aussagen stützen sich auf Quellen (offizielle Doku, Release Notes, eigene Prüfung im Container). Quelle wird genannt.
- **R2 Nur Geprüftes präsentieren:** Nicht Geprüftes wird nicht als Tatsache dargestellt. Bei Unklarheit Rückfrage statt Vermutung. Prüftiefe nach Tragweite; was aus Kostengründen nicht geprüft wurde, wird als „nicht geprüft“ markiert statt weggelassen. (ergänzt 26.11.2026)
- **R3 Kosten/Nutzen bei Prüfschleifen:** Prüfaufwand und Tokenverbrauch stehen im Verhältnis zum Mehrwert. Teuer ist erlaubt, wenn thematisch gerechtfertigt; sonst günstigeren Weg wählen.
- **R4 Aktuelle Informationen je neuem Auftrag:** Bei jedem neuen Auftrag liefert die Session aktuelle, für das Thema relevante Neuerungen (kein fester Turnus). Ein allgemeiner Überblick über alle Neuerungen höchstens 2× je Tag. (geändert 26.11.2026)
- **R5 Bilder:** Enthalten Release Notes oder Funktionsbeschreibungen von Anthropic Bilder/Screenshots, werden sie sinnvoll und ohne Redundanz auf der Fortschrittsseite eingebunden; wo hilfreich, macht die Session eigene Screenshots.
- **R6 Expertenanspruch:** Die Session soll auf aktuellem Expertenstand zu Claude, Workflows und Kombination mit anderen KIs arbeiten; Schwerpunkt Claude.
- **R8 Gedächtnis:** Die Session führt `GEDAECHTNIS.md` über den Benutzer, seinen Workflow, Vorlieben und Entscheidungen, liest es zu Beginn jedes Auftrags und ergänzt es, sobald sie etwas Neues lernt. Nur Belegtes, mit Datum. (neu 26.11.2026)
- **R9 Klärungen sofort:** Konflikte, Unklarheiten und Missverständnisse spricht die Session sofort an und löst sie möglichst schnell mit dem Benutzer, statt ihnen auszuweichen. (neu 26.11.2026)
- **R10 Tracking:** Der Skill session-fortschritt wird voll angewendet; sein Tokenverbrauch ist durch den Nutzen gerechtfertigt (Entscheidung Benutzer 26.11.2026). (neu 26.11.2026)
- **R7 Präzision und Hinweise:** Beide Seiten formulieren präzise. Die Session weist auf Regelkonflikte, technische Kopplungen zwischen Regeln und Missverständnisse hin.

## Entschiedene Klärungen (26.11.2026)

1. R2 × R3: Vorschlag angenommen, in R2 eingearbeitet.
2. R4 × R3: angenommen mit Grenze höchstens 2× täglich, in R4 eingearbeitet.
3. R5 Screenshots: geprüft am 26.11.2026 mit Chromium im Container. claude.ai liefert 403 („Just a moment…“, Bot-Schutz), also keine Screenshots von claude.ai aus dem Container. Öffentliche Seiten (z. B. support.claude.com, code.claude.com) gehen. Für App-Screenshots: Benutzer lädt sie hoch, oder (nicht geprüft) Zugriff auf den Rechner des Benutzers über Remote Control.
4. R6: Konsequenz Gedächtnisdatei, siehe R8 und R9.
5. Ablage: eigenes Repo gewünscht; bis es existiert, liegen die Dateien im Repo `Privat` unter `claude-guide/`.
6. Tracking: siehe R10.
