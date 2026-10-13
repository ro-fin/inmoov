import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';

// Spares & assembly bay. Official i2 / neck STL files are shown one at a time,
// in their published print orientation, with measured bounding dimensions.
// They are never placed on the body: no assembled i2 model has been published.
export const GUIDES = {
  Head: 'https://inmoov.fr/headi2/', Eyes: 'https://inmoov.fr/headi2/', Neck: 'https://inmoov.fr/neck-and-jaw/',
  'Left hand': 'https://inmoov.fr/hand-i2/', 'Right hand': 'https://inmoov.fr/hand-i2/'
};

export class SparesBay {
  constructor(stage) {
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.name = 'Spares bay';
    this.group.visible = false;
    stage.scene.add(this.group);
    this.dims = new THREE.Group();
    this.group.add(this.dims);
    this.loader = new STLLoader();
    this.cache = new Map();
    this.ticket = 0;
    this.catalogue = fetch('./v2-parts.json').then(r => { if (!r.ok) throw Error('Parts catalogue missing'); return r.json(); });
  }

  async show(part, onReady) {
    const ticket = ++this.ticket;
    if (!this.cache.has(part.url)) this.cache.set(part.url, this.loader.loadAsync(part.url));
    const geo = (await this.cache.get(part.url)).clone();
    if (ticket !== this.ticket) return;
    this.#clear();
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    geo.translate(...geo.boundingBox.getCenter(new THREE.Vector3()).negate().toArray());
    geo.rotateX(-Math.PI / 2);                     // print bed Z-up → scene Y-up
    geo.scale(.001, .001, .001);                   // mm → m
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const hand = /hand/i.test(part.group), mat = new THREE.MeshStandardMaterial({color: /Finger|Tip/i.test(part.name) ? 0xf07a1f : hand || /Neck|Gear|Servo|Piston|Bolt/i.test(part.name) ? 0x2a2e35 : 0xf2f0ea, roughness: .45, metalness: .05, side: THREE.DoubleSide});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    const lift = -geo.boundingBox.min.y + .08;
    mesh.position.set(0, lift, 0);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), new THREE.LineBasicMaterial({color: 0x5c6b79, transparent: true, opacity: .35}));
    mesh.add(edges);
    this.mesh = mesh;
    this.group.add(mesh);
    // Bounding box with X / Y / Z dimension lines (file axes, millimetres).
    const b = geo.boundingBox.clone().translate(mesh.position), pad = .004;
    const box = new THREE.Box3Helper(b, 0x1f6f5c);
    box.material.transparent = true; box.material.opacity = .35;
    this.dims.add(box);
    const {min, max} = b;
    this.dims.add(
      this.stage.dimension(new THREE.Vector3(min.x, min.y, max.z + pad), new THREE.Vector3(max.x, min.y, max.z + pad), `X ${fmt(size.x)} mm`, 0x1f6f5c, .0012),
      this.stage.dimension(new THREE.Vector3(max.x + pad, min.y, max.z), new THREE.Vector3(max.x + pad, min.y, min.z), `Y ${fmt(size.y)} mm`, 0x1f6f5c, .0012),
      this.stage.dimension(new THREE.Vector3(max.x + pad, min.y, min.z - pad), new THREE.Vector3(max.x + pad, max.y, min.z - pad), `Z ${fmt(size.z)} mm`, 0x1f6f5c, .0012)
    );
    this.group.position.copy(this.stage.anchor);
    this.group.visible = true;
    this.stage.focusBox(new THREE.Box3().setFromObject(mesh).expandByScalar(.02).translate(this.group.position));
    onReady?.({size: [size.x, size.y, size.z], triangles: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3});
  }

  spin(on) { this.spinning = on; }
  tick(dt) { if (this.group.visible && this.spinning && this.mesh) this.mesh.rotation.y += dt * .5; }

  hide() { this.ticket++; this.group.visible = false; this.#clear(); }
  #clear() {
    this.stage.clearGroup(this.dims);
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); }); this.group.remove(this.mesh); this.mesh = null; }
  }
}
export const fmt = v => (Math.round(v * 10) / 10).toFixed(1);
