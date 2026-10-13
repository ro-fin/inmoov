import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1366,height:768},deviceScaleFactor:1});
const errors=[], actions=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().endsWith('/api/action'))actions.push(r.postDataJSON());});
const runtime=JSON.parse(fs.readFileSync('../studio_runtime.json','utf8'));
try {
 await page.goto(runtime.url);await page.waitForFunction(()=>window.studioDebug,null,{timeout:90000});
 await expect(page.locator('#loading')).toBeHidden();
 const mesh = await page.evaluate(()=>({legs:!!window.legModel,joints:window.studioDebug.keys.every(k=>window.studioDebug.robot.joints[k]),triangles:window.studioDebug.renderer.info.render.triangles}));
 expect(mesh.legs).toBe(true);expect(mesh.joints).toBe(true);expect(mesh.triangles).toBeGreaterThan(100000);
 await expect(page.locator('#emergency')).toBeDisabled();
 await page.locator('#plus').click();await page.waitForTimeout(750);
 const moved=await page.evaluate(()=>window.studioDebug.angles[0]);expect(moved).toBeGreaterThan(0);
 expect(actions.filter(a=>['move','enable'].includes(a.action))).toHaveLength(0);
 for(const side of ['left','right']){
  await page.locator('[data-region='+side+']').click();
  for(let i=side==='left'?0:4;i<(side==='left'?4:8);i++){
   await page.locator('[data-joint="'+i+'"]').click();
   await page.locator('#plus').click();
   await expect(page.locator('#pinBadge')).toHaveText('D'+[2,4,5,6,7,8,9,10][i]);
  }
 }
 await page.locator('#demo').click();await page.waitForTimeout(900);
 const before=await page.evaluate(()=>window.studioDebug.angles);
 await page.waitForTimeout(700);
 const after=await page.evaluate(()=>window.studioDebug.angles);
 expect(after.some((v,i)=>Math.abs(v-before[i])>.1)).toBe(true);
 await page.locator('#demo').click();
 await page.locator('#resetPose').click();
 await page.locator('[data-region=left]').click();
 await page.waitForTimeout(900);
 await page.screenshot({path:'preview.png',fullPage:true});
 const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+2);
 expect(noOverflow).toBe(true);
 await page.locator('#liveMode').click();
 await expect(page.locator('#positionSlider')).toBeDisabled();
 // Inject read-only fake telemetry to exercise the UI without touching a serial port.
 const mock=await page.evaluate(()=>structuredClone(window.studioDebug.state));
 Object.assign(mock,{ready:true,busy:true,enabled:[true,...Array(7).fill(false)],positions:[1540,...Array(7).fill(1500)],acknowledged:[1520,...Array(7).fill(null)],confirmedEnabled:[true,...Array(7).fill(false)],activity:[{id:99999999,time:'12:00:00',label:'Left omoplate · 1520 µs',stage:'Acknowledged',pin:2,us:1520}]});
 await page.route('**/api/state',route=>route.fulfill({json:mock}));
 await page.waitForTimeout(800);
 await expect(page.locator('#processed')).toHaveText('ACKNOWLEDGED');
 await expect(page.locator('#position')).toHaveText('1540');
 await expect(page.locator('#commandReadout')).toContainText('1520');
 const target=await page.evaluate(()=>window.studioDebug.targets[0]);
 expect(Math.abs(target-33)).toBeLessThan(.01); // ACK 1520 => 60% of visual 0..55.
 await page.screenshot({path:'acknowledged.png',fullPage:true});
 await page.unroute('**/api/state');
 await page.waitForTimeout(500);
 await page.locator('#previewMode').click();
 await page.setViewportSize({width:820,height:1000});await page.waitForTimeout(500);
 await page.screenshot({path:'tablet.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 await page.screenshot({path:'mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toHaveLength(0);
 console.log('PASS: full body, all 8 selections, preview isolation, animation, ACK/request separation, laptop/tablet/mobile layouts; '+mesh.triangles+' rendered triangles.');
} finally { await browser.close(); }
