import {chromium} from '@playwright/test';import fs from 'node:fs';
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:1800,height:1200}});await p.goto(JSON.parse(fs.readFileSync('../studio_runtime.json')).url);await p.waitForFunction(()=>window.studioDebug,null,{timeout:90000});await p.locator('#expandView').click();
console.log(await p.evaluate(async()=>{
 const T=await import('./node_modules/three/build/three.module.js'),L=(await import('./node_modules/three/examples/jsm/loaders/STLLoader.js')).STLLoader,d=window.studioDebug;
 const points={};for(const k of ['i01.head.rothead_link','neck_link','i01.head.neck.001_link','torso_y_link','i01.leftHand.wrist.001_link','i01.rightHand.wrist.001_link','i01.rightHand.majeure_link','i01.rightHand.majeure2_link','i01.rightHand.index_link','i01.rightHand.pinky_link'])points[k]=d.robot.links[k].getWorldPosition(new T.Vector3()).toArray();
 const names=['TopskullFrontV1-0','TopskullFrontV1-1','TopskullFrontV1-2','TopskullFrontV1-3'].flatMap(n=>Array(6).fill('derived/'+n));
 const geos=await Promise.all(names.map(n=>new L().loadAsync('./assets/inmoov-v2/'+n+'.stl')));
 d.scene.children.filter(o=>!o.isLight).forEach(o=>o.visible=false);const group=new T.Group();d.scene.add(group);d.scene.background.setHex(0xd3dbe3);
 geos.forEach((g,i)=>{g.center();g.computeBoundingBox();const s=g.boundingBox.getSize(new T.Vector3());g.scale(...Array(3).fill(1/Math.max(s.x,s.y,s.z)));
 const cell=new T.Group();cell.position.set((i%6-2.5)*1.8,(1.5-Math.floor(i/6))*1.8,0);group.add(cell);const mesh=new T.Mesh(g,new T.MeshStandardMaterial({color:0xb6c9d4,roughness:.55}));mesh.rotation.set(...[[0,0,0],[Math.PI,0,0],[Math.PI/2,0,0],[-Math.PI/2,0,0],[0,Math.PI,0],[0,0,Math.PI]][i%6]);cell.add(mesh);
 const c=document.createElement('canvas');c.width=512;c.height=70;const ctx=c.getContext('2d');ctx.font='25px Arial';ctx.fillStyle='#183751';ctx.fillText(i+' '+names[i].split('/').at(-1),3,40);const sprite=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(c)}));sprite.position.set(0,-.75,.6);sprite.scale.set(1.7,.23,1);cell.add(sprite);
 });
 d.camera.position.set(0,0,12);d.controls.target.set(0,0,0);d.controls.update();d.renderer.shadowMap.enabled=false;document.querySelectorAll('#viewport> :not(canvas)').forEach(e=>e.style.display='none');return points;
}));await p.waitForTimeout(1000);await p.screenshot({path:'v2-front-orientations.png'});await b.close();
