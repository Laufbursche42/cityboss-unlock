'use strict';
// Laufbursche CITYBOSS Tool - a Web Bluetooth client for the lebitec/CITYBOSS BLE protocol family.
// Shell (header, footer, i18n, theme, doc viewer, anonymized log) matches the Laufbursche tool family;
// the BLE protocol is the proven CITYBOSS frame engine: 55 AA LEN opcode REG payload CK_LO CK_HI, with
// a 4-digit app PIN mixed into the checksum via reversible XOR (recovered elsewhere, not here).
const BUILD = 'v1';

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

// --------------------------- register map ---------------------------
// Writer opcodes: 0x70 is TR_TOUCH (the main register write via Bluetooth::OnTouchUpdate @0x483ebc).
// Speed-limit registers: 0xEF/0xF0/0xF1 are level 1 (mode-dependent), 0xF3 is level 3 (slider*1000+5000).
// Lock variants: 0x70 and 0x71 (TriggerLogic::onClickLock @0x47bbd4) or variant bytes 0xB2/0x1D/0x44/6.
const OPCODE_TOUCH = 0x70;
const REG_LIMIT_SPEED1_A = 0xEF;
const REG_LIMIT_SPEED1_B = 0xF0;
const REG_LIMIT_SPEED1_C = 0xF1;
const REG_LIMIT_SPEED3   = 0xF3;
const REG_LOCK   = 0x70;   // same byte as the opcode: the register address 0x70 toggles lock on default variants
const REG_UNLOCK = 0x71;
const SPEED_TARGETS = [
  { reg:REG_LIMIT_SPEED1_A, mul:1,    add:0,    label:'LimitSpeed1 mode A (0xEF, direct)' },
  { reg:REG_LIMIT_SPEED1_B, mul:1,    add:0,    label:'LimitSpeed1 mode B (0xF0, direct)' },
  { reg:REG_LIMIT_SPEED1_C, mul:1,    add:0,    label:'LimitSpeed1 mode C (0xF1, direct)' },
  { reg:REG_LIMIT_SPEED3,   mul:1000, add:5000, label:'LimitSpeed3 / Cruise (0xF3, kmh*1000+5000)' },
];

// --------------------------- frame engine ---------------------------
// Checksum = one's complement of the 16-bit byte sum starting at LEN (offset 2), then both bytes XORed
// with a PIN-derived mixing byte. The PIN mixing is reversible algebra from the research; without the
// right PIN the device rejects the frame. We mix the low 8 bits of (PIN) into both checksum bytes as
// documented in Bluetooth::SendFramePack (@0x48145c-0x481d7c). An exact per-byte lookup is not shipped
// in the public research, so a captured valid frame remains the ground-truth check for PIN correctness.
function pinByte(pin){ return (pin >>> 0) & 0xff; }
function checksum16(bytes, from){
  let s=0; for(let i=from;i<bytes.length;i++) s=(s+bytes[i])&0xffff;
  return (~s)&0xffff;
}
function buildFrame(opcode, reg, payload, pin){
  payload = payload || [];
  const len = payload.length + 2;                     // LEN counts REG + payload + nothing else here
  const f = [0x55, 0xAA, len, opcode, reg, ...payload];
  const ck = checksum16(f, 2);
  const mix = pinByte(pin);
  f.push((ck & 0xff) ^ mix, ((ck >> 8) & 0xff) ^ mix);
  return f;
}
function reg16LE(v){ v &= 0xffff; return [v & 0xff, (v >> 8) & 0xff]; }
function hex(bytes){ return bytes.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '); }
function parseHex(s){ return (s.match(/[0-9a-fA-F]{2}/g) || []).map(h=>parseInt(h,16)); }

// Load-time protocol self-test: the builder must produce byte-exact output for a fixed pin+payload,
// and the frame layout invariants must hold on every freshly-built frame.
const FRAME_OK = (function(){
  const eq = (a, b) => a.length === b.length && a.every((v, i) => (v & 0xff) === (b[i] & 0xff));
  // With PIN=0 (no mixing) the checksum is the plain one's complement sum - a reproducible vector.
  const fr = buildFrame(OPCODE_TOUCH, REG_LIMIT_SPEED1_A, reg16LE(25000), 0);
  // kv = header + len + opcode + reg + 2-byte LE payload + 2-byte checksum = 9 bytes total
  if (fr.length !== 9) return false;
  // sum from offset 2: 0x04 + 0x70 + 0xEF + 0xA8 + 0x61 = 0x26C -> ~0x026C = 0xFD93 -> LE: 93 FD
  const kv = eq(fr, [0x55, 0xAA, 0x04, 0x70, 0xEF, 0xA8, 0x61, 0x93, 0xFD]);
  // Round-trip with PIN=0x12 (mixing byte 0x12): both checksum bytes XOR 0x12.
  const fr2 = buildFrame(OPCODE_TOUCH, REG_LIMIT_SPEED1_A, reg16LE(25000), 0x12);
  const kv2 = eq(fr2, [0x55, 0xAA, 0x04, 0x70, 0xEF, 0xA8, 0x61, 0x93 ^ 0x12, 0xFD ^ 0x12]);
  return kv && kv2;
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

function getPin(){
  const el = $('pin-in'); if (!el) return 0;
  const v = parseInt(String(el.value || '0').replace(/\D/g,''), 10);
  return Number.isFinite(v) ? v : 0;
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
function writeReg(reg, value){ return sendFrame(buildFrame(OPCODE_TOUCH, reg, reg16LE(value), getPin())); }
function writeRegNamed(name, reg, val){ writeReg(reg, val); logSys(`${name}: reg 0x${reg.toString(16)} = ${val}`); }

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
  const b = Array.from(v);
  logRx(b);
  // Frame: 55 AA LEN OP REG payload CK_LO CK_HI  (OP = 0x70 TR_TOUCH echo)
  if (b.length < 7 || b[0] !== 0x55 || b[1] !== 0xAA) return;
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
function onDisc(){ connected=false; writeChar=null; notifyChar=null; transport=null;
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
    writeReg(reg, raw); logSys(`speed limit: reg 0x${reg.toString(16)} = ${kmh} km/h (raw ${raw})`);
  });

  $('btn-lock').addEventListener('click', ()=> writeRegNamed('lock',   REG_LOCK, 1));
  $('btn-unlock').addEventListener('click', ()=> writeRegNamed('unlock', REG_UNLOCK, 1));

  $('btn-writereg').addEventListener('click', ()=> writeReg(parseInt($('reg-nr').value)&0xff, parseInt($('reg-val').value)&0xffff));
  $('btn-raw').addEventListener('click', ()=>{
    const bytes=parseHex($('raw-hex').value); if(bytes.length<3){ logErr('too short'); return; }
    // Append auto-checksum using current PIN mixing
    const ck=checksum16(bytes,2); const mix=pinByte(getPin());
    bytes.push((ck&0xff)^mix,((ck>>8)&0xff)^mix); sendFrame(bytes);
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
      pin.addEventListener('change', () => { try { localStorage.setItem(LS.PIN, pin.value.replace(/\D/g,'').slice(0,4)); } catch (e) {} });
  }}

  $('btn-copy-log').addEventListener('click', () => navigator.clipboard.writeText(logText()).then(() => logSys('log copied')).catch(() => {}));
  $('btn-clear-log').addEventListener('click', () => { logBuffer = []; const el = $('log'); if (el) el.textContent = ''; logDiagnosticHeader(); });
  $('btn-save-log').addEventListener('click', saveLog);
  { const pl = $('public-log'); if (pl) { pl.checked = publicLog; pl.addEventListener('change', () => { publicLog = pl.checked; try { localStorage.setItem(LS.PUBLOG, publicLog ? '1' : '0'); } catch (e) {} logSys('public-log: ' + (publicLog ? 'on (anonymizing device name/id)' : 'off')); renderLog(); }); } }
  { const dg = $('diag-log'); if (dg) dg.addEventListener('change', () => { diag = dg.checked; logSys('diag-log: ' + (diag ? 'on' : 'off')); }); }
  { const sa = $('showall'); if (sa) sa.addEventListener('change', () => { logSys('show-all-frames: ' + (sa.checked ? 'on' : 'off')); renderLog(); }); }

  document.querySelectorAll('.help-btn').forEach(btn => btn.addEventListener('click', () => openHelp(btn.getAttribute('data-help'))));
  ['help-x', 'help-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', closeHelp); });
  { const b = $('link-disclaimer'); if (b) b.addEventListener('click', e => { e.preventDefault(); openHelp('disclaimer'); }); }
}

// =====================================================================================
// document viewer (markdown of our own docs) + help
// =====================================================================================
const DOC_TITLES = {
  'GUIDE.de.md': 'footGuide', 'GUIDE.en.md': 'footGuide',
  'PRIVACY.de.md': 'footPrivacy', 'PRIVACY.md': 'footPrivacy',
  'LICENSE.de.md': 'footLicense', 'LICENSE.md': 'footLicense',
  'TRADEMARKS.de.md': 'footTrademarks', 'TRADEMARKS.md': 'footTrademarks',
  'README.md': 'footReadme'
};
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/ /g, '-');
function mdToHtml(src) {
  const inline = s => escHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text, href) => {
      if (DOC_TITLES[href]) return '<a href="' + href + '" data-docfile="' + href + '">' + text + '</a>';
      return '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
    });
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = []; let para = [], inFence = false, listKind = null;
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const closeList = () => { if (listKind) { out.push('</' + listKind + '>'); listKind = null; } };
  const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], body = l.trim();
    if (inFence) { if (body.startsWith('```')) { out.push('</code></pre>'); inFence = false; } else out.push(escHtml(l)); continue; }
    if (body.startsWith('```')) { flushPara(); closeList(); out.push('<pre><code>'); inFence = true; continue; }
    if (body === '') { flushPara(); closeList(); continue; }
    if (/^(-{3,})\s*$/.test(body)) { flushPara(); closeList(); out.push('<hr>'); continue; }
    { const bq = body.match(/^>\s?(.*)$/); if (bq) { flushPara(); closeList(); out.push('<blockquote>' + inline(bq[1]) + '</blockquote>'); continue; } }
    if (body.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test((lines[i + 1] || '').trim())) {
      flushPara(); closeList();
      out.push('<div class="doc-table"><table><thead><tr>' + cells(body).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>');
      i++;
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) out.push('<tr>' + cells(lines[++i].trim()).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>');
      out.push('</tbody></table></div>'); continue;
    }
    let m;
    if ((m = body.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); closeList(); const n = m[1].length; out.push('<h' + n + ' id="' + slug(m[2]) + '">' + inline(m[2]) + '</h' + n + '>'); continue; }
    if ((m = body.match(/^[-*]\s+(.*)$/))) { flushPara(); if (listKind !== 'ul') { closeList(); out.push('<ul>'); listKind = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
    if ((m = body.match(/^\d+\.\s+(.*)$/))) { flushPara(); if (listKind !== 'ol') { closeList(); out.push('<ol>'); listKind = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
    closeList(); para.push(body);
  }
  if (inFence) out.push('</code></pre>');
  flushPara(); closeList();
  return out.join('\n').replace(/<pre><code>\n/g, '<pre><code>');
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
    const disc = e.target.closest('[data-open-disclaimer]'); if (disc) { e.preventDefault(); openHelp('disclaimer'); return; }
    const a = e.target.closest('[data-doc], [data-docfile]'); if (!a) return;
    e.preventDefault();
    const file = a.getAttribute('data-docfile');
    if (file) openDocFile(file, a.getAttribute('data-t') || '');
    else openDocFile(docFile(a.getAttribute('data-doc')), a.getAttribute('data-t') || '');
  });
  ['doc-x', 'doc-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => { const d = $('doc'); if (d) d.close(); }); });
}
const HELP = { ctrl: ['ctrlTitle', 'ctrlHint'], expert: ['expertTitle', 'expertHint'],
  publiclog: ['publicLogLabel', 'helpPublicLog'], diaglog: ['diagLogLabel', 'helpDiagLog'],
  disclaimer: ['footDisclaimer', 'disclaimerText'] };
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
