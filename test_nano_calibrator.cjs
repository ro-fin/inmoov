const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const Motion = require('./nano_motion.js');
const profiles = Array.from({length:12},(_,i)=>({pin:i+2,name:'Servo',minUs:1000,maxUs:2000,restUs:1500}));
const settle = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
test('recording captures starting pose, pauses, home and off',()=>{
  let now=100; const r=new Motion.Recorder(()=>now);
  r.start([{type:'SET',pin:2,us:1600}]); now=350; r.capture({type:'SET',pin:2,us:1500,home:true});
  now=700; r.capture({type:'OFF',pin:2}); now=1100;
  const s=r.finish(); assert.equal(s.duration,1000); assert.deepEqual(s.events.map(e=>e.at),[0,0,250,600]);
  assert(Motion.validSequence(s,profiles));
});
test('validation rejects unsafe positions, pins and malformed timing',()=>{
  const make=e=>({duration:500,events:[{type:'ALL_OFF',at:0},e]});
  for(const e of [{type:'SET',pin:2,us:999,at:1},{type:'SET',pin:14,us:1500,at:1},{type:'SET',pin:2,us:1500,at:-1},{type:'OFF',pin:2,at:501},{type:'HOME',pin:2,at:1}]) assert.equal(Motion.validSequence(make(e),profiles),false);
  assert.equal(Motion.validSequence({duration:200,events:[{type:'ALL_OFF',at:0},{type:'OFF',pin:2,at:100},{type:'OFF',pin:3,at:99}]},profiles),false);
});
test('replay preserves delays and repeats until stopped',async()=>{
  let now=0,id=0; const jobs=new Map(),sent=[],cycles=[];
  const player=new Motion.Player({dispatch:async a=>sent.push([now,a.type]),onCycle:c=>cycles.push(c),now:()=>now,later:(fn,delay)=>{jobs.set(++id,{fn,time:now+delay});return id;},cancel:id=>jobs.delete(id)});
  player.start({duration:1000,events:[{type:'ALL_OFF',at:0},{type:'SET',pin:2,us:1500,at:250},{type:'OFF',pin:2,at:600}]});
  await settle();
  const advance=async target=>{while(true){const next=[...jobs].sort((a,b)=>a[1].time-b[1].time)[0];if(!next||next[1].time>target)break;now=next[1].time;jobs.delete(next[0]);next[1].fn();await settle();}now=target;};
  await advance(1249);assert.deepEqual(sent,[[0,'ALL_OFF'],[250,'SET'],[600,'OFF'],[1000,'ALL_OFF']]);assert.deepEqual(cycles,[1,2]);
  player.stop();await advance(5000);assert.equal(sent.length,4);
});
test('stop during an in-flight replay command cancels remaining events',async()=>{
  let resolve;const sent=[];const p=new Motion.Player({dispatch:a=>{sent.push(a);return new Promise(r=>resolve=r);}});
  p.start({duration:100,events:[{type:'ALL_OFF',at:0},{type:'SET',pin:2,us:1500,at:0}]});
  p.stop();resolve();await settle();assert.equal(sent.length,1);assert.equal(p.active,false);
});
function harness() {
  const elements=new Map();
  function element(){const children=new Map();return {value:'',textContent:'',disabled:false,files:[],classList:{toggle(){}},append(){},querySelector(s){if(!children.has(s))children.set(s,element());return children.get(s);},click(){},set innerHTML(v){this.html=v;}};}
  const document={hidden:false,activeElement:null,querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},createElement:element,addEventListener(){}};
  const intervals=[],timers=[],storage=new Map(),sent=[];
  const context=vm.createContext({NanoMotion:Motion,document,window:{addEventListener(){}},navigator:{serial:{addEventListener(){}}},performance:{now:()=>0},TextEncoder,TextDecoder,URL,Blob,console,
    setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}, fakeWriter:{write:async b=>sent.push(new TextDecoder().decode(b).trim())}});
  const run=code=>vm.runInContext(code,context);
  run(fs.readFileSync(require.resolve('./nano_calibrator.js'),'utf8'));
  return {run,elements,sent,storage,intervals};
}
test('UI starts off; every home enables at 1500 and respects calibrated limits',async()=>{
  const h=harness();assert.equal(h.run('cards.length'),12);assert.equal(h.run('cards.some(c=>c.enabled)'),false);
  h.run('writer=fakeWriter; ready=true; homeCommand=true; sync(); cards.forEach(c=>c.home.onclick())');await h.run('queue');
  assert.equal(h.sent.length,12);assert.equal(h.sent[0],'HOME,2');assert.equal(h.sent[11],'HOME,13');
  assert.equal(h.run('cards.every(c=>c.enabled && +c.slider.value===1500)'),true);
  h.run('cards[0].min.value=1600; sync()');assert.equal(h.run('cards[0].home.disabled'),true);
});
test('emergency discards queued moves and ends recording and replay',async()=>{
  const h=harness();h.run('writer=fakeWriter;ready=true;manual({type:"SET",pin:2,us:1700}); emergency()');await settle();
  assert.deepEqual(h.sent,['ALL_OFF']);assert.equal(h.run('cards.some(c=>c.enabled)'),false);
  h.run('recorder.start([]);emergency()');await settle();assert.equal(h.run('recorder.active'),false);assert.equal(h.run('player.active'),false);
});
test('legacy home uses SET; record, finish, session save and restore work',async()=>{
  const h=harness();h.run('writer=fakeWriter;ready=true;cards[0].home.onclick()');await settle();assert.equal(h.sent[0],'SET,2,1500');
  h.run('$("#record").onclick();manual({type:"SET",pin:2,us:1800});$("#finish").onclick();$("#save").onclick()');await settle();
  const saved=JSON.parse(h.storage.get('roboattis.nano.session.v2'));assert.equal(saved.version,2);assert.equal(saved.sequence.events.length,3);
  h.run('loadSession(JSON.parse(localStorage.getItem(KEY)))');await settle();assert.equal(h.run('cards.some(c=>c.enabled)'),false);assert.equal(h.run('sequence.events[2].us'),1800);
});
test('import validation is atomic and preserves current profiles on failure',()=>{
  const h=harness();assert.throws(()=>h.run('loadSession({format:"RoboAttis-Nano-Direct",version:2,servos:profiles(),sequence:{duration:200,events:[{type:"ALL_OFF",at:0},{type:"SET",pin:2,us:2500,at:50}]}})'));
  assert.equal(h.run('cards[0].max.value'),2000);
});
test('home clears a pending slider move and a changed limit blocks unsafe replay/save',async()=>{
  const h=harness();h.run('writer=fakeWriter;ready=true;pending.set(2,1900);cards[0].home.onclick();flushPending()');await h.run('queue');
  assert.deepEqual(h.sent,['SET,2,1500']);
  h.run('sequence={duration:200,events:[{type:"ALL_OFF",at:0},{type:"SET",pin:2,us:1900,at:100}]};cards[0].max.value=1800;sync()');
  assert.equal(h.elements.get('#play').disabled,true);assert.equal(h.elements.get('#export').disabled,true);assert.equal(h.elements.get('#save').disabled,true);
});
test('v3 connection preserves automatic home and duplicate identity does not release it',async()=>{
  const h=harness();h.run('writer=fakeWriter;receive(IDENTITY+",V3,AUTOHOME90");for(let pin=2;pin<=13;pin++)receive("STATE,"+pin+",1500");receive(IDENTITY+",V3,AUTOHOME90")');await h.run('queue');
  assert.deepEqual(h.sent,['STATUS']);assert.equal(h.run('cards.every(c=>c.enabled && +c.slider.value===1500)'),true);
  h.run('emergency();receive("STATE,2,1500")');await h.run('queue');assert.equal(h.run('cards.some(c=>c.enabled)'),false);assert.equal(h.sent.at(-1),'ALL_OFF');
});
