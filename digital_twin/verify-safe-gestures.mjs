import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {offsetFromPulse,pulseFromOffset,pulseToVisual,visualToPulse} from './safety-controls.js';
const runtime=JSON.parse(fs.readFileSync(new URL('../studio_runtime.json',import.meta.url)));
const base=runtime.url.split('#')[0],headers={'X-Studio-Token':runtime.token};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[],actions=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 const response=await page.request.get(base+'api/state',{headers});
 const real=await response.json();
 expect(real.profiles.slice(0,4).map(p=>[p.pin,p.minUs,p.maxUs,p.restUs])).toEqual([[2,1389,1604,1600],[3,1204,1685,1500],[4,1093,1856,1626],[5,1004,1604,1604]]);
 expect(real.profiles.slice(4).every(p=>p.reversed)).toBe(true);
 // The operator may be using the real page. All test controls below are isolated mocks.
 for(const r of real.safety) {
   expect(pulseFromOffset(r,0)).toBe(r.homeUs);
   expect(offsetFromPulse(r,r.homeUs)).toBe(0);
   expect(pulseFromOffset(r,r.offsetMax)).toBe(r.minUs);
   expect(()=>pulseFromOffset(r,r.offsetMax+1)).toThrow();
   expect(()=>pulseFromOffset(r,NaN)).toThrow();
   expect(pulseToVisual(r,r.homeUs,[80,0])).toBe(0);
   expect(visualToPulse(r,0,[80,0])).toBe(r.homeUs);
 }
 const mock=structuredClone(real);
 Object.assign(mock,{ready:true,busy:true,playing:false,recording:false,positions:mock.profiles.map(p=>p.restUs),enabled:Array(8).fill(false),confirmedEnabled:Array(8).fill(false),acknowledged:Array(8).fill(null),gesture:{active:false}});
 await page.route('**/api/state',route=>route.fulfill({json:mock}));
 await page.route('**/api/action',route=>{
   const a=route.request().postDataJSON();actions.push(a);
   if(['enable','home','move'].includes(a.action)) {const v=a.action==='move'?a.us:mock.profiles[a.index].restUs;mock.positions[a.index]=mock.acknowledged[a.index]=v;mock.enabled[a.index]=mock.confirmedEnabled[a.index]=true;}
   if(a.action==='gesture') {mock.gesture={active:true,name:a.name,label:a.name,phase:'raise',loop:a.loop,cycles:0};mock.playing=true;}
   if(a.action==='gesture_loop')mock.gesture.loop=a.value;
   if(a.action==='gesture_stop'){mock.gesture={active:false};mock.playing=false;mock.enabled.fill(false);mock.confirmedEnabled.fill(false);}
   return route.fulfill({json:mock});
 });
 await page.goto(runtime.url);
 await page.waitForFunction(()=>window.studioDebug?.ready,null,{timeout:90000});
 const visualDirection=await page.evaluate(async()=>{
   const {JOINT}=await import('./twin.js');
   const {twin}=window.studioDebug;
   return ['leftOmoplate','leftRotate','leftShoulder','leftBicep'].map(id=>{
     const j=JOINT[id];
     twin.setVisualReversed(id,false);twin.set(id,20);
     const delta=j.rest[0].clone().invert().multiply(j.pivots[0].quaternion);
     twin.setVisualReversed(id,true);
     const reversed=j.rest[0].clone().invert().multiply(j.pivots[0].quaternion);
     const correct=Math.abs(delta.invert().dot(reversed))>1-1e-8;
     twin.set(id,0);const home=j.pivots[0].quaternion.angleTo(j.rest[0])<1e-6;
     twin.setVisualReversed(id,false);
     return correct&&home;
   });
 });
 expect(visualDirection).toEqual([true,true,true,true]);
 await page.locator('#jHardware details').last().evaluate(el=>el.open=true);
 const actionCount=actions.length;
 await page.locator('#reverseTwin').check();
 expect(actions.length).toBe(actionCount);
 await page.locator('#reverseTwin').uncheck();
 for(const id of ['leftOmoplate','leftRotate','leftShoulder','leftBicep']) {
   await page.evaluate(id=>window.studioDebug.select(id),id);
   await expect(page.locator('#jValue')).toHaveText('0');
   await page.locator('#jEnable').click();
   await page.locator('#jPlus').click();
   await expect.poll(()=>actions.filter(a=>a.action==='move').length).toBeGreaterThan(0);
   await page.locator('#jHome').click();
 }
 await page.evaluate(()=>window.studioDebug.select('leftBicep'));
 await expect(page.locator('#jMax')).toHaveText('68');
 await page.locator('#jAngle').fill('68');await page.locator('#jApply').click();
 await expect.poll(()=>actions.filter(a=>a.action==='move').at(-1)?.us).toBe(1004);
 expect(actions.filter(a=>a.action==='move').every(a=>{const p=mock.profiles[a.index];return a.us>=p.minUs&&a.us<=p.maxUs&&!('angleRange' in a);})).toBe(true);
 await page.locator('#jHome').click();
 mock.enabled.fill(false);mock.confirmedEnabled.fill(false);mock.acknowledged.fill(null);
 await page.evaluate(()=>window.studioDebug.setTab('motion'));
 await expect(page.locator('[data-robot-gesture=hi]')).toBeDisabled();
 await page.locator('#gestureHomeConfirmed').check();
 await page.locator('#gestureLoop').check();
 await page.locator('[data-robot-gesture=hi]').click();
 await expect.poll(()=>actions.find(a=>a.action==='gesture')?.loop).toBe(true);
 await expect(page.locator('[data-robot-gesture=left]')).toBeDisabled();
 await page.locator('#gestureLoop').uncheck();
 await expect.poll(()=>actions.filter(a=>a.action==='gesture_loop').at(-1)?.value).toBe(false);
 await page.keyboard.press('Escape');
 await expect(page.locator('#gestureStop')).toBeDisabled();
 for(const p of mock.profiles.slice(0,4))mock.acknowledged[p.pin-2]=p.restUs;
 await expect.poll(()=>page.evaluate(()=>['leftOmoplate','leftRotate','leftShoulder','leftBicep'].map(id=>Math.abs(window.studioDebug.targets[id])<.001))).toEqual([true,true,true,true]);
 await expect.poll(()=>actions.filter(a=>a.action==='gesture_stop').length).toBe(1);
 await expect(page.locator('#gestureHomeConfirmed')).not.toBeChecked();
 await page.locator('#gestureHomeConfirmed').check();
 await page.locator('#gestureHomeConfirmed').blur();
 await page.keyboard.press('Alt+4');
 await expect.poll(()=>actions.filter(a=>a.action==='gesture').at(-1)?.name).toBe('sequence');
 await page.keyboard.press('Escape');
 await expect(page.locator('#gestureStop')).toBeDisabled();
 await page.screenshot({path:new URL('safe-gestures-preview.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
 for(const width of [820,390]) {await page.setViewportSize({width,height:900});await page.waitForTimeout(300);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 expect(errors).toEqual([]);
 console.log('PASS: safe home-zero sliders, neutral visual homes, independent twin direction for all four joints, bounded commands, loop/Stop/Escape/sequence keys and responsive layout. All movement requests mocked.');
} finally {await browser.close();}
