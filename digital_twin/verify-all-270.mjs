import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),actions=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 const runtime=JSON.parse(fs.readFileSync(new URL('../studio_runtime.json',import.meta.url)));
 const response=await page.request.get(runtime.url.split('#')[0]+'api/state',{headers:{'X-Studio-Token':runtime.token}});
 const mock=await response.json();
 Object.assign(mock,{ready:true,busy:true,playing:false,recording:false,enabled:Array(8).fill(true),positions:Array(8).fill(1500)});
 // Test the new configuration independently of the real robot's enabled state.
 mock.profiles.forEach(p=>{p.minUs=500;p.maxUs=2500;});
 await page.addInitScript(()=>{if(!localStorage.getItem('test-legacy-seeded')){
  localStorage.setItem('inmoov-servo-sliders',JSON.stringify({ranges:Array.from({length:8},()=>[0,80]),steps:Array(8).fill(1)}));
  localStorage.setItem('test-legacy-seeded','1');
 }});
 await page.route('**/api/state',r=>r.fulfill({json:mock}));
 await page.route('**/api/action',r=>{const a=r.request().postDataJSON();actions.push(a);if(a.action==='move')mock.positions[a.index]=a.us;return r.fulfill({json:mock});});
 await page.goto(runtime.url);await page.waitForFunction(()=>window.studioDebug,null,{timeout:90000});
 for(let i=0;i<8;i++){
  await page.locator('[data-region='+(i<4?'left':'right')+']').click();
  await page.locator('[data-joint="'+i+'"]').click();
  await expect(page.locator('#pinBadge')).toHaveText('D'+[2,4,5,6,7,8,9,10][i]);
  await expect(page.locator('#positionSlider')).toHaveAttribute('min','0');
  await expect(page.locator('#positionSlider')).toHaveAttribute('max','270');
  for(const [angle,us] of [[0,500],[135,1500],[270,2500]]){
   const count=actions.length;await page.locator('#jointAngle').fill(String(angle));await page.locator('#applyAngle').click();
   await expect.poll(()=>actions.length).toBe(count+1);
   expect(actions.at(-1)).toMatchObject({action:'move',index:i,us,angleRange:[0,270000]});
  }
 }
 expect(await page.evaluate(()=>!!localStorage.getItem('inmoov-servo-sliders-before-all-270'))).toBe(true);
 await page.locator('#openRobot').click();await expect(page.locator('#glassSlider')).toHaveAttribute('max','270');
 expect(errors).toEqual([]);console.log('PASS: all 8 sliders migrate to 0–270°, each sends 500/1500/2500 us at 0/135/270°, full-view range correct; all movement mocked.');
}finally{await browser.close();}
