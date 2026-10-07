# Abrechnung

Gemeinsame Ausgaben (Urlaube, Trips, WG …) erfassen, aufteilen und mit **möglichst wenigen Überweisungen** ausgleichen.
Läuft komplett im Browser – am PC und als installierbare App auf dem Smartphone. **Kein Server, kein Konto:** Alle Daten liegen nur im Browser-Speicher des jeweiligen Geräts.

Hervorgegangen aus der Excel-Vorlage „Abrechnung-Session-Rohling“.

## Bedienung

Unten gibt es vier Bereiche:

- **Übersicht** – Gesamtausgaben, persönlicher Stand („Du bekommst / Du zahlst“), offene Salden als Balken, Ausgaben nach Kategorie, Teilnehmer verwalten.
- **Ausgaben** – nach Tagen gruppiert, mit Kategorie-Symbol, Suche und deinem Anteil je Ausgabe.
- **Abrechnung** – aufgebaut wie die Excel-Vorlage: Ausgaben je Teilnehmer (umschaltbar Vorkasse Σ1 / Verbrauch Σ2 / Saldo) mit Zeilenkontrolle, Bilanz (Σ1, Σ2, ΣVV, ΣA, Σges), Ausgleichsmatrix *von \ an*, Statistik und Excel-Download.
- **Ausgleich** – die nötigen Überweisungen zum Abhaken.

Ablauf:

1. **Teilnehmer** in der Übersicht anlegen.
2. **Ausgaben** erfassen: Bezeichnung, Betrag, wer bezahlt hat (auch mehrere Zahler mit Teilbeträgen) und wer sich die Ausgabe teilt:
   - **Gleich** – Häkchen bei den Beteiligten
   - **Anteile** – Gewichtung, z. B. 2 : 1 : 1
   - **Beträge** – feste Euro-Beträge je Person
3. **Ausgleich**: Bilanz je Person und die Liste der nötigen Überweisungen.

### Prüfungen (rot / grün)

| Prüfung | entspricht in Excel |
|---|---|
| Zahler ergeben zusammen den Ausgabebetrag | Zeilensumme Vorkasse |
| Aufteilung ergibt genau den Ausgabebetrag | Zeilensumme Verbrauch (`I` = `T`) |
| Σ Vorkasse = Σ Verbrauch (Statuszeile oben) | Σ1,ges = Σ2,ges |
| Summe aller Guthaben = 0 (Σ Kontrolle) | Kontrollfeld ΣVV |
| „Offen“ je Person = 0,00 € nach Ausgleich | Gesamtbilanz Σges |

Fehlerhafte Ausgaben können trotzdem gespeichert werden, sind dann rot markiert und werden bis zur Korrektur nicht berücksichtigt.

### Ausgleich mit minimaler Anzahl an Überweisungen

Die Personen werden in möglichst viele Untergruppen zerlegt, die sich untereinander zu 0 ausgleichen – jede Gruppe mit *k* Personen braucht *k − 1* Überweisungen. Das ergibt (bis 18 Personen mit offenem Saldo) die echte Mindestanzahl; darüber wird ein schnelles Näherungsverfahren verwendet. Beträge werden centgenau gerechnet, Rundungscents fair verteilt.

### Abhaken & Teilen

- **Admin** (wer die Abrechnung auf seinem Gerät angelegt hat) kann jede Überweisung als erhalten abhaken.
- **Link an Gruppe senden**: Die komplette Abrechnung steckt im Link (hinter dem `#`, wird nie an einen Server übertragen). Teilnehmer sehen alles schreibgeschützt.
- Ein Teilnehmer wählt „Ich bin …“ und kann **Überweisungen abhaken, die er empfangen hat**. Danach schickt er dem Admin einen **Bestätigungslink**; öffnet der Admin ihn, wird die Zahlung verbucht.
- Bereits verbuchte Zahlungen werden verrechnet. Kommen danach neue Ausgaben hinzu, berechnet die App nur noch den verbleibenden Ausgleich.
- **Abrechnung als Excel** (Reiter „Ausgleich“ oder Menü ⋯): umfangreiche `.xlsx` im Aufbau der Excel-Vorlage – Vorkasse, Aufteilung/Verbrauch mit Zeilen- und Gegenprobe, Bilanz (Σ1, Σ2, ΣVV, ΣA, Σges), Ausgleichsmatrix *von \ an* und Überweisungsliste. Alle Summen sind echte Formeln mit rot/grünen Kontrollfeldern. Wird ohne Fremdbibliothek direkt im Browser erzeugt (`xlsx.js`, `report.js`).
- **Export/Import** als JSON-Datei zur Sicherung oder zur Übertragung auf ein anderes Gerät.

## Installation auf Android

Seite in Chrome öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“. Danach startet sie wie eine App und funktioniert auch offline.

## Veröffentlichen über GitHub Pages

Repository → **Settings → Pages** → *Source: Deploy from a branch* → Branch wählen, Ordner `/ (root)` → Save.
Die App ist dann unter `https://<benutzer>.github.io/<repo>/` erreichbar.

## Entwicklung

Reines HTML/CSS/JavaScript ohne Build-Schritt.

- `calc.js` – Rechenkern (Aufteilung, Bilanz, minimaler Ausgleich), ohne DOM
- `app.js` – Oberfläche, Speicherung, Teilen-Links, Updates
- `xlsx.js` – minimaler XLSX-Schreiber · `report.js` – Aufbau der Excel-Abrechnung
- `sw.js`, `manifest.webmanifest`, `icons/` – Offline-Fähigkeit und Installation

Tests: `npm test` (benötigt Node ≥ 18). Lokal starten: `python3 -m http.server` im Projektordner.
