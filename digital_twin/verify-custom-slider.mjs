import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}), actions=[], errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 const runtime=JSON.parse(fs.readFileSync('../studio_runtime.json'));
 const response=await page.request.get(runtime.url.split('#')[0]+'api/state',{headers:{'X-Studio-Token':runtime.token}});
 const mock=await response.json();Object.assign(mock,{ready:true,busy:true,playing:false,recording:false,enabled:Array(8).fill(false),positions:Array(8).fill(1500)});
 for(const i of [0,4]){expect(mock.profiles[i].minUs).toBe(500);expect(mock.profiles[i].maxUs).toBe(2500);}
 await page.route('**/api/state',r=>r.fulfill({json:mock}));
 await page.route('**/api/action',r=>{const a=r.request().postDataJSON();actions.push(a);if(a.action==='move')mock.positions[a.index]=a.us;return r.fulfill({json:mock});});
 await page.goto(runtime.url);await page.waitForFunction(()=>window.studioDebug,null,{timeout:90000});
 for(const i of [0,4]){
  await page.locator('[data-region='+(i===0?'left':'right')+']').click();
  await expect(page.locator('#positionSlider')).toHaveAttribute('min','0');await expect(page.locator('#positionSlider')).toHaveAttribute('max','270');
 }
 await page.locator('[data-region=left]').click();mock.enabled[0]=true;
 await expect(page.locator('#positionSlider')).toBeEnabled();
 await page.locator('#jointAngle').fill('270');await page.locator('#applyAngle').click();
 await expect.poll(()=>actions.length).toBe(1);expect(actions[0]).toMatchObject({index:0,us:mock.profiles[0].maxUs,angleRange:[0,270000]});
 await page.locator('#openRobot').click();await expect(page.locator('#glassSlider')).toHaveAttribute('max','270');await expect(page.locator('#glassValue')).toContainText('°');await page.locator('#backToStudio').click();
 mock.enabled[0]=false;await page.locator('#sliderSettings summary').click();await expect(page.locator('#saveSlider')).toBeEnabled();
 await page.locator('#sliderMin').fill('270');await page.locator('#sliderMax').fill('0');await page.locator('#sliderStep').fill('0.5');await page.locator('#saveSlider').click();
 await expect(page.locator('#positionSlider')).toHaveAttribute('step','0.5');
 await page.reload();await page.waitForFunction(()=>window.studioDebug,null,{timeout:90000});
 await expect(page.locator('#sliderMin')).toHaveValue('270');await expect(page.locator('#positionSlider')).toHaveAttribute('step','0.5');
 mock.enabled[0]=true;await expect(page.locator('#applyAngle')).toBeEnabled();await page.locator('#jointAngle').fill('0');await page.locator('#applyAngle').click();
 await expect.poll(()=>actions.length).toBe(2);expect(actions[1]).toMatchObject({us:mock.profiles[0].maxUs,angleRange:[270000,0]});
 mock.enabled[4]=true;await page.locator('[data-region=right]').click();await expect(page.locator('#applyAngle')).toBeEnabled();
 for(const [angle,us,count] of [[0,500,3],[135,1500,4],[270,2500,5]]){
  await page.locator('#jointAngle').fill(String(angle));await page.locator('#applyAngle').click();
  await expect.poll(()=>actions.length).toBe(count);expect(actions.at(-1)).toMatchObject({index:4,us,angleRange:[0,270000]});
 }
 expect(errors).toEqual([]);console.log('PASS: both omoplates 0–270°, full-view degree slider, endpoint pulse bounds, customizable step, reversed direction and saved settings. All movement requests mocked.');
}catch(e){console.log({errors,loading:await page.locator('#loadStatus').textContent().catch(()=>null)});throw e;}finally {await browser.close();}
