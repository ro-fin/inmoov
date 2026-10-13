'use strict';
const $ = s => document.querySelector(s);
const KEY = 'roboattis.nano.session.v2', OLD_KEY = 'roboattis.nano.direct.v1';
const IDENTITY = 'PONG,ROBOATTIS,NANO,DIRECT,12,115200,D2-D13';
const {validProfile, validSequence, Recorder, Player, MAX_MS, MAX_EVENTS} = NanoMotion;
const cards = [], pending = new Map();
let port = null, writer = null, reader = null, readTask = null, ready = false, closing = false, connecting = false;
let heartbeat, identifyTimer, deadline, sequence = null, queue = Promise.resolve(), epoch = 0, homeCommand = false, autoHomeFirmware = false, statesRemaining = 0;
const recorder = new Recorder();
const player = new Player({dispatch: a => dispatch(a, false), onCycle: () => sync(), onError: e => emergency('Replay stopped: ' + e.message)});
const status = s => { $('#status').textContent = s; };
const angle = us => (us - 500) * 180 / 2000;
const pulse = deg => Math.round(500 + deg * 2000 / 180);
function log(s) { $('#log').textContent = ($('#log').textContent + '\n' + s).split('\n').slice(-20).join('\n'); }
function profile(c) { return {pin:c.pin, name:c.name.value, minUs:+c.min.value, maxUs:+c.max.value, restUs:+c.rest.value}; }
const profiles = () => cards.map(profile);
function apply(c, p) {
  if (!validProfile(p, c.pin)) throw Error('Invalid profile for D' + c.pin);
  c.name.value = p.name; c.min.value = p.minUs; c.max.value = p.maxUs; c.rest.value = p.restUs;
  c.slider.min = p.minUs; c.slider.max = p.maxUs; c.slider.value = p.restUs; c.saved = {...p};
}
function draw(c) {
  const us = +c.slider.value;
  c.value.textContent = angle(us).toFixed(1) + '°'; c.micro.textContent = us + ' µs';
  if (document.activeElement !== c.degrees) c.degrees.value = angle(us).toFixed(1);
  c.badge.textContent = c.enabled ? 'HOLDING / ON' : 'OUTPUT OFF'; c.el.classList.toggle('active', c.enabled);
}
function sync() {
  const playing = player.active, recording = recorder.active;
  for (const c of cards) {
    c.enable.disabled = !ready || playing || c.enabled;
    c.home.disabled = !ready || playing || +c.min.value > 1500 || +c.max.value < 1500;
    c.home.title = c.home.disabled && ready && !playing ? '1500 µs is outside this servo’s calibrated limits.' : 'Enable and hold at 90° / 1500 µs';
    c.off.disabled = !ready;
    for (const key of ['slider','degrees','minus','plus','restButton']) c[key].disabled = !ready || playing || !c.enabled;
    for (const key of ['min','max','rest','name']) c[key].disabled = c.enabled || playing || recording;
    c.enable.textContent = c.enabled ? 'Enabled' : 'Enable at rest'; draw(c);
  }
  $('#stop').disabled = !ready; $('#connect').disabled = connecting || closing;
  $('#connect').textContent = port ? 'Disconnect' : 'Connect Nano';
  $('#record').disabled = !ready || playing || recording;
  $('#record').classList.toggle('recording', recording); $('#finish').disabled = !recording;
  $('#play').disabled = !ready || playing || recording || !validSequence(sequence, profiles());
  $('#stopReplay').disabled = !playing;
  for (const key of ['save','export','import']) $('#' + key).disabled = playing || recording;
  if (sequence && !validSequence(sequence, profiles())) {
    $('#save').disabled = $('#export').disabled = true;
  }
  $('#sequenceStatus').textContent = recording ? 'Recording · ' + ((performance.now() - recorder.started) / 1000).toFixed(1) + ' s · ' + recorder.events.length + ' commands'
    : playing ? 'Replaying · loop ' + player.cycle + ' · repeats until stopped'
    : sequence ? 'Recording ready · ' + (sequence.duration / 1000).toFixed(1) + ' s · ' + sequence.events.length + ' commands' + (validSequence(sequence, profiles()) ? '' : ' · replay/save blocked: outside current limits; restore limits or record again')
    : 'No recording yet.';
}
function send(line) {
  const target = writer, token = epoch;
  const job = queue.then(async () => {
    if (!target || writer !== target || token !== epoch) return false;
    await target.write(new TextEncoder().encode(line + '\n')); return true;
  });
  queue = job.catch(e => { log(e.message); if (!closing) void disconnect(); });
  return job;
}
function clearOutputs() { pending.clear(); cards.forEach(c => { c.enabled = false; }); sync(); }
function finishRecording(flush = true) {
  if (!recorder.active) return;
  if (flush) flushPending();
  if (!recorder.active) return;
  sequence = recorder.finish(); sync();
}
function stopMotion() { player.stop(); pending.clear(); epoch++; statesRemaining = 0; finishRecording(false); }
function emergency(message = 'Emergency off: all servo pulses stopped.') {
  stopMotion(); clearOutputs(); void send('ALL_OFF').catch(() => {}); status(message);
}
async function dispatch(a, capture = true) {
  if (!ready || closing) throw Error('Nano is disconnected.');
  let line;
  if (a.type === 'ALL_OFF') { clearOutputs(); line = 'ALL_OFF'; }
  else {
    const c = cards[a.pin - 2];
    if (!c) throw Error('Invalid servo pin.');
    pending.delete(a.pin);
    if (a.type === 'OFF') { c.enabled = false; line = 'OFF,' + a.pin; }
    else {
      if (a.type !== 'SET' || !Number.isInteger(a.us) || a.us < +c.min.value || a.us > +c.max.value) throw Error('Position exceeds limits for D' + a.pin);
      c.enabled = true; c.slider.value = a.us;
      line = a.home && homeCommand ? 'HOME,' + a.pin : 'SET,' + a.pin + ',' + a.us;
    }
  }
  if (capture && recorder.active && !recorder.capture(a)) {
    finishRecording(false); status('Recording limit reached. Movement remains under manual control.');
  }
  sync(); return send(line);
}
function manual(a) { if (ready && !player.active) void dispatch(a).catch(e => emergency(e.message)); }
function flushPending() {
  const actions = [...pending]; pending.clear();
  for (const [pin, us] of actions) if (ready && cards[pin - 2].enabled && !player.active) manual({type:'SET',pin,us});
}
async function disconnect() {
  if (closing) return;
  closing = true; ready = false; stopMotion(); clearOutputs();
  clearInterval(heartbeat); clearInterval(identifyTimer); clearTimeout(deadline);
  const oldPort = port, oldWriter = writer, oldReader = reader;
  try { await send('ALL_OFF'); } catch (e) { log(e.message); }
  try { if (oldReader) await oldReader.cancel(); if (readTask) await readTask; } catch (e) { log(e.message); }
  try { if (oldWriter) oldWriter.releaseLock(); } catch (e) { log(e.message); }
  writer = null;
  try { if (oldPort) await oldPort.close(); } catch (e) { log(e.message); }
  port = null; reader = null; readTask = null; queue = Promise.resolve(); closing = false; connecting = false; sync();
  status('Disconnected. Outputs off. Firmware also stops pulses after 2 seconds without contact.');
}
function receive(line) {
  if ((line === IDENTITY || line === IDENTITY + ',V2,HOME90' || line === IDENTITY + ',V3,AUTOHOME90') && !ready && !closing) {
    clearInterval(identifyTimer); clearTimeout(deadline); autoHomeFirmware = line.endsWith(',V3,AUTOHOME90');
    homeCommand = autoHomeFirmware || line.endsWith(',V2,HOME90');
    clearOutputs(); statesRemaining = autoHomeFirmware ? 12 : 0; void send(autoHomeFirmware ? 'STATUS' : 'ALL_OFF').catch(() => {}); ready = true; connecting = false;
    heartbeat = setInterval(() => { void send('HEARTBEAT').catch(() => {}); }, 500);
    sync(); status('Nano verified · D2–D13 ready · ' + (autoHomeFirmware ? 'firmware v3 · automatic home on startup' : homeCommand ? 'firmware v2' : 'legacy firmware (90° home uses SET)'));
  } else if (ready && autoHomeFirmware && statesRemaining > 0 && /^STATE,\d+,\d+$/.test(line)) {
    const [,pinText,usText] = line.split(','); const c = cards[+pinText - 2], us = +usText;
    if (!c || (us !== 0 && (us < +c.min.value || us > +c.max.value))) return emergency('Reported position is outside saved limits. Outputs off.');
    statesRemaining--; c.enabled = us !== 0; if (us) c.slider.value = us; sync();
  } else if (line.startsWith('TIMEOUT') || line.startsWith('ERR')) emergency('Controller stopped: ' + line);
  else if (ready && line === 'BOOT,AUTOHOME90') emergency('Nano restarted during control. Outputs off; enable a servo to resume.');
  else if (ready && !autoHomeFirmware && line.startsWith(IDENTITY)) emergency('Nano restarted. Outputs off; enable a servo to resume.');
  if (!line.startsWith('OK,') && !line.startsWith(IDENTITY)) log(line);
}
async function readLoop(target) {
  const decoder = new TextDecoder(); let buf = ''; const currentReader = target.readable.getReader(); reader = currentReader;
  try {
    while (true) {
      const {value, done} = await currentReader.read(); if (done) break;
      buf += decoder.decode(value, {stream:true}); const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines) if (line) receive(line);
      if (buf.length > 2048) throw Error('Invalid serial response.');
    }
  } catch (e) { log(e.message); }
  finally { currentReader.releaseLock(); if (reader === currentReader) reader = null; if (!closing) setTimeout(() => { void disconnect(); }, 0); }
}
$('#connect').onclick = async () => {
  if (port) return disconnect();
  if (!navigator.serial) return status('Open this page in Microsoft Edge or Google Chrome for USB serial.');
  connecting = true; sync();
  try {
    port = await navigator.serial.requestPort(); await port.open({baudRate:115200}); writer = port.writable.getWriter();
    status('Waiting for Nano firmware identity…'); readTask = readLoop(port);
    identifyTimer = setInterval(() => { void send('PING').catch(() => {}); }, 700);
    deadline = setTimeout(() => { log('Nano identity not received.'); void disconnect(); }, 10000);
    await send('PING');
  } catch (e) { if (port) await disconnect(); status('Connection failed: ' + e.message); connecting = false; sync(); }
};
for (let pin = 2; pin <= 13; pin++) {
  const el = document.createElement('article');
  el.innerHTML = `<div class="cardtop"><h2>D${pin}</h2><span class="badge"></span></div><label>Servo name<input class="name" maxlength="80"></label><div class="readout"><b class="value"></b> <span class="micro"></span></div><input class="slider" aria-label="D${pin} pulse position" type="range" step="1"><div class="position"><button class="minus" aria-label="D${pin} minus one degree">−1°</button><label>Angle <input class="degrees" type="number" min="0" max="180" step="0.1"></label><button class="plus" aria-label="D${pin} plus one degree">+1°</button></div><div class="actions"><button class="home">Home 90°</button><button class="off danger">Off</button></div><div class="actions"><button class="enable primary">Enable at rest</button><button class="restButton">Rest</button></div><details><summary>Pulse calibration</summary><div class="limits"><label>Minimum µs<input class="min" type="number" min="500" max="2499" step="1"></label><label>Maximum µs<input class="max" type="number" min="501" max="2500" step="1"></label></div><label>Rest µs<input class="rest" type="number" min="500" max="2500" step="1"></label><div class="hint">Edit limits while this servo is off. Home is always 1500 µs and is blocked if outside your limits.</div></details>`;
  $('#cards').append(el); const c = {pin, el, enabled:false};
  for (const key of ['name','slider','degrees','minus','plus','home','enable','off','restButton','min','max','rest','value','micro','badge']) c[key] = el.querySelector('.' + key);
  cards.push(c); apply(c, {pin,name:'Servo D' + pin,minUs:1000,maxUs:2000,restUs:1500});
  c.home.onclick = () => manual({type:'SET',pin,us:1500,home:true});
  c.enable.onclick = () => manual({type:'SET',pin,us:+c.rest.value});
  c.restButton.onclick = () => manual({type:'SET',pin,us:+c.rest.value});
  c.off.onclick = () => {
    if (player.active) { player.stop(); epoch++; pending.clear(); status('Replay stopped. D' + pin + ' off; other servos hold their positions.'); }
    manual({type:'OFF',pin});
  };
  c.slider.oninput = () => { if (ready && c.enabled && !player.active) pending.set(pin, +c.slider.value); draw(c); };
  function setAngle(deg) {
    if (!Number.isFinite(deg)) return draw(c);
    const us = Math.max(+c.min.value, Math.min(+c.max.value, pulse(deg)));
    manual({type:'SET',pin,us}); c.degrees.value = angle(us).toFixed(1);
  }
  c.degrees.onchange = () => setAngle(c.degrees.value === '' ? NaN : +c.degrees.value);
  c.minus.onclick = () => setAngle(angle(+c.slider.value) - 1); c.plus.onclick = () => setAngle(angle(+c.slider.value) + 1);
  for (const input of [c.min,c.max,c.rest,c.name]) input.onchange = () => {
    const p = profile(c);
    if (validProfile(p,pin)) apply(c,p);
    else { apply(c,c.saved); status('Use 500–2500 µs, minimum below maximum, and rest within limits.'); }
    sync();
  };
}
$('#stop').onclick = () => emergency();
$('#record').onclick = () => {
  if (!ready || player.active || recorder.active) return;
  flushPending(); recorder.start(cards.filter(c => c.enabled).map(c => ({type:'SET',pin:c.pin,us:+c.slider.value})));
  status('Recording started. Move servos and pause as needed, then click Finish recording.'); sync();
};
$('#finish').onclick = () => { finishRecording(); status('Recording finished. Replay in loop is ready.'); };
$('#play').onclick = () => {
  if (!ready || recorder.active || !validSequence(sequence,profiles())) return;
  pending.clear(); epoch++; player.start(sequence); sync(); status('Replaying continuously. Stop replay holds position; Emergency off stops all pulses.');
};
$('#stopReplay').onclick = () => { player.stop(); epoch++; pending.clear(); sync(); status('Replay stopped. Servos hold the last commanded position.'); };
function session() { return {format:'RoboAttis-Nano-Direct',version:2,servos:profiles(),sequence}; }
function loadSession(j) {
  if (!j || j.format !== 'RoboAttis-Nano-Direct' || ![1,2].includes(j.version) || !Array.isArray(j.servos) || j.servos.length !== 12 || !j.servos.every((p,i) => validProfile(p,i+2))) throw Error('Expected Nano profiles for D2–D13.');
  if (j.sequence != null && !validSequence(j.sequence,j.servos)) throw Error('Recording has invalid timing, pins or positions outside the servo limits.');
  stopMotion(); clearOutputs(); if (writer) void send('ALL_OFF').catch(() => {});
  j.servos.forEach((p,i) => apply(cards[i],p)); sequence = j.sequence || null; sync();
}
$('#save').onclick = () => { try { localStorage.setItem(KEY,JSON.stringify(session())); status('Session saved in this browser: profiles and recording.'); } catch (e) { status('Could not save: ' + e.message + '. Use Export JSON.'); } };
$('#export').onclick = () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(session(),null,2)],{type:'application/json'}));
  a.download = 'inmoov-nano-session.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href),1000);
};
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  try { const f = e.target.files[0]; if (!f) return; if (f.size > 4000000) throw Error('Session file exceeds 4 MB.'); loadSession(JSON.parse(await f.text())); status('Session imported. Outputs off.'); }
  catch (err) { status(err.message); } finally { e.target.value = ''; }
};
try {
  const saved = localStorage.getItem(KEY), old = localStorage.getItem(OLD_KEY);
  if (saved) loadSession(JSON.parse(saved)); else if (old) loadSession({format:'RoboAttis-Nano-Direct',version:1,servos:JSON.parse(old)});
} catch (e) { log('Saved session could not be loaded: ' + e.message); }
setInterval(flushPending,40);
setInterval(() => {
  if (recorder.active && (performance.now() - recorder.started >= MAX_MS || recorder.events.length >= MAX_EVENTS)) { finishRecording(); status('Recording limit reached. Recording is ready.'); }
  if (recorder.active) sync();
},100);
navigator.serial?.addEventListener('disconnect',e => { if (!e.target || e.target === port || e.port === port) void disconnect(); });
document.addEventListener('visibilitychange',() => { if (document.hidden && (player.active || recorder.active)) emergency('Recording/replay stopped and outputs off because the tab was hidden.'); });
window.addEventListener('pagehide',() => { if (writer) emergency('Page closed. Outputs off.'); });
sync();
