import * as THREE from 'three';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

const palette={navy:0x172f46,stone:0xe1d9ca,brass:0xb89862,wood:0x73513b,ink:0x152536};
function seeded(seed=17){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function texture(kind){
 const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d'),r=seeded();
 g.fillStyle=kind==='wood'?'#806049':kind==='rug'?'#bbb8ac':'#ded9cf';g.fillRect(0,0,512,512);
 if(kind==='wood'){
  for(let i=0;i<1500;i++){const x=r()*512;g.strokeStyle='rgba('+(r()>.5?'34,19,8':'198,162,120')+','+(r()*.18)+')';g.lineWidth=.2+r();g.beginPath();g.moveTo(x,0);g.bezierCurveTo(x+18*r(),170,x-10*r(),310,x+12*r(),512);g.stroke();}
 }else{
  for(let i=0;i<30000;i++){const v=Math.floor(80+r()*120);g.fillStyle='rgba('+v+','+v+','+v+',.065)';g.fillRect(r()*512,r()*512,kind==='rug'?2:1,kind==='rug'?5:1);}
 }
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='wood'?2:4,kind==='wood'?1:4);t.anisotropy=4;return t;
}
function textTexture({title,lines=[],kicker='',dark=false,number=''}){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const c=canvas.getContext('2d');
 c.fillStyle=dark?'#172f46':'#f5f1e8';c.fillRect(0,0,1024,1024);
 c.strokeStyle=dark?'#6a8599':'#c6b591';c.lineWidth=2;c.strokeRect(34,34,956,956);
 c.textAlign='left';c.fillStyle=dark?'#9eb8ca':'#9a855d';c.font='500 25px Segoe UI';c.fillText(kicker.toUpperCase(),80,119);
 c.fillStyle=dark?'#f4f1e8':'#203449';c.font='500 61px Georgia';
 const heading=title.split('|');heading.forEach((line,i)=>c.fillText(line,80,230+i*76));
 let y=230+heading.length*76+58;c.fillStyle=dark?'#c6d4dd':'#65717b';c.font='32px Segoe UI';
 for(const line of lines){c.fillText(line,80,y);y+=52;}
 c.fillStyle=dark?'#98b9d0':'#8a9cac';c.font='24px Segoe UI';c.fillText('FINSTEIN   /   LEADERSHIP & EXPERTISE',80,907);
 if(number){c.font='24px Georgia';c.textAlign='right';c.fillText(number,942,119);}
 const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
export const wallProfiles=[
 {name:'Praveen Kumar',title:'Cyber & risk',subtitle:'Risk, cyber security & analytics',credentials:'CA · CISA · CEH · CDPSE · CFE',photo:'praveen.png',color:'#087fe8',deep:'#123ab0'},
 {name:'Dinesh Kumar',title:'Intelligent robotics',subtitle:'AI, technology & digital solutions',credentials:'MS · University of Illinois, Chicago',photo:'Dinesh.png',color:'#ff793d',deep:'#c33b66'},
 {name:'Vaidyanathan N A',title:'Finance & advisory',subtitle:'Financial reporting & tax',credentials:'CA · DISA · DIM',photo:'Vaidyanathan.png',color:'#11bda9',deep:'#116d86'}
];
async function portraitTexture(profile){
 const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src='./assets/finstein/'+profile.photo;});
 const c=document.createElement('canvas');c.width=768;c.height=1024;const g=c.getContext('2d');
 const gradient=g.createLinearGradient(0,0,768,1024);gradient.addColorStop(0,profile.color);gradient.addColorStop(1,profile.deep);g.fillStyle=gradient;g.fillRect(0,0,768,1024);
 g.fillStyle='#ffffff18';g.beginPath();g.arc(600,130,370,0,Math.PI*2);g.fill();
 g.fillStyle='white';g.font='600 28px Segoe UI';g.fillText('FINSTEIN / LEADERSHIP',48,66);
 const scale=Math.min(680/img.width,570/img.height);g.drawImage(img,(768-img.width*scale)/2,100,img.width*scale,img.height*scale);
 g.fillStyle='#071d42d9';g.fillRect(0,686,768,338);g.fillStyle='#fff';g.font='600 47px Segoe UI';g.fillText(profile.name,42,765);
 g.font='34px Segoe UI';g.fillStyle='#e1f3ff';g.fillText(profile.title,42,820);
 g.font='22px Segoe UI';g.fillText(profile.credentials,42,875);
 g.fillStyle='#fff';g.font='600 23px Segoe UI';g.fillText('EXPLORE PROFILE   ↗',42,977);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export async function createExecutiveRoom(scene,renderer){
 const interactiveFrames=[];
 const environmentMap=await new RGBELoader().loadAsync('./assets/interior/studio_small_03_1k.hdr');
 const pmrem=new THREE.PMREMGenerator(renderer);const envTarget=pmrem.fromEquirectangular(environmentMap);
 scene.environment=envTarget.texture;scene.environmentIntensity=.48;environmentMap.dispose();pmrem.dispose();
 const room=new THREE.Group();room.name='Finstein executive cabin';scene.add(room);
 const m={
  walnut:new THREE.MeshStandardMaterial({color:0xc4aa8b,map:texture('wood'),roughness:.42}),
  stone:new THREE.MeshStandardMaterial({color:0xffffff,map:texture('stone'),roughness:.6}),
  navy:new THREE.MeshStandardMaterial({color:palette.navy,roughness:.75}),
  brass:new THREE.MeshStandardMaterial({color:palette.brass,metalness:.78,roughness:.28}),
  dark:new THREE.MeshStandardMaterial({color:0x20272a,roughness:.68}),
  leather:new THREE.MeshStandardMaterial({color:0x4c3930,roughness:.62}),
  white:new THREE.MeshStandardMaterial({color:0xede7dc,roughness:.65}),
  rug:new THREE.MeshStandardMaterial({color:0xffffff,map:texture('rug'),roughness:1}),
  glow:new THREE.MeshStandardMaterial({color:0xffe8b7,emissive:0xffd29b,emissiveIntensity:2})
 };
 const textureLoader=new THREE.TextureLoader();
 m.floor=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.5});
 for(const [key,id,repeat] of [['walnut','wood_table_001',1],['floor','floor_tiles_06',4]]){
  const maps=await Promise.all(['Diffuse','nor_gl','Rough'].map(k=>textureLoader.loadAsync('./assets/interior/'+id+'_'+k+'.jpg')));
  maps.forEach(t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat,repeat);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());});
  maps[0].colorSpace=THREE.SRGBColorSpace;m[key].map=maps[0];m[key].normalMap=maps[1];m[key].normalScale.set(.3,.3);m[key].roughnessMap=maps[2];m[key].color.setHex(key==='walnut'?0x9f7757:0xf0e9df);m[key].roughness=.65;
 }
 function box(w,h,d,x,y,z,mat,rounded=0,parent=room){
  const geo=rounded?new RoundedBoxGeometry(w,h,d,2,Math.min(rounded,w/3,h/3,d/3)):new THREE.BoxGeometry(w,h,d);
  const obj=new THREE.Mesh(geo,mat);obj.position.set(x,y,z);obj.castShadow=true;obj.receiveShadow=true;parent.add(obj);return obj;
 }
 function cyl(rt,rb,h,x,y,z,mat,parent=room){
  const o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,32),mat);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
 }
 function rod(a,b,r,mat,parent=room){
  const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av);
  const o=cyl(r,r,delta.length(),0,0,0,mat,parent);o.position.copy(av.add(bv).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return o;
 }
 // Architectural shell. The front remains open for an unobstructed cutaway view.
 box(7.4,.12,6.4,0,-.07,-.15,m.floor);
 for(let x=-3.6;x<=3.6;x+=.9)box(.006,.003,6.3,x,-.007,-.15,new THREE.MeshStandardMaterial({color:0xbeb8ad}));
 for(let z=-3.3;z<=3;z+=.9)box(7.3,.003,.006,0,-.006,z,new THREE.MeshStandardMaterial({color:0xbeb8ad}));
 box(7.4,3.3,.15,0,1.65,-3.32,m.stone);
 box(4.0,2.82,.07,-.85,1.77,-3.205,m.navy);
 for(let x=-3.6;x<-2.9;x+=.09)box(.035,3.1,.06,x,1.6,-3.2,m.walnut);
 for(let x=1.27;x<1.62;x+=.09)box(.035,3.1,.06,x,1.6,-3.2,m.walnut);
 box(7.15,.055,.025,0,.08,-3.19,m.brass);
 box(7.15,.022,.04,0,3.16,-3.19,m.glow);
 box(.06,3.15,5.9,-3.69,1.6,-.2,m.navy);
 // Full-height side windows and a quiet abstract city backdrop.
 const city=document.createElement('canvas');city.width=1024;city.height=768;const ctx=city.getContext('2d'),rnd=seeded(103);
 const sky=ctx.createLinearGradient(0,0,0,768);sky.addColorStop(0,'#8cabc2');sky.addColorStop(.65,'#e7ebe7');sky.addColorStop(1,'#bdc5c2');ctx.fillStyle=sky;ctx.fillRect(0,0,1024,768);
 for(let layer=0;layer<3;layer++)for(let x=0;x<1024;){const w=25+rnd()*80,h=40+rnd()*220;ctx.fillStyle=['#acbfc8','#92a9b5','#79909a'][layer];ctx.fillRect(x,700-h+layer*20,w,h+68);ctx.fillStyle='#d9e1dc';for(let wx=x+7;wx<x+w-4;wx+=11)for(let wy=710-h;wy<740;wy+=17)if(rnd()>.4)ctx.fillRect(wx,wy,3,6);x+=w+8;}
 const skyline=new THREE.CanvasTexture(city);skyline.colorSpace=THREE.SRGBColorSpace;
 const windowPane=new THREE.Mesh(new THREE.PlaneGeometry(5.6,2.65),new THREE.MeshBasicMaterial({map:skyline}));windowPane.position.set(-3.65,1.75,-.2);windowPane.rotation.y=Math.PI/2;room.add(windowPane);
 for(let z=-2.96;z<2.7;z+=1.13)box(.07,2.8,.037,-3.61,1.75,z,m.dark);
 for(const y of [.36,3.13])box(.09,.07,5.68,-3.59,y,-.2,m.dark);
 for(let z=1.9;z<2.65;z+=.085)box(.13,2.85,.06,-3.48,1.66,z,new THREE.MeshStandardMaterial({color:0xcac3b5,roughness:1}),.02);
 // The executive desk, recessed modesty panel, leather blotter and restrained tools.
 const desk=new THREE.Group();desk.name='Executive walnut desk';desk.position.set(-1.25,0,-1.66);room.add(desk);
 box(2.55,.095,1.03,0,.79,0,m.walnut,.045,desk);
 box(2.42,.025,.94,0,.73,0,m.brass,.008,desk);
 box(.53,.68,.85,-.87,.35,0,m.walnut,.025,desk);
 box(.12,.68,.86,1.04,.35,0,m.navy,.02,desk);
 box(1.5,.4,.055,.05,.4,.27,m.navy,.015,desk);
 for(let y=.17;y<.7;y+=.18){box(.47,.008,.012,-.87,y,.43,m.dark,0,desk);box(.2,.018,.015,-.87,y+.08,.442,m.brass,.003,desk);}
 box(.82,.014,.43,-.2,.847,.18,m.leather,.018,desk);
 const screen=box(.75,.44,.037,.05,1.16,-.26,m.dark,.017,desk);screen.rotation.x=-.08;
 box(.69,.375,.009,.05,1.165,-.234,new THREE.MeshStandardMaterial({color:0x122d40,emissive:0x193d54,emissiveIntensity:.35}),.009,desk);
 cyl(.075,.12,.13,.05,.915,-.26,m.brass,desk);
 box(.35,.024,.22,.05,.85,-.23,m.dark,.012,desk);
 box(.53,.016,.16,-.15,.865,.2,m.dark,.007,desk);
 box(.13,.05,.085,.36,.875,.22,m.dark,.026,desk);
 const book=box(.28,.035,.35,-.85,.85,-.09,m.navy,.01,desk);book.rotation.y=-.17;
 box(.2,.012,.3,-.85,.874,-.09,m.white,0,desk).rotation.y=-.17;
 cyl(.033,.031,.07,.72,.872,.15,m.white,desk);
 cyl(.028,.028,.003,.72,.909,.15,new THREE.MeshStandardMaterial({color:0x332414}),desk);
 // Small brass desk lamp with a warm shade.
 cyl(.10,.12,.025,.88,.854,-.29,m.brass,desk);
 rod([.88,.86,-.29],[.88,1.18,-.29],.012,m.brass,desk);
 rod([.88,1.18,-.29],[.65,1.28,-.29],.012,m.brass,desk);
 const shade=new THREE.Mesh(new THREE.ConeGeometry(.14,.13,32,1,true),m.navy);shade.position.set(.65,1.24,-.29);desk.add(shade);
 function chair(x,z,rotation=0,executive=false){
  const group=new THREE.Group();group.position.set(x,0,z);group.rotation.y=rotation;room.add(group);
  box(.6,.12,.59,0,.48,0,m.leather,.05,group);
  const back=box(.6,executive?.81:.54,.13,0,executive?.9:.77,-.25,m.leather,.06,group);back.rotation.x=-.09;
  for(const s of [-1,1]){box(.06,.075,.44,s*.34,.7,-.025,m.leather,.025,group);rod([s*.3,.46,0],[s*.3,.7,0],.014,m.brass,group);}
  if(executive){cyl(.035,.055,.33,0,.26,0,m.brass,group);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;rod([0,.09,0],[Math.cos(a)*.34,.06,Math.sin(a)*.34],.025,m.dark,group);cyl(.035,.035,.045,Math.cos(a)*.34,.035,Math.sin(a)*.34,m.dark,group);}}
  else for(const x of [-.24,.24])for(const z of [-.2,.2])rod([x,.45,z],[x,.03,z+.025],.016,m.brass,group);
  return group;
 }
 chair(-1.25,-2.65,0,true);
 box(3.6,.014,2.45,-1.27,.004,-.8,m.rug,.05);
 chair(-2.15,-.05,Math.PI+.1);chair(-1.15,-.02,Math.PI-.12);
 // Sideboard, books and a sculptural object. No invented awards or certificates.
 box(1.4,.65,.46,2.5,.35,-2.96,m.walnut,.022);
 box(1.44,.027,.48,2.5,.69,-2.96,m.stone,.01);
 for(const x of [2.02,2.52,3.01]){box(.009,.52,.01,x,.36,-2.72,m.brass);}
 for(let i=0;i<7;i++)box(.075,.16+.02*(i%3),.17,2.0+i*.083,.79,-2.93,new THREE.MeshStandardMaterial({color:[0x172f46,0x867253,0xe4d9be][i%3]}),.003);
 const sculpture=new THREE.Mesh(new THREE.TorusKnotGeometry(.13,.028,70,10),m.brass);sculpture.position.set(2.92,.94,-2.95);room.add(sculpture);box(.22,.025,.19,2.92,.72,-2.95,m.dark,.005);
 function plant(x,z,scale=1){
  const group=new THREE.Group();group.position.set(x,0,z);group.scale.setScalar(scale);room.add(group);
  cyl(.18,.13,.32,0,.16,0,m.stone,group);cyl(.16,.16,.013,0,.318,0,new THREE.MeshStandardMaterial({color:0x372e24}),group);
  for(let i=0;i<11;i++){const a=i*2.39,h=.55+(i%4)*.13,dx=Math.cos(a)*.22,dz=Math.sin(a)*.22;
   rod([0,.28,0],[dx,h,dz],.006,new THREE.MeshStandardMaterial({color:0x4f6040}),group);
   const leaf=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshStandardMaterial({color:i%2?0x48604c:0x667c53,roughness:.8}));leaf.scale.set(.082,.23,.018);leaf.position.set(dx,h,dz);leaf.rotation.set(.5*Math.cos(a),a,-.7*Math.sin(a));group.add(leaf);
  }
 }
 plant(3.1,-.35,1.2);plant(-3.05,-2.76,1.35);
 // Real Finstein logo on the feature wall.
 const logo=await new THREE.TextureLoader().loadAsync('./assets/finstein/logo-white.svg');logo.colorSpace=THREE.SRGBColorSpace;logo.anisotropy=renderer.capabilities.getMaxAnisotropy();
 const logoMesh=new THREE.Mesh(new THREE.PlaneGeometry(2.12,.565),new THREE.MeshBasicMaterial({map:logo,transparent:true,depthWrite:false}));logoMesh.name='Official Finstein logo';logoMesh.position.set(-.9,2.47,-3.15);room.add(logoMesh);
 const tagline=document.createElement('canvas');tagline.width=1536;tagline.height=128;const tc=tagline.getContext('2d');tc.fillStyle='#d8e5ec';tc.font='34px Segoe UI';tc.textAlign='center';tc.fillText('Driving change, Securing the future.',768,70);
 const tagtex=new THREE.CanvasTexture(tagline);tagtex.colorSpace=THREE.SRGBColorSpace;
 const taglineMesh=new THREE.Mesh(new THREE.PlaneGeometry(2.65,.22),new THREE.MeshBasicMaterial({map:tagtex,transparent:true,depthWrite:false}));taglineMesh.position.set(-.9,2.07,-3.15);room.add(taglineMesh);
 // Bright portrait displays, with real company photography and touch targets.
 for(let i=0;i<wallProfiles.length;i++){
  const x=1.9+i*.64,y=2.0,profile=wallProfiles[i];
  box(.6,1.04,.065,x,y,-3.14,m.brass,.012);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(.55,.98),new THREE.MeshBasicMaterial({map:await portraitTexture(profile),toneMapped:false}));
  face.position.set(x,y,-3.1);face.name=profile.name+' interactive portrait';face.userData.profile=i;room.add(face);interactiveFrames.push(face);
  const strip=new THREE.Mesh(new THREE.BoxGeometry(.59,.018,.035),new THREE.MeshStandardMaterial({color:profile.color,emissive:profile.color,emissiveIntensity:2}));
  strip.position.set(x,1.465,-3.09);room.add(strip);
 }
 // Furniture details: stitched leather, keys, paper edges and warm task lighting.
 for(let row=0;row<4;row++)for(let col=0;col<13;col++)box(.031,.004,.024,-.375+col*.036,.875,.14+row*.035,m.white,.003,desk);
 for(const z of [-2.65,-.05,-.02]){
  const x=z===-2.65?-1.25:z===-.05?-2.15:-1.15;
  for(const s of [-1,1])box(.006,.004,.43,x+s*.25,.545,z,m.brass,.002);
 }
 const lampLight=new THREE.PointLight(0xffd69d,.8,1.7,2);lampLight.position.set(-.6,1.13,-1.95);room.add(lampLight);
  // A bronze inset gives the robot an uncluttered presentation zone.
 const stage=new THREE.Mesh(new THREE.CylinderGeometry(.57,.6,.024,80),new THREE.MeshStandardMaterial({color:0xa7b0b5,metalness:.28,roughness:.5}));stage.position.set(.85,.014,.55);stage.receiveShadow=true;room.add(stage);
 const trim=new THREE.Mesh(new THREE.TorusGeometry(.584,.006,6,80),m.brass);trim.rotation.x=Math.PI/2;trim.position.set(.85,.026,.55);room.add(trim);
 scene.background=new THREE.Color(0xdbe3e8);
 scene.add(new THREE.HemisphereLight(0xeaf4ff,0x92775b, .65));
 const sunlight=new THREE.DirectionalLight(0xfff1da,2.2);sunlight.position.set(-3.0,5.5,3.2);sunlight.target.position.set(0,.7,-1);sunlight.castShadow=true;sunlight.shadow.mapSize.set(4096,4096);Object.assign(sunlight.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:15});sunlight.shadow.bias=-.0003;sunlight.shadow.normalBias=.008;sunlight.shadow.radius=3;scene.add(sunlight,sunlight.target);
 const bounce=new THREE.DirectionalLight(0xd7e6ff,.55);bounce.position.set(4,3,1);scene.add(bounce);
 const warm=new THREE.PointLight(0xffd3a0,5,5,2);warm.position.set(-1.3,2.8,-2.3);scene.add(warm);
 return {room,interactiveFrames,wallProfiles,robotPosition:new THREE.Vector3(.85,.027,.55),
  cameras:{portraits:{position:[2.48,2.05,-.9],target:[2.48,2,-3.1]},inside:{position:[2.7,1.85,4.4],target:[-.3,1.5,-1.2]},room:{position:[5.7,3.15,8.7],target:[0,1.15,-.7]},front:{position:[.85,1.25,4.1],target:[.85,.95,.55]},three:{position:[3.5,1.8,3.8],target:[.85,1,.55]},side:{position:[4.5,1.35,.7],target:[.85,1,.55]},desk:{position:[2.1,2.25,3.5],target:[-1.05,1.15,-1.65]}}};
}
