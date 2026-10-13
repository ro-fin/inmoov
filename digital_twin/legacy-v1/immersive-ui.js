import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {gestures} from './gestures.js';
const $=id=>document.getElementById(id);
export function createImmersiveUI(api){
 const host=$('viewport');
 const panel=document.createElement('section');panel.id='glassPanel';panel.className='glass-panel';panel.hidden=true;
 panel.innerHTML=`
  <div class="glass-heading"><div><span class="glass-eyebrow">INMOOV / INTERACTIVE STUDIO</span><h3 id="glassTitle">Robot controls</h3></div><button id="closeGlass" aria-label="Close robot controls">×</button></div>
  <div class="glass-tabs" role="tablist"><button role="tab" data-tab="move" aria-selected="true">Move</button><button role="tab" data-tab="inspect" aria-selected="false">Inspect</button><button role="tab" data-tab="parts" aria-selected="false">V2 parts</button></div>
  <div id="glassMove" class="glass-content">
   <div class="glass-mode"><button id="glassPreviewMode">Preview</button><button id="glassRobotMode">Robot</button></div>
   <label for="glassJoint">Selected joint</label><select id="glassJoint"></select>
   <div class="glass-value"><strong id="glassValue">0°</strong><span id="glassState">Preview</span></div>
   <input id="glassSlider" type="range" aria-label="Full-view joint position">
   <div class="glass-row"><button id="glassMinus">−</button><button id="glassHome">Home</button><button id="glassPlus">+</button></div>
   <div class="glass-row" id="glassPower"><button id="glassEnable">Enable at home</button><button id="glassRelease">Release</button></div>
   <p id="glassFeedback" class="glass-note"></p>
   <div class="glass-divider"></div><div class="glass-label">EXPRESSIONS <span>Visual preview</span></div>
   <div class="gesture-grid">${Object.entries(gestures).map(([id,g])=>'<button data-gesture="'+id+'">'+g.label+'</button>').join('')}</div>
   <div class="glass-row"><button id="gesturePause">Stop gesture</button><button id="gestureReset">Rest pose</button></div>
   <p id="gestureStatus" class="glass-note" role="status">Choose a gesture. No servo commands are sent.</p>
  </div>
  <div id="glassInspect" class="glass-content" hidden>
   <p class="glass-note">Touch any part, then focus to inspect it. Scroll or pinch to zoom; right-drag to pan.</p>
   <div class="focus-grid"><button data-focus="head">Head</button><button data-focus="neck">Neck</button><button data-focus="left">Left arm</button><button data-focus="right">Right arm</button><button data-focus="hands">Hands</button><button data-focus="torso">Torso</button><button data-focus="legs">Legs</button></div>
   <button id="focusTouched" class="glass-wide">Focus touched part</button>
   <div class="glass-row"><button id="closeZoom">Zoom +</button><button id="wideZoom">Zoom −</button><button id="bodyFit">Fit body</button></div>
   <label class="glass-check"><input id="shellView" type="checkbox"> See through printed shells</label>
   <p id="partIdentity" class="glass-note">Touch a part to see its source name.</p>
   <p class="glass-warning">i2 head and hands · Revised neck. Assembly placements are visual fits. Use the V2 part files and official instructions for construction.</p>
  </div>
  <div id="glassParts" class="glass-content" hidden>
   <div class="glass-label">OFFICIAL i2 PARTS <span>Original STL geometry</span></div>
   <label for="partGroup">Body section</label><select id="partGroup"><option>Head</option><option>Eyes</option><option>Neck</option><option>Left hand</option><option>Right hand</option></select>
   <label for="partSelect">Part</label><select id="partSelect"></select>
   <button id="loadPart" class="glass-wide">Inspect this V2 part</button>
   <p id="partDimensions" class="glass-note" role="status">Choose a part to inspect its original shape and dimensions.</p>
   <div class="glass-row"><button id="partFront">Front</button><button id="partSide">Side</button><button id="partFit">Fit part</button></div>
   <div class="glass-row"><a id="downloadPart" download>Download STL ↗</a><a id="assemblyGuide" href="https://inmoov.fr/headi2/" target="_blank" rel="noopener">Assembly guide ↗</a></div>
   <button id="returnBody" class="glass-wide">Return to robot</button>
   <p class="glass-warning">Parts retain the publisher's print geometry and millimetre dimensions. They are shown individually, not as a verified assembled V2 body.</p>
  </div>`;
 host.append(panel);
 const wall=document.createElement('section');wall.id='wallCard';wall.className='glass-panel wall-card';wall.hidden=true;wall.innerHTML='<button id="closeWall" class="wall-close" aria-label="Close profile">×</button><img id="wallPhoto" alt=""><div class="wall-copy"><span class="glass-eyebrow">FINSTEIN / LEADERSHIP</span><h3 id="wallName"></h3><p id="wallRole"></p><p id="wallCredentials"></p><a href="https://finstein.ai/aboutus.html" target="_blank" rel="noopener">Meet our leadership ↗</a></div>';host.append(wall);
 const shortcuts=document.createElement('div');shortcuts.id='sceneShortcuts';shortcuts.className='scene-shortcuts';shortcuts.innerHTML='<button id="openRobot">◎ Robot controls</button><button id="openParts">V2 parts ↗</button><button id="openWall">◈ Leadership wall</button>';host.append(shortcuts);
 const hint=document.createElement('span');hint.className='touch-hint';hint.textContent='Touch the robot to explore · Tap a portrait to meet the team';host.append(hint);
 for(let i=0;i<api.names.length;i++){const o=document.createElement('option');o.value=i;o.textContent=api.names[i];$('glassJoint').append(o);}
 let tab='move',touched=null,catalogue=[],workbench=null,savedView=null,loadId=0;
 const bench=new THREE.Group();bench.name='Official V2 part workbench';bench.visible=false;api.scene.add(bench);
 const loader=new STLLoader();
 function show(next='move'){panel.hidden=false;wall.hidden=true;setTab(next);sync();$('closeGlass').focus();}
 function setTab(next){tab=next;for(const b of panel.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',b.dataset.tab===next);for(const [id,key] of [['glassMove','move'],['glassInspect','inspect'],['glassParts','parts']])$(id).hidden=next!==key;if(next!=='parts')restoreBody();}
 function hide(){restoreBody();panel.hidden=true;$('openRobot').focus();}
 function showWall(index){restoreBody();panel.hidden=true;const p=api.environment.wallProfiles[index];wall.hidden=false;wall.style.setProperty('--profile-color',p.color);$('wallPhoto').src='assets/finstein/'+p.photo;$('wallPhoto').alt=p.name;$('wallName').textContent=p.name;$('wallRole').textContent=p.subtitle;$('wallCredentials').textContent=p.credentials;$('closeWall').focus();}
 $('closeGlass').onclick=hide;$('closeWall').onclick=()=>{wall.hidden=true;$('openWall').focus();};
 $('openRobot').onclick=()=>{api.expand();show();};
 $('openParts').onclick=()=>{api.expand();show('parts');};
 $('openWall').onclick=()=>{api.fit('portraits');showWall(0);};
 panel.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
 $('glassJoint').onchange=e=>api.select(+e.target.value);
 $('glassPreviewMode').onclick=()=>$('previewMode').click();$('glassRobotMode').onclick=()=>$('liveMode').click();
 $('glassSlider').addEventListener('pointerdown',()=>api.beginDrag());
 $('glassSlider').oninput=e=>{if(!$('glassSlider').disabled)api.change(+e.target.value);};
 for(const [target,source] of [['glassMinus','minus'],['glassPlus','plus'],['glassHome','home'],['glassEnable','enable'],['glassRelease','release']])$(target).onclick=()=>$(source).click();
 panel.querySelectorAll('[data-gesture]').forEach(b=>b.onclick=()=>{restoreBody();if(api.isPreview())api.gesture(b.dataset.gesture);});
 $('gesturePause').onclick=()=>api.stopGesture();$('gestureReset').onclick=()=>$('resetPose').click();
 function focus(object){
  if(!object)return;
  object.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const radius=Math.max(.025,size.length()*.5),distance=radius/Math.sin(THREE.MathUtils.degToRad(api.camera.fov*.5))*1.15/Math.min(1,api.camera.aspect);
  const direction=api.camera.position.clone().sub(api.controls.target).normalize();
  api.controls.autoRotate=false;api.controls.target.copy(center);api.camera.position.copy(center).addScaledVector(direction,distance);api.controls.update();
 }
 function focusRegion(region){
  const r=api.robot();const object=region==='neck'?r.getObjectByName('Revised three-piston neck'):region==='head'?r.getObjectByName('InMoov i2 exposed mechanical head'):region==='left'?r.links.left_shoulder_y_link:region==='right'?r.links.right_shoulder_y_link:region==='hands'?r.links['i01.rightHand.wrist.001_link']:region==='torso'?r.links.torso_y_link:window.legModel;
  focus(object);
 }
 panel.querySelectorAll('[data-focus]').forEach(b=>b.onclick=()=>focusRegion(b.dataset.focus));
 $('focusTouched').onclick=()=>focus(touched);
 $('closeZoom').onclick=()=>{api.camera.position.sub(api.controls.target).multiplyScalar(.7).add(api.controls.target);api.controls.update();};
 $('wideZoom').onclick=()=>{api.camera.position.sub(api.controls.target).multiplyScalar(1.4).add(api.controls.target);api.controls.update();};
 $('bodyFit').onclick=()=>api.fit('front');
 $('shellView').onchange=e=>{for(const mesh of api.meshes()){if(mesh.userData.isServo||mesh.userData.isJoint)continue;mesh.material.transparent=e.target.checked;mesh.material.opacity=e.target.checked?.15:1;mesh.material.depthWrite=!e.target.checked;}};
 function picked(hit){touched=hit.object;let o=touched,joint=-1;while(o){const index=api.keys.indexOf(o.name);if(index>=0){joint=index;break;}o=o.parent;}if(joint>=0)api.select(joint);$('partIdentity').textContent=(touched.userData.partName||touched.parent?.name||touched.name||'Reference part')+(touched.userData.source==='visual hardware'?' · illustrative hardware':touched.userData.v2?' · official geometry, visual fit':touched.userData.isServo?' · black servo housing':' · reference mesh');if(api.isFullView())show(joint>=0?'move':'inspect');}
 function clearBench(){for(const child of [...bench.children]){child.traverse(o=>{if(o.isMesh||o.isLineSegments){o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();}});bench.remove(child);}}
 function restoreBody(){
  loadId++;if(!savedView)return;bench.visible=false;api.modelRoot().visible=true;api.environment.room.visible=true;api.scene.background.copy(savedView.background);api.camera.position.copy(savedView.position);api.controls.target.copy(savedView.target);api.controls.update();savedView=null;workbench=null;clearBench();
 }
 function fitPart(axis='front'){
  if(!workbench)return;const box=new THREE.Box3().setFromObject(workbench),size=box.getSize(new THREE.Vector3()),d=size.length()*1.5/Math.min(1,api.camera.aspect);api.controls.target.set(0,0,0);api.camera.position.set(axis==='side'?d:0,d*.22,axis==='side'?0:d);api.controls.update();
 }
 async function loadPart(){
  const p=catalogue.find(x=>x.url===$('partSelect').value);if(!p)return;
  const ticket=++loadId;$('partDimensions').textContent='Loading original V2 geometry…';$('loadPart').disabled=true;
  try{
   const geometry=await loader.loadAsync(p.url);if(ticket!==loadId){geometry.dispose();return;}
   if(!savedView)savedView={position:api.camera.position.clone(),target:api.controls.target.clone(),background:api.scene.background.clone()};
   clearBench();geometry.computeBoundingBox();geometry.center();geometry.scale(.001,.001,.001);geometry.computeVertexNormals();
   workbench=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xe9ecee,metalness:.06,roughness:.4,side:THREE.DoubleSide}));bench.add(workbench);
   const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,32),new THREE.LineBasicMaterial({color:0x52667a,transparent:true,opacity:.25}));workbench.add(edges);
   bench.visible=true;api.modelRoot().visible=false;api.environment.room.visible=false;api.scene.background.setHex(0x243547);api.controls.autoRotate=false;fitPart();
   $('partDimensions').textContent=p.name+' · '+p.dimensions.join(' × ')+' mm (file X / Y / Z) · '+p.triangles.toLocaleString()+' triangles';
   $('downloadPart').href=p.url;$('downloadPart').download=p.name+'.stl';
  }catch(e){$('partDimensions').textContent='Could not load this part. '+e.message;}finally{$('loadPart').disabled=false;}
 }
 function filterParts(){
  $('partSelect').replaceChildren();for(const p of catalogue.filter(p=>p.group===$('partGroup').value)){const o=document.createElement('option');o.value=p.url;o.textContent=p.name;$('partSelect').append(o);}
  $('loadPart').disabled=!$('partSelect').options.length;
  updateDownload();
  $('assemblyGuide').href=$('partGroup').value==='Neck'?'https://inmoov.fr/neck-and-jaw/':$('partGroup').value.includes('hand')?'https://inmoov.fr/hand-i2/':'https://inmoov.fr/headi2/';
 }
 function updateDownload(){const p=catalogue.find(x=>x.url===$('partSelect').value);if(p){$('downloadPart').href=p.url;$('downloadPart').download=p.name+'.stl';}else $('downloadPart').removeAttribute('href');}
 $('partGroup').onchange=filterParts;$('partSelect').onchange=updateDownload;$('loadPart').onclick=loadPart;
 $('partFront').onclick=()=>fitPart();$('partSide').onclick=()=>fitPart('side');$('partFit').onclick=()=>fitPart();$('returnBody').onclick=restoreBody;
 fetch('./v2-parts.json').then(r=>{if(!r.ok)throw Error('Catalogue unavailable');return r.json();}).then(parts=>{catalogue=parts;filterParts();}).catch(e=>$('partDimensions').textContent=e.message);
 function sync(){
  const s=$('positionSlider');$('glassJoint').value=api.selected();$('glassTitle').textContent=api.names[api.selected()];$('glassSlider').min=s.min;$('glassSlider').max=s.max;$('glassSlider').value=s.value;$('glassSlider').disabled=s.disabled;
  $('glassTitle').textContent=tab==='parts'?'V2 parts workbench':tab==='inspect'?'Inspect your robot':api.names[api.selected()];
  $('glassPreviewMode').setAttribute('aria-pressed',api.isPreview());$('glassRobotMode').setAttribute('aria-pressed',!api.isPreview());
  $('glassSlider').step=s.step;$('glassValue').textContent=s.value+'°';$('glassState').textContent=$('processed').textContent;$('glassFeedback').textContent=$('commandReadout').textContent;
  $('glassPower').hidden=api.isPreview();for(const [target,source] of [['glassMinus','minus'],['glassPlus','plus'],['glassHome','home'],['glassEnable','enable'],['glassRelease','release']])$(target).disabled=$(source).disabled;
  panel.querySelectorAll('[data-gesture]').forEach(b=>{b.disabled=!api.isPreview();b.classList.toggle('active',api.gestureId()===b.dataset.gesture);});
  $('gesturePause').disabled=!api.gestureId();$('gestureReset').disabled=!api.isPreview();
  $('gestureStatus').textContent=!api.isPreview()?'Gestures are available in Preview mode.':api.gestureId()?gestures[api.gestureId()].label+' · animated preview':'Choose a gesture. No servo commands are sent.';
 }
 return {sync,picked,showWall,show,focus,restoreBody,get bench(){return bench},get part(){return workbench},onExit(){restoreBody();panel.hidden=true;wall.hidden=true;}};
}
