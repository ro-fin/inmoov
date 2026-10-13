import * as THREE from 'three';
import {ColladaLoader} from 'three/addons/loaders/ColladaLoader.js';

// Genuine InMoov digital twin.
// Geometry and assembly come from Gael Langevin's VinMoov (the virtual InMoov
// used by MyRobotLab). All nine sections share one world frame, so every part
// sits exactly where the designer placed it. Units in the files are decimetres
// (Z up, robot facing −Y); the twin is scaled to metres.

const SECTIONS = ['legs', 'midstom', 'topstom', 'torso', 'head', 'shoulders', 'rotate', 'bicep', 'hand'];
const BASE = new URL('./assets/original/VinMoov4_Blender/i01.', import.meta.url).href;
const FILE_BYTES = {legs: 8530933, midstom: 2582729, topstom: 2493151, torso: 7224792, head: 7577315, shoulders: 4858415, rotate: 8669047, bicep: 1859379, hand: 6758576};
// Pivots whose parent is not a same-named placeholder in another file.
const EXPLICIT_PARENT = {
  'i01.torso.midstom.full': 'i01.torso.lowStom',
  'i01.leftArm.omoplate': 'i01.torso.topStom',
  'i01.rightArm.omoplate': 'i01.torso.topStom'
};

export const COLORS = {printed: 0xf2f0ea, servo: 0x17191d, bronze: 0x8c6c3c, metal: 0xb8bec5, finger: 0xf07a1f, iris: 0x2f6f3a, accent: 0xd8a21c};

// Axes are given in the body frame: +X robot's left, +Y robot's back, +Z up.
// Positive angles follow the anatomical names in `label`.
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
export const JOINTS = [
  {id: 'neck', node: 'i01.head.neck', axis: X, sign: -1, min: -30, max: 35, label: 'Neck', hint: 'Look up / down', group: 'head'},
  {id: 'rothead', node: 'i01.head.rothead', axis: Z, sign: 1, min: -70, max: 70, label: 'Head rotate', hint: 'Turn left / right', group: 'head'},
  {id: 'rollNeck', node: 'i01.head.rollNeck', axis: Y, sign: 1, min: -18, max: 18, label: 'Neck roll', hint: 'Tilt to the side', group: 'head'},
  {id: 'jaw', node: 'i01.head.jaw', axis: X, sign: 1, min: 0, max: 22, label: 'Jaw', hint: 'Open the mouth', group: 'head'},
  {id: 'eyeY', node: 'i01.head.eyeY', axis: X, sign: -1, min: -25, max: 25, label: 'Eyes up/down', hint: 'Look up / down', group: 'head'},
  {id: 'eyeLeft', node: 'i01.head.eyeLeft', axis: Z, sign: 1, min: -30, max: 30, label: 'Left eye', hint: 'Look left / right', group: 'head'},
  {id: 'eyeRight', node: 'i01.head.eyeRight', axis: Z, sign: 1, min: -30, max: 30, label: 'Right eye', hint: 'Look left / right', group: 'head'},
  {id: 'waist', node: 'i01.torso.midStom', axis: Z, sign: 1, min: -40, max: 40, label: 'Waist rotate', hint: 'Twist the upper body', group: 'torso'},
  {id: 'lean', node: 'i01.torso.topStom', axis: Y, sign: 1, min: -15, max: 15, label: 'Torso lean', hint: 'Lean to the side', group: 'torso'}
];
for (const [side, s] of [['left', -1], ['right', 1]]) {
  const S = side[0].toUpperCase() + side.slice(1);
  JOINTS.push(
    {id: side + 'Omoplate', node: `i01.${side}Arm.omoplate`, axis: Y, sign: s, min: -5, max: 85, label: S + ' omoplate', hint: 'Lift the arm outward', group: side},
    {id: side + 'Rotate', node: `i01.${side}Arm.rotate`, axis: Z, sign: s, min: -80, max: 80, label: S + ' rotate', hint: 'Rotate the upper arm', group: side},
    {id: side + 'Shoulder', node: `i01.${side}Arm.shoulder`, axis: X, sign: -1, min: -35, max: 160, label: S + ' shoulder', hint: 'Raise the arm forward', group: side},
    {id: side + 'Bicep', node: `i01.${side}Arm.bicep`, axis: X, sign: -1, min: 0, max: 100, label: S + ' bicep', hint: 'Bend the elbow', group: side},
    {id: side + 'Wrist', node: `i01.${side}Hand.wrist`, axis: 'forearm', sign: s, min: -90, max: 90, label: S + ' wrist', hint: 'Rotate the hand', group: side + 'Hand'}
  );
  for (const [finger, chain] of Object.entries({thumb: ['thumb1', 'thumb', 'thumb3'], index: ['index', 'index2', 'index3'], majeure: ['majeure', 'majeure2', 'majeure3'], ringFinger: ['ringFinger', 'ringfinger2', 'ringfinger3'], pinky: ['pinky', 'pinky2', 'pinky3']})) {
    const label = {thumb: 'thumb', index: 'index', majeure: 'middle', ringFinger: 'ring', pinky: 'pinky'}[finger];
    JOINTS.push({id: side + finger[0].toUpperCase() + finger.slice(1), nodes: chain.map(n => `i01.${side}Hand.${n}`), finger, axis: finger === 'thumb' ? 'thumb' : 'knuckle', sign: 1, min: 0, max: 90, label: S + ' ' + label, hint: 'Curl the finger', group: side + 'Hand'});
  }
}
export const JOINT = Object.fromEntries(JOINTS.map(j => [j.id, j]));
// Order used by the Nano firmware (Arms V6): D2, D4, D5, D6 / D7, D8, D9, D10.
export const HARDWARE = ['leftOmoplate', 'leftRotate', 'leftShoulder', 'leftBicep', 'rightOmoplate', 'rightRotate', 'rightShoulder', 'rightBicep'];

const SECTION_OF = name =>
  /Hand\./.test(name) ? (name.includes('left') ? 'Left hand' : 'Right hand') :
  /leftArm|left\.bicep/.test(name) ? 'Left arm' : /rightArm|right\.bicep/.test(name) ? 'Right arm' :
  /head\./.test(name) ? 'Head & neck' : /Leg/.test(name) ? 'Legs' : 'Torso';

function classify(color, name) {
  const [r, g, b] = [color.r, color.g, color.b];
  if (r > .9 && g > .9 && b > .9) return 'printed';
  if (r < .25 && g < .25 && b < .25) return 'servo';
  if (g > r && g > b) return 'iris';
  if (r > .8 && g > .6 && b < .1) return 'accent';
  if (r > .75 && g > .4 && g < .5 && b < .05) return 'finger';
  if (r > .3 && r < .5 && g > .2 && g < .35 && b < .2) return 'bronze';
  if (Math.abs(r - g) < .06 && Math.abs(g - b) < .06) return r > .6 ? 'metal' : 'servo';
  return 'printed';
}
const KIND_LABEL = {printed: 'Printed shell (PLA)', servo: 'Servo / black hardware', bronze: 'Bearing / bronze hardware', metal: 'Metal hardware', finger: 'Finger (printed)', iris: 'Eye', accent: 'Gear / accent'};
export const kindLabel = k => KIND_LABEL[k] || k;

export class InMoovTwin {
  constructor() {
    this.root = new THREE.Group();          // world-space holder (metres, Y up)
    this.root.name = 'InMoov digital twin';
    this.body = new THREE.Group();          // Blender frame (decimetres, Z up)
    this.body.rotation.x = -Math.PI / 2;
    this.body.scale.setScalar(.1);
    this.root.add(this.body);
    this.nodes = new Map();
    this.meshes = [];
    this.angles = Object.fromEntries(JOINTS.map(j => [j.id, 0]));
    this.visualReversed = {};
    this.materials = {};
    this.xray = false;
    this.explodeAmount = 0;
  }

  async load(onProgress = () => {}) {
    const loaded = Object.fromEntries(SECTIONS.map(s => [s, 0]));
    const total = Object.values(FILE_BYTES).reduce((a, b) => a + b, 0);
    const report = () => onProgress(Object.values(loaded).reduce((a, b) => a + b, 0) / total);
    const results = await Promise.all(SECTIONS.map(s => new ColladaLoader().loadAsync(BASE + s + '.dae', e => { loaded[s] = e.loaded; report(); }).then(r => { loaded[s] = FILE_BYTES[s]; report(); return r; })));
    const roots = [];
    results.forEach((res, i) => {
      for (const child of [...res.scene.children]) {
        if (/^(Camera|Lamp)$/.test(child.name) || child.isCamera || child.isLight) continue;
        child.userData.sectionFile = SECTIONS[i];
        this.body.add(child);
        roots.push(child);
      }
    });
    // Join sections: each file's root pivot replaces its same-named placeholder.
    const find = (name, not) => {
      let found = null;
      this.body.traverse(o => { if (!found && o.name === name && o !== not && !isInside(o, not)) found = o; });
      return found;
    };
    for (const r of roots) {
      const parentName = EXPLICIT_PARENT[r.name];
      if (parentName) { find(parentName, r).attach(r); continue; }
      const placeholder = find(r.name, r);
      if (placeholder) { placeholder.parent.attach(r); placeholder.removeFromParent(); }
    }
    this.body.traverse(o => { if (o.name) this.nodes.set(o.name, o); });
    this.body.updateMatrixWorld(true);
    this.#prepareMeshes();
    this.#prepareJoints();
    this.#prepareExplode();
    this.measure = this.#measureBody();
    return this;
  }

  node(name) { return this.nodes.get(name); }

  // Body-frame helpers (Blender frame, decimetres).
  bodyPosition(o) {
    this.root.updateMatrixWorld(true);
    return this.body.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
  }
  bodyQuaternion(o) {
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    return this.body.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q);
  }

  #material(kind) {
    if (this.materials[kind]) return this.materials[kind];
    const spec = {
      printed: {roughness: .5, metalness: 0}, finger: {roughness: .45, metalness: 0},
      servo: {roughness: .42, metalness: .15}, bronze: {roughness: .32, metalness: .75},
      metal: {roughness: .28, metalness: .85}, iris: {roughness: .2, metalness: 0}, accent: {roughness: .4, metalness: .2}
    }[kind];
    const m = new THREE.MeshStandardMaterial({color: COLORS[kind], ...spec});
    m.userData.kind = kind;
    return (this.materials[kind] = m);
  }

  #prepareMeshes() {
    const isFinger = n => /Hand\.(index|majeure|ringFinger|pinky)(Phal|Cover)|Hand\.(ringFingerCover|pinkyCover|indexCover|majeureCover)|Hand\.Thumb(Base|Mid|Tip|Cover)/.test(n);
    this.body.traverse(o => {
      if (!o.isMesh) return;
      const name = o.name || o.parent?.name || 'part';
      const partName = o.name && !/^mesh/i.test(o.name) ? o.name : o.parent?.name;
      const source = Array.isArray(o.material) ? o.material : [o.material];
      const kinds = source.map(m => isFinger(partName) && classify(m.color, partName) === 'printed' ? 'finger' : classify(m.color, partName));
      const mats = kinds.map(k => this.#material(k));
      o.material = Array.isArray(o.material) ? mats : mats[0];
      o.castShadow = o.receiveShadow = true;
      o.geometry.computeBoundingBox();
      const size = o.geometry.boundingBox.getSize(new THREE.Vector3());
      const s = o.getWorldScale(new THREE.Vector3()).x / this.body.getWorldScale(new THREE.Vector3()).x;
      const dimsMm = [size.x, size.y, size.z].map(v => Math.round(v * s * 100 * 10) / 10);
      o.userData.part = {name: prettyName(partName), raw: partName, section: SECTION_OF(partName), kinds, dimsMm, triangles: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3};
      this.meshes.push(o);
    });
  }

  #prepareJoints() {
    const pos = n => this.bodyPosition(this.node(n));
    for (const j of JOINTS) {
      const names = j.nodes || [j.node];
      j.pivots = names.map(n => this.node(n)).filter(Boolean);
      if (!j.pivots.length) { console.warn('Missing pivot', j.id); continue; }
      let axisBody;
      const side = j.group.startsWith('left') ? 'left' : 'right';
      if (j.axis === 'forearm') {
        axisBody = pos(`i01.${side}Hand.majeure`).sub(pos(`i01.${side}Hand.wrist`)).normalize();
      } else if (j.axis === 'knuckle') {
        axisBody = pos(`i01.${side}Hand.index`).sub(pos(`i01.${side}Hand.pinky`)).normalize();
        if (side === 'left') axisBody.negate();
      } else if (j.axis === 'thumb') {
        const along = pos(`i01.${side}Hand.thumb3`).sub(pos(`i01.${side}Hand.thumb1`)).normalize();
        const knuckle = pos(`i01.${side}Hand.index`).sub(pos(`i01.${side}Hand.pinky`)).normalize();
        axisBody = new THREE.Vector3().crossVectors(along, knuckle).normalize();
        if (side === 'left') axisBody.negate();
      } else axisBody = new THREE.Vector3(...j.axis);
      j.axisBody = axisBody.clone().multiplyScalar(j.sign);
      j.rest = j.pivots.map(p => p.quaternion.clone());
      j.localAxes = j.pivots.map(p => {
        const q = this.bodyQuaternion(p);
        // Axis expressed in the pivot's own (post-rotation) frame.
        return j.axisBody.clone().applyQuaternion(q.invert()).normalize();
      });
    }
  }

  set(id, degrees) {
    const j = JOINT[id];
    if (!j?.pivots?.length) return;
    const v = THREE.MathUtils.clamp(degrees, j.min, j.max);
    this.angles[id] = v;
    // Fingers: every phalanx of the chain bends by the same angle (tendon-driven curl).
    j.pivots.forEach((p, i) => {
      const rad = v * THREE.MathUtils.DEG2RAD * (this.visualReversed[id] ? -1 : 1);
      p.quaternion.copy(j.rest[i]).multiply(new THREE.Quaternion().setFromAxisAngle(j.localAxes[i], rad));
    });
  }
  setVisualReversed(id, reversed) {
    if (!JOINT[id] || typeof reversed !== 'boolean') return;
    this.visualReversed[id] = reversed;
    this.set(id, this.angles[id]);
  }
  setMany(values) { for (const [k, v] of Object.entries(values)) this.set(k, v); }
  reset() { for (const j of JOINTS) this.set(j.id, 0); }

  // Meshes that move with a joint (for highlighting).
  meshesOf(id) {
    const j = JOINT[id];
    if (!j?.pivots?.length) return [];
    const set = new Set();
    j.pivots[0].traverse(o => { if (o.isMesh) set.add(o); });
    return [...set];
  }
  jointOfMesh(mesh) {
    // Deepest joint whose pivot contains the mesh.
    let best = null, depth = -1;
    for (const j of JOINTS) {
      if (!j.pivots?.length || !isInside(mesh, j.pivots[0])) continue;
      const d = depthOf(j.pivots[0]);
      if (d > depth) { depth = d; best = j; }
    }
    return best;
  }

  // style: null | 'selected' | 'active' | 'isolate-dim'
  #variant(base, style) {
    if (!style) return base;
    const key = base.userData.kind + ':' + style;
    if (this.materials[key]) return this.materials[key];
    const m = base.clone();
    m.userData = {kind: base.userData.kind, style};
    if (style === 'selected') { m.emissive = new THREE.Color(0x2fbf8f); m.emissiveIntensity = base.userData.kind === 'servo' ? .1 : .16; }
    if (style === 'active') { m.emissive = new THREE.Color(0x2fbf8f); m.emissiveIntensity = .55; }
    if (style === 'isolate-dim') { m.transparent = true; m.opacity = .08; m.depthWrite = false; }
    this.#applyXray(m);
    return (this.materials[key] = m);
  }
  highlight(meshes, style) {
    const set = new Set(meshes);
    for (const mesh of this.meshes) {
      const bases = mesh.userData.baseMaterials ||= (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(m => this.materials[m.userData.kind] || m);
      const want = set.has(mesh) ? style : this.isolated && !this.isolated.has(mesh) ? 'isolate-dim' : null;
      const mats = bases.map(b => this.#variant(b, want));
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    }
  }
  isolate(meshes) { this.isolated = meshes ? new Set(meshes) : null; }

  #applyXray(m) {
    const shell = m.userData.kind === 'printed' || m.userData.kind === 'finger';
    if (m.userData.style === 'isolate-dim') return;
    m.transparent = this.xray && shell;
    m.opacity = this.xray && shell ? .14 : 1;
    m.depthWrite = !(this.xray && shell);
    m.needsUpdate = true;
  }
  setXray(on) {
    this.xray = on;
    for (const m of Object.values(this.materials)) this.#applyXray(m);
  }

  #prepareExplode() {
    // Each section's subtree moves away from the chest along the line joining
    // the chest to its own centre, so assemblies stay intact while separating.
    const chest = this.bodyPosition(this.node('i01.torso.topStom'));
    this.explodeItems = [];
    const tops = ['i01.torso.midstom.full', 'i01.torso.midStom', 'i01.head.neck', 'i01.head.jaw',
      'i01.leftArm.omoplate', 'i01.leftArm.shoulder', 'i01.leftArm.rotate', 'i01.leftArm.bicep', 'i01.leftHand.wrist',
      'i01.rightArm.omoplate', 'i01.rightArm.shoulder', 'i01.rightArm.rotate', 'i01.rightArm.bicep', 'i01.rightHand.wrist'];
    for (const name of tops) {
      const n = this.node(name);
      if (!n) continue;
      const box = new THREE.Box3();
      n.traverse(o => {
        if (!o.isMesh) return;
        const inBody = o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().copy(this.body.matrixWorld).invert().multiply(o.matrixWorld));
        box.union(inBody);
      });
      const centre = box.isEmpty() ? this.bodyPosition(n) : box.getCenter(new THREE.Vector3());
      const dir = centre.clone().sub(chest);
      if (/midstom\.full|midStom$/.test(name)) dir.set(0, 0, -1);
      if (/head\.neck/.test(name)) dir.set(0, 0, 1);
      if (/jaw/.test(name)) dir.set(0, -1, -.6);
      dir.normalize().multiplyScalar(/Hand/.test(name) ? .9 : /bicep|rotate/.test(name) ? .8 : 1.4);
      this.explodeItems.push({node: n, restPos: n.position.clone(), dirBody: dir});
    }
  }
  explode(t) {
    this.explodeAmount = t;
    this.root.updateMatrixWorld(true);
    for (const it of this.explodeItems) {
      it.node.position.copy(it.restPos);
      if (!t) continue;
      const parent = it.node.parent;
      // Convert a body-frame displacement into the parent's local frame.
      const m = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(this.body.matrixWorld);
      const a = new THREE.Vector3().applyMatrix4(m), b = it.dirBody.clone().multiplyScalar(t).applyMatrix4(m);
      it.node.position.add(b.sub(a));
    }
  }

  #measureBody() {
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const boxOf = name => {
      const box = new THREE.Box3(), n = this.node(name);
      n?.traverse(o => { if (o.isMesh) box.union(o.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld))); });
      return box;
    };
    const all = new THREE.Box3();
    for (const m of this.meshes) all.union(m.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)));
    const p = n => this.bodyPosition(this.node(n));
    const mm = v => Math.round(v * 100);
    const head = boxOf('i01.head.rothead'), torso = boxOf('i01.torso.topStom');
    const lHand = boxOf('i01.leftHand.wrist');
    const shoulders = new THREE.Box3().union(boxOf('i01.leftArm.omoplate')).union(boxOf('i01.rightArm.omoplate'));
    shoulders.union(boxOf('i01.torso.topStom'));
    const size = all.getSize(new THREE.Vector3());
    const lines = {
      height: {label: 'Overall height', mm: mm(size.z), a: [all.max.x + .6, 0, all.min.z], b: [all.max.x + .6, 0, all.max.z]},
      span: {label: 'Shoulder width (outer)', mm: mm(torso.getSize(new THREE.Vector3()).x), a: [torso.min.x, -1.5, torso.max.z + .15], b: [torso.max.x, -1.5, torso.max.z + .15]},
      upperArm: {label: 'Shoulder → elbow pivot', mm: mm(p('i01.leftArm.shoulder').distanceTo(p('i01.leftArm.bicep'))), a: p('i01.leftArm.shoulder').toArray(), b: p('i01.leftArm.bicep').toArray()},
      forearm: {label: 'Elbow → wrist pivot', mm: mm(p('i01.leftArm.bicep').distanceTo(p('i01.leftHand.wrist'))), a: p('i01.leftArm.bicep').toArray(), b: p('i01.leftHand.wrist').toArray()},
      hand: {label: 'Hand length', mm: mm(lHand.getSize(new THREE.Vector3()).z), a: [lHand.max.x + .15, lHand.min.y, lHand.min.z], b: [lHand.max.x + .15, lHand.min.y, lHand.max.z]},
      headW: {label: 'Head width', mm: mm(head.getSize(new THREE.Vector3()).x), a: [head.min.x, head.min.y - .2, head.max.z + .1], b: [head.max.x, head.min.y - .2, head.max.z + .1]},
      headH: {label: 'Head height', mm: mm(head.getSize(new THREE.Vector3()).z)},
      depth: {label: 'Torso depth', mm: mm(torso.getSize(new THREE.Vector3()).y)},
      shoulderSpan: {label: 'Shoulder pivot spacing', mm: mm(p('i01.leftArm.shoulder').distanceTo(p('i01.rightArm.shoulder')))},
      hip: {label: 'Hip height (waist pivot)', mm: mm(p('i01.torso.midStom').z)}
    };
    return {size: [mm(size.x), mm(size.y), mm(size.z)], lines, shoulders};
  }

  // Body-frame point (dm) → world (m).
  toWorld(arr) { this.root.updateMatrixWorld(true); return this.body.localToWorld(new THREE.Vector3(...arr)); }

  summary() {
    const bySection = {};
    for (const m of this.meshes) {
      const p = m.userData.part;
      (bySection[p.section] ||= []).push(p);
    }
    return bySection;
  }
}

function isInside(o, ancestor) { if (!ancestor) return false; let p = o.parent; while (p) { if (p === ancestor) return true; p = p.parent; } return false; }
function depthOf(o) { let d = 0; while (o.parent) { d++; o = o.parent; } return d; }
export function prettyName(raw = '') {
  return raw.replace(/^i01\.+/, '').replace(/\.full(\.\d+)?$/, '').replace(/\./g, ' · ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Phal(\d)/, ' phalanx $1').replace(/^./, c => c.toUpperCase());
}
