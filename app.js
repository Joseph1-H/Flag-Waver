/* Flag Waver — realistic cloth-simulated flag with Three.js
 * Verlet integration + distance constraints + aerodynamic (normal-based) wind.
 */
(function () {
  'use strict';

  // ---- Simulation constants -------------------------------------------------
  const DAMPING = 0.03;
  const DRAG = 1 - DAMPING;
  const MASS = 0.1;
  const GRAVITY = 981 * 1.4;
  const TIMESTEP = 18 / 1000;
  const TIMESTEP_SQ = TIMESTEP * TIMESTEP;
  const CONSTRAINT_ITERATIONS = 3;

  // Flag geometry (world units). Width/height recomputed when ratio changes.
  let segsX = 24;
  let segsY = 16;
  let flagW = 320;
  let flagH = 320 / 1.5;

  const gravityForce = new THREE.Vector3(0, -GRAVITY, 0).multiplyScalar(MASS);
  const windForce = new THREE.Vector3(0, 0, 0);
  const tmp = new THREE.Vector3();
  const diff = new THREE.Vector3();

  let windStrength = 0.6; // 0..1 from slider
  let gustEnd = 0;

  // ---- Particle & Cloth -----------------------------------------------------
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
    // a += force / mass
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

  let particles = [];
  let constraints = [];

  function idx(ix, iy) { return iy * (segsX + 1) + ix; }

  function buildCloth() {
    particles = [];
    constraints = [];

    const dx = flagW / segsX;
    const dy = flagH / segsY;

    for (let iy = 0; iy <= segsY; iy++) {
      for (let ix = 0; ix <= segsX; ix++) {
        const x = (ix / segsX - 0.5) * flagW;
        const y = (0.5 - iy / segsY) * flagH;
        const p = new Particle(x, y, 0);
        if (ix === 0) p.pinned = true; // hoist edge attached to pole
        particles.push(p);
      }
    }

    const restH = dx;
    const restV = dy;
    const restD = Math.sqrt(dx * dx + dy * dy);

    for (let iy = 0; iy <= segsY; iy++) {
      for (let ix = 0; ix <= segsX; ix++) {
        if (ix < segsX) constraints.push([particles[idx(ix, iy)], particles[idx(ix + 1, iy)], restH]);
        if (iy < segsY) constraints.push([particles[idx(ix, iy)], particles[idx(ix, iy + 1)], restV]);
        // shear (diagonals) keep the cloth from collapsing
        if (ix < segsX && iy < segsY) {
          constraints.push([particles[idx(ix, iy)], particles[idx(ix + 1, iy + 1)], restD]);
          constraints.push([particles[idx(ix + 1, iy)], particles[idx(ix, iy + 1)], restD]);
        }
      }
    }
  }

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
  scene.fog = new THREE.Fog(0x0b1020, 600, 1600);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 1, 5000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Lighting
  scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x30405f, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
  sun.position.set(240, 320, 420);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 2000;
  sun.shadow.camera.left = -600;
  sun.shadow.camera.right = 600;
  sun.shadow.camera.top = 600;
  sun.shadow.camera.bottom = -600;
  scene.add(sun);

  // Group holds flag + pole so the hoist sits at left
  const flagGroup = new THREE.Group();
  scene.add(flagGroup);

  // Pole
  const poleHeight = flagH * 1.9;
  let pole, finial;
  function buildPole() {
    if (pole) flagGroup.remove(pole);
    if (finial) flagGroup.remove(finial);
    const h = flagH * 1.9;
    const poleGeo = new THREE.CylinderGeometry(5, 6, h, 24);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa6bd, metalness: 0.75, roughness: 0.35 });
    pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(-flagW / 2 - 4, h / 2 - flagH / 2, 0);
    pole.castShadow = true;
    flagGroup.add(pole);

    const ballGeo = new THREE.SphereGeometry(11, 24, 24);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffcf5c, metalness: 0.9, roughness: 0.25 });
    finial = new THREE.Mesh(ballGeo, ballMat);
    finial.position.set(-flagW / 2 - 4, h - flagH / 2 + 11, 0);
    finial.castShadow = true;
    flagGroup.add(finial);
  }

  // Flag mesh
  let flagMesh, flagGeo, flagMat;
  let flagTexture = makeDefaultTexture();

  function buildFlagMesh() {
    if (flagMesh) {
      flagGroup.remove(flagMesh);
      flagGeo.dispose();
    }
    flagGeo = new THREE.PlaneGeometry(flagW, flagH, segsX, segsY);
    flagMat = new THREE.MeshStandardMaterial({
      map: flagTexture,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.0,
    });
    flagMesh = new THREE.Mesh(flagGeo, flagMat);
    flagMesh.castShadow = true;
    flagMesh.receiveShadow = true;
    flagGroup.add(flagMesh);
  }

  function rebuild() {
    buildCloth();
    buildPole();
    buildFlagMesh();
  }

  // ---- Default texture (shown before upload) --------------------------------
  function makeDefaultTexture() {
    const c = document.createElement('canvas');
    c.width = 768; c.height = 512;
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
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    return tex;
  }

  // ---- Camera orbit (minimal, no external controls) -------------------------
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
    orbit.radius = Math.max(260, Math.min(1400, orbit.radius + e.deltaY * 0.5));
  }, { passive: false });

  // ---- Simulation loop ------------------------------------------------------
  let time = Date.now();

  function simulate(now) {
    // Wind: base strength from slider, plus layered sine gusts, plus manual gust.
    let strength = windStrength * 2000;
    if (now < gustEnd) strength += 2600 * ((gustEnd - now) / 900);
    const wobble = (Math.sin(now / 900) * 0.5 + Math.sin(now / 430) * 0.3 + 0.9);
    const mag = strength * Math.max(0.15, wobble);

    windForce.set(
      mag,
      Math.sin(now / 1700) * mag * 0.12,
      Math.sin(now / 650) * mag * 0.35
    );

    // Aerodynamic force: use current face normals so the cloth catches the wind.
    flagGeo.computeVertexNormals();
    const normals = flagGeo.attributes.normal;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.addForce(gravityForce);
      tmp.set(normals.getX(i), normals.getY(i), normals.getZ(i));
      const f = tmp.dot(windForce);
      p.addForce(tmp.multiplyScalar(f));
    }

    for (let i = 0; i < particles.length; i++) particles[i].integrate(TIMESTEP_SQ);

    for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
      for (let c = 0; c < constraints.length; c++) {
        const con = constraints[c];
        satisfyConstraint(con[0], con[1], con[2]);
      }
    }

    // Write particle positions into the geometry.
    const pos = flagGeo.attributes.position;
    for (let i = 0; i < particles.length; i++) {
      pos.setXYZ(i, particles[i].position.x, particles[i].position.y, particles[i].position.z);
    }
    pos.needsUpdate = true;
    flagGeo.computeVertexNormals();
    flagGeo.attributes.normal.needsUpdate = true;
  }

  function animate() {
    requestAnimationFrame(animate);
    const now = Date.now();
    simulate(now);
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

  let ratioMode = '1.5';
  let lastImageRatio = 1.5;

  function setRatio(value) {
    let r = value === 'auto' ? lastImageRatio : parseFloat(value);
    r = Math.max(0.5, Math.min(3, r));
    flagH = flagW / r;
    rebuild();
  }

  function applyBitmap(source, w, h) {
    // Draw through a 2D canvas so EXIF orientation is baked in and the
    // texture upload is consistent across browsers (no sideways/upside-down).
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(source, 0, 0, w, h);
    lastImageRatio = w / h;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    flagTexture = tex;
    if (ratioMode === 'auto') flagH = flagW / lastImageRatio;
    rebuild();
  }

  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    // Preferred path: createImageBitmap honors EXIF orientation directly.
    if (window.createImageBitmap) {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then((bmp) => { applyBitmap(bmp, bmp.width, bmp.height); bmp.close && bmp.close(); })
        .catch(() => loadViaImg(file));
    } else {
      loadViaImg(file);
    }
  }

  function loadViaImg(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      applyBitmap(img, img.naturalWidth, img.naturalHeight);
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
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]);
  });
  // allow dropping anywhere on the page
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]);
  });

  windSlider.addEventListener('input', () => {
    windStrength = parseInt(windSlider.value, 10) / 100;
    windVal.textContent = windSlider.value;
  });

  ratioSel.addEventListener('change', () => {
    ratioMode = ratioSel.value;
    setRatio(ratioMode);
  });

  gustBtn.addEventListener('click', () => { gustEnd = Date.now() + 900; });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- Go -------------------------------------------------------------------
  windStrength = parseInt(windSlider.value, 10) / 100;
  rebuild();
  applyCamera();
  animate();
})();
