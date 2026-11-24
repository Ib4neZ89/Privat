# Übergabe Kontoumzug – Session „Experte für PC Probleme“

Stand: 24.11.2026. Verfasst von der Cloud-Session „Experte für PC Probleme“ im alten Konto.
Anlass: Der Benutzer wechselt auf ein AKS-Team-Konto mit anderer E-Mail-Adresse. Verlauf, Skills und
Artifacts des alten Kontos gibt es im neuen Konto nicht. Diese Datei ist die einzige Quelle für die Nachfolge.

> **Wichtig, zwei Sessions auf einem Repo:** Das Repo `Ib4neZ89/Privat` gehört inhaltlich zur App
> **„Abrechnung“** (README.md, app.js, calc.js …), die eine **andere** Session („Abrechnung“) betreut.
> Diese Übergabe betrifft **nur** das Thema PC-Probleme. Für die App hier nichts ableiten; deren Session
> legt ggf. eine eigene Übergabe an (bei gleichem Dateinamen beide Abschnitte zusammenführen, nichts überschreiben).

---

## 1. Zweck, Stand, Version

- **Zweck:** Beratung als Experte für PC-Probleme, Schritt für Schritt mit dem Benutzer.
  Reihenfolge der Themen (Vorgabe des Benutzers):
  1. Hardware-Probleme bzw. Erstinbetriebnahme von PCs, inkl. BIOS/UEFI
  2. Betriebssystem-Ebene
  3. Netzwerk
  4. **Vorerst keine spezifische Software.**
- **Arbeitsform:** reine Beratung im Chat. Es gibt **keinen Code und keine Dateien** zu diesem Thema im Repo,
  außer dieser Übergabe und der Zeile in `CLAUDE.md`.
- **Version:** keine (kein Softwareprodukt).
- **Aktueller Stand:** Fall 1 (Erstinbetriebnahme, Monitor ohne Signal) ist **offen**. Wir warten auf Rückmeldungen des Benutzers (Abschnitt 2).

### Fall 1: Neuer Gaming-PC, Monitor zeigt „HDMI Kein Signal“

**Gerät:** CSL M13500H Gaming-PC (MediaMarkt, Artikel 176514602):
AMD Ryzen 7 5700X, 32 GB RAM, 1000 GB SSD, NVIDIA GeForce RTX 5060 Ti, Windows 11 Home.
Produktseite:
https://www.mediamarkt.de/de/product/_csl-m13500h-gaming-pc-mit-amd-ryzentm-7-5700x-prozessor-32-gb-ram-1000-gb-ssd-nvidia-geforce-rtxtm-5060-ti-windows-11-home-176514602.html

**Ausgangslage laut Benutzer:**
- Tower ausgepackt, Strom angeschlossen, Peripherie angeschlossen.
- Monitor per HDMI an der **dedizierten Grafikkarte** angeschlossen und zeigt „HDMI Kein Signal“.
- Der Monitor hat nur **einen HDMI-Eingang** und **kein DisplayPort**. Die RTX hat zusätzlich DP-Ausgänge.
- Die CPU hat keine Onboard-Grafik (bestätigt: **5700X ohne iGPU**, nur Modelle mit „G“ wie der 5700G haben eine).
  Die Bildschirmausgänge am Mainboard sind deshalb immer tot.
- Andere Bildschirme: nur dieser Monitor und ein **TV**.
- Rückmeldung vom 20.11.: **„Der PC läuft, auch schon einige Minuten.“** Die Stromversorgung der Grafikkarte hält der Benutzer für eine mögliche Ursache und wollte sie prüfen.

**Bisher gegebene Empfehlungen (nicht wiederholen, darauf aufbauen):**
1. POST-Prüfung: Netzteil-Kippschalter, PCIe-Stromkabel der GPU (8-Pin bzw. 12V-2x6) ganz eingerastet,
   bei einem modularen Netzteil auch das Ende am Netzteil, EPS-Strom (4+4-Pin) der CPU, Sitz von RAM und GPU,
   Transportschaum, beim Erststart bis zu 5 min Memory Training, Debug-LEDs (CPU/DRAM/VGA/BOOT).
2. Stehende GPU-Lüfter sind normal (Zero-Fan bei RTX 50). Eine rote LED am Stromanschluss der Karte bedeutet: kein Strom.
3. **TV als Testgerät:** gleiches Kabel, richtigen HDMI-Eingang wählen.
   Bild am TV → Monitor, Kabel oder Handshake ist das Problem. Kein Bild → Problem im PC.
   Am TV PC- oder Spielmodus, gegen Overscan „Just Scan“.
4. Monitor-seitig: Eingang manuell wählen, Monitor 30 s stromlos machen, zuerst den Monitor einschalten, dann den PC.
   Unter Windows Auflösung und Bildwiederholrate auf Monitorwerte stellen.
5. Dauerlösung bei nur einem HDMI-Eingang: **passives DP→HDMI-Kabel** (DP++). Die Richtung ist fest: DP an den PC, HDMI an den Monitor.
   Ein aktiver Adapter (HDMI 2.0/2.1) ist nur für 4K60+, HDR oder hohe Bildwiederholraten nötig.
6. Verdacht nach der Stromprüfung: **RTX 50 auf älterem AM4-Board** (A520/B550): veraltetes BIOS, CSM an, PCIe-Autoaushandlung.
   Wege ohne iGPU: CMOS-Reset (Jumper CLR_CMOS oder Knopfzelle ca. 1 min), USB-BIOS-Flashback, falls das Board es hat,
   leihweise eine ältere GPU einbauen, um BIOS-Update und CSM-Abschaltung zu erledigen, **Reklamation/Gewährleistung** bei MediaMarkt/CSL.
7. Prüfen, dass das HDMI-Kabel wirklich in der GPU steckt (waagerechte Buchsen unten) und nicht im Mainboard-I/O.

## 2. Offene Aufträge, Backlog, Rückfragen an den Benutzer

| Nr. | Thema | Status | Was fehlt |
|---|---|---|---|
| F1 | „HDMI Kein Signal“ beim CSL M13500H | **offen, wartet auf Benutzer** | Ergebnis der Stromprüfung an der GPU; **Mainboard-Hersteller und -Modell** (bestimmt Debug-LEDs, Flashback, CMOS-Jumper); leuchtet eine Debug-LED dauerhaft; Ergebnis des **TV-Tests** |
| B1 | Betriebssystem-Themen | Backlog | erst nach Abschluss der Hardware/Erstinbetriebnahme |
| B2 | Netzwerk-Themen | Backlog | danach |
| B3 | Spezifische Software | ausgeschlossen bis auf Weiteres | Vorgabe des Benutzers |
| O1 | URL der Seite „PC-Probleme Fortschritt“ an Skill-Master melden | offen, liegt beim Benutzer (alte Konto-Welt) | im neuen Konto gegenstandslos, falls dort kein Skill-Master läuft |
| O2 | Die Zeile „Abrechnung“ in CLAUDE.md trägt den Titel der fremden Seite; dort stehen aber Skill-/Regelwerk-Aufträge | Hinweis, keine Aktion | gehört der Session „Abrechnung“ |

Erledigte Aufträge im alten Konto (Fortschrittsseite): t01 Diagnose „Kein Signal“, t02 Skill geladen,
t03 eigene Fortschrittsseite angelegt, t04 diese Übergabe.

## 3. Stehende Regeln und Entscheidungen des Benutzers

Aus dem Gesprächsverlauf (sonst nirgends im Repo):
- Themenreihenfolge und Ausschluss spezifischer Software (Abschnitt 1).
- Antworten auf **Deutsch**, praxisnah, als Schritt-für-Schritt-Diagnose. Der Benutzer arbeitet direkt am Gerät
  und meldet die Ergebnisse zurück.
- Bevorzugte Lösung ist immer die einfachste (z. B. „am besten anderen Monitor nehmen“). Danach kommen Alternativen
  mit den tatsächlich vorhandenen Geräten (hier: derselbe Monitor oder TV).
- **Eigene Fortschrittsseite je Session** („Auf jeden Fall eigene Seite anlegen!“, 20.11.2026). Nie auf der Seite
  der Session „Abrechnung“ schreiben.

Aus `CLAUDE.md` (Stand vor dem Umzug):
- Je Session eine Zeile „Fortschritt Session „<Name>“ (<Thema>): Skill session-fortschritt, Seite <URL>“.

Regeln aus dem Konto-Skill **session-fortschritt** (im neuen Konto nicht vorhanden, Kurzfassung der hier geltenden Punkte):
- Jede Nachricht des Benutzers mit mindestens einem Werkzeugaufruf ist ein Auftrag mit eigener Kachel. Eine reine Chat-Antwort ist keiner.
- In Seitentexten **keine Personennamen**, sondern „Benutzer“.
- Zeiten nur aus der Systemuhr, Schätzungen realistisch ohne Puffer.
- Tracking in derselben Nachricht wie die Arbeit, nie in einer eigenen Runde.
- Ohne den Skill im neuen Konto: Tracking entfällt, bis der Benutzer etwas anderes sagt. Dann **keine** Seite nachbauen.

Gedächtnis: Diese Session hatte **kein Auto-Memory** (`~/.claude/projects/-home-user-Privat/memory` existiert nicht),
daher gibt es keinen Ordner `umzug/memory/`.

## 4. Arbeitsweise und Konventionen

- Ablauf je Problem: Symptom aufnehmen → einfache, häufige Ursachen zuerst (Strom, Kabel, Eingang) →
  Gegentest mit einem anderen Gerät → gezielte Eingrenzung über die Herstellerdaten (Mainboard-Modell) → Dauerlösung → ggf. Reklamation.
- Konkrete Modelle nachschlagen statt raten. Fehlende Angaben gezielt erfragen (eine kurze Liste am Ende jeder Antwort).
- Prüfschleifen: Bei Übergaben und Dokumenten mindestens zwei Runden, bis eine Runde keine Lücke mehr findet.
- Git: Arbeits-Branch `claude/upbeat-lovelace-rnn03j` (im neuen Konto ggf. ein neuer Session-Branch).
  Kein Push auf andere Branches ohne Erlaubnis, **kein Pull Request ohne ausdrücklichen Auftrag**.
  Commit-Nachrichten auf Deutsch.
- Release: entfällt (kein Produkt).

## 5. Einrichtung

- Cloud-Session von Claude Code (Linux-Container). Repo: `https://github.com/Ib4neZ89/Privat`, Arbeitsordner `/home/user/Privat`.
- Werkzeuge im Container (24.11.2026): git 2.43.0, Node v22.23.5, Python 3.13.18. Für das PC-Thema wird nichts davon gebraucht.
- Bauen/Testen/Veröffentlichen: entfällt für dieses Thema. (Die App „Abrechnung“ testet mit `npm test`; sie gehört der anderen Session.)
- Verbundene Ordner, eigener Rechner: keine.
- Externe Dienste: keine. Die Produktseite oben ist nur eine Referenz.
- **Zugangsdaten:** keine benötigt, keine im Repo. GitHub-Zugriff läuft über die Konto-Verbindung der Cloud-Session
  (im neuen Konto neu verbinden: claude.ai → GitHub verbinden, Claude-GitHub-App auf das Repo).

## 6. Artifacts dieses Projekts

| Titel | URL | Zweck |
|---|---|---|
| PC-Probleme Fortschritt | https://claude.ai/artifact/NXya2VBBG2WQqJmvNrRHNB | Fortschrittsseite dieser Session (Daten exportiert Skill-Master zentral, hier nicht exportiert). Im neuen Konto nicht erreichbar. |

Weitere Artifacts zu diesem Thema gibt es nicht. Die Seite „Abrechnung Fortschritt“ (RcMyLLdygBVMieSaE4jLbi) gehört der anderen Session.

## 7. Geplante Aufgaben, App-Verbindungen

- Geplante Aufgaben: keine.
- Verbindungen zu Apps: keine.

## 8. Startprompt für die Nachfolge-Session im neuen Konto

```text
Du bist die Nachfolge-Session „Experte für PC Probleme“. Lies zuerst UEBERGABE-UMZUG.md im
Projektordner vollständig; sie ersetzt den Verlauf aus dem alten Konto. Das Repo gehört inhaltlich
zur App „Abrechnung“ einer anderen Session – deren Dateien nicht anfassen.

Aufgabe: Beratung zu PC-Problemen auf Deutsch, Reihenfolge Hardware/Erstinbetriebnahme inkl.
BIOS/UEFI → Betriebssystem → Netzwerk, vorerst keine spezifische Software.

Offen ist Fall F1: CSL M13500H (Ryzen 7 5700X ohne iGPU, RTX 5060 Ti), Monitor mit nur einem HDMI-Eingang
zeigt „HDMI Kein Signal“, der PC läuft. Die gegebenen Empfehlungen stehen in Abschnitt 1 der Übergabe,
nicht wiederholen. Frag mich nach: Ergebnis der GPU-Stromprüfung, Mainboard-Modell, dauerhaft leuchtende
Debug-LED, Ergebnis des TV-Tests – und mach dann mit der Eingrenzung weiter.

Passe die Zeile „Experte für PC Probleme“ in CLAUDE.md an, sobald es im neuen Konto eine
Fortschrittsseite gibt; ohne den Skill session-fortschritt kein Tracking nachbauen.
```
