import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';

// Original STL shapes at millimetre scale. These assembly transforms are visual
// fits to the existing rig, not manufacturer CAD mates or verified clearances.
export async function installV2Assembly(robot,meshList){
 const loader=new STLLoader(),cache=new Map(),parts=[],oldVisuals=[],pistons=[];
 const colors={shell:0xe5e7e4,joint:0x11151b,finger:0xf47b20,metal:0x8d979f,eye:0xf4f6f3};
 function geometry(path){
  if(!cache.has(path))cache.set(path,loader.loadAsync('./assets/inmoov-v2/'+path+'.stl').then(g=>{g.center();g.scale(.001,.001,.001);g.computeVertexNormals();return g;}));
  return cache.get(path);
 }
 function material(kind){return new THREE.MeshStandardMaterial({color:colors[kind],roughness:kind==='metal'?.29:kind==='finger'?.46:.5,metalness:kind==='metal'?.65:.04});}
 function register(mesh,name,kind,source){
  mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={...mesh.userData,v2:true,partName:name,source,fit:'Visual assembly · alignment not verified',isServo:kind==='servo',isJoint:kind==='joint',isFinger:kind==='finger',baseColor:mesh.material.color.clone()};
  meshList.push(mesh);parts.push(mesh);return mesh;
 }
 async function part(parent,path,position,rotation=[0,0,0],kind='shell'){
  const mesh=register(new THREE.Mesh(await geometry(path),material(kind)),path.split('/').at(-1),kind,path+'.stl');
  mesh.position.fromArray(position);mesh.rotation.set(...rotation);parent.add(mesh);return mesh;
 }
 function frameAt(parent,worldPosition,worldQuaternion=new THREE.Quaternion()){
  parent.updateWorldMatrix(true,false);const frame=new THREE.Group();parent.add(frame);
  frame.position.copy(parent.worldToLocal(worldPosition.clone()));
  frame.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQuaternion));
  const scale=parent.getWorldScale(new THREE.Vector3());frame.scale.set(1/scale.x,1/scale.y,1/scale.z);return frame;
 }
 function hideVisuals(link){
  for(const o of link.children.filter(o=>o.isURDFVisual)){o.visible=false;o.userData.supersededByV2=true;oldVisuals.push(o);}
 }
 robot.updateWorldMatrix(true,true);
 const headOrigin=robot.links['i01.head.rothead_link'].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.008,0));
 // Replace every original head and neck visual, retaining the original joint rig.
 for(const [name,link] of Object.entries(robot.links))if(name.startsWith('i01.head.')||name==='neck_link')hideVisuals(link);
 robot.traverse(o=>{if(o.isURDFVisual&&/^i01\.torso\.full\.(003|044|059|060|061|062|069)$/.test(o.name)){o.visible=false;o.userData.supersededByV2=true;oldVisuals.push(o);}});
 const head=frameAt(robot.links['i01.head.rothead_link'],headOrigin);head.name='InMoov i2 exposed mechanical head';
 const rx=Math.PI/2;
 await Promise.all([
  part(head,'i2Head/LowBackV5',[0,.043,-.035],[rx,0,0]),
  part(head,'derived/TopBackskullV4-0',[0,.108,-.043],[-rx,0,0]),
  part(head,'derived/TopskullV5-0',[0,.151,.020],[rx*.5,0,0]),
  part(head,'derived/TopskullV5-1',[0,.151,-.028],[-rx*.5,0,0]),
  part(head,'i2Head/GearHolderV3',[0,.041,-.005],[-rx,0,0],'joint'),
  part(head,'i2Head/SkullServoFixV5',[0,.077,-.019],[-rx,0,0],'joint'),
  part(head,'i2Head/FaceHolderLeftV5',[.040,.066,.031],[0,0,0],'joint'),
  part(head,'i2Head/FaceHolderRightV5',[-.040,.066,.031],[0,0,0],'joint'),
  part(head,'i2Head/TeethTopHolderV3',[0,.061,.053],[-rx,0,0],'joint'),
  part(head,'i2Head/TopTeethV3',[0,.050,.067],[rx,0,0]),
  part(head,'i2Head/ForHeadSupportV2',[0,.137,.036],[-rx,0,0],'joint'),
  part(head,'i2Head/UpperLipV2',[0,.078,.070],[-rx,0,0]),
  part(head,'i2Head/MainGearV2',[-.02,.012,-.009],[-rx,0,0],'joint'),
  part(head,'i2Head/ServoGearV2',[.022,.018,-.009],[-rx,0,0],'joint')
 ]);
 const jaw=new THREE.Group();jaw.name='i2 jaw pivot';jaw.position.set(0,.045,.006);head.add(jaw);
 await part(jaw,'i2Head/JawV5',[0,-.014,.032],[rx,0,0]);
 await part(jaw,'i2Head/BottomTeethV1',[0,-.003,.060],[rx,0,0]);
 for(const [side,sign] of [['Left',1],['Right',-1]]){
  const eye=new THREE.Group();eye.name='i2 '+side+' eye';eye.position.set(sign*.032,.107,.067);head.add(eye);
  await part(eye,'derived/Eye-'+(sign===1?'L-AllPartsV2-10':'R-AllPartsV2-1'),[0,0,0],[0,0,0],'eye');
  await part(eye,'derived/Eye-'+(sign===1?'L-AllPartsV2-13':'R-AllPartsV2-2'),[0,0,.0105],[0,0,0],'joint');
  await part(head,'i2Eyes/Eye-'+(sign===1?'L':'R')+'-BaseV5',[sign*.031,.097,.027],[-rx,0,0],'joint');
  await part(head,'i2Head/EyebrowV3',[sign*.032,.132,.065],[0,0,sign*.10]);
 }
 // Revised ball neck and three piston mechanisms: central shells remain open
 // so that the black joints and polished piston shafts are visible.
 const neckBasePosition=headOrigin.clone().add(new THREE.Vector3(0,-.133,0));
 const neck=frameAt(robot.links.torso_y_link,neckBasePosition);neck.name='Revised three-piston neck';
 const neckTop=frameAt(robot.links.neck_link,headOrigin.clone().add(new THREE.Vector3(0,-.018,0)));neckTop.name='Revised neck upper plate';
 await Promise.all([
  part(neck,'Neck/NeckPlateV2',[0,.004,0],[-rx,0,0],'joint'),
  part(neck,'Neck/NeckJointLowerV5',[0,.040,0],[-rx,0,0],'joint'),
  part(neck,'Neck/NeckV3',[0,.065,0],[-rx,0,0],'joint'),
  part(neckTop,'Neck/NeckPlateHighV2',[0,0,0],[-rx,0,0],'joint')
 ]);
 for(const [x,z] of [[-.047,-.026],[.047,-.026],[0,.044]]){
  const a=new THREE.Vector3(x,.014,z),b=new THREE.Vector3(x*.8,0,z*.75);
  await part(neck,'Neck/PistonBaseSideV2',[x,.008,z],[0,0,0],'joint');
  const outer=await part(neck,'Neck/NeckPistonV2',[x,.061,z],[-rx,0,0],'joint');
  const inner=await part(neck,'Neck/NeckPistonSideV1',[x,.090,z],[-rx,0,0],'metal');
  pistons.push({a,b,outer,inner});
 }
 // Install real i2 palm shells and split finger components on the existing
 // articulated hand hierarchy. No original finger or palm visuals remain visible.
 const hands={};
 for(const side of ['left','right']){
  const prefix='i01.'+side+'Hand.',wrist=robot.links[prefix+'wrist.001_link'];
  const point=n=>robot.links[prefix+n+'_link'].getWorldPosition(new THREE.Vector3());
  const wristPosition=point('wrist.001'),middle=point('majeure'),index=point('index'),pinky=point('pinky');
  const y=middle.clone().sub(wristPosition).normalize(),x=index.clone().sub(pinky).normalize();
  const z=x.clone().cross(y).normalize();x.copy(y.clone().cross(z).normalize());
  const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
  const center=wristPosition.clone().lerp(middle,.52);
  for(const [name,link] of Object.entries(robot.links))if(name.startsWith(prefix))hideVisuals(link);
  const hand=frameAt(wrist,center,q);hand.name='InMoov i2 '+side+' palm';hands[side]=hand;
  const dir='hands/Inmoov-hand-i2/i2_'+(side==='left'?'Left':'Right')+'Hand/';
  await part(hand,dir+(side==='left'?'i2_LeftWristLargeV2':'i2_WristLargeV2'),[0,0,0],[0,0,0],'joint');
  await part(hand,dir+(side==='left'?'i2_LeftPalmCoverV2':'i2_PalmCoverV2'),[0,0,.014],[-rx,0,0]);
  await part(hand,dir+(side==='left'?'i2_LeftHandCoverV1':'i2_HandCoverV2'),[0,0,-.015],[rx,Math.PI,0]);
  const chains=[['index','index2','index3'],['majeure','majeure2','majeure3'],['ringFinger','ringfinger2','ringfinger3'],['pinky','pinky2','pinky3'],['thumb1','thumb','thumb3']];
  for(const [f,chain] of chains.entries())for(let j=0;j<chain.length;j++){
   const link=robot.links[prefix+chain[j]+'_link'];const group=new THREE.Group();group.name='i2 '+side+' '+chain[j];group.scale.setScalar(10);link.add(group);
   const path=j===0?'derived/i2_FingersX5V2-'+(f===4?'0':'2'):j===1?'derived/i2_FingersX5V2-1':'derived/i2_FingersTipX5V2-1';
   await part(group,path,[0,j===0?.019:j===1?.012:.009,0],j===2?[-rx,0,0]:[0,0,0],'finger');
   if(j===2)await part(group,'derived/i2_FingersTipX5V2-'+(f===4?'3':'5'),[0,.017,.002],[-rx,0,0],'finger');
   // The actual STL hinge remains orange; the pin is a separate visual hardware marker.
   const pin=register(new THREE.Mesh(new THREE.CylinderGeometry(.0017,.0017,f===4?.019:.017,12),material('joint')),'Finger hinge pin (visual hardware)','joint','visual hardware');
   pin.rotation.z=rx;group.add(pin);
  }
 }
 const anatomy={head,neck,neckTop,hands,parts,oldVisuals};
 function update(){
  jaw.rotation.x=robot.joints['i01.head.jaw_link_joint'].jointValue[0]||0;
  neck.updateWorldMatrix(true,false);neckTop.updateWorldMatrix(true,false);
  for(const p of pistons){
   const end=neck.worldToLocal(neckTop.localToWorld(p.b.clone())),direction=end.clone().sub(p.a).normalize();
   const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
   p.outer.quaternion.copy(q);p.outer.position.copy(p.a).addScaledVector(direction,.045);
   p.inner.quaternion.copy(q);p.inner.position.copy(end).addScaledVector(direction,-.032);
  }
 }
 update();return {...anatomy,update};
}
