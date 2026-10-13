import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {CSS2DRenderer, CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {createExecutiveRoom} from './executive-room.js';

// Scene, camera, lighting and viewport tools shared by the twin and the spares bay.
export class Stage {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, .01, 80);
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, preserveDrawingBuffer: true});
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.02;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    host.prepend(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    host.append(this.labels.domElement);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, {enableDamping: true, dampingFactor: .09, zoomToCursor: true, minDistance: .05, maxDistance: 14, maxPolarAngle: Math.PI * .56});
    this.controls.target.set(0, .95, 0);
    this.camera.position.set(0, 1.2, 4.6);
    this.anchor = new THREE.Vector3();       // where the robot stands
    this.mode = 'studio';
    this.onFrame = [];
    this.frameErrors = new WeakSet();
    this.contextLost = false;
    r.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.contextLost = true;
      host.dispatchEvent(new CustomEvent('render-status', {detail:'3D graphics paused. Restoring the view…'}));
    });
    r.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.resize();
      host.dispatchEvent(new CustomEvent('render-status', {detail:''}));
    });
    this.#studio();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = now => {
      // Schedule first so a UI callback cannot permanently stop the 3D view.
      requestAnimationFrame(loop);
      if (this.contextLost) return;
      for (const f of this.onFrame) {
        try { f(now); }
        catch (error) {
          if (!this.frameErrors.has(f)) {
            this.frameErrors.add(f);
            console.error('Scene update failed; rendering continues.', error);
          }
        }
      }
      this.controls.update();
      r.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #studio() {
    const g = this.studio = new THREE.Group();
    g.name = 'Studio stage';
    this.scene.add(g);
    this.studioBackground = new THREE.Color(0xe9ecef);
    this.scene.background = this.studioBackground;
    this.scene.fog = new THREE.Fog(0xe9ecef, 7, 16);
    new RGBELoader().loadAsync('./assets/interior/studio_small_03_1k.hdr').then(tex => {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.studioEnv = pmrem.fromEquirectangular(tex).texture;
      tex.dispose(); pmrem.dispose();
      if (this.mode === 'studio') { this.scene.environment = this.studioEnv; this.scene.environmentIntensity = .55; }
    }).catch(() => {});
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb9c0c7, .9);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.4, 5, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {left: -1.4, right: 1.4, top: 2.2, bottom: -.2, near: .5, far: 12});
    key.shadow.bias = -.0004; key.shadow.normalBias = .02;
    const fill = new THREE.DirectionalLight(0xdfe8ff, .7); fill.position.set(-3, 2, 2);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1); rim.position.set(-1.5, 3, -3.5);
    g.add(hemi, key, key.target, fill, rim);
    // Soft round floor that fades into the backdrop, with a crisp contact shadow.
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const ctx = c.getContext('2d'), grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.55, 'rgba(250,251,252,.9)'); grad.addColorStop(1, 'rgba(233,236,239,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 512);
    const floorTex = new THREE.CanvasTexture(c); floorTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.5, 96), new THREE.MeshBasicMaterial({map: floorTex, transparent: true, depthWrite: false}));
    floor.rotation.x = -Math.PI / 2;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.ShadowMaterial({opacity: .2}));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .001; shadow.receiveShadow = true;
    // Plinth ring marks the footprint.
    const ring = new THREE.Mesh(new THREE.RingGeometry(.56, .565, 128), new THREE.MeshBasicMaterial({color: 0xc5ccd3, transparent: true, opacity: .8}));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .002;
    g.add(floor, shadow, ring);
    // 100 mm measurement grid, off by default.
    this.grid = new THREE.GridHelper(3, 30, 0x8795a3, 0xb9c2cb);
    this.grid.material.transparent = true; this.grid.material.opacity = .45;
    this.grid.position.y = .003; this.grid.visible = false;
    g.add(this.grid);
  }

  async setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'cabin') {
      if (!this.cabin) {
        const holder = new THREE.Group(); holder.name = 'Finstein executive cabin';
        this.cabinEnv = await createExecutiveRoom(holder, this.renderer);
        this.cabin = holder;
        this.scene.add(holder);
      }
      this.cabin.visible = true; this.studio.visible = false;
      this.scene.background = this.cabin.background || new THREE.Color(0xdbe3e8);
      this.scene.environment = this.cabin.environment; this.scene.environmentIntensity = this.cabin.environmentIntensity ?? .48;
      this.scene.fog = null;
      this.anchor.copy(this.cabinEnv.robotPosition);
    } else {
      if (this.cabin) this.cabin.visible = false;
      this.studio.visible = true;
      this.scene.background = this.studioBackground;
      this.scene.environment = this.studioEnv || null; this.scene.environmentIntensity = .55;
      this.scene.fog = new THREE.Fog(0xe9ecef, 7, 16);
      this.anchor.set(0, 0, 0);
    }
    this.mode = mode;
  }

  // Camera presets around the robot anchor (robot faces +Z).
  view(name, animate = true) {
    const a = this.anchor, h = 1.7;
    const presets = {
      front: [[0, .98, 3.7], [0, .9, 0]], three: [[2.2, 1.4, 2.9], [0, .9, 0]], side: [[3.7, .98, 0], [0, .9, 0]],
      back: [[0, 1.05, -4.3], [0, .9, 0]], top: [[0, 4.6, .6], [0, .8, 0]],
      head: [[.32, 1.64, .78], [0, 1.57, .02]], torso: [[.7, 1.35, 1.6], [0, 1.22, 0]], arms: [[1.3, 1.3, 1.9], [0, 1.15, 0]],
      hands: [[.25, .9, 1.25], [0, .8, .02]], legs: [[1.1, .6, 2.4], [0, .5, 0]]
    };
    if (name === 'room' && this.cabinEnv) return this.#fly(new THREE.Vector3(...this.cabinEnv.cameras.room.position), new THREE.Vector3(...this.cabinEnv.cameras.room.target), animate);
    if (this.mode === 'cabin' && this.cabinEnv?.cameras[name]) { const c = this.cabinEnv.cameras[name]; return this.#fly(new THREE.Vector3(...c.position), new THREE.Vector3(...c.target), animate); }
    const p = presets[name] || presets.front;
    const pos = new THREE.Vector3(...p[0]).add(a), target = new THREE.Vector3(...p[1]).add(a);
    if (this.camera.aspect < 1 && ['front', 'three', 'side', 'back'].includes(name)) pos.sub(target).multiplyScalar(1 / Math.max(.55, this.camera.aspect)).add(target);
    return this.#fly(pos, target, animate);
  }
  focusBox(box, animate = true) {
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(.04, size.length() * .5);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05 / Math.min(1, this.camera.aspect);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y > .8) dir.set(.3, .3, 1).normalize();
    return this.#fly(centre.clone().addScaledVector(dir, dist), centre, animate);
  }
  frameBody(box, animate = false) {
    const size=box.getSize(new THREE.Vector3()), centre=box.getCenter(new THREE.Vector3());
    const tangent=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));
    const distance=Math.max(size.y/(2*tangent),size.x/(2*tangent*this.camera.aspect))*1.3+size.z/2;
    return this.#fly(centre.clone().add(new THREE.Vector3(0,0,distance)),centre,animate);
  }
  #fly(pos, target, animate) {
    this.controls.autoRotate = false;
    const fromP = this.camera.position.clone(), fromT = this.controls.target.clone(), start = performance.now(), dur = animate ? 650 : 0;
    this.flight = now => {
      const k = dur ? Math.min(1, (now - start) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(fromP, pos, e); this.controls.target.lerpVectors(fromT, target, e);
      if (k >= 1) this.flight = null;
    };
    if (!this.onFrame.includes(this.#flightTick)) this.onFrame.unshift(this.#flightTick);
  }
  #flightTick = now => this.flight?.(now);

  zoom(f) { this.camera.position.sub(this.controls.target).multiplyScalar(f).add(this.controls.target); }

  pick(event, objects) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1), this.camera);
    return ray.intersectObjects(objects, false).find(h => { let o = h.object; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
  }

  label(text, className = 'tag') {
    const el = document.createElement('div');
    el.className = className; el.textContent = text;
    return new CSS2DObject(el);
  }

  // Dimension line between two world points with a label in millimetres.
  dimension(a, b, text, color = 0x1f6f5c, dot = .006) {
    const g = new THREE.Group();
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({color, depthTest: false, transparent: true}));
    line.renderOrder = 10;
    const dotGeo = new THREE.SphereGeometry(dot, 12, 12), dotMat = new THREE.MeshBasicMaterial({color, depthTest: false});
    const d1 = new THREE.Mesh(dotGeo, dotMat), d2 = new THREE.Mesh(dotGeo, dotMat);
    d1.position.copy(a); d2.position.copy(b); d1.renderOrder = d2.renderOrder = 11;
    const tag = this.label(text, 'dim-tag');
    tag.position.lerpVectors(a, b, .5);
    g.add(line, d1, d2, tag);
    g.userData.dispose = () => { line.geometry.dispose(); line.material.dispose(); dotGeo.dispose(); dotMat.dispose(); tag.element.remove(); };
    return g;
  }
  clearGroup(group) {
    for (const c of [...group.children]) { c.userData.dispose?.(); c.traverse(o => { if (o.isCSS2DObject) o.element.remove(); }); group.remove(c); }
  }
}
