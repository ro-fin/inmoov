import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ColladaLoader} from 'three/addons/loaders/ColladaLoader.js';
import URDFLoader from 'urdf-loader';
import {createExecutiveRoom} from './executive-room.js';
import {GesturePlayer} from './gestures.js';
import {createImmersiveUI} from './immersive-ui.js';
import {installV2Assembly} from './v2-assembly.js';
let v2Assembly=null;
let immersive=null,gesturePlayer=null;

const $ = id => document.getElementById(id);
const names = ['Left omoplate','Left rotate','Left shoulder','Left bicep','Right omoplate','Right rotate','Right shoulder','Right bicep'];
const pins = [2,4,5,6,7,8,9,10];
const hints = ['Lift the shoulder outward','Rotate the upper arm','Raise the arm forward','Bend the elbow'];
const keys = ['left_shoulder_y_link_joint','left_shoulder_z_link_joint','left_shoulder_x_link_joint','left_elbow_x_link_joint','right_shoulder_y_link_joint','right_shoulder_z_link_joint','right_shoulder_x_link_joint','right_elbow_x_link_joint'];
const token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('studio-token') || '';
sessionStorage.setItem('studio-token', token);
history.replaceState(null, '', location.pathname);
const defaults = names.map((name,i)=>({name,pin:pins[i],minUs:500,maxUs:2500,restUs:1500}));
let state = {ready:false,busy:false,profiles:defaults,positions:Array(8).fill(1500),enabled:Array(8).fill(false),acknowledged:Array(8).fill(null),confirmedEnabled:Array(8).fill(false),activity:[],ports:[],session:null};
let selected=0, region='left', preview=true, demo=false, demoStart=0, online=false, dragging=false;
let targetAngles=Array(8).fill(0), visualAngles=Array(8).fill(0), previewAngles=Array(8).fill(0);
let mapping = Array.from({length:8},(_,i)=>i%4===3?[0,80]:i%4===0?[0,55]:[-25,55]);
try { const m=JSON.parse(localStorage.getItem('inmoov-angle-mapping')); if(Array.isArray(m)&&m.length===8&&m.every(a=>Array.isArray(a)&&a.length===2&&a.every(Number.isFinite))) mapping=m; } catch {}
const DEG=Math.PI/180, reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let servoRanges=Array.from({length:8},()=>[0,270]),sliderSteps=Array(8).fill(1);
try {const s=JSON.parse(localStorage.getItem('inmoov-servo-sliders'));if(s?.ranges?.length===8&&s?.steps?.length===8&&s.ranges.every(r=>Array.isArray(r)&&r.length===2&&r.every(a=>Number.isFinite(a)&&Math.abs(a)<=360)&&r[0]!==r[1])&&s.steps.every(x=>Number.isFinite(x)&&x>=.1&&x<=10)){servoRanges=s.ranges;sliderSteps=s.steps;}}catch{}
// Apply the requested all-servo conversion once, including existing browser settings.
// Later per-joint customizations continue to be saved normally.
try {if(localStorage.getItem('inmoov-all-servos-270-v1')!=='1'){
 const previous=localStorage.getItem('inmoov-servo-sliders');
 if(previous)localStorage.setItem('inmoov-servo-sliders-before-all-270',previous);
 servoRanges=Array.from({length:8},()=>[0,270]);
 localStorage.setItem('inmoov-servo-sliders',JSON.stringify({ranges:servoRanges,steps:sliderSteps}));
 localStorage.setItem('inmoov-all-servos-270-v1','1');
}}catch{}
const settings=document.createElement('details');settings.id='sliderSettings';settings.innerHTML='<summary>Customize angle slider</summary><div class="field-grid"><label>Angle at minimum pulse °<input id="sliderMin" type="number" min="-360" max="360" step="0.1"></label><label>Angle at maximum pulse °<input id="sliderMax" type="number" min="-360" max="360" step="0.1"></label><label>Step °<input id="sliderStep" type="number" min="0.1" max="10" step="0.1"></label></div><button id="saveSlider">Save slider range</button><p class="muted">Servo angle scale. Pulse limits stay unchanged. Set the physical joint angles separately under Visual angle mapping.</p>';
$('angleCommand').after(settings);
settings.insertAdjacentHTML('beforeend','<p id="sliderPulseRange" class="command-readout"></p>');
function pulseAngle(i,us){const p=state.profiles[i],r=servoRanges[i];return r[0]+(us-p.minUs)/(p.maxUs-p.minUs)*(r[1]-r[0]);}
function displayAngle(i){if(!preview)return pulseAngle(i,state.positions[i]);const r=servoRanges[i],m=mapping[i];return r[0]+(previewAngles[i]-m[0])/(m[1]-m[0])*(r[1]-r[0]);}
let toastTimer, sliderTimer, activitySignature='', lastAckId=0, activeUntil=0, activeIndex=-1;
let queuedMove=null, moveInFlight=false;
function cancelQueuedMove(){clearTimeout(sliderTimer);queuedMove=null;}
function angleRange(i){return servoRanges[i].map(a=>Math.round(a*1000));}
async function flushMove(){
 if(moveInFlight)return;
 if(!queuedMove||preview||!online||!state.ready){queuedMove=null;return;}
 const next=queuedMove;queuedMove=null;moveInFlight=true;
 try {if(state.enabled[next.index]&&!state.playing)await send('move',next);}
 finally {moveInFlight=false;if(queuedMove)sliderTimer=setTimeout(flushMove,16);}
}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
async function request(action, extra={}) {
  const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(5000)});
  const result=await response.json(); if(!response.ok) throw Error(result.error || 'Controller unavailable');
  state=result; online=true; update(); return result;
}
async function send(action, extra={}) {if(['emergency','off','disconnect','home','enable','play','import'].includes(action))cancelQueuedMove();try{return await request(action,extra);}catch(e){cancelQueuedMove();toast(e.message);return null;}}
async function poll(){
  try{
    const response=await fetch('/api/state',{headers:{'X-Studio-Token':token},cache:'no-store',signal:AbortSignal.timeout(1500)});
    if(!response.ok)throw Error('Open Studio using its launcher.');
    state=await response.json();online=true;if(state.busy&&preview)mode(false);update();
  }catch(e){online=false;$('status').textContent='Controller connection lost. Robot controls are disabled.';update();}
  setTimeout(poll,80);
}
function fillCalibration(){
  const p=state.profiles[selected];
  for(const key of ['minUs','maxUs','restUs']) $(key).value=p[key];
  $('angleMin').value=mapping[selected][0];$('angleMax').value=mapping[selected][1];
  $('sliderMin').value=servoRanges[selected][0];$('sliderMax').value=servoRanges[selected][1];$('sliderStep').value=sliderSteps[selected];
}
function selectJoint(i){
  selected=i;region=i<4?'left':'right';fillCalibration();
  document.querySelectorAll('[data-joint]').forEach(b=>b.classList.toggle('selected',+b.dataset.joint===i));
  document.querySelectorAll('[data-region]').forEach(b=>b.classList.toggle('active',b.dataset.region===region));
  $('positionSlider').value=preview?previewAngles[i]:state.positions[i];update();
  $('leftJoints').hidden=i>=4;$('rightJoints').hidden=i<4;
}
for(let i=0;i<8;i++){
  const b=document.createElement('button');b.textContent=names[i].split(' ')[1];b.dataset.joint=i;b.onclick=()=>selectJoint(i);$(i<4?'leftJoints':'rightJoints').append(b);
}
function mode(value){
  if(value && state.busy){toast('Disconnect the robot before entering preview.');return;}
  gesturePlayer?.stop();preview=value;demo=false;previewAngles.fill(0);targetAngles.fill(0);
  cancelQueuedMove();
  $('previewMode').classList.toggle('selected',preview);$('liveMode').classList.toggle('selected',!preview);
  update();
}
$('previewMode').onclick=()=>mode(true);$('liveMode').onclick=()=>mode(false);
function update(){
 const p=state.profiles[selected], ready=online&&state.ready, active=region==='left'||region==='right';
 const enabled=state.enabled[selected], ack=state.acknowledged[selected];
 $('connectionText').textContent=ready?'Connected':state.busy&&online?'Connecting…':'Offline';
 $('connectionDot').className='dot'+(ready?' mint':'');
 $('connectionButton').textContent=state.busy&&online?'Disconnect':'Connect robot';
 $('emergency').disabled=!ready;
 $('fullEmergency').disabled=!ready;
 $('fullState').textContent=preview?'Preview · No hardware movement':ready?'Robot connected · Estimated pose':'Robot offline';
 $('modeBadge').textContent=preview?'● PREVIEW ONLY':ready?'● ROBOT CONNECTED':'○ ROBOT OFFLINE';
 $('poseNote').textContent=preview?'Preview animation · No commands are sent to the robot.':'Estimated pose from acknowledged pulses · Actual angles are not measured.';
 $('jointName').textContent=active?names[selected]:({head:'Head & neck',torso:'Torso',hands:'Hands',legs:'Legs & feet'})[region];
 $('jointHint').textContent=active?hints[selected%4]:'Reference geometry · not mapped to the Nano';
 $('pinBadge').textContent=active?'D'+p.pin:'VIEW';
 $('jointState').textContent=!active?'Visual reference':preview?'Preview ready':!ready?'Robot offline':enabled?'Joint enabled':'Joint released';
 $('jointDot').className='dot'+(active&&(preview||ready&&enabled)?' mint':'');
 $('processed').textContent=preview?'SIMULATED':ack===null?'NO FEEDBACK':state.confirmedEnabled[selected]?'ACKNOWLEDGED':'OUTPUT OFF';
 $('positionLabel').textContent=preview?'PREVIEW SERVO ANGLE':'REQUESTED SERVO ANGLE';
 $('unit').textContent='°';
 const bounds=[Math.min(...servoRanges[selected]),Math.max(...servoRanges[selected])];
 const slider=$('positionSlider');slider.min=bounds[0];slider.max=bounds[1];slider.step=sliderSteps[selected];
 if(!dragging){slider.value=displayAngle(selected);}
 $('position').textContent=Number(Number(slider.value).toFixed(1));
 $('minLabel').textContent=bounds[0]+'°';$('maxLabel').textContent=bounds[1]+'°';
 $('minus').textContent='− '+sliderSteps[selected]+'°';$('plus').textContent='+ '+sliderSteps[selected]+'°';
 const movable=active&&(preview||ready&&enabled&&!state.playing);
 slider.disabled=!movable;for(const id of ['minus','plus','home'])$(id).disabled=!movable;
 $('enable').hidden=preview||!active;$('release').hidden=preview||!active;
 $('enable').disabled=!ready||enabled||state.playing;$('release').disabled=!ready||!enabled;
 $('commandReadout').textContent=!active?'Select an arm joint to control it.':preview?'Explore the joint with the slider.':ack===null?'Waiting for a confirmed position command.':'Nano acknowledged '+ack+' µs'+(state.confirmedEnabled[selected]?' · output enabled.':' · output released; last pose retained.');
 $('angleCommand').hidden=preview||!active;
 $('applyAngle').disabled=!movable;
 $('jointAngle').disabled=!movable;
 $('jointAngle').min=bounds[0];$('jointAngle').max=bounds[1];$('jointAngle').step=sliderSteps[selected];
 if(document.activeElement!==$('jointAngle'))$('jointAngle').value=pulseAngle(selected,state.positions[selected]).toFixed(1);
 $('sliderSettings').hidden=!active;$('saveSlider').disabled=enabled||state.recording||state.playing;
 $('sliderPulseRange').textContent=servoRanges[selected][0]+'° → '+p.minUs+' µs · '+servoRanges[selected][1]+'° → '+p.maxUs+' µs';
 $('calibration').hidden=!active;$('visualMapping').hidden=!active;
 $('applyCalibration').disabled=enabled||state.recording||state.playing;
 $('saveMapping').disabled=enabled||state.recording||state.playing;
 $('setHome').disabled=preview||!ready||!enabled||state.recording||state.playing;
 $('demo').hidden=!preview;$('demo').textContent=demo?'Ⅱ Stop preview':'▷ Preview motion';$('resetPose').hidden=!preview;
 for(const id of ['record','finish','play','hold','loopLabel'])$(id).hidden=preview;
 $('record').disabled=!ready||state.recording||state.playing;$('finish').disabled=!state.recording;
 $('play').disabled=!ready||state.recording||state.playing||!state.sequenceValid;$('hold').disabled=!state.playing;
 $('loop').checked=!!state.loop;$('loop').disabled=!!state.playing||!!state.recording;
 $('sequenceStatus').textContent=preview?(demo?'Gentle arm movement · preview only':'Explore a gentle movement in preview.'):state.sequenceStatus||'No recording yet';
 if(online)$('status').textContent=state.status||'Ready to explore.';
 for(const id of ['save','importButton'])$(id).disabled=!!state.recording||!!state.playing;
 if(!preview){
   for(let i=0;i<8;i++){const us=state.acknowledged[i];if(us!==null){const q=state.profiles[i], t=THREE.MathUtils.clamp((us-q.minUs)/(q.maxUs-q.minUs),0,1);targetAngles[i]=mapping[i][0]+t*(mapping[i][1]-mapping[i][0]);}}
 }
 const event=state.activity.find(e=>e.stage==='Acknowledged'&&e.pin&&e.us);
 if(event&&event.id!==lastAckId){lastAckId=event.id;activeIndex=state.profiles.findIndex(p=>p.pin===event.pin);activeUntil=performance.now()+1100;}
 const sig=state.activity[0]?.id;
 if(sig!==activitySignature){activitySignature=sig;$('activityList').replaceChildren();
  for(const a of state.activity.slice(0,12)){const li=document.createElement('li');li.className=a.stage==='Queued'?'queued':'';const title=document.createElement('strong');title.textContent=a.label;const sub=document.createElement('small');sub.textContent=a.time+' · '+a.stage;li.append(title,sub);$('activityList').append(li);}
  $('activityCount').textContent=state.activity.length;$('activityIntro').hidden=state.activity.length>0;
 }
 immersive?.sync();
}
function change(value){
 gesturePlayer?.stop();
 const slider=$('positionSlider'),step=sliderSteps[selected];const v=THREE.MathUtils.clamp(Math.round((value-Number(slider.min))/step)*step+Number(slider.min),+slider.min,+slider.max);slider.value=v;$('position').textContent=Number(v.toFixed(1));
 const r=servoRanges[selected],t=(v-r[0])/(r[1]-r[0]);
 if(preview){demo=false;previewAngles[selected]=mapping[selected][0]+t*(mapping[selected][1]-mapping[selected][0]);targetAngles[selected]=previewAngles[selected];activeIndex=selected;activeUntil=performance.now()+700;update();}
 else {const p=state.profiles[selected];queuedMove={index:selected,us:Math.round(p.minUs+t*(p.maxUs-p.minUs)),angleRange:angleRange(selected)};flushMove();}
}
$('positionSlider').addEventListener('pointerdown',()=>dragging=true);
window.addEventListener('pointerup',()=>dragging=false);
$('positionSlider').oninput=e=>change(+e.target.value);
$('minus').onclick=()=>change(+$('positionSlider').value-sliderSteps[selected]);$('plus').onclick=()=>change(+$('positionSlider').value+sliderSteps[selected]);
$('home').onclick=()=>preview?change(0):send('home',{index:selected,angleRange:angleRange(selected)});
$('enable').onclick=()=>send('enable',{index:selected,angleRange:angleRange(selected)});$('release').onclick=()=>send('off',{index:selected});
$('applyAngle').onclick=()=>{const a=Number($('jointAngle').value),[lo,hi]=servoRanges[selected];if(!Number.isFinite(a)||a<Math.min(lo,hi)||a>Math.max(lo,hi))return toast('Use an angle inside your slider range.');change(a);};
$('saveSlider').onclick=()=>{const r=[Number($('sliderMin').value),Number($('sliderMax').value)],s=Number($('sliderStep').value);if(state.enabled[selected]||state.recording||state.playing)return toast('Release the joint before changing its angle scale.');if(!r.every(a=>Number.isFinite(a)&&Math.abs(a)<=360)||Math.abs(r[1]-r[0])<.1||!Number.isFinite(s)||s<.1||s>10||s>Math.abs(r[1]-r[0]))return toast('Use distinct endpoints within −360° to 360° and a step from 0.1° to 10°.');cancelQueuedMove();servoRanges[selected]=r;sliderSteps[selected]=s;localStorage.setItem('inmoov-servo-sliders',JSON.stringify({ranges:servoRanges,steps:sliderSteps}));update();toast('Angle slider saved. Pulse limits unchanged.');};
$('emergency').onclick=()=>{clearTimeout(sliderTimer);send('emergency');};
$('applyCalibration').onclick=async()=>{const data={index:selected};for(const k of ['minUs','maxUs','restUs'])data[k]=Number($(k).value);if(await send('calibrate',data))toast('Limits updated. Save your session to keep them.');};
$('setHome').onclick=()=>send('sethome',{index:selected});
$('saveMapping').onclick=()=>{const values=[Number($('angleMin').value),Number($('angleMax').value)],b=jointBounds(selected);if(Math.round(values[0]*1000)===Math.round(values[1]*1000)||!values.every(v=>Number.isFinite(v)&&v>=b[0]&&v<=b[1]))return toast('Use two different angles within the model limits: '+b.join(' to ')+'°');mapping[selected]=values;localStorage.setItem('inmoov-angle-mapping',JSON.stringify(mapping));toast('Angle mapping saved on this browser.');};
for(const id of ['record','finish','play','hold'])$(id).onclick=()=>send(id);
$('loop').onchange=e=>send('loop',{value:e.target.checked});
$('demo').onclick=()=>{gesturePlayer?.stop();demo=!demo;demoStart=performance.now();update();};
$('resetPose').onclick=()=>{gesturePlayer?.stop();demo=false;previewAngles.fill(0);targetAngles.fill(0);update();};
function ports(){const sel=$('portSelect'),old=sel.value;sel.replaceChildren();for(const p of state.ports){const o=document.createElement('option');o.value=o.textContent=p;sel.append(o);}if(state.ports.includes(old))sel.value=old;$('connectNow').disabled=!state.ports.length;}
$('connectionButton').onclick=async()=>{if(state.busy){await send('disconnect');return;}await send('refresh');ports();$('connectDialog').showModal();};
$('refresh').onclick=async()=>{await send('refresh');ports();};
$('connectNow').onclick=async()=>{demo=false;mode(false);if(await send('connect',{port:$('portSelect').value}))$('connectDialog').close();};
$('sessionButton').onclick=()=>$('sessionDialog').showModal();$('aboutButton').onclick=()=>$('aboutDialog').showModal();
$('save').onclick=async()=>{if(await send('save'))toast('Session saved.');};
$('export').onclick=()=>{if(!state.session)return toast('Controller unavailable.');const url=URL.createObjectURL(new Blob([JSON.stringify(state.session,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='inmoov-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('importButton').onclick=()=>$('import').click();$('import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>4000000)throw Error('Session file exceeds 4 MB.');if(await send('import',{session:JSON.parse(await f.text())})){fillCalibration();toast('Session imported; outputs off.');}}catch(e){toast(e.message);}finally{e.target.value='';}};
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(fullView){e.preventDefault();leaveFullView();}else if(state.ready){clearTimeout(sliderTimer);send('emergency');}}});
document.querySelectorAll('[data-region]').forEach(b=>b.onclick=()=>{if(b.dataset.region==='left'||b.dataset.region==='right'){selectJoint(b.dataset.region==='left'?0:4);}else{region=b.dataset.region;document.querySelectorAll('[data-region]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-joint]').forEach(x=>x.classList.remove('selected'));update();}});
const scene=new THREE.Scene();
const host=$('viewport');const camera=new THREE.PerspectiveCamera(44,1,.0005,100);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;host.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.006;controls.zoomToCursor=true;controls.maxDistance=36;controls.maxPolarAngle=Math.PI*.49;controls.target.set(0,.9,0);
let environment=null;
const roomReady=createExecutiveRoom(scene,renderer).then(value=>environment=value);
let robot=null, modelRoot=new THREE.Group(), meshList=[], height=1.8, readyModel=false;
scene.add(modelRoot);
const manager=new THREE.LoadingManager();
manager.onProgress=(url,loaded,total)=>$('loadStatus').textContent='Preparing body parts · '+Math.round(loaded/total*100)+'%';
manager.onError=url=>{console.error('Asset load failed',url);$('loadStatus').textContent='A model part could not load. Relaunch Studio to retry.';};
const loader=new URDFLoader(manager);loader.packages={'sentience_gz':'./assets/reference/inmoov_ros_sim-master'};
function jointBounds(i){if(!robot)return i%4===3?[0,90]:[-45,90];const j=robot.joints[keys[i]];return [Math.ceil(j.limit.lower/DEG),Math.floor(j.limit.upper/DEG)];}
function fit(view='front'){
 if(!environment)return;
 immersive?.restoreBody();
 const preset=environment.cameras[view]||environment.cameras.front;
 controls.target.fromArray(preset.target);camera.position.fromArray(preset.position);
 if(camera.aspect<.9)camera.position.sub(controls.target).multiplyScalar(.9/camera.aspect).add(controls.target);
 controls.update();camera.updateMatrixWorld();
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{controls.autoRotate=false;fit(b.dataset.view);document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('selected',x===b));});
$('fitView').onclick=()=>fit();$('autoOrbit').onclick=()=>{controls.autoRotate=!controls.autoRotate;$('autoOrbit').classList.toggle('selected',controls.autoRotate);};
new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}).observe(host);
let fullView=false,previousFocus=null;
const outsideViewport=[...document.querySelectorAll('body>header,.sidebar,.inspector,body>footer,.view-heading,.view-tools,.view-caption,.pose-note,.motion-strip')];
function enterFullView(){
 if(fullView)return;previousFocus=document.activeElement;fullView=true;
 host.classList.add('expanded');document.body.classList.add('scene-expanded');
 $('expandView').hidden=true;$('fullToolbar').hidden=false;$('fullBottom').hidden=false;
 outsideViewport.forEach(el=>el.inert=true);host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','Finstein executive cabin full view');
 $('backToStudio').focus();
}
function leaveFullView(){
 if(!fullView)return;immersive?.onExit();fullView=false;host.classList.remove('expanded');document.body.classList.remove('scene-expanded');
 $('expandView').hidden=false;$('fullToolbar').hidden=true;$('fullBottom').hidden=true;
 outsideViewport.forEach(el=>el.inert=false);host.removeAttribute('role');host.removeAttribute('aria-modal');
 previousFocus?.focus();
}
$('expandView').onclick=enterFullView;$('backToStudio').onclick=leaveFullView;
$('fullEmergency').onclick=()=>{clearTimeout(sliderTimer);send('emergency');};
document.querySelectorAll('[data-room-view]').forEach(b=>b.onclick=()=>{controls.autoRotate=false;fit(b.dataset.roomView);});
host.addEventListener('keydown',e=>{if(!fullView||e.key!=='Tab')return;const buttons=[...host.querySelectorAll('button:not([hidden]):not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')].filter(b=>b.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
async function loadModel(){
 await roomReady;
 const xml=await fetch('./assets/reference/inmoov_ros_sim-master/urdf/sentience_gz.urdf').then(r=>{if(!r.ok)throw Error('Model file missing');return r.text();});
 const loaded=new Promise(resolve=>manager.onLoad=resolve);
 robot=loader.parse(xml);modelRoot.add(robot);robot.rotation.x=-Math.PI/2;robot.scale.setScalar(.1);
 await loaded;
 robot.traverse(o=>{if(o.isMesh){
  const name=o.parent?.name||'';
  // Servo case and end-cap groups identified from the source mesh atlas.
  // Shafts, gears and printed brackets retain their own material.
  const servo=/\.bicep\.full\.(008|009|010)$/.test(name)||/Arm\.shoulder\.full\.00[345]$/.test(name)||/Arm\.omoplate\.full(?:\.00[12])?$/.test(name)||/^i01\.torso\.topStom\.full(?:\.00[12]|\.009|\.01[01])?$/.test(name);
  const joint=/Arm\.(shoulder|omoplate)\./.test(name)||/Arm\.rotate\.full(?:\.00[1678]|\.010)?$/.test(name)||/nekHinge/.test(name);
  o.userData.isJoint=joint;
  const color=servo||joint?0x101318:/topStom/.test(name)?0xc7cdc7:0xdadfd8;
  o.userData.isServo=servo;o.castShadow=true;o.receiveShadow=true;o.material=new THREE.MeshStandardMaterial({color,metalness:servo?.02:.07,roughness:servo?.48:.56});o.userData.baseColor=o.material.color.clone();meshList.push(o);
 }});
 const lower=await new ColladaLoader().loadAsync('./assets/original/VinMoov4_Blender/i01.legs.dae');
 const legs=lower.scene;
 legs.scale.setScalar(.1);
 const extras=[];legs.traverse(o=>{if(o.isCamera||o.isLight)extras.push(o);});extras.forEach(o=>o.removeFromParent());
 legs.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.material=new THREE.MeshStandardMaterial({color:0xdadfd5,metalness:.12,roughness:.45});o.userData.baseColor=o.material.color.clone();meshList.push(o);}});
 modelRoot.add(legs);
 for(const link of ['base_node','stand_link'])robot.links[link]?.children.filter(o=>o.isURDFVisual).forEach(o=>o.visible=false);
 window.legModel=legs;
 const box=new THREE.Box3().setFromObject(modelRoot), center=box.getCenter(new THREE.Vector3());
 modelRoot.position.set(-center.x,-box.min.y,-center.z).add(environment.robotPosition);height=box.max.y-box.min.y;
 modelRoot.updateMatrixWorld(true);v2Assembly=await installV2Assembly(robot,meshList);readyModel=true;
 $('loading').hidden=true;fit('inside');fillCalibration();selectJoint(0);
 gesturePlayer=new GesturePlayer(robot,keys);
 immersive=createImmersiveUI({scene,camera,controls,environment,names,keys,beginDrag:()=>dragging=true,expand:enterFullView,fit,select:selectJoint,change,robot:()=>robot,meshes:()=>meshList,modelRoot:()=>modelRoot,selected:()=>selected,isPreview:()=>preview,isFullView:()=>fullView,gestureId:()=>gesturePlayer.active?.id,stopGesture:()=>{gesturePlayer.stop();update();},gesture:id=>{if(!preview)return;demo=false;gesturePlayer.start(id,performance.now(),visualAngles);update();}});
 window.studioDebug={robot,v2Assembly,immersive,gesturePlayer,modelRoot,scene,renderer,camera,controls,keys,environment,get fullView(){return fullView},get angles(){return [...visualAngles]},get targets(){return [...targetAngles]},get state(){return state},get preview(){return preview}};
}
loadModel().catch(e=>{$('loading').querySelector('strong').textContent='Model could not load';$('loadStatus').textContent=e.message;console.error(e);});
const raycaster=new THREE.Raycaster();let pointerStart;
renderer.domElement.addEventListener('pointerdown',e=>pointerStart=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup',e=>{
 if(!readyModel||!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
 const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
 if(!modelRoot.visible)return;
 const hits=raycaster.intersectObjects([...meshList,...environment.interactiveFrames]);
 const hit=hits.find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent;}return true;});
 if(hit){if(hit.object.userData.profile!==undefined)immersive.showWall(hit.object.userData.profile);else immersive.picked(hit);}

});
function belongs(mesh,joint){let o=mesh;while(o){if(o===joint)return true;o=o.parent;}return false;}
let last=performance.now();
function frame(now){
 const dt=Math.min(.05,(now-last)/1000);last=now;
 if(readyModel){
  if(preview&&gesturePlayer?.active){
   gesturePlayer.tick(now,targetAngles);previewAngles=[...targetAngles];
  }else if(preview&&demo){
   const t=(now-demoStart)/1000;
   for(let i=0;i<8;i++){const b=jointBounds(i),phase=t*.9+(i>=4?.55:0),a=i%4===3?25+22*Math.sin(phase):i%4===0?12+10*Math.sin(phase*.75):i%4===2?12+13*Math.sin(phase):7*Math.sin(phase);previewAngles[i]=targetAngles[i]=THREE.MathUtils.clamp(a,b[0],b[1]);}
   robot.setJointValue('i01.head.rothead_link_joint',Math.sin(t*.45)*.12);
   robot.setJointValue('i01.head.neck.001_link_joint',Math.sin(t*.6)*.04);
   for(const side of ['left','right'])for(const finger of ['index','majeure','ringFinger','pinky','thumb'])robot.setJointValue('i01.'+side+'Hand.'+finger+'_link_joint',(.5+.5*Math.sin(t*.8))*.18);
   if(Math.round(now/100)%2===0)update();
  }else{
   robot.setJointValue('i01.head.rothead_link_joint',0);robot.setJointValue('i01.head.neck.001_link_joint',0);
   for(const side of ['left','right'])for(const finger of ['index','majeure','ringFinger','pinky','thumb'])robot.setJointValue('i01.'+side+'Hand.'+finger+'_link_joint',0);
  }
  for(let i=0;i<8;i++){visualAngles[i]=THREE.MathUtils.damp(visualAngles[i],targetAngles[i],reduced?100:8,dt);robot.setJointValue(keys[i],visualAngles[i]*DEG);}
 v2Assembly?.update();
 const selectedJoint=modelRoot.visible&&(region==='left'||region==='right')?robot.joints[keys[selected]]:null;
  const activeJoint=now<activeUntil?robot.joints[keys[activeIndex]]:null;
  for(const mesh of meshList){
   const selectedMesh=selectedJoint&&belongs(mesh,selectedJoint),activeMesh=activeJoint&&belongs(mesh,activeJoint);
   mesh.material.emissive.setHex(activeMesh?0x287542:selectedMesh?0x285332:0x000000);
   mesh.material.emissiveIntensity=activeMesh?.32:.07;
  }
  if(selectedJoint){const pos=selectedJoint.getWorldPosition(new THREE.Vector3()).project(camera);const x=(pos.x*.5+.5)*host.clientWidth,y=(-pos.y*.5+.5)*host.clientHeight;
   $('jointTag').hidden=pos.z>1||x<0||y<0||x>host.clientWidth||y>host.clientHeight;
   $('jointTag').style.left=Math.min(host.clientWidth-155,x+18)+'px';$('jointTag').style.top=y+'px';
   $('jointTag').textContent=names[selected]+(preview?' · preview':state.confirmedEnabled[selected]?' · acknowledged':' · released');
  }else $('jointTag').hidden=true;
 }
 controls.update();renderer.render(scene,camera);requestAnimationFrame(frame);
}
selectJoint(0);poll();requestAnimationFrame(frame);
