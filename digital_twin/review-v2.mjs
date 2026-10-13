import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(JSON.parse(fs.readFileSync('../studio_runtime.json','utf8')).url);
await page.waitForFunction(()=>window.studioDebug,null,{timeout:90000});
await page.locator('#expandView').click();
for(const [name,kind] of [['v2-head','head'],['v2-hand','hand'],['v2-neck','neck']]){
 await page.evaluate(kind=>{const d=studioDebug;const o=kind==='head'?d.v2Assembly.head:kind==='neck'?d.v2Assembly.neck:d.v2Assembly.hands.right;const p=o.getWorldPosition(d.controls.target.clone());if(kind==='head')p.y+=.09;if(kind==='neck')p.y+=.06;d.controls.target.copy(p);d.camera.position.copy(p).add({x:kind==='hand'?.27:.09,y:kind==='hand'?.05:.03,z:kind==='hand'?.3:.42});d.controls.update();},kind);
 await page.waitForTimeout(500);await page.screenshot({path:name+'.png'});
}
console.log(JSON.stringify({errors,counts:await page.evaluate(()=>({parts:studioDebug.v2Assembly.parts.length,hidden:studioDebug.v2Assembly.oldVisuals.every(v=>!v.visible)}))}));
console.log(JSON.stringify(await page.evaluate(async()=>{const T=await import('three'),out=[];studioDebug.robot.traverse(o=>{if(!o.isMesh||o.userData.v2)return;let p=o,visible=true;while(p){if(!p.visible)visible=false;p=p.parent;}if(!visible)return;const b=new T.Box3().setFromObject(o),c=b.getCenter(new T.Vector3());if(c.y>1.47&&c.y<1.61)out.push({name:o.parent.name,c:c.toArray(),size:b.getSize(new T.Vector3()).toArray()});});return out;})));
await browser.close();
