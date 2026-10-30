# Regelwerk Tokens

Version: v11

> **Unvollständig:** Der Grundtext v10 (`C:\dev\token-zaehler\docs\token-regeln.md`) konnte in dieser Cloud-Session nicht kopiert werden – kein Rechner verbunden. Bis er nachgetragen ist, gilt für alle übrigen Punkte die Kurzfassung im Skill session-fortschritt, Abschnitt 5. Diese Datei enthält nur die Ergänzungen v11.

## Abschnitt 1 – Ergänzung v11

Cloud-Sessions mit Protokollen im Container (Pfad `/root/.claude/projects/…`) zählen normal; der Container kann verschwinden, dann rückt `logStart` vor und ältere Aufträge werden `tokensPartial` – bekannte Unschärfe, im Bericht nennen.

## Abschnitt 2 – neu in v11: Kompensationstask

Kompensationstask `tasks/k01` = `{kind: "kompensation", title: "Kompensation: nicht zugeordnete Tokens vor dem Stichtag", note: <ein Satz, wofür er da ist>, from: logStart, to: pflege.seit, created: logStart, registered: jetzt, tokensUsed}`. Keine `status`, `steps`, `segments`, `durationMin`.

`tokensUsed` = Σ aller Nachrichten mit `timestamp < pflege.seit`, die keinem Auftrag zugeordnet sind – bei jedem Durchlauf neu berechnet. Er zählt zu `assigned` (`unassigned` enthält damit nur noch Nachrichten ab Stichtag), nicht zu Schritten und Aufträgen. Nur einer je Seite. Prüfregeln P01, P05, P06, P06r, P10a, P15, P16 gelten für ihn nicht.
