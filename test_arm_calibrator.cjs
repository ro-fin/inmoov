const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const Motion = require('./arm_motion.js');
const profiles = Array.from({length:8},(_,i)=>({pin:i+2,name:'Servo',minUs:1000,maxUs:2000,restUs:1500}));
const settle = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
function harness() {
  const elements=new Map();
  function element(){const children=new Map();return {value:'',textContent:'',disabled:false,files:[],classList:{toggle(){}},append(){},querySelector(s){if(!children.has(s))children.set(s,element());return children.get(s);},click(){},set innerHTML(v){this.html=v;}};}
  const document={hidden:false,activeElement:null,querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},createElement:element,addEventListener(){}};
  const intervals=[],timers=[],storage=new Map(),sent=[];
  const context=vm.createContext({NanoMotion:Motion,document,window:{addEventListener(){}},navigator:{serial:{addEventListener(){}}},performance:{now:()=>0},TextEncoder,TextDecoder,URL,Blob,console,
    setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}, fakeWriter:{write:async b=>sent.push(new TextDecoder().decode(b).trim())}});
  const run=code=>vm.runInContext(code,context);
  run(fs.readFileSync(require.resolve('./arm_calibrator.js'),'utf8'));
  return {run,elements,sent,storage,intervals};
}

test('eight named joints connect with outputs off',async()=>{const h=harness();assert.equal(h.run('cards.length'),8);assert.equal(h.run('cards[7].name.value'),'Right bicep');h.run('writer=fakeWriter;receive(IDENTITY)');await h.run('queue');assert.deepEqual(h.sent,['ALL_OFF']);assert.equal(h.run('cards.some(c=>c.enabled)'),false)});
test('custom home saves and restores without motion',async()=>{const h=harness();h.run('writer=fakeWriter;ready=true;manual({type:"SET",pin:2,us:1540})');await h.run('queue');h.run('cards[0].setHome.onclick();cards[0].home.onclick()');await h.run('queue');assert.equal(h.sent.at(-1),'SET,2,1540');h.run('loadSession(JSON.parse(localStorage.getItem(KEY)))');await h.run('queue');assert.equal(h.run('cards[0].rest.value'),1540);assert.equal(h.run('cards.some(c=>c.enabled)'),false)});
test('emergency cancels queued moves and recording',async()=>{const h=harness();h.run('writer=fakeWriter;ready=true;manual({type:"SET",pin:2,us:1550});recorder.start([]);emergency()');await settle();assert.deepEqual(h.sent,['ALL_OFF']);assert.equal(h.run('recorder.active || player.active || cards.some(c=>c.enabled)'),false)});
test('home only moves enabled joints',async()=>{const h=harness();h.run('writer=fakeWriter;ready=true;cards[0].enable.onclick()');await h.run('queue');h.sent.length=0;h.run('$("#homeAll").onclick()');await h.run('queue');assert.deepEqual(h.sent,['SET,2,1500'])});
test('recording saves and validates',async()=>{const h=harness();h.run('writer=fakeWriter;ready=true;cards[0].enable.onclick()');await h.run('queue');h.run('$("#record").onclick();manual({type:"SET",pin:2,us:1560});$("#finish").onclick();$("#save").onclick()');await h.run('queue');const s=JSON.parse(h.storage.get('roboattis.arms.session.v1'));assert.equal(s.sequence.events.length,3);assert(Motion.validSequence(s.sequence,s.servos))});
test('unsafe imports preserve profiles',()=>{const h=harness();assert.throws(()=>h.run('loadSession({format:"RoboAttis-Nano-Arms",version:1,servos:profiles(),sequence:{duration:200,events:[{type:"ALL_OFF",at:0},{type:"SET",pin:10,us:1500,at:50}]}})'));assert.equal(h.run('cards[0].max.value'),1600)});
test('player once ends and loop repeats; stop cancels further dispatch',async()=>{for(const loop of [false,true]){let now=0,id=0;const jobs=new Map(),sent=[];const p=new Motion.Player({dispatch:async a=>sent.push(a.type),now:()=>now,later:(fn,delay)=>{jobs.set(++id,{fn,time:now+delay});return id},cancel:id=>jobs.delete(id)});p.start({duration:100,events:[{type:'ALL_OFF',at:0},{type:'SET',pin:2,us:1500,at:50}]},loop);await settle();const advance=async target=>{while(true){const n=[...jobs].sort((a,b)=>a[1].time-b[1].time)[0];if(!n||n[1].time>target)break;now=n[1].time;jobs.delete(n[0]);n[1].fn();await settle()}now=target};await advance(120);assert.equal(p.active,loop);assert.equal(sent.length,loop?3:2);p.stop();const count=sent.length;await advance(500);assert.equal(sent.length,count)}});

