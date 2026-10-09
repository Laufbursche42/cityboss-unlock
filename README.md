# Laufbursche CITYBOSS Tool (cityboss-unlock)

A static web page that talks to CITYBOSS e-scooters over Web Bluetooth. Let the page auto-detect your
scooter or pick the model yourself, and it uses the matching BLE protocol for it. Depending on the
model it sets the maximum speed, switches the cruise/limit mode, locks and unlocks the vehicle,
toggles the lights and reads the live telemetry, straight from the browser. Nothing to install: no app
store, no signing, no developer account. It runs in **Bluefy** on iOS and in **Chrome** on Android or
desktop.

> **This is a feasibility study.** It exists to show what the Bluetooth protocol of these scooters
> makes possible, not to be a finished product. The protocol was reconstructed from the official app
> (MiniRobot, `com.loby.balance.car.google` 11.3.7). Error-free operation is not promised and there is
> no warranty of any kind. Whatever you do with it, you do at your own risk.

**Open the web app: [laufbursche42.github.io/cityboss-unlock](https://laufbursche42.github.io/cityboss-unlock/)**

Or run it yourself, no build step, no dependencies: clone the repo and serve the folder over a local
HTTP server. Opening `index.html` directly as a `file://` URL will not work, the page fetches its own
documents and browsers block that over `file://`.

```
git clone https://github.com/Laufbursche42/cityboss-unlock.git
cd cityboss-unlock
python -m http.server 8000
```

Any static server works. With Node installed, this does the same job:

```
npx serve .
```

Then open the printed address in a browser that supports Web Bluetooth.

**Guide: [Deutsch](GUIDE.de.md) | [English](GUIDE.en.md)** covers everything step by step, from picking
the model to the first send.

## Auto-detect or pick your model

The BLE transport differs per model, so the page needs to know which scooter it is talking to. The
default dropdown option, **Auto detect**, scans all nearby scooters the app knows (name prefixes such
as `i10`, `MAX`, `T10`, `Mini`, `Plus`, `X1`, `X3`, `GoKart`, `XRIDER` and more) and, after connecting,
picks the right GATT profile from the services the device actually exposes, exactly like the official
app. You can also pick your model from the list.

The platform behind the MiniRobot app is a white-label base shared by many brands, so the same
protocol serves a wide range of devices (kick scooters, self-balancing scooters, karts). The page
supports all five GATT profiles the app knows and selects the matching one automatically.

## What it does

- **Auto-detect the scooter** by its advertised name and the discovered GATT service, or pick the
  model from the list.
- **Set the maximum speed / speed limit.** The value goes to the model's speed register (for example
  MaxSpeed `0x7d`) with the per-mode scaling the app uses. The page carries no limit of its own.
- **Cruise / limit mode on and off** (register `0x72`). In this app cruise and the speed-limit mode
  are the same switch; the target speed is set separately.
- **Lock and unlock the vehicle** (register `0xf6`). This is the anti-theft immobilizer, not the speed.
- **Toggle the lights** (headlight, brake, hub, ambient; the `0xd3` light bitfield).
- **Read the telemetry** the scooter sends back (speed, battery, voltage, current, trip, total, error
  code, firmware) and keep the raw notifications in an on-screen diagnostic log as plain hex.
- **Expert panel** to write any register or send a raw frame, for models where the exact register
  differs. The page builds the frame header, checksum and optional obfuscation for you.

## No encryption to configure

There is nothing to switch. The BLE protocol is plaintext frames with a checksum. Some device types
add a simple single-byte XOR obfuscation over the whole frame; the page offers that as an option in the
expert panel. There is no AES, no pairing and no connection PIN.

## Browser support

- **iOS:** the **Bluefy** browser. Safari and every other iOS browser run on the Safari engine, which
  has no Web Bluetooth at all.
- **Android or desktop:** **Chrome** or another Chromium browser. Web Bluetooth is built in.

There is no OTA firmware flashing here.

## Project structure

```
index.html                - the single page: cards, the model dropdown, the diagnostic log
app.js                    - all logic: transports, frame builders, connect, decode, UI
i18n.js                   - the German and English string table
styles.css                - theme and layout
GUIDE.de.md, GUIDE.en.md  - the step-by-step guide
tools/cityboss_speed.py   - a Python (bleak) reference for the frame format
scripts/                  - check-i18n.js and security-scan.py (run in CI and the git hooks)
.github/workflows/        - CI (JS lint plus security scan) and CodeQL
.githooks/                - pre-commit and pre-push checks
```

## Development

No build step and no dependencies. Edit the files and reload the page. Serve locally, Web Bluetooth
needs `https` or `localhost`:

```
python -m http.server 8000
```

Run the same checks as the CI and the hooks:

```
node scripts/check-i18n.js
python scripts/security-scan.py
```

Enable the git hooks with `git config core.hooksPath .githooks`. New user-facing strings go into both
languages in `i18n.js`; `check-i18n.js` fails on a missing or unused key.

## Legal

Raising the maximum speed lifts the factory limit. The operating permit (Betriebserlaubnis, ABE) is
then void and riding the scooter in public traffic is no longer allowed. Use it on your own vehicle
only. Everything you do with this page is at your own risk.

## License

PolyForm Noncommercial 1.0.0 with two additional terms, in full in [LICENSE.md](LICENSE.md).

## Privacy

Nothing leaves your device but the page load itself. The details are in [PRIVACY.md](PRIVACY.md).

## Trademarks

An independent project, not affiliated with CITYBOSS. "CITYBOSS" and the model names are trademarks of
their respective owners and are used here only to say which scooters this page works with. See
[TRADEMARKS.md](TRADEMARKS.md).
