# Guide: Laufbursche CITYBOSS unlock

> **Feasibility study.** This tool shows what the Bluetooth protocol of these scooters makes possible.
> It is not a finished product. Error-free operation is not promised and there is no warranty. Whatever
> you do with it, you do at your own risk and on your own vehicle only.

> **Important for error reports:** switch on the **Diagnostic log** at the bottom of the page *before* you connect to the scooter. Only then is the full connection handshake captured - and those are exactly the lines we need in a [ticket](https://github.com/Laufbursche42/Laufbursche42/issues) to reproduce a problem.

## 1. What you need

Everything happens in the browser over Web Bluetooth: pick the model, connect, set the speed, switch
the cruise/limit mode, lock and unlock the vehicle, toggle the lights. There is nothing to install. You
need:

**A browser that supports Web Bluetooth.**

- **iOS:** the **Bluefy** browser (free on the App Store). Safari and every other iOS browser run on
  the Safari engine, which has no Web Bluetooth at all.
- **Android or desktop:** **Chrome** or another Chromium browser. Web Bluetooth is built in.

**An CITYBOSS (or a compatible MiniRobot-platform scooter).** The app is a white-label base shared by
many brands, so the advertised name starts with one of many prefixes (for example `i10`, `MAX`, `T10`,
`Mini`, `Plus`, `X1`, `X3`, `GoKart`, `XRIDER`, `TECAR`, `NEXRIDE`, `E-WHEELS`, `KING`, `EROBOT`). Not
every model exposes every function over Bluetooth; the page shows the controls that apply and an expert
panel for the rest.

---

## 2. Auto detect or pick your model

The easiest option in the model dropdown at the top is **Auto detect**. The page scans all nearby
scooters the app knows and, after connecting, picks the right GATT profile from the services the device
actually exposes, exactly like the manufacturer app. You do not need to know your model.

If you prefer, pick your model from the list. The page then works the same; the discovered service has
the final say on the transport, so a wrong pick is corrected automatically.

---

## 3. Connect

1. Open the page in Bluefy or Chrome.
2. Turn the scooter on. Keep it a few meters next to the phone.
3. Tap **Connect** and choose your scooter in the browser chooser.
4. Watch the status top right: `connecting`, then `connected`, and the detected profile in the log.

**Android: Location must be on.** On Android, Chrome only scans for Bluetooth when Location services
(GPS) are on and Chrome has the Location or Nearby-devices permission. Otherwise the device list stays
empty even though the scooter is right there. Also close the manufacturer app fully first (swipe it
away), otherwise it holds the connection and the scooter no longer advertises for the browser to see.
If in doubt, power the scooter off and on again right before you scan.

The page then polls the live data and fills the telemetry tiles. The very first connect always needs
the browser chooser. That is a browser security rule no shortcut can skip.

---

## 4. Set and test the maximum speed

1. Enter the value in km/h in the **Speed limit** card.
2. Pick the target register (MaxSpeed is the usual one) and tap **Set**. The page sends the value with
   the correct per-mode scaling.

The page itself has no upper limit. Whether the controller actually rides a raised value or caps it at
the legal limit is decided inside the scooter's firmware, so this is what you test on the road.

**How to test whether the scooter really rides the value:**

1. Find a safe, open spot on private ground, no traffic. Helmet on.
2. Ride at full throttle briefly and note the km/h at which the scooter caps. That is your baseline.
3. Set a value slightly above it, for example 2 to 3 km/h more, and tap **Set**.
4. Ride full throttle again and watch the **Speed** tile. Does it climb past the previous cap? Then the
   controller accepts the value.
5. Repeat in small steps. The value at which it stops going higher is the firmware's hard cap.
6. A high number does not make the scooter faster than the motor and battery allow. It only shows
   whether the controller accepts it.

---

## 5. Cruise / limit mode

In this app cruise control and the speed-limit mode are the same switch. It has two parts:

- **Target speed:** set it in the speed-limit card (this writes the speed register).
- **On / off:** the **Cruise / limit** buttons send the enable command (register `0x72`, 1 = on,
  0 = off).

Setting only the target speed does not switch the mode on; you also need the on button.

---

## 6. Lock and unlock the vehicle

This is the **anti-theft immobilizer** of the scooter, NOT the speed. Unlock releases the scooter, lock
immobilizes it (register `0xf6`).

---

## 7. Lights

The light buttons toggle the headlight; the same `0xd3` bitfield also carries brake light, hub light
and ambient light bits, which you can set from the expert panel. These are comfort settings and have
nothing to do with speed.

---

## 8. Read live values

Once data arrives, the tiles fill in (speed, battery, voltage, current, trip, total, max speed, lock,
error code, firmware) and the log shows the raw notifications as hex. The register mapping is
model dependent, so a value may stay a dash on some models; the raw data is always in the log.

---

## 9. Expert panel

For anything the dedicated buttons do not cover, or for a model where the exact register differs:

- **Write register (0x20):** enter a register number and a 16-bit value.
- **Read register (0x06):** trigger a read of a register block.
- **Send raw frame:** paste bytes; the page appends the checksum and applies the selected XOR.
- **Model XOR:** the single-byte obfuscation key, if your device type uses one (default none).

---

## 10. Test cleanly and report

Test on your own device on private ground only. The log at the bottom is a full transcript of every
byte sent and received. Report problems or successes as a
[GitHub issue](https://github.com/Laufbursche42/cityboss-unlock/issues) with the copied log so it is clear
what was sent and received.

---

## 11. Limits worth knowing

- Whether the controller rides a value above the factory limit is decided inside the encrypted
  controller firmware and is model dependent; the road test in section 4 is the way to find out.
- The exact register for a few settings (for example zero-start) is model dependent; use the expert
  panel and confirm with a capture of the original app if needed.
- There is no firmware flashing here.

---

## 12. Legal

Raising the maximum speed lifts the factory limit. The type approval (ABE) is then void and riding on
public roads is no longer allowed. Use it on your own vehicle and at your own risk only.

## Contribute
Want to find out if and how tuning works on your scooter? Test this tool on your own vehicle and open a ticket on [GitHub](https://github.com/Laufbursche42/Laufbursche42/issues) - with your model and what worked (or did not). That way we figure out together what is possible on which model.
