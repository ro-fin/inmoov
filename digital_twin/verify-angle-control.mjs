import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const actions=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(JSON.parse(fs.readFileSync('../studio_runtime.json')).url);
 await page.waitForFunction(()=>window.studioDebug,null,{timeout:90000});
 const mock=await page.evaluate(()=>structuredClone(studioDebug.state));
 Object.assign(mock,{ready:true,busy:true,playing:false,enabled:[true,...Array(7).fill(false)],positions:Array(8).fill(1500)});
 await page.route('**/api/state',r=>r.fulfill({json:mock}));
 await page.route('**/api/action',async r=>{const a=r.request().postDataJSON();actions.push(a);if(a.action==='move'){await new Promise(resolve=>setTimeout(resolve,100));mock.positions[a.index]=a.us;}await r.fulfill({json:mock});});
 await page.locator('#liveMode').click();await expect(page.locator('#applyAngle')).toBeEnabled();
 await page.locator('#jointAngle').fill('202');await page.locator('#applyAngle').click();
 await expect.poll(()=>actions.length).toBe(1);expect(actions[0]).toMatchObject({action:'move',index:0,us:1550,angleRange:[0,270000]});
 await page.waitForTimeout(250);actions.length=0;
 await page.evaluate(()=>{const slider=document.querySelector('#positionSlider');for(let i=0;i<30;i++){slider.value=150+i;slider.dispatchEvent(new Event('input',{bubbles:true}));}});
 await expect.poll(()=>actions.length).toBe(2);expect(actions[0].us).toBe(1511);expect(actions[1].us).toBe(1533);
 await page.waitForTimeout(250);actions.length=0;
 await page.evaluate(()=>{const slider=document.querySelector('#positionSlider');slider.value=180;slider.dispatchEvent(new Event('input',{bubbles:true}));slider.value=216;slider.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#emergency').click();});
 await page.waitForTimeout(350);
 expect(actions.some(a=>a.action==='emergency')).toBe(true);expect(actions.some(a=>a.us===1560)).toBe(false);
 expect(errors).toEqual([]);console.log('PASS: degree entry, calibrated angle packet, immediate first value, latest-value coalescing, emergency cancels unsent movement. All requests mocked.');
}finally{await browser.close();}
