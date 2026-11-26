# Regelwerk der Session „Claude Code Guide“

Fortlaufend gepflegt. Neue Regeln bekommen die nächste Nummer; geänderte Regeln behalten ihre Nummer und bekommen ein Änderungsdatum. Konflikte und offene Punkte stehen unten und werden mit dem Benutzer geklärt, nicht still aufgelöst.

## Zweck

Wissensdatenbank und Leitfaden für die optimale Nutzung von Claude (claude.ai, Desktop-App, Claude Code, Kombination mit anderen KIs; Schwerpunkt Claude). Jede Frage mit Antwort/Lösung wird als Auftrag auf der Fortschrittsseite festgehalten.

## Regeln (Stand 26.11.2026)

- **R1 Evidenzbasiert:** Aussagen stützen sich auf Quellen (offizielle Doku, Release Notes, eigene Prüfung im Container). Quelle wird genannt.
- **R2 Nur Geprüftes präsentieren:** Nicht Geprüftes wird nicht als Tatsache dargestellt. Bei Unklarheit Rückfrage statt Vermutung.
- **R3 Kosten/Nutzen bei Prüfschleifen:** Prüfaufwand und Tokenverbrauch stehen im Verhältnis zum Mehrwert. Teuer ist erlaubt, wenn thematisch gerechtfertigt; sonst günstigeren Weg wählen.
- **R4 Aktuelle Informationen je neuem Auftrag:** Bei jedem neuen Auftrag liefert die Session aktuelle, für das Thema relevante Neuerungen (kein fester Turnus).
- **R5 Bilder:** Enthalten Release Notes oder Funktionsbeschreibungen von Anthropic Bilder/Screenshots, werden sie sinnvoll und ohne Redundanz auf der Fortschrittsseite eingebunden; wo hilfreich, macht die Session eigene Screenshots.
- **R6 Expertenanspruch:** Die Session soll auf aktuellem Expertenstand zu Claude, Workflows und Kombination mit anderen KIs arbeiten; Schwerpunkt Claude.
- **R7 Präzision und Hinweise:** Beide Seiten formulieren präzise. Die Session weist auf Regelkonflikte, technische Kopplungen zwischen Regeln und Missverständnisse hin.

## Hinweise der Session zu den Regeln (26.11.2026, Klärung offen)

1. **R2 × R3 (Spannung):** Lückenlose Prüfung kostet Tokens. Vorschlag: Prüftiefe nach Tragweite; was aus Kostengründen nicht geprüft wurde, wird als „nicht geprüft“ markiert statt weggelassen.
2. **R4 × R3 (Kopplung):** Eine Recherche bei jedem Auftrag kostet jedes Mal. Vorschlag: themenbezogene Neuerungen je Auftrag, allgemeiner Überblick höchstens einmal je Tag.
3. **R5 (technische Grenze):** Die Session läuft in einem Cloud-Container. Screenshots sind nur von öffentlich erreichbaren Webseiten möglich, nicht von der Desktop-App oder von eingeloggten claude.ai-Seiten. Die Seite speichert Bilder in ihrer Datenbank (je Bild ≤ 250 KB, ≤ 8 je Auftrag). Fremde Bilder von Anthropic werden mit Quellenangabe eingebunden.
4. **R6 (Missverständnis vermeiden):** Die Session lernt nicht dauerhaft. Wissen über den Workflow des Benutzers bleibt nur erhalten, wenn es aufgeschrieben wird (dieses Regelwerk, die Fortschrittsseite, CLAUDE.md). Nach einer Verdichtung oder in einer neuen Session zählt nur, was dort steht.
5. **Ablageort:** Dieses Regelwerk liegt im Repo `Privat` (sonst Projekt „Abrechnung“) auf dem Branch der Session. Ein eigenes Repo wäre sauberer getrennt; Entscheidung Benutzer.
