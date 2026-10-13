import {chromium, expect} from '@playwright/test';
import fs from 'node:fs';
const runtime = JSON.parse(fs.readFileSync(new URL('../studio_runtime.json', import.meta.url)));
const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const actions = [], errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  const r = await page.request.get(runtime.url.split('#')[0]+'api/state', {headers:{'X-Studio-Token':runtime.token}});
  const mock = await r.json();
  expect(mock.profiles.map(p => p.pin)).toEqual([2,3,4,5,6,7,8,9]);
  Object.assign(mock, {ready:true,busy:true,enabled:Array(8).fill(true),positions:Array(8).fill(1500),playing:false,recording:false});
  mock.profiles.forEach(p=>p.reversed=false);
  await page.route('**/api/state', route => route.fulfill({json:mock}));
  await page.route('**/api/action', route => {
    const a = route.request().postDataJSON(); actions.push(a);
    if(a.action==='move') { mock.positions[a.index]=a.us; mock.acknowledged[a.index]=a.us; }
    if(a.action==='calibrate') mock.profiles[a.index].reversed=a.reversed;
    return route.fulfill({json:mock});
  });
  await page.goto(runtime.url);
  await page.waitForFunction(() => window.studioDebug?.ready, null, {timeout:15000});
  const joints=['leftOmoplate','leftRotate','leftShoulder','leftBicep','rightOmoplate','rightRotate','rightShoulder','rightBicep'];
  for(let i=0;i<8;i++) {
    await page.evaluate(id => window.studioDebug.select(id), joints[i]);
    await expect(page.locator('#jPin')).toHaveText('D'+(i+2));
    await expect(page.locator('#immChip')).toHaveText('D'+(i+2));
    await expect(page.locator('#jSlider')).toHaveAttribute('min','0');
    await expect(page.locator('#jSlider')).toHaveAttribute('max','270');
    for(const [angle,us] of [[0,500],[135,1500],[270,2500]]) {
      const count=actions.length;
      await page.locator('#jAngle').fill(String(angle));
      await page.locator('#jApply').click();
      await expect.poll(() => actions.length).toBe(count+1);
      expect(actions.at(-1)).toMatchObject({action:'move',index:i,us,angleRange:[0,270000]});
    }
  }
  for(let i=4;i<8;i++) {
    await page.evaluate(id=>window.studioDebug.select(id),joints[i]);
    mock.enabled[i]=false;
    const reverse=page.locator('#reverseServo');
    await expect(reverse).toBeEnabled();
    await reverse.evaluate(el=>el.closest('details').open=true);
    await reverse.check();
    await expect.poll(()=>mock.profiles[i].reversed).toBe(true);
    expect(mock.profiles.slice(0,4).every(p=>!p.reversed)).toBe(true);
    mock.enabled[i]=true;
    await expect(page.locator('#jApply')).toBeEnabled();
    for(const [angle,us] of [[0,2500],[135,1500],[270,500]]) {
      const count=actions.length;
      await page.locator('#jAngle').fill(String(angle));
      await page.locator('#jApply').click();
      await expect.poll(()=>actions.length).toBe(count+1);
      expect(actions.at(-1)).toMatchObject({action:'move',index:i,us,angleRange:[270000,0]});
      const ranges=[[0,80],[-70,70],[-30,150],[0,95]],range=ranges[i-4];
      await expect.poll(()=>page.evaluate(id=>window.studioDebug.targets[id],joints[i])).toBe(range[0]+angle/270*(range[1]-range[0]));
    }
    await expect(reverse).toBeDisabled();
  }
  expect(errors).toEqual([]);
  console.log('PASS: D2–D9 labels, all eight 0–270° controls, all four right-arm reversals, correct twin acknowledgement mapping; 36 movement commands mocked.');
} catch(e) {
  console.log('UI errors:', errors);
  console.log('Loading:',await page.locator('#loadText').textContent());
  throw e;
} finally { await browser.close(); }
