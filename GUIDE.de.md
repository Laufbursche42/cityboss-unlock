# Anleitung: Laufbursche CITYBOSS unlock

> **Machbarkeitsstudie.** Dieses Werkzeug zeigt, was das Bluetooth-Protokoll dieser Scooter möglich
> macht. Es ist kein fertiges Produkt. Ein fehlerfreier Betrieb wird nicht zugesichert und es gibt
> keine Gewähr. Was immer du damit tust, tust du auf eigenes Risiko und nur am eigenen Fahrzeug.

> **Wichtig für Fehler-Reports:** Schalte unten auf der Seite den **Diagnose-Log** ein, *bevor* du dich mit dem Scooter verbindest. Nur dann wird der komplette Verbindungsaufbau mitgeschnitten - und genau diese Zeilen brauchen wir in einem [Ticket](https://github.com/Laufbursche42/Laufbursche42/issues), um ein Problem nachzuvollziehen.

## 1. Was du brauchst

Alles läuft im Browser über Web Bluetooth: Modell wählen, verbinden, Geschwindigkeit setzen, den
Tempomat- beziehungsweise Limit-Modus schalten, das Fahrzeug sperren und entsperren, die Lichter
schalten. Es gibt nichts zu installieren. Du brauchst:

**Einen Browser mit Web-Bluetooth-Unterstützung.**

- **iOS:** den Browser **Bluefy** (kostenlos im App Store). Safari und jeder andere iOS-Browser laufen
  auf der Safari-Engine, die kein Web Bluetooth hat.
- **Android oder Desktop:** **Chrome** oder ein anderer Chromium-Browser. Web Bluetooth ist eingebaut.

**Einen CITYBOSS (oder einen kompatiblen Scooter der MiniRobot-Plattform).** Die App ist eine
White-Label-Basis für viele Marken, daher beginnt der angezeigte Name mit einem von vielen Präfixen
(zum Beispiel `i10`, `MAX`, `T10`, `Mini`, `Plus`, `X1`, `X3`, `GoKart`, `XRIDER`, `TECAR`, `NEXRIDE`,
`E-WHEELS`, `KING`, `EROBOT`). Nicht jedes Modell bietet jede Funktion über Bluetooth an; die Seite
zeigt die passenden Bedienelemente und ein Experten-Panel für den Rest.

---

## 2. Auto-Erkennung oder Modell wählen

Am einfachsten ist im Modell-Menü oben die **Auto-Erkennung**. Die Seite sucht alle Scooter in der
Nähe, die die App kennt. Nach dem Verbinden wählt sie das richtige GATT-Profil aus den Diensten, die
das Gerät tatsächlich anbietet, genau wie die Hersteller-App. Du musst dein Modell nicht kennen.

Wenn du willst, wähle dein Modell aus der Liste. Die Seite arbeitet dann gleich; der erkannte Dienst
entscheidet am Ende über den Transport, eine falsche Wahl wird also automatisch korrigiert.

---

## 3. Verbinden

1. Öffne die Seite in Bluefy oder Chrome.
2. Schalte den Scooter ein. Halte ihn ein paar Meter neben das Telefon.
3. Tippe auf **Verbinden** und wähle deinen Scooter im Browser-Dialog.
4. Beobachte den Status oben rechts: `verbinde`, dann `verbunden` und das erkannte Profil im Protokoll.

**Android: Standort muss an sein.** Unter Android sucht Chrome nur nach Bluetooth, wenn der
Standortdienst (GPS) an ist und Chrome die Berechtigung Standort oder Geräte in der Nähe hat. Sonst
bleibt die Geräteliste leer, obwohl der Scooter direkt daneben steht. Schließe außerdem zuerst die
Hersteller-App vollständig (wegwischen), sonst hält sie die Verbindung und der Scooter meldet sich
nicht mehr für den Browser. Im Zweifel den Scooter direkt vor dem Suchen aus- und wieder einschalten.

Die Seite pollt danach die Live-Daten und füllt die Telemetrie-Kacheln. Der allererste Verbindungsaufbau
braucht immer den Browser-Dialog. Das ist eine Sicherheitsregel des Browsers, die keine Abkürzung
umgehen kann.

---

## 4. Höchstgeschwindigkeit setzen und testen

1. Trage den Wert in km/h in der Karte **Speed-Limit** ein.
2. Wähle das Ziel-Register (MaxSpeed ist das übliche) und tippe auf **Setzen**. Die Seite sendet den
   Wert mit der korrekten Skalierung je Modus.

Die Seite selbst hat keine obere Grenze. Ob der Controller einen angehobenen Wert real fährt oder ihn
auf das gesetzliche Limit deckelt, entscheidet die Firmware im Scooter. Genau das testest du auf der
Strasse.

**So testest du, ob der Scooter den Wert wirklich fährt:**

1. Suche einen sicheren, freien Ort auf privatem Gelände, kein Verkehr. Helm auf.
2. Fahre kurz mit Vollgas und merke dir, bei welchen km/h der Scooter abriegelt. Das ist dein
   Ausgangswert.
3. Setze einen Wert leicht darüber, zum Beispiel 2 bis 3 km/h mehr und tippe auf **Setzen**.
4. Fahre wieder Vollgas und beobachte die Kachel **Tempo**. Klettert sie über die vorige Grenze? Dann
   nimmt der Controller den Wert an.
5. Wiederhole in kleinen Schritten. Der Wert, ab dem es nicht mehr höher geht, ist der harte Deckel der
   Firmware.
6. Eine hohe Zahl macht den Scooter nicht schneller, als Motor und Akku hergeben. Sie zeigt nur, ob der
   Controller den Wert annimmt.

---

## 5. Tempomat- beziehungsweise Limit-Modus

In dieser App sind Tempomat und Speed-Limit-Modus derselbe Schalter. Er hat zwei Teile:

- **Zielgeschwindigkeit:** in der Speed-Limit-Karte setzen (das schreibt das Geschwindigkeits-Register).
- **Ein / Aus:** die Knöpfe **Tempomat / Limit** senden das Enable-Kommando (Register `0x72`, 1 = an,
  0 = aus).

Nur die Zielgeschwindigkeit zu setzen schaltet den Modus nicht ein; du brauchst zusätzlich den
Ein-Knopf.

---

## 6. Fahrzeug sperren und entsperren

Das ist die **Wegfahrsperre** des Scooters, NICHT die Geschwindigkeit. Entsperren gibt den Scooter
frei, Sperren blockiert ihn (Register `0xf6`).

---

## 7. Licht

Die Licht-Knöpfe schalten den Scheinwerfer; dasselbe `0xd3`-Bitfeld trägt auch Bits für Bremslicht,
Nabenlicht und Umgebungslicht, die du im Experten-Panel setzen kannst. Das sind Komfort-Einstellungen
und haben nichts mit der Geschwindigkeit zu tun.

---

## 8. Live-Werte lesen

Sobald Daten ankommen, füllen sich die Kacheln (Tempo, Akku, Spannung, Strom, Fahrt, Gesamt, Max-Tempo,
Sperre, Fehlercode, Firmware) und das Protokoll zeigt die rohen Notifications als Hex. Die
Register-Zuordnung ist modellabhängig, daher kann ein Wert bei manchen Modellen ein Strich bleiben; die
Rohdaten stehen immer im Protokoll.

---

## 9. Experten-Panel

Für alles, was die festen Knöpfe nicht abdecken oder für ein Modell mit abweichendem Register:

- **Register schreiben (0x20):** Registernummer und 16-Bit-Wert eingeben.
- **Register lesen (0x06):** einen Register-Block auslesen.
- **Roh-Frame senden:** Bytes einfügen; die Seite hängt die Prüfsumme an und wendet das gewählte XOR an.
- **Modell-XOR:** der Ein-Byte-Verschleierungs-Schlüssel, falls dein Gerätetyp einen nutzt (Standard
  keiner).

---

## 10. Sauber testen und melden

Teste nur am eigenen Gerät auf privatem Gelände. Das Protokoll unten ist ein vollständiger Mitschnitt
jedes gesendeten und empfangenen Bytes. Melde Probleme oder Erfolge als
[GitHub-Issue](https://github.com/Laufbursche42/cityboss-unlock/issues) mit dem kopierten Protokoll, damit
klar ist, was gesendet und empfangen wurde.

---

## 11. Grenzen, die man kennen sollte

- Ob der Controller einen Wert über dem Werkslimit fährt, entscheidet die verschlüsselte
  Controller-Firmware und ist modellabhängig; der Fahrtest in Abschnitt 4 ist der Weg, das zu klären.
- Das genaue Register einiger Einstellungen (zum Beispiel Zero-Start) ist modellabhängig; nutze das
  Experten-Panel und bestätige bei Bedarf mit einem Mitschnitt der Original-App.
- Es gibt hier kein Firmware-Flashen.

---

## 12. Rechtliches

Das Anheben der Höchstgeschwindigkeit hebt die Werksdrossel auf. Die ABE erlischt damit und der Betrieb
auf öffentlichen Wegen ist dann nicht mehr erlaubt. Nutze es nur am eigenen Fahrzeug und auf eigenes
Risiko.

## Mithelfen
Willst du herausfinden, ob und wie Tuning bei deinem Scooter geht? Teste dieses Tool an deinem eigenen Fahrzeug und öffne ein Ticket auf [GitHub](https://github.com/Laufbursche42/Laufbursche42/issues) - mit deinem Modell und was funktioniert hat (oder nicht). So finden wir gemeinsam heraus, was bei welchem Modell möglich ist.
