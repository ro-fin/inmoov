import {chromium} from '@playwright/test';import fs from 'node:fs';
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});const p=await b.newPage();await p.goto(JSON.parse(fs.readFileSync('../studio_runtime.json')).url);await p.waitForFunction(()=>window.studioDebug,{timeout:90000});
console.log(JSON.stringify(await p.evaluate(async()=>{
 const T=await import('./node_modules/three/build/three.module.js'),d=window.studioDebug,r=d.robot,D=Math.PI/180,results={};
 for(const side of ['left','right']){
  const joints=[...d.keys.slice(side==='left'?0:4,side==='left'?4:8),side+'_wrist_z_link_joint','i01.'+side+'Hand.wrist.001_link_joint'].map(k=>r.joints[k]);
  const point=n=>r.links['i01.'+side+'Hand.'+n+'_link'].getWorldPosition(new T.Vector3());
  const goal=new T.Vector3(.85+(side==='left'?.025:-.025),1.23,.87);
  function cost(a){joints.forEach((j,i)=>j.setJointValue(a[i]*D));r.updateMatrixWorld(true);const wrist=point('wrist.001'),middle=point('majeure3'),index=point('index'),pinky=point('pinky');const c=index.clone().add(pinky).multiplyScalar(.25).addScaledVector(wrist,.5),long=middle.clone().sub(wrist).normalize(),normal=index.clone().sub(wrist).cross(pinky.clone().sub(wrist)).normalize();return c.distanceToSquared(goal)*30+long.distanceToSquared(new T.Vector3(0,1,0))*.3+Math.pow(1-Math.abs(normal.x),2)*.3;}
  let best=null;
  for(const seed of [[8,side==='left'?-60:60,40,90,side==='left'?-28:28,0],[5,side==='left'?-40:40,50,90,0,70],[20,side==='left'?-60:60,60,80,side==='left'?-80:80,40]]){
   let a=[...seed],score=cost(a);
   for(const step of [25,12,6,3,1,.4])for(let iter=0;iter<15;iter++){let changed=false;for(let i=0;i<6;i++)for(const sign of [-1,1]){const v=T.MathUtils.clamp(a[i]+step*sign,joints[i].limit.lower/D,joints[i].limit.upper/D),trial=[...a];trial[i]=v;const c=cost(trial);if(c<score){a=trial;score=c;changed=true;}}if(!changed)break;}
   if(!best||score<best.score)best={angles:a,score};
  }
  cost(best.angles);results[side]=best;
 }
 return results;
}),null,2));await b.close();

