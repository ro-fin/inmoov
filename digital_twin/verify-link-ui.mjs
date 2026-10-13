import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const runtime=JSON.parse(fs.readFileSync(new URL('../studio_runtime.json',import.meta.url)));
const base=runtime.url.split('#')[0], headers={'X-Studio-Token':runtime.token};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(runtime.url);
  await expect.poll(()=>page.workers().length,{timeout:10000}).toBeGreaterThanOrEqual(1);
  const worker=page.workers().find(w=>w.url().endsWith('link-heartbeat.js'));
  expect(worker).toBeTruthy();
  await expect.poll(()=>worker.evaluate(()=>self.linkHeartbeatStats?.count||0),{timeout:10000}).toBeGreaterThanOrEqual(2);
  const unauthorized=await page.request.get(base+'api/heartbeat');
  expect(unauthorized.status()).toBe(403);
  let response=await page.request.get(base+'api/state',{headers}),state=await response.json();
  expect(state.enabled.some(Boolean)).toBe(false);
  if(!state.busy) {
    response=await page.request.post(base+'api/action',{headers,data:{action:'refresh'}});state=await response.json();
    const port=state.ports.find(p=>p.startsWith('COM3 '));expect(port).toBeTruthy();
    response=await page.request.post(base+'api/action',{headers,data:{action:'connect',port}});expect(response.ok()).toBe(true);
  }
  await expect.poll(async()=>{
    response=await page.request.get(base+'api/state',{headers});state=await response.json();return state.ready;
  },{timeout:12000}).toBe(true);
  const before=await worker.evaluate(()=>self.linkHeartbeatStats.count);
  // Block renderer longer than the browser grace period. Worker keeps contact.
  await page.evaluate(()=>{const end=performance.now()+7000;while(performance.now()<end){};});
  const during=(await worker.evaluate(()=>self.linkHeartbeatStats.count))-before;
  expect(during).toBeGreaterThanOrEqual(4);
  response=await page.request.get(base+'api/state',{headers});state=await response.json();
  expect(state.ready).toBe(true);expect(state.link.browserPaused).toBe(false);
  expect(state.enabled.some(Boolean)).toBe(false);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({connected:state.ready,workerHeartbeatsDuringMainThreadPause:during,link:state.link,outputs:'all off'}));
}catch(e){console.log('UI errors:',errors);throw e;}finally{await browser.close();}
