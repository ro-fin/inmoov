import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const runtime=JSON.parse(fs.readFileSync(new URL('../studio_runtime.json',import.meta.url)));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const failed=[];page.on('requestfailed',r=>failed.push(r.url().split('#')[0]+' '+r.failure()?.errorText));
try {
 await page.goto(runtime.url+'&tab=motion');
 await expect.poll(()=>page.evaluate(()=>!!window.studioDebug?.ready),{timeout:60000}).toBe(true);
 await expect(page.locator('#loading')).toBeHidden();
 await expect(page.locator('[data-tab=motion]')).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>page.evaluate(()=>window.studioDebug.stage.renderer.info.render.triangles)).toBeGreaterThan(100000);
 const api=await page.request.get(runtime.url.split('#')[0]+'app.js');
 expect(api.headers()['cache-control']).toBe('no-store');
 // Regression: an unrelated UI callback must not permanently stop the 3D renderer.
 const before=await page.evaluate(()=>{
   const stage=window.studioDebug.stage;
   let thrown=false;const callback=()=>{if(!thrown){thrown=true;throw Error('Intentional rendering recovery test');}};
   stage.onFrame.push(callback);window.renderTestCallback=callback;
   return stage.renderer.info.render.frame;
 });
 await expect.poll(()=>page.evaluate(()=>window.studioDebug.stage.renderer.info.render.frame)).toBeGreaterThan(before+2);
 await page.evaluate(()=>{const stage=window.studioDebug.stage;stage.onFrame=stage.onFrame.filter(f=>f!==window.renderTestCallback);delete window.renderTestCallback;});
 expect(errors).toEqual([]);
 await page.screenshot({path:new URL('rendering-fixed.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
 await page.setViewportSize({width:342,height:572});
 await page.locator('#tFull').click();
 await expect(page.locator('#immPanel')).toBeHidden();
 await expect.poll(()=>page.locator('#viewport').evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(572);
 await expect.poll(()=>page.evaluate(async()=>{
   const THREE=await import('three');const {twin,stage}=window.studioDebug;
   const box=new THREE.Box3().setFromObject(twin.root);
   const points=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(stage.camera));
   return points.every(p=>Math.abs(p.x)<.95&&Math.abs(p.y)<.95);
 })).toBe(true);
 await page.locator('#immControls').click();await expect(page.locator('#immPanel')).toBeVisible();
 await page.locator('#immControlsClose').click();await expect(page.locator('#immPanel')).toBeHidden();
 await page.screenshot({path:new URL('full-view-visible.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
 console.log('PASS: visible full body, narrow-pane camera fit, unobstructed full view, controls toggle, fresh scripts and animation-loop recovery. No motor commands sent.');
} catch(e) {console.error('Display diagnostics:',errors.slice(0,5),failed.slice(0,8));console.error(await page.locator('#loadText').textContent());throw e;}
finally {await browser.close();}
