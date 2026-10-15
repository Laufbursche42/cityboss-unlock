'use strict';
// Laufbursche CITYBOSS Tool - a Web Bluetooth client for the lebitec/CITYBOSS BLE protocol family.
// Shell (header, footer, i18n, theme, doc viewer, anonymized log) matches the Laufbursche tool family;
// the BLE protocol is the proven CITYBOSS frame engine: HEADER LEN OPCODE DIR REG payload CK_LO CK_HI,
// with the app code (6 digits typed, last 4 = atoi mod 10000) mixed 16-bit into the checksum (XOR). The
// finished frame is transformed per model variant (chosen by BLE name in SetAppType): a whole-frame
// single-byte XOR (default CITYBOSS = 0x34) and/or a 4-byte header. See CB_VARIANTS.
const BUILD = 'v6';

// =====================================================================================
// CITYBOSS BLE protocol (ground truth - do not reinvent)
// =====================================================================================

// --------------------------- BLE transports (6 GATT profiles, lebitec OEM) ---------------------------
// BluetoothHolder.searchGattServices picks a numeric _appType and auto-detects which family is live.
// All 16-bit UUIDs expand to the standard base 0000xxxx-0000-1000-8000-00805F9B34FB except Nordic UART.
const TRANSPORTS = [
  { id:1, name:'Nordic UART', service:'6e400001-b5a3-f393-e0a9-e50e24dcca9e', write:'6e400002-b5a3-f393-e0a9-e50e24dcca9e', notify:'6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
  { id:2, name:'ae00',        service:'0000ae00-0000-1000-8000-00805f9b34fb', write:'0000ae01-0000-1000-8000-00805f9b34fb', notify:'0000ae02-0000-1000-8000-00805f9b34fb' },
  { id:3, name:'ffe0/fff4',   service:'0000ffe0-0000-1000-8000-00805f9b34fb', write:'0000fff3-0000-1000-8000-00805f9b34fb', notify:'0000fff4-0000-1000-8000-00805f9b34fb' },
  { id:4, name:'fff0/fff7',   service:'0000fff0-0000-1000-8000-00805f9b34fb', write:'0000fff3-0000-1000-8000-00805f9b34fb', notify:'0000fff7-0000-1000-8000-00805f9b34fb' },
  { id:5, name:'fff0/fff1',   service:'0000fff0-0000-1000-8000-00805f9b34fb', write:'0000fff2-0000-1000-8000-00805f9b34fb', notify:'0000fff1-0000-1000-8000-00805f9b34fb' },
  { id:6, name:'ffb0/ffb3',   service:'0000ffb0-0000-1000-8000-00805f9b34fb', write:'0000ffb1-0000-1000-8000-00805f9b34fb', notify:'0000ffb2-0000-1000-8000-00805f9b34fb' },
];
const ALL_SERVICES = [...new Set(TRANSPORTS.map(t=>t.service))];

// Advertised-name prefixes commonly used by lebitec OEM scooter models (CITYBOSS and siblings).
const SCAN_PREFIXES = ['CITYBOSS','CITY','CB','LB','LE','V5','M0','M1','Mini','GoKart','TECAR','EO','E12','E9'];

// --------------------------- register map + write opcodes ---------------------------
// Verified from libcpp_empty_test.so: a write frame carries OPCODE DIR(0x03) REG payload, where OPCODE
// depends on the helper - SendWriteCmd_HB @0x482650 uses 0x20 (speed-limit sliders), generic
// SendWriteCmd @0x4820b8 uses 0x06 (lock/unlock). Speed registers: 0xEF/0xF0/0xF1 level 1
// (mode-dependent, value = km/h), 0xF3 level 3 (km/h*1000+5000). Lock/unlock: 0x70/0x71.
const OP_WRITE    = 0x06;   // generic SendWriteCmd (lock/unlock)
const OP_WRITE_HB = 0x20;   // SendWriteCmd_HB (speed-limit + register writes)
const DIR_WRITE   = 0x03;
const REG_LIMIT_SPEED1_A = 0xEF;
const REG_LIMIT_SPEED1_B = 0xF0;
const REG_LIMIT_SPEED1_C = 0xF1;
const REG_LIMIT_SPEED3   = 0xF3;
const REG_LOCK   = 0x70;   // onClickLock @0x47bbd4 writes 0x70/0x71 via generic SendWriteCmd (opcode 0x06)
const REG_UNLOCK = 0x71;
const SPEED_TARGETS = [
  { reg:REG_LIMIT_SPEED1_A, mul:1,    add:0,    label:'LimitSpeed1 mode A (0xEF, direct)' },
  { reg:REG_LIMIT_SPEED1_B, mul:1,    add:0,    label:'LimitSpeed1 mode B (0xF0, direct)' },
  { reg:REG_LIMIT_SPEED1_C, mul:1,    add:0,    label:'LimitSpeed1 mode C (0xF1, direct)' },
  { reg:REG_LIMIT_SPEED3,   mul:1000, add:5000, label:'LimitSpeed3 / Cruise (0xF3, kmh*1000+5000)' },
];

// --------------------------- per-model frame variant (UserInterface::SetAppType @0x457264) ---------------------------
// The scooter picks a frame variant from its BLE name: a whole-frame single-byte XOR over EVERY byte
// (header + checksum included) and/or a 4-byte header 5A A5 <b> 3E instead of 55 AA <b+2>. Verified from
// the native lib; first substring match wins, in SetAppType order. An unmatched name (the typical CITYBOSS
// e-scooter) falls through to +0x1838=3 -> XOR 0x34, so the plain 55 AA frame is NOT the default.
const CB_VARIANTS = [
  { needle:'M6',          h4:false, xor:0x00 },
  { needle:'MiniRobot',   h4:false, xor:0x55 },
  { needle:'GoKart',      h4:false, xor:0x00 },
  { needle:'N3MTenbot',   h4:false, xor:0x00 },
  { needle:' MiniPro',    h4:false, xor:0x00 },
  { needle:'NinebotMini', h4:false, xor:0x00 },
  { needle:'miniPLUS_',   h4:true,  xor:0x00 },
  { needle:'Plus',        h4:true,  xor:0x39 },
  { needle:'M5Robot',     h4:false, xor:0xD8 },
  { needle:'M1',          h4:false, xor:0x7A },
  { needle:'A6',          h4:false, xor:0xD8 },
  { needle:'M0',          h4:false, xor:0x34 },
  { needle:'VOLTAIK',     h4:false, xor:0x34 },
  { needle:'MIScooter',   h4:false, xor:0x00 },
];
const CB_VARIANT_DEFAULT = { h4:false, xor:0x34 };   // unmatched name -> +0x1838=3 -> whole-frame XOR 0x34
function resolveVariant(name){
  const n = String(name || '');
  for (const v of CB_VARIANTS) if (n.indexOf(v.needle) >= 0) return v;
  return CB_VARIANT_DEFAULT;
}

// --------------------------- frame engine ---------------------------
// Verified from Bluetooth::SendFramePack @0x48145c: 55 AA LEN OPCODE DIR REG payload CK_LO CK_HI, with
// LEN = payload.length + 2. Checksum = ones-complement of the 16-bit byte sum from offset 2 (LEN), then
// the 16-bit app code XORed in per byte (lo^code_lo, hi^code_hi); ParseFrame compares the same. The code
// is the value the owner set in the app, reduced to atoi mod 10000 (0..9999) = its last four digits.
function checksum16(bytes, from){
  let s=0; for(let i=from;i<bytes.length;i++) s=(s+bytes[i])&0xffff;
  return (~s)&0xffff;
}
function buildFrame(opcode, reg, payload, pin, variant){
  payload = payload || [];
  const v = variant || CB_VARIANT_DEFAULT;
  const b = payload.length & 0xff;
  const f = v.h4
    ? [0x5A, 0xA5, b, 0x3E, opcode & 0xff, DIR_WRITE, reg & 0xff, ...payload]          // 4-byte header, LEN = b
    : [0x55, 0xAA, (b + 2) & 0xff, opcode & 0xff, DIR_WRITE, reg & 0xff, ...payload];  // 3-byte header, LEN = b+2
  const ck = checksum16(f, 2);
  const p = (pin >>> 0) & 0xffff;                     // 16-bit app code mixed into both checksum bytes
  f.push((ck & 0xff) ^ (p & 0xff), ((ck >> 8) & 0xff) ^ ((p >> 8) & 0xff));
  if (v.xor) for (let i = 0; i < f.length; i++) f[i] = (f[i] ^ v.xor) & 0xff;  // whole-frame XOR (header + checksum included)
  return f;
}
function reg16LE(v){ v &= 0xffff; return [v & 0xff, (v >> 8) & 0xff]; }
function hex(bytes){ return bytes.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '); }
function parseHex(s){ return (s.match(/[0-9a-fA-F]{2}/g) || []).map(h=>parseInt(h,16)); }

// Load-time protocol self-test: the builder must produce byte-exact output for a fixed pin+payload,
// and the frame layout invariants must hold on every freshly-built frame.
const FRAME_OK = (function(){
  const eq = (a, b) => a.length === b.length && a.every((v, i) => (v & 0xff) === (b[i] & 0xff));
  const PL = reg16LE(40);                 // speed write to 0xF0, value 40 -> payload 28 00, code 0
  const base = { h4:false, xor:0x00 };
  // base, no XOR: 55 AA 04 20 03 F0 28 00 C0 FE
  if (!eq(buildFrame(OP_WRITE_HB, REG_LIMIT_SPEED1_B, PL, 0, base),
          [0x55,0xAA,0x04,0x20,0x03,0xF0,0x28,0x00,0xC0,0xFE])) return false;
  // default CITYBOSS: the base frame with whole-frame XOR 0x34
  if (!eq(buildFrame(OP_WRITE_HB, REG_LIMIT_SPEED1_B, PL, 0, CB_VARIANT_DEFAULT),
          [0x61,0x9E,0x30,0x14,0x37,0xC4,0x1C,0x34,0xF4,0xCA])) return false;
  // 4-byte header + XOR 0x39 (Plus): 5A A5 02 3E 20 03 F0 28 00 84 FE then XOR 0x39
  if (!eq(buildFrame(OP_WRITE_HB, REG_LIMIT_SPEED1_B, PL, 0, { h4:true, xor:0x39 }),
          [0x63,0x9C,0x3B,0x07,0x19,0x3A,0xC9,0x11,0x39,0xBD,0xC7])) return false;
  // app code 1234 (0x04D2) on the base frame: checksum low XOR 0xD2, high XOR 0x04
  if (!eq(buildFrame(OP_WRITE_HB, REG_LIMIT_SPEED1_B, PL, 1234, base),
          [0x55,0xAA,0x04,0x20,0x03,0xF0,0x28,0x00,0xC0 ^ 0xD2,0xFE ^ 0x04])) return false;
  return true;
})();

// --------------------------- helpers ---------------------------
const $ = (id) => document.getElementById(id);
const LS = { THEME: 'cbu_theme', LANG: 'cbu_lang', PUBLOG: 'cbu_publog', PIN: 'cbu_pin' };

// =====================================================================================
// i18n
// =====================================================================================
let lang = 'de';
function table() { return (window.I18N && window.I18N[lang]) || {}; }
function t(key) { const v = table()[key]; return (typeof v === 'string') ? v : ''; }
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(n => {
    const v = t(n.getAttribute('data-t'));
    if (/[<&]/.test(v)) n.innerHTML = v; else n.textContent = v;   // scan-ok: our own translation table
  });
  { const el = $('link-guide'); if (el) el.href = docFile('GUIDE'); }
  { const el = $('link-readme'); if (el) el.href = docFile('README'); }
  { const el = $('link-license'); if (el) el.href = docFile('LICENSE'); }
  { const el = $('link-privacy'); if (el) el.href = docFile('PRIVACY'); }
  { const el = $('link-trademarks'); if (el) el.href = docFile('TRADEMARKS'); }
  { const el = $('langs'); if (el) el.setAttribute('aria-label', t('langGroup')); }
  { const el = $('build-ver'); if (el) el.textContent = t('buildLabel') + ' ' + BUILD; }
  { const el = $('enc-state'); if (el) el.textContent = t('encNone'); }
  document.querySelectorAll('#langs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  fillSpeedTargets();
  { const el = $('status'); setStatus(el ? el.dataset.state : 'disconnected'); }
  { const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    const el = $('btn-theme'); if (el) { el.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); el.title = el.getAttribute('aria-label'); } }
}
function initLangSwitch() {
  let saved = null; try { saved = localStorage.getItem(LS.LANG); } catch (e) {}
  if (saved === 'de' || saved === 'en') lang = saved;
  document.querySelectorAll('#langs button').forEach(b => b.addEventListener('click', () => {
    lang = b.dataset.lang; try { localStorage.setItem(LS.LANG, lang); } catch (e) {} applyLang();
  }));
}

// =====================================================================================
// theme
// =====================================================================================
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const b = $('btn-theme');
  if (b) { b.textContent = dark ? '☀' : '☾'; b.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); b.title = b.getAttribute('aria-label'); }
  try { localStorage.setItem(LS.THEME, dark ? 'dark' : 'light'); } catch (e) {}
}
function initTheme() {
  let saved = null; try { saved = localStorage.getItem(LS.THEME); } catch (e) {}
  applyTheme(saved !== 'light');
  const b = $('btn-theme');
  if (b) b.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light'));
}

// =====================================================================================
// log (anonymized on the way out; the buffer keeps raw text with \x01..\x01 sensitive spans)
// =====================================================================================
let logBuffer = [];
let publicLog = true;
let diag = false;
function redact(text) {
  let s = String(text);
  if (device && device.id) s = s.split(device.id).join('[redacted-id]');
  s = s.replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[redacted-mac]');
  s = s.replace(/\b(secret|token|key|aes|pwd|password|pin|mac|serial|vin|uid|imei)\b(\s*[:=]\s*)("?)([^\s",]+)\3/gi,
    (m, k, sep) => k + sep + '[redacted]');
  s = s.replace(/\b[0-9A-Fa-f]{16,}\b/g, '[redacted-hex]');
  return s;
}
function anonymize(s) {
  if (!publicLog) return String(s).replace(/\x01/g, '');
  return redact(String(s).replace(/\x01[^\x01]*\x01/g, 'XX').replace(/\x01/g, ''));
}
function logLine(cls, text) {
  const safe = '[' + new Date().toTimeString().slice(0, 8) + '] ' + text;
  logBuffer.push({ raw: safe, cls: cls });
  const el = $('log'); if (!el) return;
  const span = document.createElement('span');
  if (cls) span.className = cls; span.textContent = anonymize(safe) + '\n';
  el.appendChild(span); el.scrollTop = el.scrollHeight;
}
function renderLog() {
  const el = $('log'); if (!el) return;
  el.textContent = '';
  for (const e of logBuffer) { const span = document.createElement('span'); if (e.cls) span.className = e.cls; span.textContent = anonymize(e.raw) + '\n'; el.appendChild(span); }
  el.scrollTop = el.scrollHeight;
}
function logText() { return logBuffer.map(e => anonymize(e.raw)).join('\n'); }
function saveLog() {
  try {
    const blob = new Blob([logText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'laufbursche42-cityboss-log.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logSys('log saved');
  } catch (e) { logErr('save failed: ' + (e && e.message ? e.message : e)); }
}
const logTx = (b) => logLine('log-tx', '>>> ' + hex(b));
const logRx = (b) => logLine('log-rx', '<<< ' + hex(b));
const logSys = (text) => logLine('', '--- ' + text);
const logErr = (text) => logLine('log-err', '!!! ' + text);
const logDiag = (text) => { if (diag) logLine('', '... ' + text); };
function logDiagnosticHeader() {
  logLine('', '=== cityboss-unlock diagnostic ===');
  logLine('', 'build: ' + BUILD);
  logLine('', 'time: ' + new Date().toISOString());
  logLine('', 'userAgent: ' + (navigator.userAgent || '?'));
  logLine('', 'webBluetooth: ' + (navigator.bluetooth ? 'yes' : 'no'));
  logLine('', 'protocol self-test: ' + (FRAME_OK ? 'OK' : 'FAILED'));
  logLine('', '================================');
  if (!FRAME_OK) logErr('protocol self-test FAILED - frame builder/vector mismatch');
}

// =====================================================================================
// BLE state
// =====================================================================================
let device=null, server=null, writeChar=null, notifyChar=null, transport=null;
let connected=false;
let cbVariant = CB_VARIANT_DEFAULT;   // frame variant resolved from the BLE name on connect

function getPin(){
  const el = $('pin-in'); if (!el) return 0;
  const digits = String(el.value || '').replace(/\D/g, '');
  if (!digits) return 0;
  const v = parseInt(digits, 10);                       // device uses atoi(code) mod 10000 = last 4 digits
  return Number.isFinite(v) ? (v % 10000) : 0;
}

async function sendFrame(frame){
  if(!writeChar){ logErr('not connected'); return; }
  const buf = Uint8Array.from(frame);
  try{
    if(writeChar.writeValueWithoutResponse) await writeChar.writeValueWithoutResponse(buf);
    else await writeChar.writeValue(buf);
    logTx(frame);
  }catch(e){ logErr('TX error: ' + (e && e.message ? e.message : e)); }
}
function writeReg(reg, value, opcode){ return sendFrame(buildFrame(opcode || OP_WRITE_HB, reg, reg16LE(value), getPin(), cbVariant)); }
function writeRegNamed(name, reg, val, opcode){ writeReg(reg, val, opcode); logSys(`${name}: reg 0x${reg.toString(16)} = ${val}`); }

// --------------------------- receive / telemetry ---------------------------
// Register map derived from capstone disassembly of UserInterface::RefreshMainPage* and RefreshInfo
// @0x459b9c / 0x460190 / 0x45b66c / 0x45df24 / 0x45ac90 in libcpp_empty_test.so. Each entry maps a
// MapData register byte to (tile id, decoder, label). The device variant (classic/var2/var4/KDC)
// is chosen at the controller side by appType, which we can't query, so we build a UNION across
// variants: whichever register the device actually writes, we populate its tile. Collisions where
// one register means different things on different variants (e.g. 0x22 = battery on var2/var4 but
// trip-km on KDC) default to the most common interpretation; ambiguous registers can be
// disambiguated by a user capture later.
const TELE_MAP = {
  // RefreshMainPage (classic, 0xB0-0xB5 range)
  0xB5: { tile:'t-speed',  dec:f16_div10, suf:' km/h' },
  0xB4: { tile:'t-batt',   dec:u8,        suf:'%' },
  0xB2: { tile:'t-lock',   dec:lockState },
  0xB0: { tile:'t-warn-a', dec:boolState },
  0xB1: { tile:'t-warn-b', dec:boolState },
  // RefreshMainPage2 (var2, speed on 0xBC)
  0xBC: { tile:'t-speed',  dec:f16_div10, suf:' km/h' },
  // RefreshMainPage4 (var4, speed on 0xF7)
  0xF7: { tile:'t-speed',  dec:f16_div10, suf:' km/h' },
  // RefreshMainPageKDC (GoKart, speed on 0xAC - regular getMapData API, not GoKart partition)
  0xAC: { tile:'t-speed',  dec:f16_div10, suf:' km/h' },
  // Shared across var2/var4/KDC (regular partition)
  0x22: { tile:'t-batt',   dec:u8,        suf:'%' },     // KDC variant also writes trip-km here; battery first
  0x1D: { tile:'t-lock',   dec:lockState },
  0x7F: { tile:'t-lock',   dec:lockState },               // var4 lock
  0x1B: { tile:'t-mode',   dec:u8 },
  0x1C: { tile:'t-mode',   dec:u8 },
  // RefreshInfo (detail page, shared register space across variants)
  0x1F: { tile:'t-total',  dec:f32_div100, suf:' km' },
  0x24: { tile:'t-volt',   dec:f16_div100, suf:' V' },
  0x25: { tile:'t-total',  dec:f32_div100, suf:' km' },
  0x27: { tile:'t-trip',   dec:f16_div100 },
  0x28: { tile:'t-batt',   dec:u8,        suf:'%' },
  0x32: { tile:'t-runtime-m', dec:u8 },
  0x34: { tile:'t-runtime-h', dec:u8 },
  0x47: { tile:'t-cell1',  dec:f16_div100, suf:' V' },
  0x48: { tile:'t-cell2',  dec:f16_div100, suf:' V' },
  0x49: { tile:'t-cell3',  dec:f16_div100, suf:' V' },
  0x4A: { tile:'t-cur',    dec:f16_div100, suf:' A' },
  0x4B: { tile:'t-cur-b',  dec:f16_div100, suf:' A' },
  0x61: { tile:'t-stat-a', dec:u16LE },
  0x62: { tile:'t-stat-b', dec:u16LE },
};
function u8(b){ return b[0]; }
function u16LE(b){ return (b[1] << 8) | b[0]; }
function f16_div10(b){ return (((b[1] << 8) | b[0]) / 10).toFixed(1); }
function f16_div100(b){ return (((b[1] << 8) | b[0]) / 100).toFixed(2); }
function f32_div100(b){ return (((b[3] << 24) | (b[2] << 16) | (b[1] << 8) | b[0]) >>> 0) / 100; }
function lockState(b){ return b[0] ? t('valLocked') : t('valUnlocked'); }
function boolState(b){ return b[0] ? '1' : '0'; }
function setTile(id, text){ const el = $(id); if(!el) return; el.textContent = (text == null ? '-' : String(text)); }
function onNotify(ev){
  const v = new Uint8Array(ev.target.value.buffer);
  let b = Array.from(v);
  logRx(b);                                                     // log the raw on-wire bytes
  if (cbVariant.xor) b = b.map(x => (x ^ cbVariant.xor) & 0xff); // undo the model's whole-frame XOR first
  // After de-XOR: 55 AA ... (3-byte header) or 5A A5 ... 3E (4-byte). The reg/payload offsets below are the
  // classic layout, not yet re-verified against the variant frames - telemetry only, never the writes.
  if (b.length < 7 || !((b[0] === 0x55 && b[1] === 0xAA) || (b[0] === 0x5A && b[1] === 0xA5))) return;
  const len = b[2];
  if (b.length < 4 + len + 2) return;
  const reg = b[4];
  const payload = b.slice(5, 5 + (len - 1));
  const entry = TELE_MAP[reg];
  if (!entry) { logDiag('tele: reg 0x' + reg.toString(16).padStart(2,'0') + ' = ' + hex(payload) + ' (unmapped)'); return; }
  try {
    const val = entry.dec(payload);
    setTile(entry.tile, val + (entry.suf || ''));
    logDiag('tele: ' + entry.tile + ' <- 0x' + reg.toString(16).padStart(2,'0') + ' = ' + val);
  } catch(e){ logDiag('tele: 0x' + reg.toString(16).padStart(2,'0') + ' decode failed: ' + e.message); }
}

// =====================================================================================
// connect / reveal
// =====================================================================================
async function connect(){
  if(connected){ await disconnect(); return; }
  if(!navigator.bluetooth){ logErr('Web Bluetooth not available (needs Chrome, Edge or Bluefy)'); return; }
  try{
    setStatus('connecting');
    const showAll = $('showall') && $('showall').checked;
    const req = showAll
      ? { acceptAllDevices: true, optionalServices: ALL_SERVICES }
      : { filters: SCAN_PREFIXES.map(p => ({ namePrefix: p })), optionalServices: ALL_SERVICES };
    device = await navigator.bluetooth.requestDevice(req);
    device.addEventListener('gattserverdisconnected', onDisc);
    logSys('device: \x01' + (device.name || '(no name)') + '\x01');
    cbVariant = resolveVariant(device.name);
    logSys('frame variant: ' + (cbVariant.h4 ? '4-byte header' : '3-byte header') + ', XOR ' + (cbVariant.xor ? '0x' + cbVariant.xor.toString(16).toUpperCase().padStart(2,'0') : 'none'));
    setStatus('linking');
    server = await device.gatt.connect();
    transport = null;
    for(const tr of TRANSPORTS){
      try{
        const svc = await server.getPrimaryService(tr.service);
        const w = await svc.getCharacteristic(tr.write).catch(()=>null);
        const n = await svc.getCharacteristic(tr.notify).catch(()=>null);
        if(w && n){ transport=tr; writeChar=w; notifyChar=n; break; }
      }catch(e){ /* try next profile */ }
    }
    if(!transport){ logErr('no matching GATT profile found'); setStatus('no-service'); await disconnect(); return; }
    logDiag('profile ' + transport.id + ' (' + transport.name + ')');
    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', onNotify);
    connected = true;
    setStatus('connected');
    revealInteractive(true);
    setControlsEnabled(true);
    { const el = $('devinfo'); if (el) el.textContent = t('devPrefix') + ' ' + ((publicLog && device.name) ? 'XX' : (device.name || '')) + '  -  profile ' + transport.id; }
    logSys('connected, profile ' + transport.id);
  }catch(e){ logErr('connect aborted: ' + (e && e.message ? e.message : e)); setStatus('disconnected'); }
}
async function disconnect(){ try{ if(device && device.gatt.connected) device.gatt.disconnect(); }catch(e){} onDisc(); }
function onDisc(){ connected=false; writeChar=null; notifyChar=null; transport=null; cbVariant=CB_VARIANT_DEFAULT;
  setStatus('disconnected'); setControlsEnabled(false); revealInteractive(false);
  const el = $('devinfo'); if (el) el.textContent = ''; logSys('disconnected'); }

function revealInteractive(on){ ['live-card','more-card','raw-card'].forEach(id => { const el = $(id); if (el) el.hidden = !on; }); }
const CONTROL_IDS = ['btn-setspeed','btn-lock','btn-unlock','btn-writereg','btn-raw','btn-raw-plain'];
function setControlsEnabled(on){ CONTROL_IDS.forEach(id => { const e = $(id); if (e) e.disabled = !on; }); }

function statusLabel(s){
  const map = { disconnected:'stDisconnected', connecting:'stConnecting', linking:'stLinking',
    connected:'stConnected', 'no-service':'stNoService', 'no-char':'stNoChar' };
  return t(map[s] || 'stDisconnected') || s;
}
function setStatus(s){
  const el = $('status'); if (el) { el.dataset.state = s; el.textContent = statusLabel(s); }
  const cb = $('btn-conn');
  if (cb) { const on = (s === 'connecting' || s === 'linking' || s === 'connected'); cb.textContent = on ? t('btnDisconnect') : t('btnConnect'); }
}

// =====================================================================================
// control wiring
// =====================================================================================
function makeOption(value, label){ const o=document.createElement('option'); o.value=value; o.textContent=label; return o; }
function fillSpeedTargets(){
  const st=$('speed-target'); if(!st) return; const prev = st.value;
  st.textContent=''; SPEED_TARGETS.forEach(s=> st.appendChild(makeOption(s.reg, s.label)));
  if (prev) st.value = prev;
}
function wire(){
  $('btn-conn').addEventListener('click', connect);

  $('btn-setspeed').addEventListener('click', ()=>{
    const kmh = parseFloat($('speed-kmh').value) || 0;
    const reg = parseInt($('speed-target').value);
    const tg = SPEED_TARGETS.find(s=>s.reg===reg) || { mul:1, add:0 };
    const raw = Math.round(kmh*tg.mul + tg.add) & 0xffff;
    writeReg(reg, raw, OP_WRITE_HB); logSys(`speed limit: reg 0x${reg.toString(16)} = ${kmh} km/h (raw ${raw})`);
  });

  $('btn-lock').addEventListener('click', ()=> writeRegNamed('lock',   REG_LOCK, 1, OP_WRITE));
  $('btn-unlock').addEventListener('click', ()=> writeRegNamed('unlock', REG_UNLOCK, 1, OP_WRITE));

  $('btn-writereg').addEventListener('click', ()=> writeReg(parseInt($('reg-nr').value)&0xff, parseInt($('reg-val').value)&0xffff));
  $('btn-raw').addEventListener('click', ()=>{
    const bytes=parseHex($('raw-hex').value); if(bytes.length<3){ logErr('too short'); return; }
    // Append auto-checksum using current PIN mixing
    const ck=checksum16(bytes,2); const p=getPin()&0xffff;
    bytes.push((ck&0xff)^(p&0xff),((ck>>8)&0xff)^((p>>8)&0xff));
    if(cbVariant.xor) for(let i=0;i<bytes.length;i++) bytes[i]=(bytes[i]^cbVariant.xor)&0xff;  // match the model's whole-frame XOR
    sendFrame(bytes);
  });
  $('btn-raw-plain').addEventListener('click', ()=>{
    const bytes=parseHex($('raw-hex').value); if(!bytes.length) return;
    if(!writeChar){ logErr('not connected'); return; }
    const buf=Uint8Array.from(bytes);
    (writeChar.writeValueWithoutResponse ? writeChar.writeValueWithoutResponse(buf) : writeChar.writeValue(buf));
    logTx(bytes);
  });

  // PIN persistence (local only)
  { const pin = $('pin-in'); if (pin) {
      try { const saved = localStorage.getItem(LS.PIN); if (saved) pin.value = saved; } catch (e) {}
      pin.addEventListener('change', () => { try { localStorage.setItem(LS.PIN, pin.value.replace(/\D/g,'').slice(0,6)); } catch (e) {} });
  }}

  $('btn-copy-log').addEventListener('click', () => navigator.clipboard.writeText(logText()).then(() => logSys('log copied')).catch(() => {}));
  $('btn-clear-log').addEventListener('click', () => { logBuffer = []; const el = $('log'); if (el) el.textContent = ''; logDiagnosticHeader(); });
  $('btn-save-log').addEventListener('click', saveLog);
  { const pl = $('public-log'); if (pl) { pl.checked = publicLog; pl.addEventListener('change', () => { publicLog = pl.checked; try { localStorage.setItem(LS.PUBLOG, publicLog ? '1' : '0'); } catch (e) {} logSys('public-log: ' + (publicLog ? 'on (anonymizing device name/id)' : 'off')); renderLog(); }); } }
  { const dg = $('diag-log'); if (dg) dg.addEventListener('change', () => { diag = dg.checked; logSys('diag-log: ' + (diag ? 'on' : 'off')); }); }
  { const sa = $('showall'); if (sa) sa.addEventListener('change', () => { logSys('show-all-frames: ' + (sa.checked ? 'on' : 'off')); renderLog(); }); }

  document.querySelectorAll('.help-btn').forEach(btn => btn.addEventListener('click', () => openHelp(btn.getAttribute('data-help'))));
  ['help-x', 'help-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', closeHelp); });
  { const b = $('link-disclaimer'); if (b) b.addEventListener('click', e => { e.preventDefault(); openDocFile(docFile('DISCLAIMER'), 'footDisclaimer'); }); }
}

// =====================================================================================
// document viewer (markdown of our own docs) + help
// =====================================================================================
const DOC_TITLES = {
  'GUIDE.de.md': 'footGuide', 'GUIDE.en.md': 'footGuide',
  'PRIVACY.de.md': 'footPrivacy', 'PRIVACY.md': 'footPrivacy',
  'LICENSE.de.md': 'footLicense', 'LICENSE.md': 'footLicense',
  'TRADEMARKS.de.md': 'footTrademarks', 'TRADEMARKS.md': 'footTrademarks',
  'DISCLAIMER.de.md': 'footDisclaimer', 'DISCLAIMER.md': 'footDisclaimer',
  'README.md': 'footReadme'
};
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/ /g, '-');
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// inlineMd receives ALREADY-escaped text (mdToHtml escapes first); DOC_TITLES hrefs stay in-modal.
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, href) {
      if (DOC_TITLES[href]) return '<a href="' + href + '" data-docfile="' + href + '">' + text + '</a>';
      return '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
    });
}
function mdToHtml(md) {
  var codeBlocks = [];
  // 1) pull fenced code blocks out first so their content is never treated as markdown
  md = String(md).replace(/```[^\n]*\n?([\s\S]*?)```/g, function (m, code) {
    var i = codeBlocks.length;
    codeBlocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return '\x00CB' + i + '\x00';
  });
  var lines = md.split(/\r?\n/);
  var out = [], para = [], list = null;
  function flushPara() { if (para.length) { out.push('<p>' + inlineMd(esc(para.join(' '))) + '</p>'); para = []; } }
  function flushList() { if (list) { out.push('<' + list.type + '>' + list.items.join('') + '</' + list.type + '>'); list = null; } }
  function isTableSep(s) { var tt = s.replace(/\s/g, ''); return /^\|?:?-+:?(\|:?-+:?)+\|?$/.test(tt); }
  function splitRow(s) { return s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    var cb = ln.match(/^\x00CB(\d+)\x00$/);
    if (cb) { flushPara(); flushList(); out.push(codeBlocks[Number(cb[1])]); continue; }
    if (/^\s*$/.test(ln)) { flushPara(); flushList(); continue; }
    var h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); var lvl = Math.min(h[1].length, 4); out.push('<h' + lvl + '>' + inlineMd(esc(h[2])) + '</h' + lvl + '>'); continue; }
    if (/^---+$/.test(ln.trim())) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if (ln.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {   // GFM table: header, |---| sep, rows
      flushPara(); flushList();
      var head = splitRow(ln); i++;   // consume the separator row
      var body = '';
      while (i + 1 < lines.length && lines[i + 1].indexOf('|') >= 0 && lines[i + 1].trim() !== '') {
        body += '<tr>' + splitRow(lines[++i]).map(function (c) { return '<td>' + inlineMd(esc(c)) + '</td>'; }).join('') + '</tr>';
      }
      out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + inlineMd(esc(c)) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table>');
      continue;
    }
    if (/^\s*>/.test(ln)) {                             // merge consecutive > lines into ONE callout
      flushPara(); flushList();
      var q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      i--;                                              // step back; the for-loop re-increments
      while (q.length && /^\s*$/.test(q[0])) q.shift();
      while (q.length && /^\s*$/.test(q[q.length - 1])) q.pop();
      if (q.length) out.push('<blockquote>' + mdToHtml(q.join('\n')) + '</blockquote>');  // inner rendered as markdown
      continue;
    }
    var ul = ln.match(/^\s*[-*]\s+(.*)$/);
    var ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      var type = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type: type, items: [] }; }
      list.items.push('<li>' + inlineMd(esc((ul ? ul[1] : ol[1]))) + '</li>');
      continue;
    }
    para.push(ln.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}
const docCache = {};
const docFile = name => { if (name === 'GUIDE') return 'GUIDE.' + lang + '.md'; if (name === 'README') return 'README.md'; return lang === 'de' ? name + '.de.md' : name + '.md'; };
function openDocFile(file, titleKey) {
  const dlg = $('doc'), body = $('doc-body'); if (!dlg || !body) return;
  const mark = (lang === 'de' && !file.includes('.de.') && file !== 'README.md') ? ' ' + t('docEnglish') : '';
  $('doc-title').textContent = (t(titleKey || DOC_TITLES[file] || '') || file) + mark;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  const showDoc = html => { body.innerHTML = html; const h1 = body.querySelector('h1'); if (h1) { $('doc-title').textContent = h1.textContent.trim() + mark; h1.remove(); } body.scrollTop = 0; }; // scan-ok: markdown of our own documents, escaped by mdToHtml first
  if (docCache[file]) { showDoc(docCache[file]); return; }
  body.innerHTML = '<p>' + escHtml(t('docLoading')) + '</p>'; // scan-ok: escaped
  fetch(file + '?v=' + BUILD).then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text(); })
    .then(txt => { docCache[file] = mdToHtml(txt); showDoc(docCache[file]); })
    .catch(e => { body.innerHTML = '<p>' + escHtml(t('docFail')) + '</p><pre class="log-err">' + escHtml(file + ': ' + (e && e.message ? e.message : e)) + '</pre>'; }); // scan-ok: escaped
}
function wireDocViewer() {
  document.addEventListener('click', e => {
    if (!e.target.closest) return;
    const disc = e.target.closest('[data-open-disclaimer]'); if (disc) { e.preventDefault(); openDocFile(docFile('DISCLAIMER'), 'footDisclaimer'); return; }
    const a = e.target.closest('[data-doc], [data-docfile]'); if (!a) return;
    e.preventDefault();
    const file = a.getAttribute('data-docfile');
    if (file) openDocFile(file, a.getAttribute('data-t') || '');
    else openDocFile(docFile(a.getAttribute('data-doc')), a.getAttribute('data-t') || '');
  });
  ['doc-x', 'doc-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => { const d = $('doc'); if (d) d.close(); }); });
}
const HELP = { ctrl: ['ctrlTitle', 'ctrlHint'], expert: ['expertTitle', 'expertHint'],
  publiclog: ['publicLogLabel', 'helpPublicLog'], diaglog: ['diagLogLabel', 'helpDiagLog'] };
function openHelp(key) {
  const m = HELP[key]; if (!m) return; const dlg = $('help'); if (!dlg) return;
  $('help-title').textContent = t(m[0]);
  const bo = $('help-body'); if (bo) { const v = t(m[1]); if (/[<&]/.test(v)) bo.innerHTML = v; else bo.textContent = v; } // scan-ok: our own translation table
  if (dlg.showModal) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } } else dlg.setAttribute('open', '');
}
function closeHelp() { const dlg = $('help'); if (dlg && dlg.close) dlg.close(); }

// =====================================================================================
// init
// =====================================================================================
window.addEventListener('DOMContentLoaded', () => {
  initLangSwitch();
  initTheme();
  wireDocViewer();
  wire();
  try { const p = localStorage.getItem(LS.PUBLOG); if (p === '0') publicLog = false; } catch (e) {}
  { const pl = $('public-log'); if (pl) pl.checked = publicLog; }
  fillSpeedTargets();
  applyLang();
  setStatus('disconnected');
  { const el = $('platform-note'); if (el) el.hidden = !!navigator.bluetooth; }
  logDiagnosticHeader();
});
