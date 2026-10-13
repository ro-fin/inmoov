import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],failures=[],actions=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(new URL(r.url()).pathname)});
page.on('request',r=>{if(r.url().endsWith('/api/action'))actions.push(r.postDataJSON());});
try{
 await page.goto(JSON.parse(fs.readFileSync('../studio_runtime.json','utf8')).url);
 await page.waitForFunction(()=>window.studioDebug,null,{timeout:90000});
 const replacement=await page.evaluate(()=>{const a=studioDebug.v2Assembly;return {hidden:a.oldVisuals.every(o=>!o.visible),head:a.head.children.length,orange:a.parts.filter(o=>o.userData.isFinger).every(o=>o.material.color.getHex()===0xf47b20),fingers:a.parts.filter(o=>o.userData.isFinger).length,black:a.parts.filter(o=>o.userData.isJoint).every(o=>o.material.color.getHex()===0x11151b),neck:a.neck.children.length};});
 expect(replacement.hidden).toBe(true);expect(replacement.head).toBeGreaterThan(10);expect(replacement.orange).toBe(true);expect(replacement.fingers).toBeGreaterThanOrEqual(40);expect(replacement.black).toBe(true);expect(replacement.neck).toBeGreaterThan(8);
 await page.locator('#expandView').click();await page.locator('[data-room-view=front]').click();
 await page.waitForTimeout(500);
 const touch=await page.evaluate(async()=>{
  const T=await import('./node_modules/three/build/three.module.js'),d=window.studioDebug;
  const head=d.v2Assembly.head;
  d.camera.updateMatrixWorld();const p=new T.Box3().setFromObject(head).getCenter(new T.Vector3()).project(d.camera),r=document.querySelector('canvas').getBoundingClientRect(),ray=new T.Raycaster();
  for(const dx of [0,.01,-.01,.025,-.025])for(const dy of [0,.01,-.01,.025,-.025]){
   ray.setFromCamera(new T.Vector2(p.x+dx,p.y+dy),d.camera);
   if(ray.intersectObject(head,true).length)return {x:r.x+((p.x+dx)*.5+.5)*r.width,y:r.y+(-(p.y+dy)*.5+.5)*r.height};
  }
  throw Error('No visible head surface found');
 });
 await page.mouse.click(touch.x,touch.y);
 await expect(page.locator('#glassPanel')).toBeVisible();await expect(page.locator('#glassInspect')).toBeVisible();
 await page.locator('[data-tab=move]').click();await page.locator('#glassJoint').selectOption('3');
 await page.locator('#glassPlus').click();await expect(page.locator('#glassValue')).toHaveText('1°');
 for(const id of ['hi','bye','left','stop','vanakkam']){
  await page.locator('[data-gesture='+id+']').click();
  await expect(page.locator('[data-gesture='+id+']')).toHaveClass(/active/);
  await expect(page.locator('#gestureStatus')).toContainText('animated preview');
  await page.waitForTimeout(1500);
  const bounded=await page.evaluate(()=>{const d=window.studioDebug;return d.targets.every((v,i)=>Number.isFinite(v)&&v>=d.robot.joints[d.keys[i]].limit.lower*180/Math.PI-.01&&v<=d.robot.joints[d.keys[i]].limit.upper*180/Math.PI+.01);});
  expect(bounded).toBe(true);
 }
 await page.screenshot({path:'final-vanakkam.png'});
 await page.locator('#gestureReset').click();await page.waitForTimeout(700);
 await page.locator('[data-tab=inspect]').click();await page.locator('#shellView').check();
 const servo=await page.evaluate(()=>{let black=0,transparent=0;window.studioDebug.robot.traverse(o=>{if(o.isMesh){if(o.userData.isServo&&o.material.color.getHex()===0x101318&&!o.material.transparent)black++;if(!o.userData.isServo&&o.material.transparent)transparent++;}});return{black,transparent};});
 expect(servo.black).toBeGreaterThanOrEqual(18);expect(servo.transparent).toBeGreaterThan(100);
 await page.locator('[data-focus=head]').click();
 const solidHardware=await page.evaluate(()=>studioDebug.v2Assembly.parts.filter(o=>o.userData.isJoint).every(o=>!o.material.transparent));expect(solidHardware).toBe(true);
 await page.locator('[data-focus=neck]').click();await page.locator('[data-focus=head]').click();
 expect(await page.evaluate(()=>window.studioDebug.controls.minDistance)).toBeLessThan(.01);
 await page.screenshot({path:'final-inspection.png'});
 await page.locator('#shellView').uncheck();
 await page.locator('[data-tab=parts]').click();
 await expect(page.locator('#partSelect option')).not.toHaveCount(0);
 await page.locator('#partSelect').selectOption({label:'JawV5'});
 await page.locator('#loadPart').click();await expect(page.locator('#partDimensions')).toContainText('triangles',{timeout:20000});
 expect(await page.evaluate(()=>window.studioDebug.modelRoot.visible)).toBe(false);
 expect(await page.evaluate(()=>window.studioDebug.immersive.part.geometry.attributes.position.count)).toBe(10838*3);
 await expect(page.locator('#jointTag')).toBeHidden();
 await page.screenshot({path:'final-v2-workbench.png'});
 await page.locator('#partSide').click();await page.locator('#partFit').click();
 await page.locator('[data-room-view=front]').click();
 expect(await page.evaluate(()=>window.studioDebug.modelRoot.visible)).toBe(true);
 for(const group of ['Eyes','Neck','Left hand','Right hand']){await page.locator('#partGroup').selectOption(group);expect(await page.locator('#partSelect option').count()).toBeGreaterThan(0);await expect(page.locator('#downloadPart')).toHaveAttribute('href',await page.locator('#partSelect').inputValue());}
 await page.locator('#returnBody').click();expect(await page.evaluate(()=>window.studioDebug.modelRoot.visible)).toBe(true);
 await page.locator('#closeGlass').click();await page.locator('#openWall').click();await page.locator('#closeWall').click();
 const portrait=await page.evaluate(async()=>{const T=await import('./node_modules/three/build/three.module.js'),d=window.studioDebug,p=d.environment.interactiveFrames[1].getWorldPosition(new T.Vector3()).project(d.camera);return{x:(p.x*.5+.5)*innerWidth,y:(-p.y*.5+.5)*innerHeight};});
 await page.mouse.click(portrait.x,portrait.y);await expect(page.locator('#wallName')).toHaveText('Dinesh Kumar');
 await page.screenshot({path:'final-leadership.png'});
 await page.locator('#closeWall').click();await page.locator('[data-room-view=inside]').click();
 await page.screenshot({path:'final-cabin.png'});
 await page.locator('#backToStudio').click();
 await page.setViewportSize({width:390,height:844});await page.locator('#openRobot').click();
 await expect(page.locator('#glassPanel')).toBeInViewport();await expect(page.locator('#closeGlass')).toBeInViewport();
 await page.screenshot({path:'final-mobile-glass.png'});
 await page.locator('#backToStudio').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(actions).toHaveLength(0);
 // Fake feedback and intercept every POST before testing the floating real-mode controls.
 const mock=await page.evaluate(()=>structuredClone(window.studioDebug.state));
 Object.assign(mock,{ready:true,busy:true,playing:false,enabled:[true,...Array(7).fill(false)],positions:Array(8).fill(1500)});
 await page.route('**/api/action',route=>route.fulfill({json:mock}));
 await page.route('**/api/state',route=>route.fulfill({json:mock}));
 await page.locator('#openRobot').click();await page.locator('#glassRobotMode').click();await page.locator('#glassJoint').selectOption('0');
 await expect(page.locator('#glassPlus')).toBeEnabled();
 await expect(page.locator('[data-gesture=hi]')).toBeDisabled();
 await page.locator('#glassPlus').click();await expect.poll(()=>actions.length).toBe(1);
 expect(actions[0]).toMatchObject({action:'move',index:0,us:1501});
 await page.locator('#fullEmergency').click();await expect.poll(()=>actions.length).toBe(2);expect(actions[1].action).toBe('emergency');
 expect(errors).toEqual([]);expect(failures).toEqual([]);
 console.log('PASS: real mesh touch, glass controls, 5 bounded gestures, black motor cases, transparent shells, close focus, original V2 STL and dimensions, portrait interaction, mobile, mocked live controls and emergency; no actual hardware commands.');
}finally{await browser.close();}
