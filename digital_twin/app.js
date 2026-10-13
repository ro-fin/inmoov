import * as THREE from 'three';
import {Stage} from './stage.js';
import {InMoovTwin, JOINTS, JOINT, HARDWARE, kindLabel, COLORS} from './twin.js';
import {MotionPlayer, GESTURES} from './motion.js';
import {SparesBay, GUIDES, fmt} from './spares.js';
import {offsetFromPulse,pulseFromOffset,rawCommand,pulseToVisual,visualToPulse} from './safety-controls.js';
import {controlAccess,handSignAccess} from './control-access.js';

const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const PINS = [2, 3, 4, 5, 6, 7, 8, 9];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Controller link (unchanged protocol with twin_server.py) ────────────────
let token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('studio-token') || '';
const requestedTab = new URLSearchParams(location.hash.slice(1)).get('tab');
const calibrationLaunch = new URLSearchParams(location.hash.slice(1)).get('view')==='calibrator';
sessionStorage.setItem('studio-token', token);
history.replaceState(null, '', location.pathname);
const heartbeatWorker = new Worker('./link-heartbeat.js');
heartbeatWorker.postMessage({token});
addEventListener('pagehide', () => heartbeatWorker.terminate(), {once:true});
const defaults = HARDWARE.map((id, i) => ({name: JOINT[id].label, pin: PINS[i], minUs: 500, maxUs: 2500, restUs: 1500}));
let state = {ready: false, busy: false, profiles: defaults, positions: Array(8).fill(1500), enabled: Array(8).fill(false), acknowledged: Array(8).fill(null), confirmedEnabled: Array(8).fill(false), activity: [], ports: [], session: null};
let online = false, preview = true;
let sessionAuthorized = !!token;

// Servo angle scale per wired joint (degrees at min / max pulse) — same storage as before.
let servoRanges = Array.from({length: 8}, () => [0, 270]), sliderSteps = Array(8).fill(1);
try { const s = JSON.parse(localStorage.getItem('inmoov-servo-sliders')); if (s?.ranges?.length === 8 && s?.steps?.length === 8 && s.ranges.every(r => Array.isArray(r) && r.length === 2 && r.every(a => Number.isFinite(a) && Math.abs(a) <= 360) && r[0] !== r[1]) && s.steps.every(x => Number.isFinite(x) && x >= .1 && x <= 10)) { servoRanges = s.ranges; sliderSteps = s.steps; } } catch {}
// Twin calibration: joint degrees at min / max pulse for each wired joint.
let mapping = HARDWARE.map(id => ({leftOmoplate: [0, 80], leftRotate: [-70, 70], leftShoulder: [-30, 150], leftBicep: [0, 95]})[id.replace('right', 'left')]);
try { const m = JSON.parse(localStorage.getItem('inmoov-twin-mapping-v1')); if (Array.isArray(m) && m.length === 8 && m.every(a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) && a[0] !== a[1])) mapping = m; } catch {}
// Left-arm visual homes now coincide with the neutral model pose.
mapping.splice(0,4,[80,0],[70,-70],[150,-30],[95,0]);
try {const m=JSON.parse(localStorage.getItem('inmoov-home-anchored-twin-v1'));if(Array.isArray(m)&&m.length===4&&m.every(a=>Array.isArray(a)&&a.length===2&&a.every(Number.isFinite)&&a[0]>0&&a[1]<=0))mapping.splice(0,4,...m);}catch{}

const directionT = (i, t) => state.profiles[i].reversed ? 1 - t : t;
const safetyRule = i => state.safety?.find(r=>r.pin===PINS[i]);
const pulseToServo = (i, us) => { const safe=safetyRule(i); if(safe) return offsetFromPulse(safe,us); const p = state.profiles[i], r = servoRanges[i]; return r[0] + directionT(i, (us - p.minUs) / (p.maxUs - p.minUs)) * (r[1] - r[0]); };
const servoToT = (i, deg) => { const r = servoRanges[i]; return (deg - r[0]) / (r[1] - r[0]); };
const tToTwin = (i, t) => safetyRule(i) ? pulseToVisual(safetyRule(i),500+2000*t,mapping[i]) : mapping[i][0] + t * (mapping[i][1] - mapping[i][0]);
const twinToT = (i, a) => safetyRule(i) ? (visualToPulse(safetyRule(i),a,mapping[i])-500)/2000 : (a - mapping[i][0]) / (mapping[i][1] - mapping[i][0]);
const angleRange = i => safetyRule(i) ? undefined : (state.profiles[i].reversed ? [...servoRanges[i]].reverse() : servoRanges[i]).map(a => Math.round(a * 1000));
const valuePulse = (i,v) => { const safe=safetyRule(i),p=state.profiles[i]; return safe ? pulseFromOffset(safe,v) : Math.round(p.minUs+directionT(i,clamp(servoToT(i,v),0,1))*(p.maxUs-p.minUs)); };
const pulseTwinT = (i,us) => safetyRule(i) ? clamp((us-500)/2000,0,1) : directionT(i,clamp((us-state.profiles[i].minUs)/(state.profiles[i].maxUs-state.profiles[i].minUs),0,1));

let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4200); }
async function request(action, extra = {}) {
  const response = await fetch('/api/action', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Studio-Token': token}, body: JSON.stringify({action, ...extra}), signal: AbortSignal.timeout(5000)});
  const result = await response.json(); if (!response.ok) {if(response.status===403){sessionAuthorized=false;online=false;update();}throw Error(result.error || 'Controller unavailable');}
  sessionAuthorized=true;
  state = result; online = true; update(); return result;
}
let queuedMove = null, moveInFlight = false, moveTimer;
function cancelQueuedMove() { clearTimeout(moveTimer); queuedMove = null; }
async function send(action, extra = {}) { if (['emergency', 'off', 'disconnect', 'home', 'enable', 'play', 'import','gesture','gesture_stop','gesture_home'].includes(action)) cancelQueuedMove(); if(['emergency','off','disconnect','import','gesture_stop'].includes(action)) $('gestureHomeConfirmed').checked=false; try { return await request(action, extra); } catch (e) { cancelQueuedMove(); toast(e.message); return null; } }
async function flushMove() {
  if (moveInFlight) return;
  if (!queuedMove || preview || !online || !state.ready) { queuedMove = null; return; }
  const next = queuedMove; queuedMove = null; moveInFlight = true;
  try { if (state.enabled[next.index] && !state.playing) await send('move', next); }
  finally { moveInFlight = false; if (queuedMove) moveTimer = setTimeout(flushMove, 16); }
}
let pollFailures = 0;
async function poll() {
  const requestToken=token;
  try {
    const r = await fetch('/api/state', {headers: {'X-Studio-Token': requestToken}, cache: 'no-store', signal: AbortSignal.timeout(1500)});
    if(requestToken!==token){setTimeout(poll,0);return;}
    if (!r.ok) {if(r.status===403)sessionAuthorized=false;throw Error('Open Studio from its launcher to control the robot.');}
    sessionAuthorized=true;
    state = await r.json(); online = true; pollFailures = 0; if (state.busy && preview) setMode(false); update();
  } catch (e) { if(requestToken!==token){setTimeout(poll,0);return;} online = false; pollFailures++; if (pollFailures === 1 || pollFailures % 25 === 0) update(); $('status').textContent = !sessionAuthorized ? 'Restore control session using a one-time pairing code.' : 'Controller connection lost. Robot controls are disabled.'; }
  setTimeout(poll, online ? 80 : 800);
}
$('pairSessionForm').onsubmit=async e=>{
  e.preventDefault();
  const code=$('pairSessionCode').value.trim();
  if(!/^[0-9]{8}$/.test(code))return;
  $('pairSessionSubmit').disabled=true;
  try{
    const response=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),signal:AbortSignal.timeout(5000)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Pairing failed.');
    token=result.token;
    sessionStorage.setItem('studio-token',token);
    heartbeatWorker.postMessage({token});
    sessionAuthorized=true;
    $('pairSessionCode').value='';
    $('pairSessionStatus').textContent='Paired. Checking the controller connection…';
    setFull(false);setTab('control');
    toast('Control session restored. Servo outputs have not been changed.');
  }catch(error){$('pairSessionStatus').textContent=error.message;}
  finally{$('pairSessionSubmit').disabled=false;}
};

// ── Stage, twin, spares ─────────────────────────────────────────────────────
const stage = new Stage($('viewport'));
$('viewport').addEventListener('render-status',e=>{
  $('renderStatus').textContent=e.detail;
  $('renderStatus').hidden=!e.detail;
});
const twin = new InMoovTwin();
try {const directions=JSON.parse(localStorage.getItem('inmoov-twin-directions-v1'));if(directions&&typeof directions==='object')for(const [id,reversed] of Object.entries(directions))if(HARDWARE.includes(id)&&typeof reversed==='boolean')twin.setVisualReversed(id,reversed);}catch{}
const bay = new SparesBay(stage);
const motion = new MotionPlayer(twin);
stage.scene.add(twin.root);
const targets = Object.fromEntries(JOINTS.map(j => [j.id, 0]));
const visual = Object.fromEntries(JOINTS.map(j => [j.id, 0]));
let selected = 'leftOmoplate', ready = false, demo = false, demoStart = 0, dragging = false;
let activeJoint = null, activeUntil = 0, lastAckId = 0;
const hw = id => HARDWARE.indexOf(id);

// ── Mode ────────────────────────────────────────────────────────────────────
function setMode(value) {
  if (value && state.busy) { toast('Disconnect the robot before returning to Preview.'); return; }
  motion.stop(); demo = false; preview = value; cancelQueuedMove();
  if (!preview) for (const j of JOINTS) if (hw(j.id) < 0) targets[j.id] = 0;
  update();
}
$('modePreview').onclick = () => setMode(true);
$('modeRobot').onclick = () => setMode(false);

// ── Joint browser ───────────────────────────────────────────────────────────
const GROUPS = [['left', 'Left arm'], ['right', 'Right arm'], ['head', 'Head & neck'], ['torso', 'Torso'], ['leftHand', 'Left hand'], ['rightHand', 'Right hand']];
const jointButtons = {};
for (const [g, label] of GROUPS) {
  const joints = JOINTS.filter(j => j.group === g), wired = joints.filter(j => hw(j.id) >= 0).length;
  const d = document.createElement('details');
  d.className = 'jgroup'; d.open = g === 'left' || g === 'right'; d.dataset.group = g;
  d.innerHTML = `<summary>${label} <small>${wired ? wired + ' wired · ' : ''}${joints.length} joints</small><svg class="icon chev"><use href="#i-chev"/></svg></summary><div class="jlist"></div>`;
  for (const j of joints) {
    const i = hw(j.id), b = document.createElement('button');
    b.className = 'jbtn' + (i >= 0 ? ' hw' : ''); b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="row"><b>${j.label.replace(/^(Left|Right) /, '')}</b>${i >= 0 ? `<span class="chip pin">D${PINS[i]}</span>` : ''}<span class="val">0°</span></span><span class="bar"><i></i></span>`;
    b.onclick = () => select(j.id);
    d.querySelector('.jlist').append(b);
    jointButtons[j.id] = b;
  }
  $('jointBrowser').append(d);
}
for (const j of JOINTS) { const o = document.createElement('option'); o.value = j.id; o.textContent = j.label + (hw(j.id) >= 0 ? ` · D${PINS[hw(j.id)]}` : ''); $('immJoint').append(o); }
$('immJoint').onchange = e => select(e.target.value);
for(const id of HARDWARE){const option=document.createElement('option');option.value=id;option.textContent=`D${PINS[hw(id)]} · ${JOINT[id].label}`;$('calibrationJoint').append(option);}
$('calibrationJoint').onchange=e=>select(e.target.value);

function select(id, reveal = true) {
  if (!JOINT[id]) return;
  selected = id;
  for (const [k, b] of Object.entries(jointButtons)) b.setAttribute('aria-pressed', k === id);
  if (reveal) { const d = jointButtons[id].closest('details'); if (!d.open) d.open = true; }
  fillCalibration(); update();
}
function fillCalibration() {
  const i = hw(selected); if (i < 0) return;
  const p = state.profiles[i];
  $('minUs').value = p.minUs; $('maxUs').value = p.maxUs; $('restUs').value = p.restUs;
  const safe=safetyRule(i);
  $('sMin').value = safe ? safe.offsetMin : servoRanges[i][0]; $('sMax').value = safe ? safe.offsetMax : servoRanges[i][1]; $('sStep').value = sliderSteps[i];
  $('mMin').value = mapping[i][0]; $('mMax').value = mapping[i][1];
}

// Slider semantics: wired joints use servo degrees; others use twin degrees.
function sliderSpec(id) {
  const i = hw(id);
  const safe=safetyRule(i);
  if(safe) {const p=state.profiles[i];return {min:Math.max(safe.offsetMin,offsetFromPulse(safe,p.maxUs)),max:Math.min(safe.offsetMax,offsetFromPulse(safe,p.minUs)),step:sliderSteps[i],unit:'offset'};}
  if (i >= 0) { const r = servoRanges[i]; return {min: Math.min(...r), max: Math.max(...r), step: sliderSteps[i], unit: 'servo'}; }
  const j = JOINT[id]; return {min: j.min, max: j.max, step: 1, unit: 'twin'};
}
function currentValue(id) {
  const i = hw(id);
  if (i < 0) return targets[id];
  if (!preview) return pulseToServo(i, state.positions[i]);
  if(safetyRule(i)) { const spec=sliderSpec(id); return clamp(pulseToServo(i,500+twinToT(i,targets[id])*2000),spec.min,spec.max); }
  return servoRanges[i][0] + twinToT(i, targets[id]) * (servoRanges[i][1] - servoRanges[i][0]);
}
function change(value, id = selected) {
  motion.stop(); demo = false;
  const spec = sliderSpec(id), v = clamp(Math.round((value - spec.min) / spec.step) * spec.step + spec.min, spec.min, spec.max);
  const i = hw(id);
  if (i < 0) { if (!preview) return; targets[id] = v; pulse(id, 700); update(); return; }
  const t = servoToT(i, v);
  if (preview) { targets[id] = tToTwin(i, safetyRule(i) ? pulseTwinT(i,valuePulse(i,v)) : t); pulse(id, 700); update(); return; }
  const p = state.profiles[i];
  queuedMove = {index: i, us: valuePulse(i,v), angleRange: angleRange(i)};
  flushMove();
}
function pulse(id, ms) { activeJoint = id; activeUntil = performance.now() + ms; }
function home(id = selected) {
  const i = hw(id);
  if (i < 0) return change(0, id);
  if (preview) return change(pulseToServo(i, state.profiles[i].restUs), id);
  send('home', {index: i, angleRange: angleRange(i)});
}
$('jSlider').addEventListener('pointerdown', () => dragging = true);
$('immSlider').addEventListener('pointerdown', () => dragging = true);
addEventListener('pointerup', () => dragging = false);
$('jSlider').oninput = e => change(+e.target.value);
$('immSlider').oninput = e => change(+e.target.value);
for (const [btn, dir] of [['jMinus', -1], ['jPlus', 1], ['immMinus', -1], ['immPlus', 1]]) $(btn).onclick = () => change(+$('jSlider').value + dir * sliderSpec(selected).step * (btn.startsWith('imm') ? 5 : 1));
$('jHome').onclick = () => home(); $('immHome').onclick = () => home();
$('jEnable').onclick = () => { const i = hw(selected); if (i >= 0) send('enable', {index: i, angleRange: angleRange(i)}); };
$('jRelease').onclick = () => { const i = hw(selected); if (i >= 0) send('off', {index: i}); };
$('immEnable').onclick=()=>$('jEnable').click();
$('immRelease').onclick=()=>$('jRelease').click();
$('immRobotMode').onclick=()=>setMode(false);
$('immConnect').onclick=()=>$('connectBtn').click();
$('immMotion').onclick=()=>{setFull(false);setTab('motion');};
$('jApply').onclick = () => { const a = Number($('jAngle').value),spec=sliderSpec(selected); if (!Number.isFinite(a) || a < spec.min || a > spec.max) return toast('Use a value inside the safe slider range.'); change(a); };
$('applyLimits').onclick = async () => { const i = hw(selected), data = {index: i}; for (const k of ['minUs', 'maxUs', 'restUs']) data[k] = Number($(k).value); if (await send('calibrate', data)) toast('Limits updated. Save the session to keep them.'); };
$('setHome').onclick = () => send('sethome', {index: hw(selected)});
$('reverseServo').onchange = async e => {
  const i = hw(selected), p = state.profiles[i], reversed = e.target.checked;
  if (i < 0 || state.enabled[i] || state.recording || state.playing) { update(); return toast('Release the joint before changing direction.'); }
  cancelQueuedMove();
  if (await send('calibrate', {index:i,minUs:p.minUs,maxUs:p.maxUs,restUs:p.restUs,reversed})) {
    toast(JOINT[selected].label + (reversed ? ' direction reversed.' : ' direction normal.') + ' Save the session to keep it.');
  }
  update();
};
$('saveScale').onclick = () => {
  const i = hw(selected), r = [Number($('sMin').value), Number($('sMax').value)], s = Number($('sStep').value);
  if (state.enabled[i] || state.recording || state.playing) return toast('Release the joint before changing its angle scale.');
  if(safetyRule(i)) {if(!Number.isFinite(s)||s<.1||s>10) return toast('Choose a step from 0.1 to 10.'); sliderSteps[i]=s;localStorage.setItem('inmoov-servo-sliders',JSON.stringify({ranges:servoRanges,steps:sliderSteps}));update();return toast('Step saved. Safety endpoints and home zero are fixed.');}
  if (!r.every(a => Number.isFinite(a) && Math.abs(a) <= 360) || Math.abs(r[1] - r[0]) < .1 || !Number.isFinite(s) || s < .1 || s > 10 || s > Math.abs(r[1] - r[0])) return toast('Use distinct endpoints within −360° to 360° and a step from 0.1° to 10°.');
  cancelQueuedMove(); servoRanges[i] = r; sliderSteps[i] = s;
  localStorage.setItem('inmoov-servo-sliders', JSON.stringify({ranges: servoRanges, steps: sliderSteps})); update(); toast('Servo scale saved. Pulse limits unchanged.');
};
$('saveMap').onclick = () => {
  const i = hw(selected), j = JOINT[selected], v = [Number($('mMin').value), Number($('mMax').value)];
  if (Math.round(v[0] * 100) === Math.round(v[1] * 100) || !v.every(x => Number.isFinite(x) && x >= j.min - 60 && x <= j.max + 60)) return toast(`Use two different angles near the joint range (${j.min}° to ${j.max}°).`);
  if(safetyRule(i)&&(v[0]<=0||v[1]>0)) return toast('For the left arm, minimum pulse is the positive lift/outward endpoint; maximum pulse is zero or negative. Home stays at 0°.');
  mapping[i] = v; localStorage.setItem('inmoov-twin-mapping-v1', JSON.stringify(mapping)); update(); toast('Twin calibration saved on this computer.');
  if(safetyRule(i))localStorage.setItem('inmoov-home-anchored-twin-v1',JSON.stringify(mapping.slice(0,4)));
};
$('reverseTwin').onchange=e=>{
  if(hw(selected)<0) return;
  twin.setVisualReversed(selected,e.target.checked);
  localStorage.setItem('inmoov-twin-directions-v1',JSON.stringify(twin.visualReversed));
  toast('Twin direction updated. Servo commands are unchanged.');
};
$('estop').onclick = $('immStop').onclick = () => { cancelQueuedMove(); send('emergency'); };

// ── Connection & session ────────────────────────────────────────────────────
function fillPorts() { const sel = $('portSelect'), old = sel.value; sel.replaceChildren(); for (const p of state.ports) { const o = document.createElement('option'); o.value = o.textContent = p; sel.append(o); } if (state.ports.includes(old)) sel.value = old; else if (state.port && state.ports.includes(state.port)) sel.value = state.port; $('connectNow').disabled = !state.ports.length; }
$('connectBtn').onclick = async () => { if (!online) return toast('Open Studio from its launcher to connect the Nano.'); if (state.busy) { await send('disconnect'); return; } await send('refresh'); fillPorts(); $('connectDialog').showModal(); };
$('refreshPorts').onclick = async () => { await send('refresh'); fillPorts(); };
$('connectNow').onclick = async () => { setMode(false); if (await send('connect', {port: $('portSelect').value,mode:$('serialMode').value})) $('connectDialog').close(); };
$('menuBtn').onclick = () => $('menuDialog').showModal();
$('save').onclick = async () => { if (await send('save')) toast('Session saved.'); };
$('export').onclick = () => { if (!state.session) return toast('Controller unavailable.'); const url = URL.createObjectURL(new Blob([JSON.stringify(state.session, null, 2)], {type: 'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'inmoov-session.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('importBtn').onclick = () => $('import').click();
$('import').onchange = async e => { try { const f = e.target.files[0]; if (!f) return; if (f.size > 4e6) throw Error('Session file exceeds 4 MB.'); if (await send('import', {session: JSON.parse(await f.text())})) { fillCalibration(); toast('Session imported; outputs off.'); } } catch (err) { toast(err.message); } finally { e.target.value = ''; } };
for (const id of ['record', 'finish', 'play', 'hold']) $(id).onclick = () => send(id);
$('loop').onchange = e => send('loop', {value: e.target.checked});
async function startHandSign(name) {
  if(preview||!online||!state.ready) return toast('Connect the Nano in Robot mode first.');
  if(state.playing||state.recording) return toast('Stop the current motion before choosing another sign.');
  motion.stop();demo=false;
  await send('gesture',{name,loop:$('gestureLoop').checked,confirmedHome:$('gestureHomeConfirmed').checked});
}
document.querySelectorAll('[data-robot-gesture]').forEach(b=>b.onclick=()=>startHandSign(b.dataset.robotGesture));
$('gestureStop').onclick=()=>send('gesture_stop');
$('gestureHome').onclick=()=>send('gesture_home',{confirmedHome:$('gestureHomeConfirmed').checked});
$('gestureLoop').onchange=e=>{if(state.gesture?.active)send('gesture_loop',{value:e.target.checked});};
$('restoreSafety').onclick=async()=>{if(await send('restore_safety')) {await send('save');fillCalibration();toast('Tested left-arm settings restored and saved.');}};
$('gestureHomeConfirmed').onchange=()=>update();
function prepareRobotControls(){
  if(!sessionAuthorized||!online)return toast('Open the calibrator from its launcher to restore the control session.');
  if(preview)setMode(false);
  if(!state.ready&&!state.busy)$('connectBtn').click();
}
$('calibrationSetup').onclick=prepareRobotControls;
$('calibrationSave').onclick=()=>$('save').click();
$('gestureSetup').onclick=()=>{prepareRobotControls();if(state.ready&&!preview)$('gestureHomeConfirmed').focus();};
$('showHandSigns').onclick=()=>$('liveSigns').scrollIntoView({behavior:'smooth',block:'start'});

// ── Tabs ────────────────────────────────────────────────────────────────────
let tab = 'control';
function setTab(next) {
  tab = next;
  document.body.dataset.workspace=next;
  $(next==='motion'?'motionSignsHost':'calibrationSignsHost').append($('liveSigns'));
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === next));
  document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== next);
  if (next !== 'spares') closeBay();
  if (next !== 'inspect') stopMeasure();
  update();
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));

// ── Viewport tools ──────────────────────────────────────────────────────────
const setOn = (id, on) => $(id).classList.toggle('on', on);
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { if (bay.group.visible) closeBay(); stage.view(b.dataset.view); document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b)); });
$('tFit').onclick = () => stage.view('front');
$('tOrbit').onclick = () => { stage.controls.autoRotate = !stage.controls.autoRotate; stage.controls.autoRotateSpeed = 1.2; setOn('tOrbit', stage.controls.autoRotate); };
function setXray(on) { twin.setXray(on); setOn('tXray', on); $('xrayToggle').checked = on; }
$('tXray').onclick = () => setXray(!twin.xray); $('xrayToggle').onchange = e => setXray(e.target.checked);
function setGrid(on) { stage.grid.visible = on; setOn('tGrid', on); $('gridToggle').checked = on; }
$('tGrid').onclick = () => setGrid(!stage.grid.visible); $('gridToggle').onchange = e => setGrid(e.target.checked);
$('explode').oninput = e => { twin.explode(+e.target.value); refreshDims(); };

const dimGroup = new THREE.Group(); stage.scene.add(dimGroup);
let dimsOn = false;
function refreshDims() {
  stage.clearGroup(dimGroup);
  if (!dimsOn || !ready) return;
  for (const l of Object.values(twin.measure.lines)) if (l.a) dimGroup.add(stage.dimension(twin.toWorld(l.a), twin.toWorld(l.b), `${l.mm} mm`));
}
function setDims(on) { dimsOn = on; setOn('tDims', on); $('dimToggle').checked = on; if (on && twin.explodeAmount) { $('explode').value = 0; twin.explode(0); } refreshDims(); }
$('tDims').onclick = () => setDims(!dimsOn); $('dimToggle').onchange = e => setDims(e.target.checked);

async function setScene(mode) {
  $('tScene').disabled = $('immScene').disabled = true;
  try { await stage.setMode(mode); } catch (e) { toast('Cabin could not load: ' + e.message); } finally { $('tScene').disabled = $('immScene').disabled = false; }
  twin.root.position.copy(stage.anchor);
  for (const b of [$('tScene'), $('immScene')]) b.querySelector('span').textContent = stage.mode === 'cabin' ? 'Studio' : 'Cabin';
  $('sceneTitle').textContent = stage.mode === 'cabin' ? 'Finstein · Executive cabin' : 'InMoov · 1 : 1 digital twin';
  $('profile').hidden = true;
  refreshDims(); stopMeasure();
  stage.view(stage.mode === 'cabin' ? 'three' : 'front');
}
$('tScene').onclick = $('immScene').onclick = () => setScene(stage.mode === 'cabin' ? 'studio' : 'cabin');

// Full view
let fullView = false;
function setFull(on) {
  fullView = on; document.body.classList.toggle('immersive', on);
  sessionStorage.setItem('inmoov-full-view',String(on));
  $('immPanel').hidden=true;
  setOn('tFull', on); requestAnimationFrame(() => {stage.resize();if(on&&ready)stage.frameBody(new THREE.Box3().setFromObject(twin.root));});
  if (on) $('backStudio').focus();
}
$('tFull').onclick = () => setFull(true); $('backStudio').onclick = () => setFull(false);
$('immControls').onclick=()=>$('immPanel').hidden=!$('immPanel').hidden;
$('immControlsClose').onclick=()=>$('immPanel').hidden=true;

// ── Picking, measuring, inspecting ──────────────────────────────────────────
let measuring = false, measurePts = [], measureMarks = new THREE.Group(), measures = [];
stage.scene.add(measureMarks);
function startMeasure() { measuring = true; measurePts = []; $('measureHint').hidden = false; setOn('tMeasure', true); $('mStart').textContent = 'Measuring…'; stage.renderer.domElement.style.cursor = 'crosshair'; }
function stopMeasure() { measuring = false; measurePts = []; $('measureHint').hidden = true; setOn('tMeasure', false); $('mStart').textContent = 'Start measuring'; stage.renderer.domElement.style.cursor = ''; }
$('tMeasure').onclick = () => { if (measuring) return stopMeasure(); setTab('inspect'); startMeasure(); };
$('mStart').onclick = () => measuring ? stopMeasure() : startMeasure();
$('mClear').onclick = () => { stage.clearGroup(measureMarks); measures = []; renderMeasures(); };
function renderMeasures() {
  $('mList').replaceChildren(...measures.map((m, k) => { const li = document.createElement('li'); li.innerHTML = `<span>Distance ${k + 1}</span><small>${m.toFixed(1)} mm</small>`; return li; }));
}

let pickedMesh = null;
let down = null;
stage.renderer.domElement.addEventListener('pointerdown', e => down = [e.clientX, e.clientY]);
stage.renderer.domElement.addEventListener('pointerup', e => {
  if (!ready || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  if (bay.group.visible) return;
  if (stage.mode === 'cabin' && stage.cabinEnv) {
    const f = stage.pick(e, stage.cabinEnv.interactiveFrames);
    const t = stage.pick(e, twin.meshes);
    if (f && (!t || f.distance < t.distance)) return showProfile(f.object.userData.profile);
  }
  const hit = stage.pick(e, twin.meshes);
  if (measuring) {
    if (!hit) return;
    measurePts.push(hit.point.clone());
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.007, 12, 12), new THREE.MeshBasicMaterial({color: 0x1f6f5c, depthTest: false}));
    dot.position.copy(hit.point); dot.renderOrder = 12; dot.userData.dispose = () => { dot.geometry.dispose(); dot.material.dispose(); };
    measureMarks.add(dot);
    if (measurePts.length === 2) {
      const mm = measurePts[0].distanceTo(measurePts[1]) * 1000;
      measureMarks.add(stage.dimension(measurePts[0], measurePts[1], mm.toFixed(1) + ' mm', 0xc6352b));
      measures.push(mm); renderMeasures(); measurePts = [];
    }
    return;
  }
  if (!hit) return;
  pickedMesh = hit.object;
  const joint = twin.jointOfMesh(hit.object);
  showPart(hit);
  if (joint) select(joint.id);
  if (fullView && joint) {$('immJoint').value = joint.id;$('immPanel').hidden=false;}
});
function showPart(hit) {
  const p = hit.object.userData.part, joint = twin.jointOfMesh(hit.object);
  const face = hit.face && Array.isArray(hit.object.material) ? hit.face.materialIndex : 0;
  $('pName').textContent = p.name;
  $('pSection').textContent = p.section + ' · original VinMoov mesh, assembled position';
  $('pSize').textContent = `${fmt(p.dimsMm[0])} × ${fmt(p.dimsMm[1])} × ${fmt(p.dimsMm[2])} mm`;
  $('pKinds').textContent = kindLabel(p.kinds[face] ?? p.kinds[0]) + (p.kinds.length > 1 ? ` (+${new Set(p.kinds).size - 1} more)` : '');
  $('pJoint').textContent = joint ? joint.label + (hw(joint.id) >= 0 ? ` · D${PINS[hw(joint.id)]}` : '') : 'Fixed';
  $('pTris').textContent = Math.round(p.triangles).toLocaleString();
  $('pInfo').hidden = $('pActions').hidden = false;
}
$('pFocus').onclick = () => pickedMesh && stage.focusBox(new THREE.Box3().setFromObject(pickedMesh));
$('pIsolate').onclick = () => { if (!pickedMesh) return; twin.isolate([pickedMesh]); stage.focusBox(new THREE.Box3().setFromObject(pickedMesh)); };
$('pShowAll').onclick = () => twin.isolate(null);
document.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => { twin.isolate(null); stage.view(b.dataset.focus); });

function showProfile(index) {
  const p = stage.cabinEnv.wallProfiles[index]; if (!p) return;
  $('profile').style.setProperty('--pc', p.color);
  $('profilePhoto').src = 'assets/finstein/' + p.photo; $('profilePhoto').alt = p.name;
  $('profileName').textContent = p.name; $('profileRole').textContent = p.subtitle; $('profileCred').textContent = p.credentials;
  $('profile').hidden = false;
}
$('profileClose').onclick = () => $('profile').hidden = true;

// ── Spares bay ──────────────────────────────────────────────────────────────
let catalogue = [], partFilter = 'All', currentPart = null;
const SWATCH = {Head: '#f2f0ea', Eyes: '#f2f0ea', Neck: '#2a2e35', 'Left hand': '#f07a1f', 'Right hand': '#f07a1f', Body: '#d5d9de'};
function buildCatalogue() {
  const body = Object.entries(twin.summary()).map(([section, parts]) => {
    const box = new THREE.Box3();
    for (const m of twin.meshes) if (m.userData.part.section === section) box.union(new THREE.Box3().setFromObject(m));
    const s = box.getSize(new THREE.Vector3()).multiplyScalar(1000);
    return {name: section + ' (assembled)', group: 'Body', section, dimensions: [s.x, s.z, s.y], parts: parts.length};
  });
  return bay.catalogue.then(v2 => [...v2.map(p => ({...p, i2: true})), ...body]);
}
function renderFilters() {
  const groups = ['All', 'Head', 'Eyes', 'Neck', 'Left hand', 'Right hand', 'Body'];
  $('partFilters').replaceChildren(...groups.map(g => { const b = document.createElement('button'); b.textContent = g; b.setAttribute('aria-pressed', g === partFilter); b.onclick = () => { partFilter = g; renderFilters(); renderParts(); }; return b; }));
}
function renderParts() {
  const q = $('partSearch').value.trim().toLowerCase();
  const list = catalogue.filter(p => (partFilter === 'All' || p.group === partFilter) && (!q || (p.name + ' ' + p.group).toLowerCase().includes(q)));
  $('partList').replaceChildren(...list.map(p => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.setAttribute('aria-pressed', currentPart === p);
    b.innerHTML = `<span class="sw" style="background:${SWATCH[p.group]}"></span><span class="nm"></span><span class="dm">${p.dimensions.map(v => Math.round(v)).join(' × ')}</span>`;
    b.querySelector('.nm').textContent = p.name; b.title = p.group + ' · ' + p.name;
    b.onclick = () => openPart(p);
    li.append(b); return li;
  }));
  $('i2Note').hidden = partFilter === 'Body';
}
$('partSearch').oninput = renderParts;
async function openPart(p) {
  currentPart = p; renderParts();
  $('partCard').hidden = false;
  $('pcGroup').textContent = p.i2 ? `i2 · ${p.group}` : 'Assembled body section';
  $('pcName').textContent = p.name;
  $('pcSizeLabel').textContent = p.i2 ? 'Print size (X × Y × Z)' : 'Section size (W × H × D)';
  $('pcSize').textContent = p.dimensions.map(v => fmt(v)).join(' × ') + ' mm';
  $('pcSource').textContent = p.i2 ? 'Official InMoov STL' : 'VinMoov assembly';
  $('pcTrisLabel').textContent = p.i2 ? 'Triangles' : 'Meshes';
  $('pcTris').textContent = p.i2 ? p.triangles.toLocaleString() : p.parts;
  $('pcDownload').hidden = !p.i2; $('pcGuide').hidden = !p.i2; $('pcSpin').closest('label').hidden = !p.i2;
  if (p.i2) { $('pcDownload').href = p.url; $('pcDownload').download = p.name + '.stl'; $('pcGuide').href = GUIDES[p.group]; }
  if (p.i2) {
    twin.root.visible = false; dimGroup.visible = false; measureMarks.visible = false;
    if (stage.mode === 'cabin') stage.cabin.visible = false;
    stage.grid.visible = true;
    $('sceneTitle').textContent = 'Spares bay · ' + p.name;
    $('sceneSub').textContent = 'Official i2 file · print orientation · measured bounding box in mm';
    await bay.show(p);
  } else {
    closeBay(false);
    const meshes = twin.meshes.filter(m => m.userData.part.section === p.section);
    twin.isolate(meshes);
    const box = new THREE.Box3(); meshes.forEach(m => box.union(new THREE.Box3().setFromObject(m)));
    stage.focusBox(box);
  }
}
function closeBay(resetView = true) {
  if (!bay.group.visible && !currentPart) return;
  const wasBay = bay.group.visible;
  bay.hide(); twin.root.visible = true; dimGroup.visible = true; measureMarks.visible = true; twin.isolate(null);
  if (stage.mode === 'cabin') stage.cabin.visible = true;
  stage.grid.visible = $('gridToggle').checked;
  $('sceneTitle').textContent = stage.mode === 'cabin' ? 'Finstein · Executive cabin' : 'InMoov · 1 : 1 digital twin';
  $('sceneSub').textContent = 'Genuine VinMoov assembly · 1698 mm · drag to orbit, scroll to zoom, click a part';
  if (resetView) { currentPart = null; $('partCard').hidden = true; renderParts(); if (wasBay) stage.view('front'); }
}
$('pcBack').onclick = () => closeBay();
$('pcSpin').onchange = e => bay.spin(e.target.checked);
function renderBom() {
  $('bom').innerHTML = '<tr><th>Joint</th><th>Pin</th><th>Pulse µs</th><th>Home</th></tr>' + HARDWARE.map((id, i) => {
    const p = state.profiles[i];
    return `<tr><td>${JOINT[id].label}</td><td class="m">D${PINS[i]}</td><td class="m">${p.minUs}–${p.maxUs}</td><td class="m">${p.restUs}</td></tr>`;
  }).join('');
  $('bomUnwired').textContent = `${JOINTS.length - HARDWARE.length} further twin joints (head, torso, wrists, fingers) are preview-only until wired.`;
}

// ── Motion ──────────────────────────────────────────────────────────────────
for (const host of [$('gestures'), $('immGestures')]) for (const [id, g] of Object.entries(GESTURES)) {
  const b = document.createElement('button'); b.dataset.gesture = id;
  b.innerHTML = host.id === 'gestures' ? `<span>${g.icon}</span><b>${g.label}</b>${g.sub ? `<small>${g.sub}</small>` : ''}` : `${g.icon} ${g.label}`;
  b.onclick = () => { if (!preview) return toast('Gestures run in Preview mode.'); demo = false; motion.start(id, targets); update(); };
  host.append(b);
}
$('demo').onclick = () => { if (!preview) return; motion.stop(); demo = !demo; demoStart = performance.now(); update(); };
$('restPose').onclick = () => { motion.stop(); demo = false; for (const k of Object.keys(targets)) targets[k] = 0; update(); };

// ── Keyboard ────────────────────────────────────────────────────────────────
addEventListener('keydown', e => {
  if(e.repeat) return;
  if(e.key==='Escape'&&state.gesture?.active) {e.preventDefault();send('gesture_stop');return;}
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
    const names={'1':'hi','2':'stop','3':'left','4':'sequence'};
    if(names[e.key]) {e.preventDefault();startHandSign(names[e.key]);return;}
    if(e.key.toLowerCase()==='h'&&!preview&&state.ready) {e.preventDefault();$('gestureHome').click();return;}
  }
  if (e.key !== 'Escape') return;
  if (document.querySelector('dialog[open]')) return;
  if (measuring) { e.preventDefault(); return stopMeasure(); }
  if (fullView) { e.preventDefault(); return setFull(false); }
  if (state.ready) { cancelQueuedMove(); send('emergency'); toast('Emergency off sent.'); }
});

// ── UI refresh ──────────────────────────────────────────────────────────────
let actSig = '';
let safetyInitialized=false;
let wasConnected=false;
function update() {
  const connected = online && state.ready, i = hw(selected), j = JOINT[selected];
  if(wasConnected&&!connected) $('gestureHomeConfirmed').checked=false;
  wasConnected=connected;
  if(state.safety&&!safetyInitialized) {for(let k=0;k<4;k++)targets[HARDWARE[k]]=tToTwin(k,pulseTwinT(k,state.profiles[k].restUs));safetyInitialized=true;fillCalibration();}
  const safe=safetyRule(i),unit=safe?'':'°';
  // Top bar
  $('modePreview').setAttribute('aria-pressed', preview); $('modeRobot').setAttribute('aria-pressed', !preview);
  $('linkDot').className = 'dot' + (connected ? ' ok' : state.busy && online ? ' busy' : '');
  $('linkText').textContent = connected ? 'Nano connected' : state.busy && online ? (state.link?.state === 'usb-missing' ? 'USB device missing' : state.link?.reconnects ? 'Reconnecting…' : 'Connecting…') : online ? 'Nano offline' : 'No controller';
  $('linkPort').textContent = connected && state.port ? state.port : '';
  $('connectBtn').textContent = state.busy && online ? 'Disconnect' : 'Connect';
  $('connectBtn').className = state.busy && online ? '' : 'primary';
  $('estop').disabled = $('immStop').disabled = !connected;
  const modeText = preview ? 'Preview · no hardware' : connected ? 'Robot live · expected pose' : 'Robot mode · offline';
  $('modeChip').textContent = $('immState').textContent = modeText;
  $('modeChip').className = 'chip ' + (preview ? 'accent' : connected ? 'danger' : 'warn');
  $('immDot').className = 'dot' + (connected && !preview ? ' ok' : '');
  // Joint card
  const spec = sliderSpec(selected), value = currentValue(selected), wired = i >= 0;
  const access=controlAccess({authorized:sessionAuthorized,online,preview,ready:state.ready,wired,enabled:wired&&state.enabled[i],playing:!!state.playing});
  $('controlSessionNotice').hidden=sessionAuthorized;
  $('immControlStatus').textContent=access.message;
  $('calibrationStatus').textContent=access.message;
  if(document.activeElement!==$('calibrationJoint'))$('calibrationJoint').value=wired?selected:'';
  $('calibrationSetup').hidden=!preview&&connected;
  $('calibrationSetup').textContent=preview?'Use Robot mode':state.busy?'Connecting…':'Connect Nano';
  $('calibrationSetup').disabled=!sessionAuthorized||!online||!preview&&state.busy;
  $('calibrationSave').disabled=!online||!!state.recording||!!state.playing;
  $('limitsHelp').textContent=safe?'This joint uses your tested limits and fixed home. Position, step size and twin calibration are available below.':'Set pulse limits and home with this joint released, then save settings.';
  $('immRobotMode').disabled=!sessionAuthorized||!online||!preview;
  $('immConnect').disabled=!sessionAuthorized||!online;
  $('immConnect').textContent=state.busy?'Disconnect':'Connect Nano';
  $('immEnable').disabled=!access.canEnable;
  $('immRelease').disabled=preview||!connected||!wired||!state.enabled[i];
  $('immPower').hidden=preview||!wired;
  $('immGestures').hidden=!preview;
  $('immMotion').hidden=preview;
  $('immGestureLabel').textContent=preview?'Gestures · preview':'Robot hand signs';
  const movable = wired ? (preview || connected && state.enabled[i] && !state.playing) : preview;
  $('jGroup').textContent = GROUPS.find(g => g[0] === j.group)[1];
  $('jName').textContent = j.label; $('jHint').textContent = j.hint;
  $('jPin').textContent = wired ? 'D' + PINS[i] : 'Twin only'; $('jPin').className = 'chip ' + (wired ? 'pin' : '');
  $('jState').textContent = !wired ? (preview ? 'Preview joint · not wired to the Nano' : 'Not wired · switch to Preview to pose it') : preview ? 'Preview ready' : !connected ? 'Robot offline' : state.enabled[i] ? 'Joint enabled' : 'Joint released';
  $('jDot').className = 'dot' + (movable ? ' ok' : '');
  const ack = wired ? state.acknowledged[i] : null;
  $('jAck').textContent = preview ? 'SIMULATED' : !wired ? 'PREVIEW ONLY' : ack === null ? 'NO FEEDBACK' : state.confirmedEnabled[i] ? 'ACKNOWLEDGED' : 'OUTPUT OFF';
  $('jAck').className = 'chip ' + (!preview && wired && ack !== null && state.confirmedEnabled[i] ? 'accent' : '');
  $('jValueLabel').textContent = safe ? 'Home offset · command units' : wired ? (preview ? 'Preview servo angle' : 'Requested servo angle') : 'Joint angle';
  $('jValueUnit').textContent=unit;
  $('jTwinWrap').hidden = !wired;
  $('jTwin').textContent = (wired ? tToTwin(i, safe ? pulseTwinT(i,valuePulse(i,value)) : servoToT(i, value)) : value).toFixed(1) + '°';
  for (const s of [$('jSlider'), $('immSlider')]) { s.min = spec.min; s.max = spec.max; s.step = spec.step; s.disabled = !movable; if (!dragging) s.value = value; }
  $('jValue').textContent = (+value).toFixed(spec.step < 1 ? 1 : 0);
  $('immValue').innerHTML = (+value).toFixed(0) + '<small>'+unit+'</small>';
  $('immChip').textContent = wired ? 'D' + PINS[i] : 'Twin only';
  if (document.activeElement !== $('immJoint')) $('immJoint').value = selected;
  $('jMin').textContent = +spec.min.toFixed(1) + unit; $('jMax').textContent = +spec.max.toFixed(1) + unit;
  $('jMinus').textContent = '−' + spec.step + unit; $('jPlus').textContent = '+' + spec.step + unit;
  for (const id of ['jMinus', 'jPlus', 'jHome', 'immMinus', 'immPlus', 'immHome']) $(id).disabled = !movable;
  $('jPower').hidden = $('jGoto').hidden = preview || !wired;
  if (wired) {
    $('jEnable').disabled = !access.canEnable; $('jRelease').disabled = !connected || !state.enabled[i];
    $('jApply').disabled = $('jAngle').disabled = !movable;
    if (document.activeElement !== $('jAngle')) $('jAngle').value = pulseToServo(i, state.positions[i]).toFixed(1);
    const p = state.profiles[i];
    $('scaleReadout').textContent = safe ? `Home 0 = original ${safe.rawHome} · range ${spec.min.toFixed(1)} to ${spec.max.toFixed(1)} command units. Physical degrees are not measured.` : `${servoRanges[i][0]}° → ${p.reversed ? p.maxUs : p.minUs} µs · ${servoRanges[i][1]}° → ${p.reversed ? p.minUs : p.maxUs} µs`;
    $('sMin').disabled=$('sMax').disabled=!!safe;
    $('restUs').readOnly=!!safe;
    for(const key of ['minUs','maxUs','restUs']) {$(key).min=safe?safe.minUs:500;$(key).max=safe?safe.maxUs:2500;}
    const locked = state.enabled[i] || state.recording || state.playing;
    $('applyLimits').disabled = $('saveScale').disabled = $('saveMap').disabled = locked;
    $('reverseServo').disabled = locked || !online || !!safe;
    $('reverseServo').checked = !!p.reversed;
    $('reverseTwin').checked=!!twin.visualReversed[selected];
    $('setHome').disabled = preview || !connected || !state.enabled[i] || state.recording || state.playing || !!safe;
    $('jApply').textContent=safe?'Go to value':'Go to angle';
    $('jAngle').min=spec.min;$('jAngle').max=spec.max;$('jAngle').step=spec.step;
  }
  $('safetyReadout').hidden=!safe;
  if(safe) $('safetyReadout').textContent=`Home 0 = original ${safe.rawHome} · original limits ${safe.rawMin}–${safe.rawMax}. Requested original value ${rawCommand(safe,valuePulse(i,value)).toFixed(1)}. Bounds ${state.profiles[i].minUs}–${state.profiles[i].maxUs} µs.`;
  $('jHardware').hidden = !wired;
  $('jReadout').textContent = !wired ? (preview ? 'Pose this joint on the twin. It is not connected to a servo yet.' : 'Only the eight arm joints are driven in Robot mode.') : preview ? 'Slide to preview. Nothing is sent to the robot.' : !connected ? (state.link?.state === 'usb-missing' ? 'Windows cannot see the Nano. Check servo power and USB; reconnection is automatic.' : 'Waiting for the Nano connection.') : !state.enabled[i] ? 'USB connected. Enable this joint at home to send live commands.' : ack === null ? 'Waiting for a confirmed command.' : `Nano acknowledged ${ack} µs` + (state.confirmedEnabled[i] ? ' · output enabled.' : ' · output released; last pose kept.');
  for (const [id, b] of Object.entries(jointButtons)) {
    const sp = sliderSpec(id), v = currentValue(id), frac = clamp((v - sp.min) / (sp.max - sp.min), 0, 1);
    b.querySelector('.val').textContent = Math.round(v) + (safetyRule(hw(id))?'':'°');
    b.querySelector('.bar i').style.width = (frac * 100).toFixed(1) + '%';
  }
  // Robot mode: drive wired joints from acknowledged pulses.
  if (!preview) for (let k = 0; k < 8; k++) { const us = state.acknowledged[k]; if (us !== null) targets[HARDWARE[k]] = tToTwin(k,pulseTwinT(k,us)); }
  const ev = state.activity.find(e => e.stage === 'Acknowledged' && e.pin && e.us);
  if (ev && ev.id !== lastAckId) { lastAckId = ev.id; const k = PINS.indexOf(ev.pin); if (k >= 0) { pulse(HARDWARE[k], 1100); jointButtons[HARDWARE[k]].classList.remove('flash'); void jointButtons[HARDWARE[k]].offsetWidth; jointButtons[HARDWARE[k]].classList.add('flash'); } }
  const sig = state.activity[0]?.id + ':' + state.activity.length;
  if (sig !== actSig) {
    actSig = sig;
    $('activity').replaceChildren(...state.activity.slice(0, 14).map(a => { const li = document.createElement('li'); li.className = a.stage === 'Acknowledged' ? 'ack' : ''; const t = document.createElement('span'); t.textContent = a.label; const s = document.createElement('small'); s.textContent = a.time + ' · ' + a.stage; li.append(t, s); return li; }));
    $('actCount').textContent = state.activity.length; $('actEmpty').hidden = state.activity.length > 0;
  }
  // Motion tab
  document.querySelectorAll('[data-gesture]').forEach(b => { b.disabled = !preview; b.classList.toggle('on', motion.active?.id === b.dataset.gesture); });
  $('demo').disabled = $('restPose').disabled = !preview;
  $('demo').textContent = demo ? '❚❚ Stop idle motion' : '▷ Idle motion';
  $('motionStatus').textContent = !preview ? 'Gestures run in Preview mode.' : motion.active ? GESTURES[motion.active.id].label + ' · playing on the twin' : demo ? 'Idle motion on the twin' : '';
  $('record').disabled = !connected || state.recording || state.playing; $('finish').disabled = !state.recording;
  $('play').disabled = !connected || state.recording || state.playing || !state.sequenceValid; $('hold').disabled = !state.playing;
  $('loop').checked = !!state.loop; $('loop').disabled = !connected || !!state.playing || !!state.recording;
  $('seqStatus').textContent = connected ? state.sequenceStatus || 'No recording yet.' : 'Connect the robot to record a sequence of arm moves.';
  const running=!!state.gesture?.active;
  const knownHome=$('gestureHomeConfirmed').checked||(state.confirmedEnabled?.length>=4&&state.confirmedEnabled.slice(0,4).every((on,k)=>on&&state.acknowledged[k]!=null));
  const signs=handSignAccess({authorized:sessionAuthorized,online,preview,ready:state.ready,busy:state.busy,playing:state.playing,recording:state.recording,inFlight:state.link?.inFlight,rightEnabled:state.enabled.slice(4).some(Boolean)||state.confirmedEnabled?.slice(4).some(Boolean),knownHome});
  document.querySelectorAll('[data-robot-gesture]').forEach(b=>{b.disabled=!signs.canStart;b.title=signs.message;b.classList.toggle('on',running&&b.dataset.robotGesture===state.gesture.name);});
  $('gestureReady').textContent=running?'Hand sign running. Stop loop or return home below.':signs.message;
  $('gestureSetup').hidden=!signs.action||running;
  $('gestureSetup').textContent=signs.action==='robot'?'Use Robot mode':signs.action==='connect'?'Connect Nano':'Confirm physical home below';
  $('previewGestures').hidden=!preview;
  $('gestureHomeConfirmed').disabled=running;
  $('gestureStop').disabled=!connected||!running;
  $('gestureHome').disabled=preview||!connected||!!state.recording||!!state.playing&&!running||!running&&!knownHome;
  $('gestureLoop').disabled=preview||!connected||!!state.recording||!!state.playing&&!running;
  if(running) $('gestureLoop').checked=!!state.gesture.loop;
  $('gestureStatus').textContent=preview?'Switch to Robot mode for live hand signs.':!connected?'Connect the Nano to run hand signs.':!knownHome&&!running?'Confirm physical home, then choose a hand sign.':state.gestureStatus;
  $('restoreSafety').disabled=!online||state.enabled.some(Boolean)||!!state.playing||!!state.recording;
  for (const id of ['save', 'importBtn']) $(id).disabled = !online || !!state.recording || !!state.playing;
  if (online) $('status').textContent = state.status || 'Ready.';
  if (tab === 'spares') renderBom();
}

// ── Frame loop ──────────────────────────────────────────────────────────────
const tag = stage.label('', 'tag'); stage.scene.add(tag);
let last = performance.now(), lastHighlight = '', uiTick = 0;
stage.onFrame.push(now => {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  bay.tick(dt);
  if (!ready) return;
  if (preview && motion.active) motion.tick(now, targets);
  else if (preview && demo) {
    const t = (now - demoStart) / 1000;
    Object.assign(targets, {leftShoulder: 10 + 8 * Math.sin(t * .8), rightShoulder: 10 + 8 * Math.sin(t * .8 + 1.4), leftBicep: 20 + 14 * Math.sin(t * .9), rightBicep: 20 + 14 * Math.sin(t * .9 + 1.1), leftOmoplate: 6 + 5 * Math.sin(t * .6), rightOmoplate: 6 + 5 * Math.sin(t * .6 + 2), rothead: 18 * Math.sin(t * .35), neck: 5 * Math.sin(t * .5), eyeLeft: 12 * Math.sin(t * .35 + .4), eyeRight: 12 * Math.sin(t * .35 + .4), waist: 6 * Math.sin(t * .3)});
    for (const s of ['left', 'right']) for (const f of ['Index', 'Majeure', 'RingFinger', 'Pinky', 'Thumb']) targets[s + f] = 12 + 12 * Math.sin(t * .9 + (s === 'left' ? 0 : 1));
  }
  for (const j of JOINTS) { visual[j.id] = THREE.MathUtils.damp(visual[j.id], targets[j.id], reduced ? 100 : 9, dt); twin.set(j.id, visual[j.id]); }
  if (twin.explodeAmount) twin.explode(twin.explodeAmount);
  // Highlight the selected joint's moving assembly; flash on acknowledgement or preview move.
  const hot = now < activeUntil ? activeJoint : null, key = selected + '|' + hot + '|' + (twin.isolated ? twin.isolated.size : 0);
  if (key !== lastHighlight) { lastHighlight = key; twin.highlight(twin.meshesOf(hot || selected), hot ? 'active' : 'selected'); }
  const pivot = JOINT[selected].pivots?.[0];
  tag.visible = !!pivot && twin.root.visible;
  if (pivot) { pivot.getWorldPosition(tag.position); tag.element.textContent = JOINT[selected].label + (hw(selected) >= 0 ? ' · D' + PINS[hw(selected)] : ''); tag.element.className = 'tag' + (hot ? ' active' : ''); }
  if ((motion.active || demo) && ++uiTick % 6 === 0) update();
});

// ── Boot ────────────────────────────────────────────────────────────────────
select(selected); renderFilters(); poll();
setTab(['control','inspect','spares','motion'].includes(requestedTab)?requestedTab:'control');
if(calibrationLaunch)setFull(false);
else if(sessionStorage.getItem('inmoov-full-view')==='true')setFull(true);
twin.load(p => { $('loadBar').style.width = Math.round(p * 100) + '%'; $('loadText').textContent = p < 1 ? `Loading original VinMoov sections · ${Math.round(p * 100)}%` : 'Joining sections and pivots…'; }).then(async () => {
  ready = true;
  twin.root.position.copy(stage.anchor);
  $('dimTable').innerHTML = Object.values(twin.measure.lines).map(l => `<tr><td>${l.label}</td><td>${l.mm} mm</td></tr>`).join('');
  $('sceneSub').textContent = `Genuine VinMoov assembly · ${twin.measure.lines.height.mm} mm · drag to orbit, scroll to zoom, click a part`;
  if(fullView)stage.frameBody(new THREE.Box3().setFromObject(twin.root));else stage.view('front', false);
  $('loading').hidden = true;
  catalogue = await buildCatalogue().catch(e => { toast(e.message); return []; });
  renderParts(); update();
  window.studioDebug = {twin, stage, bay, motion, targets, get state() { return state; }, get preview() { return preview; }, select, setTab, setScene, setFull, openPart, catalogue, ready: true};
}).catch(e => { console.error(e); $('loading').querySelector('strong').textContent = 'The model could not load'; $('loadText').textContent = e.message; $('retryView').hidden=false; });
