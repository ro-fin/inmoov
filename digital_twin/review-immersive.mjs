import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>console.log('ERROR',e.message));page.on('response',r=>{if(r.status()>=400)console.log('FAILED',new URL(r.url()).pathname)});
await page.goto(JSON.parse(fs.readFileSync('../studio_runtime.json','utf8')).url);await page.waitForFunction(()=>window.studioDebug,{timeout:90000});
await page.locator('#openRobot').click();await page.locator('[data-room-view=front]').click();
for(const id of ['hi','stop','vanakkam']){
 await page.locator('[data-gesture='+id+']').click();await page.waitForTimeout(2300);await page.screenshot({path:'gesture-'+id+'.png'});
}
await page.locator('#gestureReset').click();
console.log(await page.evaluate(async()=>{
 const T=await import('./node_modules/three/build/three.module.js'),d=window.studioDebug;
 const wrist=Object.fromEntries(['left','right'].map(side=>[side,d.robot.links['i01.'+side+'Hand.wrist.001_link'].getWorldPosition(new T.Vector3()).toArray()]));
 return {wrist,modelBox:new T.Box3().setFromObject(d.modelRoot).getSize(new T.Vector3()).toArray()};
}));
await page.locator('[data-tab=parts]').click();await page.locator('#partSelect').selectOption({label:'JawV5'});await page.locator('#loadPart').click();await page.waitForTimeout(1700);await page.screenshot({path:'v2-jaw.png'});
await page.locator('#returnBody').click();await page.locator('#closeGlass').click();await page.locator('#openWall').click();await page.screenshot({path:'leadership-wall.png'});
await page.locator('#closeWall').click();await page.locator('[data-room-view=inside]').click();await page.screenshot({path:'cabin-inside.png'});
await page.setViewportSize({width:1440,height:1440});
await page.evaluate(async()=>{
 const T=await import('./node_modules/three/build/three.module.js'),d=window.studioDebug,all=[];
 for(const key of ['left_shoulder_x_link','left_shoulder_y_link','neck_link','torso_bottom_link','torso_z_link'])d.robot.links[key].children.filter(o=>o.isURDFVisual).forEach(v=>v.traverse(o=>{if(o.isMesh)all.push({name:v.name,mesh:o})}));
 d.scene.children.filter(o=>!o.isLight).forEach(o=>o.visible=false);
 const atlas=new T.Group();d.scene.add(atlas);d.scene.background.setHex(0xd2d8dd);
 all.forEach(({name,mesh},i)=>{
  const geo=mesh.geometry.clone();geo.center();geo.computeBoundingBox();const s=geo.boundingBox.getSize(new T.Vector3());geo.scale(...Array(3).fill(.92/Math.max(s.x,s.y,s.z)));
  const cell=new T.Group();cell.position.set((i%7-3)*1.5,(3-Math.floor(i/7))*1.5,0);atlas.add(cell);
  const m=new T.Mesh(geo,new T.MeshStandardMaterial({color:0xc5cfdb,roughness:.55}));m.rotation.set(-Math.PI/2,0,.4);cell.add(m);
  const c=document.createElement('canvas');c.width=512;c.height=64;const g=c.getContext('2d');g.fillStyle='#152c45';g.font='28px Arial';g.fillText(i+' '+name.replace('i01.','').replace('leftArm.','').replace('left.',''),3,38);
  const label=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(c)}));label.position.set(0,-.62,.5);label.scale.set(1.42,.18,1);cell.add(label);
 });
 d.camera.position.set(0,0,16);d.controls.target.set(0,0,0);d.controls.update();d.renderer.shadowMap.enabled=false;
 document.querySelectorAll('#viewport> :not(canvas)').forEach(el=>el.style.display='none');
 window.atlasNames=all.map((x,i)=>[i,x.name]);
});
await page.waitForTimeout(1000);await page.screenshot({path:'servo-atlas2.png'});console.log(await page.evaluate(()=>window.atlasNames));await browser.close();
