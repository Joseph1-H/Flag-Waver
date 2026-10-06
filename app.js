/* Flag Waver — realistic cloth-simulated flags with Three.js
 * Verlet integration + distance constraints + aerodynamic (normal-based) wind.
 * Supports up to 5 independent flags.
 */
(function () {
  'use strict';

  // ---- Simulation constants -------------------------------------------------
  const DAMPING = 0.02;
  const DRAG = 1 - DAMPING;
  const MASS = 0.1;
  const GRAVITY = 981 * 1.1;
  const TIMESTEP = 18 / 1000;
  const TIMESTEP_SQ = TIMESTEP * TIMESTEP;
  const CONSTRAINT_ITERATIONS = 5;
  const MAX_FLAGS = 5;

  const FLAG_W = 320;            // flag width in world units (constant)
  const DEF_SEGS_X = 30;
  const DEF_SEGS_Y = 18;
  const FLAG_GAP = 90;           // gap between adjacent flags

  const gravityForce = new THREE.Vector3(0, -GRAVITY, 0).multiplyScalar(MASS);
  const windLocal = new THREE.Vector3();
  const drag = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const diff = new THREE.Vector3();

  let windStrength = 0.6; // 0..1 from slider (global)
  let gustEnd = 0;        // timestamp; global gust

  // ---- Particle -------------------------------------------------------------
  function Particle(x, y, z) {
    this.position = new THREE.Vector3(x, y, z);
    this.previous = new THREE.Vector3(x, y, z);
    this.original = new THREE.Vector3(x, y, z);
    this.a = new THREE.Vector3(0, 0, 0);
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.pinned = false;
  }
  Particle.prototype.addForce = function (force) {
    this.a.add(this.tmp2.copy(force).multiplyScalar(1 / MASS));
  };
  Particle.prototype.integrate = function (timesq) {
    if (this.pinned) {
      this.position.copy(this.original);
      this.previous.copy(this.original);
      this.a.set(0, 0, 0);
      return;
    }
    const newPos = this.tmp.subVectors(this.position, this.previous);
    newPos.multiplyScalar(DRAG).add(this.position);
    newPos.add(this.a.multiplyScalar(timesq));
    this.tmp = this.previous;
    this.previous = this.position;
    this.position = newPos;
    this.a.set(0, 0, 0);
  };

  function satisfyConstraint(p1, p2, dist) {
    diff.subVectors(p2.position, p1.position);
    const len = diff.length();
    if (len === 0) return;
    const correction = diff.multiplyScalar(1 - dist / len);
    const half = correction.multiplyScalar(0.5);
    if (!p1.pinned) p1.position.add(half);
    if (!p2.pinned) p2.position.sub(half);
  }

  // ---- Three.js scene -------------------------------------------------------
  const container = document.getElementById('scene');
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b1020, 1400, 4200);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 1, 8000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x30405f, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
  sun.position.set(240, 320, 420);
  scene.add(sun);

  // ---- Textures -------------------------------------------------------------
  function toPOT(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return Math.min(p, 2048);
  }

  function finishTexture(cv) {
    const tex = new THREE.CanvasTexture(cv);
    tex.flipY = false; // pixels pre-flipped; keeps orientation consistent cross-browser
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    if (renderer && renderer.capabilities) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    return tex;
  }

  function makeFlagTexture(source, w, h) {
    const cw = toPOT(w);
    const ch = toPOT(h);
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(0, ch);
    ctx.scale(1, -1);
    ctx.drawImage(source, 0, 0, cw, ch);
    return finishTexture(cv);
  }

  function makeDefaultTexture() {
    const c = document.createElement('canvas');
    c.width = 768;
    c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 768, 512);
    g.addColorStop(0, '#2d4a8a');
    g.addColorStop(1, '#5b8cff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 768, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 72px -apple-system, Segoe UI, sans-serif';
    ctx.fillText('⚑', 384, 210);
    ctx.font = 'bold 44px -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Upload an image', 384, 300);
    ctx.font = '26px -apple-system, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('to raise your own flag', 384, 348);
    return makeFlagTexture(c, 768, 512);
  }

  // ---- Flag -----------------------------------------------------------------
  function Flag() {
    this.segsX = DEF_SEGS_X;
    this.segsY = DEF_SEGS_Y;
    this.w = FLAG_W;
    this.h = FLAG_W / 1.5;
    this.ratioMode = '1.5';
    this.lastImageRatio = 1.5;
    this.selected = false;

    this.texture = makeDefaultTexture();
    this.group = new THREE.Group();
    scene.add(this.group);

    this.particles = [];
    this.constraints = [];
    this.build();
  }

  Flag.prototype.idx = function (ix, iy) { return iy * (this.segsX + 1) + ix; };

  Flag.prototype.buildCloth = function () {
    const particles = [];
    const constraints = [];
    const dx = this.w / this.segsX;
    const dy = this.h / this.segsY;

    for (let iy = 0; iy <= this.segsY; iy++) {
      for (let ix = 0; ix <= this.segsX; ix++) {
        const x = (ix / this.segsX - 0.5) * this.w;
        const y = (0.5 - iy / this.segsY) * this.h;
        const p = new Particle(x, y, 0);
        if (ix === 0) p.pinned = true; // hoist edge on the pole
        particles.push(p);
      }
    }

    const restH = dx, restV = dy, restD = Math.sqrt(dx * dx + dy * dy);
    const idx = (ix, iy) => iy * (this.segsX + 1) + ix;
    for (let iy = 0; iy <= this.segsY; iy++) {
      for (let ix = 0; ix <= this.segsX; ix++) {
        if (ix < this.segsX) constraints.push([particles[idx(ix, iy)], particles[idx(ix + 1, iy)], restH]);
        if (iy < this.segsY) constraints.push([particles[idx(ix, iy)], particles[idx(ix, iy + 1)], restV]);
        if (ix < this.segsX && iy < this.segsY) {
          constraints.push([particles[idx(ix, iy)], particles[idx(ix + 1, iy + 1)], restD]);
          constraints.push([particles[idx(ix + 1, iy)], particles[idx(ix, iy + 1)], restD]);
        }
      }
    }
    this.particles = particles;
    this.constraints = constraints;
  };

  Flag.prototype.buildPole = function () {
    const cx = -this.w / 2 - 4;
    const flagTop = this.h / 2;
    const poleTop = flagTop + this.h * 0.1;
    const poleBottom = -this.h * 1.2;
    const ph = poleTop - poleBottom;

    if (this.pole) this.group.remove(this.pole);
    if (this.poleGeo) this.poleGeo.dispose();
    this.poleGeo = new THREE.CylinderGeometry(5, 6, ph, 24);
    if (!this.poleMat) this.poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa6bd, metalness: 0.75, roughness: 0.35 });
    this.pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    this.pole.position.set(cx, (poleTop + poleBottom) / 2, 0);
    this.group.add(this.pole);

    if (this.finial) this.group.remove(this.finial);
    if (this.finialGeo) this.finialGeo.dispose();
    this.finialGeo = new THREE.SphereGeometry(11, 24, 24);
    if (!this.finialMat) this.finialMat = new THREE.MeshStandardMaterial({ color: 0xffcf5c, metalness: 0.9, roughness: 0.25 });
    this.finial = new THREE.Mesh(this.finialGeo, this.finialMat);
    this.finial.position.set(cx, poleTop + 11, 0);
    this.group.add(this.finial);

    this.applySelected();
  };

  Flag.prototype.buildFlagMesh = function () {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.flagGeo.dispose();
    }
    this.flagGeo = new THREE.PlaneGeometry(this.w, this.h, this.segsX, this.segsY);
    if (!this.flagMat) {
      this.flagMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, metalness: 0.0 });
    }
    this.flagMat.map = this.texture;
    this.flagMat.needsUpdate = true;
    this.mesh = new THREE.Mesh(this.flagGeo, this.flagMat);
    this.group.add(this.mesh);
  };

  Flag.prototype.build = function () {
    this.buildCloth();
    this.buildPole();
    this.buildFlagMesh();
  };

  Flag.prototype.setTexture = function (tex) {
    if (this.texture && this.texture !== tex) this.texture.dispose();
    this.texture = tex;
    if (this.flagMat) {
      this.flagMat.map = tex;
      this.flagMat.needsUpdate = true;
    }
  };

  Flag.prototype.setRatio = function (value) {
    this.ratioMode = value;
    let r = value === 'auto' ? this.lastImageRatio : parseFloat(value);
    r = Math.max(0.5, Math.min(3, r));
    this.h = this.w / r;
    this.build();
  };

  Flag.prototype.applySelected = function () {
    if (this.finialMat) this.finialMat.emissive = new THREE.Color(this.selected ? 0x6a5410 : 0x000000);
  };
  Flag.prototype.setSelected = function (sel) {
    this.selected = sel;
    this.applySelected();
  };

  Flag.prototype.simulate = function (now) {
    const t = now / 1000;
    const w = windStrength;

    let env = 0.7 + 0.3 * Math.sin(t * 0.6) * Math.sin(t * 0.27 + 1.0);
    if (now < gustEnd) env += 1.4 * ((gustEnd - now) / 900);
    const base = (180 + w * 1500) * env;

    const waveSpeed = 5.5 + w * 7.0;
    const waveK = 10.5;

    const geo = this.flagGeo;
    geo.computeVertexNormals();
    const normals = geo.attributes.normal;
    const particles = this.particles;

    for (let iy = 0; iy <= this.segsY; iy++) {
      for (let ix = 0; ix <= this.segsX; ix++) {
        const i = this.idx(ix, iy);
        const p = particles[i];
        p.addForce(gravityForce);

        const u = ix / this.segsX;
        const v = iy / this.segsY;
        const amp = u * (0.35 + 0.65 * u);

        const phase = u * waveK - t * waveSpeed + v * 1.4;
        const ripple = Math.sin(phase) + 0.35 * Math.sin(phase * 2.1 + v * 3.0 + 1.7);

        windLocal.set(
          base * (0.9 + 0.12 * ripple),
          base * 0.16 * ripple * amp,
          base * (0.55 * ripple * amp + 0.07 * Math.sin(t * 1.7 + v * 2.0))
        );

        tmp.set(normals.getX(i), normals.getY(i), normals.getZ(i));
        const along = tmp.dot(windLocal);
        p.addForce(tmp.multiplyScalar(along));

        drag.set(base * 0.16 * amp, 0, 0);
        p.addForce(drag);
      }
    }

    for (let i = 0; i < particles.length; i++) particles[i].integrate(TIMESTEP_SQ);

    for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
      const cons = this.constraints;
      for (let c = 0; c < cons.length; c++) satisfyConstraint(cons[c][0], cons[c][1], cons[c][2]);
    }

    const pos = geo.attributes.position;
    for (let i = 0; i < particles.length; i++) {
      pos.setXYZ(i, particles[i].position.x, particles[i].position.y, particles[i].position.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.attributes.normal.needsUpdate = true;
  };

  Flag.prototype.dispose = function () {
    scene.remove(this.group);
    if (this.flagGeo) this.flagGeo.dispose();
    if (this.flagMat) this.flagMat.dispose();
    if (this.poleGeo) this.poleGeo.dispose();
    if (this.poleMat) this.poleMat.dispose();
    if (this.finialGeo) this.finialGeo.dispose();
    if (this.finialMat) this.finialMat.dispose();
    if (this.texture) this.texture.dispose();
  };

  // ---- Flag manager ---------------------------------------------------------
  const flags = [];
  let selected = null;

  function layoutFlags() {
    const n = flags.length;
    const spacing = FLAG_W + FLAG_GAP;
    const total = (n - 1) * spacing;
    flags.forEach((f, i) => { f.group.position.x = -total / 2 + i * spacing; });
    orbit.radius = Math.max(300, Math.min(3200, 620 + (n - 1) * 330));
  }

  function selectFlag(f) {
    selected = f;
    flags.forEach((x) => x.setSelected(x === f));
    ratioSel.value = f.ratioMode;
    renderTabs();
  }

  function addFlag() {
    if (flags.length >= MAX_FLAGS) return;
    const f = new Flag();
    flags.push(f);
    layoutFlags();
    selectFlag(f);
  }

  function removeFlag() {
    if (flags.length <= 1) return;
    const i = flags.indexOf(selected);
    selected.dispose();
    flags.splice(i, 1);
    layoutFlags();
    selectFlag(flags[Math.max(0, i - 1)]);
  }

  // ---- Camera orbit ---------------------------------------------------------
  const orbit = { theta: -0.35, phi: 1.32, radius: 640, target: new THREE.Vector3(0, 0, 0) };
  function applyCamera() {
    const r = orbit.radius;
    const x = r * Math.sin(orbit.phi) * Math.sin(orbit.theta);
    const y = r * Math.cos(orbit.phi);
    const z = r * Math.sin(orbit.phi) * Math.cos(orbit.theta);
    camera.position.set(x, y, z).add(orbit.target);
    camera.lookAt(orbit.target);
  }

  let dragging = false, lastX = 0, lastY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lastX) * 0.005;
    orbit.phi -= (e.clientY - lastY) * 0.005;
    orbit.phi = Math.max(0.25, Math.min(Math.PI - 0.25, orbit.phi));
    lastX = e.clientX; lastY = e.clientY;
  });
  renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.radius = Math.max(260, Math.min(3600, orbit.radius + e.deltaY * 0.5));
  }, { passive: false });

  // ---- Animation ------------------------------------------------------------
  function animate() {
    requestAnimationFrame(animate);
    const now = Date.now();
    for (let i = 0; i < flags.length; i++) flags[i].simulate(now);
    applyCamera();
    renderer.render(scene, camera);
  }

  // ---- UI wiring ------------------------------------------------------------
  const fileInput = document.getElementById('file');
  const drop = document.getElementById('drop');
  const windSlider = document.getElementById('wind');
  const windVal = document.getElementById('windVal');
  const ratioSel = document.getElementById('ratio');
  const gustBtn = document.getElementById('gust');
  const flagTabs = document.getElementById('flagTabs');
  const flagCount = document.getElementById('flagCount');
  const removeBtn = document.getElementById('removeFlag');

  function renderTabs() {
    flagTabs.innerHTML = '';
    flags.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'flag-tab' + (f === selected ? ' sel' : '');
      b.textContent = String(i + 1);
      b.title = 'Flag ' + (i + 1);
      b.addEventListener('click', () => selectFlag(f));
      flagTabs.appendChild(b);
    });
    if (flags.length < MAX_FLAGS) {
      const add = document.createElement('button');
      add.className = 'flag-add';
      add.textContent = '＋';
      add.title = 'Add a flag';
      add.addEventListener('click', addFlag);
      flagTabs.appendChild(add);
    }
    flagCount.textContent = flags.length + ' / ' + MAX_FLAGS;
    removeBtn.disabled = flags.length <= 1;
  }

  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      const w = img.naturalWidth, h = img.naturalHeight;
      const f = selected;
      f.lastImageRatio = w / h;
      f.setTexture(makeFlagTexture(img, w, h));
      if (f.ratioMode === 'auto') { f.h = f.w / f.lastImageRatio; f.build(); }
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
  }

  fileInput.addEventListener('change', (e) => loadImage(e.target.files[0]));

  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]);
  });

  windSlider.addEventListener('input', () => {
    windStrength = parseInt(windSlider.value, 10) / 100;
    windVal.textContent = windSlider.value;
  });

  ratioSel.addEventListener('change', () => { selected.setRatio(ratioSel.value); });
  gustBtn.addEventListener('click', () => { gustEnd = Date.now() + 900; });
  removeBtn.addEventListener('click', removeFlag);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- Go -------------------------------------------------------------------
  windStrength = parseInt(windSlider.value, 10) / 100;
  addFlag();        // start with one flag
  applyCamera();
  animate();
})();
