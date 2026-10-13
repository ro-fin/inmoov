import * as THREE from 'three';
const D=Math.PI/180;
const smooth=x=>x*x*(3-2*x);
export const gestures={
 hi:{label:'Hi',duration:5.5,pose:[8,0,0,8,26,-20,70,85]},
 bye:{label:'Bye',duration:6,pose:[8,0,0,8,38,-15,78,80]},
 left:{label:'Go left',duration:5.5,pose:[75,0,8,10,8,0,0,8]},
 stop:{label:'Stop',duration:5,pose:[8,0,0,8,12,0,65,30]},
 vanakkam:{label:'Vanakkam · வணக்கம்',duration:6,pose:[10.6,-68.2,47.2,52,7.8,58.6,41.4,52.4],wrists:[83.6,-77.6],wristBends:[90,88.4]}
};
export class GesturePlayer{
 constructor(robot,keys){this.robot=robot;this.keys=keys;this.active=null;this.lastAux={};}
 start(id,now,angles){if(!gestures[id])return;this.active={id,start:now,from:[...angles]};}
 stop(){this.active=null;this.resetAux();}
 resetAux(){for(const name of Object.keys(this.lastAux))this.robot.setJointValue(name,0);this.lastAux={};}
 aux(name,v){const j=this.robot.joints[name];if(!j)return;v=THREE.MathUtils.clamp(v,j.limit.lower,j.limit.upper);this.robot.setJointValue(name,v);this.lastAux[name]=v;}
 tick(now,targets){
  if(!this.active)return false;
  const {id,start,from}=this.active,g=gestures[id],t=(now-start)/1000;
  if(t>=g.duration){targets.fill(0);this.stop();return false;}
  const enter=smooth(Math.min(1,t/1.25)),leave=smooth(Math.min(1,(g.duration-t)/1.15)),weight=enter*leave;
  const p=[...g.pose];
  if(id==='hi'||id==='bye')p[5]+=Math.sin(Math.max(0,t-1.2)*(id==='hi'?5:6))*14*enter;
  if(id==='left')p[1]=Math.sin(t*2)*5;
  for(let i=0;i<8;i++){const j=this.robot.joints[this.keys[i]],a=from[i]*(1-enter)*leave+p[i]*weight;targets[i]=THREE.MathUtils.clamp(a,j.limit.lower/D,j.limit.upper/D);}
  this.aux('i01.head.rothead_link_joint',(id==='left'?-.18:id==='hi'?.08:0)*weight);
  this.aux('i01.head.neck.001_link_joint',(id==='vanakkam'?.15:0)*weight);
  for(const side of ['left','right']){
   const sideIndex=side==='left'?0:1;
   this.aux(side+'_wrist_z_link_joint',(g.wrists?g.wrists[sideIndex]*D:id==='stop'&&side==='right'?.3:0)*weight);
   this.aux('i01.'+side+'Hand.wrist.001_link_joint',(g.wristBends?g.wristBends[sideIndex]*D:0)*weight);
   for(const [finger,parts] of Object.entries({index:['index','index2','index3'],middle:['majeure','majeure2','majeure3'],ring:['ringFinger','ringfinger2','ringfinger3'],pinky:['pinky','pinky2','pinky3'],thumb:['thumb','thumb3']})){
    const curl=id==='left'&&side==='left'&&finger!=='index'?.95:id==='bye'&&side==='right'?.16+.22*(.5+.5*Math.sin(t*6)):.025;
    for(const part of parts)this.aux('i01.'+side+'Hand.'+part+'_link_joint',curl*weight);
   }
  }
  return true;
 }
}
