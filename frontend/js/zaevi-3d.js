/**
 * ==========================================================================
 * ZAEVI — 3D WebGL Engine & Atelier Studio
 * Three.js site-wide silk stage, lacquered monogram, 360° Studio Viewer & Hotspots
 * ==========================================================================
 */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Check WebGL support & reduced motion
  function isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =========================================================================
  // 1. Site-wide Live Stage: crimson silk, lacquered monogram, drifting motes
  //    One fixed canvas sits behind every storefront page (z-index:-1, no
  //    pointer events). Copy stays readable because the silk dims with scroll.
  // =========================================================================
  const SILK_VERTEX = `
    uniform float uTime, uFlow, uPointerAmp, uRippleTime, uRippleAmp;
    uniform vec2 uPointer, uRippleOrigin;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying float vFold;

    vec3 permute(vec3 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m; m = m * m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    // Long diagonal folds with a slowly wandering phase, so they read as draped satin.
    float fold(vec2 p){
      float t = uTime * 0.075 + uFlow;
      float across = p.x * 0.8 + p.y * 0.6;
      float along = -p.x * 0.6 + p.y * 0.8;
      float wander = snoise(vec2(along * 0.07 + t * 0.5, across * 0.045 - t * 0.3)) * 2.4;
      float h = sin(across * 0.46 + wander + t * 1.5) * 1.15;
      h += sin(across * 0.93 + wander * 1.6 - t * 1.1 + 1.3) * 0.46;
      h += snoise(vec2(across * 0.2 - t * 0.4, along * 0.1 + t * 0.2)) * 0.34;
      float d = distance(p, uPointer);
      h += uPointerAmp * exp(-d * d * 0.16) * sin(d * 1.9 - uTime * 1.6) * 0.55;
      if (uRippleAmp > 0.001) {
        float front = distance(p, uRippleOrigin) - uRippleTime * 7.0;
        h += uRippleAmp * exp(-front * front * 0.22) * sin(front * 1.7) * 0.7;
      }
      return h;
    }

    void main(){
      vec3 pos = position;
      const float e = 0.12;
      float h = fold(pos.xy);
      vec3 n = normalize(vec3(h - fold(pos.xy + vec2(e, 0.0)), h - fold(pos.xy + vec2(0.0, e)), e));
      pos.z += h;
      vec4 world = modelMatrix * vec4(pos, 1.0);
      vWorld = world.xyz;
      vNormalW = normalize(mat3(modelMatrix) * n);
      vFold = h;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const SILK_FRAGMENT = `
    precision highp float;
    uniform vec3 uDeep, uBase, uSheen, uGlint, uFloor;
    uniform float uDim;
    uniform vec2 uRes;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying float vFold;

    void main(){
      vec3 N = normalize(vNormalW);
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 L1 = normalize(vec3(0.5, 0.62, 0.62));
      vec3 L2 = normalize(vec3(-0.75, -0.3, 0.55));
      float wrap = clamp(dot(N, L1) * 0.6 + 0.4, 0.0, 1.0);
      float n1 = max(dot(N, normalize(L1 + V)), 0.0);
      float n2 = max(dot(N, normalize(L2 + V)), 0.0);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

      // Satin: a wide soft lobe carries the fold, and a tight lobe adds a restrained glint.
      vec3 c = mix(uDeep, uBase, wrap * wrap * wrap);
      c += uSheen * pow(n1, 18.0) * 0.72 + uGlint * pow(n1, 170.0) * 0.2;
      c += uSheen * pow(n2, 30.0) * 0.12 + uBase * fres * 0.22;
      c *= 0.55 + 0.45 * smoothstep(-1.3, 1.2, vFold);

      vec2 uv = gl_FragCoord.xy / uRes;
      c *= mix(0.3, 1.0, smoothstep(1.15, 0.2, distance(uv, vec2(0.66, 0.56))));

      // Dim after gamma: uDim then maps directly to how dark the page looks behind text.
      c = c / (1.0 + c * 0.4);
      vec3 g = pow(c, vec3(1.0 / 2.2));
      gl_FragColor = vec4(uFloor + g * uDim, 1.0);
    }
  `;

  // Silk palettes, selected by the hero buttons. Values are sRGB and converted to linear below.
  const SILK_PALETTES = {
    silk: { deep: 0x140105, base: 0x8a0614, sheen: 0xd10f25, glint: 0xffc9bd },
    monolith: { deep: 0x050304, base: 0x1f181a, sheen: 0x5a4a4e, glint: 0xffe4de },
    sapphire: { deep: 0x020614, base: 0x0a2a8a, sheen: 0x2a5cf0, glint: 0xcfe0ff },
    emerald: { deep: 0x01100a, base: 0x075c3a, sheen: 0x12a66b, glint: 0xc9ffe6 },
    amber: { deep: 0x140a01, base: 0x7a4204, sheen: 0xd98a14, glint: 0xffe6bd },
  };
  const ACCENT_LABELS = { rouge: 'Rouge', sapphire: 'Sapphire', emerald: 'Emerald', amber: 'Amber' };
  const ACCENT_LACQUER = { rouge: 0xd30a1f, sapphire: 0x1f4fd8, emerald: 0x0e7d4f, amber: 0xc46a08 };
  const MOTION_SPEEDS = { still: 0, calm: 0.45, normal: 1, lively: 1.8 };

  // The ZAEVI monogram, traced from assets/zaevi-icon.png (coordinates are icon pixels).
  function monogramShapes() {
    const S = 0.0042;
    const X = (px) => (px - 820) * S;
    const Y = (py) => (780 - py) * S;
    const path = (start, segments) => {
      const shape = new THREE.Shape();
      shape.moveTo(X(start[0]), Y(start[1]));
      segments.forEach((s) => {
        if (s.length === 2) shape.lineTo(X(s[0]), Y(s[1]));
        else shape.bezierCurveTo(X(s[0]), Y(s[1]), X(s[2]), Y(s[3]), X(s[4]), Y(s[5]));
      });
      shape.closePath();
      return shape;
    };
    const letter = path([375, 413], [
      [1128, 413], [605, 1043],
      [480, 1055, 390, 1105, 316, 1176],
      [430, 1095, 530, 1062, 645, 1062],
      [790, 1062, 880, 1122, 960, 1165],
      [1040, 1205, 1090, 1210, 1140, 1208],
      [1240, 1205, 1330, 1158, 1395, 1100],
      [1340, 1215, 1225, 1318, 1020, 1318],
      [860, 1318, 760, 1255, 680, 1205],
      [610, 1162, 550, 1138, 480, 1138],
      [385, 1138, 320, 1170, 258, 1215],
      [870, 457],
      [700, 447, 590, 450, 530, 470],
      [430, 505, 360, 570, 292, 670],
      [285, 675, 280, 662, 284, 652],
    ]);
    const star = path([1207, 160], [
      [1225, 250, 1270, 310, 1367, 328],
      [1270, 345, 1220, 400, 1202, 497],
      [1190, 400, 1140, 345, 1041, 328],
      [1140, 310, 1190, 250, 1207, 160],
    ]);
    return { letter, star, starCentre: new THREE.Vector3(X(1205), Y(328), 0) };
  }

  // Procedural studio reflections, so the lacquer needs no HDR download.
  function buildStudioEnvironment(renderer) {
    const room = new THREE.Scene();
    room.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0x080304, side: THREE.BackSide })));
    const softbox = (w, h, r, g, b, x, y, z) => {
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      material.color.setRGB(r, g, b);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
      panel.position.set(x, y, z);
      panel.lookAt(0, 0, 0);
      room.add(panel);
    };
    softbox(9, 3, 3.4, 3.2, 3.2, 2, 8, 4);
    softbox(3, 9, 5, 0.7, 0.8, -8, 0, 3);
    softbox(4, 7, 1.3, 1.2, 1.2, 8, -1, 5);
    softbox(10, 2, 2.4, 0.3, 0.4, 0, -8, 2);
    const generator = new THREE.PMREMGenerator(renderer);
    const env = generator.fromScene(room, 0.025).texture;
    generator.dispose();
    room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return env;
  }

  function initLiveStage() {
    if (!window.THREE || !isWebGLAvailable() || document.getElementById('zaeviStage')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'zaeviStage';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      canvas.remove();
      return;
    }

    const root = document.documentElement;
    const body = document.body;
    const isHome = body.classList.contains('home-page');
    const isCalm = ['checkout-page', 'account-page', 'track-page', 'confirmation-page'].some((c) => body.classList.contains(c));
    const isSmall = Math.min(window.innerWidth, window.innerHeight) < 700;
    const hero = document.querySelector('.hero');
    const topBlock = hero || document.querySelector('.pagehero');
    const manifesto = document.querySelector('.manifesto');
    const baseDim = isCalm ? 0.08 : 0.16;
    const topDim = hero ? 1 : topBlock ? 0.8 : baseDim;
    const minFrameMs = isHome ? 0 : 1000 / 30;

    root.classList.add('has-stage');
    renderer.setClearColor(0x0b0708, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping; // ACES shifts the brand crimson towards orange
    let pixelRatio = Math.min(window.devicePixelRatio || 1, isSmall ? 1.25 : 1.6);
    renderer.setPixelRatio(pixelRatio);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    camera.position.set(0, 0, 12);

    // --- Silk ---
    const linear = (hex) => new THREE.Color(hex).convertSRGBToLinear();
    const paletteOf = (mode) => {
      const p = SILK_PALETTES[mode];
      return { uDeep: linear(p.deep), uBase: linear(p.base), uSheen: linear(p.sheen), uGlint: linear(p.glint) };
    };
    let colourPalette = 'silk'; // what the "colour" hero button means for the chosen accent
    const targetPalette = paletteOf('silk');
    const silkUniforms = {
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uPointerAmp: { value: 0 },
      uRippleOrigin: { value: new THREE.Vector2(0, 0) },
      uRippleTime: { value: 0 },
      uRippleAmp: { value: 0 },
      uDim: { value: topDim },
      uRes: { value: new THREE.Vector2(1, 1) },
      uFloor: { value: new THREE.Color(0x0b0708) },
      uDeep: { value: targetPalette.uDeep.clone() },
      uBase: { value: targetPalette.uBase.clone() },
      uSheen: { value: targetPalette.uSheen.clone() },
      uGlint: { value: targetPalette.uGlint.clone() },
    };
    const segments = isSmall ? [96, 64] : isHome ? [220, 140] : [150, 96];
    const silkGeometry = new THREE.PlaneGeometry(38, 25, segments[0], segments[1]);
    const silk = new THREE.Mesh(silkGeometry, new THREE.ShaderMaterial({
      uniforms: silkUniforms,
      vertexShader: SILK_VERTEX,
      fragmentShader: SILK_FRAGMENT,
      toneMapped: false,
    }));
    silk.rotation.x = -0.38;
    silk.rotation.z = 0.12;
    silk.position.z = -3;
    silk.frustumCulled = false;
    scene.add(silk);

    // --- Motes of light ---
    const moteCount = isSmall ? 50 : 110;
    const motePositions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      motePositions[i * 3] = (Math.random() - 0.5) * 20;
      motePositions[i * 3 + 1] = (Math.random() - 0.5) * 13;
      motePositions[i * 3 + 2] = Math.random() * 7 - 2;
    }
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    const dotCanvas = document.createElement('canvas');
    dotCanvas.width = dotCanvas.height = 48;
    const dotCtx = dotCanvas.getContext('2d');
    const dotGradient = dotCtx.createRadialGradient(24, 24, 0, 24, 24, 24);
    dotGradient.addColorStop(0, 'rgba(255,235,228,1)');
    dotGradient.addColorStop(0.35, 'rgba(255,120,120,.5)');
    dotGradient.addColorStop(1, 'rgba(255,60,70,0)');
    dotCtx.fillStyle = dotGradient;
    dotCtx.fillRect(0, 0, 48, 48);
    const moteMaterial = new THREE.PointsMaterial({
      size: 0.11,
      map: new THREE.CanvasTexture(dotCanvas),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const motes = new THREE.Points(moteGeometry, moteMaterial);
    scene.add(motes);

    // --- Monogram (homepage hero only) ---
    let monogram = null;
    let monogramStar = null;
    let lacquer = null;
    let monogramEnabled = true;
    let motionSpeed = 1;
    if (hero) {
      const { letter, star, starCentre } = monogramShapes();
      lacquer = new THREE.MeshPhysicalMaterial({
        color: linear(0xc70a1c),
        metalness: 0.45,
        roughness: 0.24,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMap: buildStudioEnvironment(renderer),
        envMapIntensity: 1,
      });
      const extrude = { steps: 1, depth: 0.2, curveSegments: isSmall ? 18 : 32, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.028, bevelSegments: isSmall ? 2 : 5 };
      monogram = new THREE.Group();
      const letterGeometry = new THREE.ExtrudeGeometry(letter, extrude);
      letterGeometry.translate(0, 0, -0.1);
      monogram.add(new THREE.Mesh(letterGeometry, lacquer));
      const starGeometry = new THREE.ExtrudeGeometry(star, extrude);
      starGeometry.translate(-starCentre.x, -starCentre.y, -0.1);
      monogramStar = new THREE.Mesh(starGeometry, lacquer);
      monogramStar.position.copy(starCentre);
      monogram.add(monogramStar);
      scene.add(monogram);

      const key = new THREE.DirectionalLight(0xffffff, 0.42);
      key.position.set(4, 6, 8);
      scene.add(key);
      const rim = new THREE.PointLight(0xff1a30, 3, 24);
      rim.position.set(-5, -3, 4);
      scene.add(rim);

      const controls = document.createElement('div');
      controls.className = 'hero-3d-container';
      controls.innerHTML = `
        <div class="hero-3d-controls" role="group" aria-label="3D scene colour">
          <button type="button" class="hero-3d-btn active" data-mode="silk" aria-pressed="true">✦ Rouge Silk</button>
          <button type="button" class="hero-3d-btn" data-mode="monolith" aria-pressed="false">✦ Noir Silk</button>
        </div>
      `;
      const heroBg = hero.querySelector('.hero-bg') || hero.firstChild;
      hero.insertBefore(controls, heroBg ? heroBg.nextSibling : null);
      const modeButtons = controls.querySelectorAll('.hero-3d-btn');
      modeButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          modeButtons.forEach((b) => {
            b.classList.toggle('active', b === btn);
            b.setAttribute('aria-pressed', String(b === btn));
          });
          Object.assign(targetPalette, paletteOf(btn.dataset.mode === 'silk' ? colourPalette : btn.dataset.mode));
          if (prefersReducedMotion) {
            ['uDeep', 'uBase', 'uSheen', 'uGlint'].forEach((k) => silkUniforms[k].value.copy(targetPalette[k]));
            renderer.render(scene, camera);
          }
        });
      });
    }

    // --- Layout ---
    function layoutMonogram() {
      if (!monogram) return;
      const aspect = camera.aspect;
      if (aspect < 0.95) {
        monogram.userData.base = { x: 0, y: 1.75, s: Math.max(0.36, 0.52 * aspect) };
      } else {
        monogram.userData.base = { x: Math.min(3.25, 1.95 * aspect), y: 0.05, s: Math.min(0.82, 0.5 * aspect) };
      }
    }

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(silkUniforms.uRes.value);
      layoutMonogram();
      updateScroll();
    }

    // --- Scroll-driven dimming: full silk at the top, quiet behind content ---
    let targetDim = topDim;
    let heroProgress = 0;
    function updateScroll() {
      const vh = window.innerHeight;
      let dim = baseDim;
      heroProgress = 1;
      if (topBlock) {
        const rect = topBlock.getBoundingClientRect();
        const visible = Math.max(0, Math.min(1, rect.bottom / rect.height));
        heroProgress = 1 - visible;
        dim = baseDim + (topDim - baseDim) * visible * visible;
      }
      if (manifesto) {
        const rect = manifesto.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - vh / 2);
        dim = Math.max(dim, 0.62 * Math.max(0, 1 - distance / (vh * 0.8)));
      }
      targetDim = dim;
    }

    // --- Pointer ---
    let pointerX = 0;
    let pointerY = 0;
    let smoothX = 0;
    let smoothY = 0;
    let pointerEnergy = 0;
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      pointerY = -(e.clientY / window.innerHeight) * 2 + 1;
      pointerEnergy = 1;
    }, { passive: true });
    window.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('resize', resize, { passive: true });

    // --- Ripple: a wave through the cloth from a click or an add to bag ---
    let rippleAmp = 0;
    function ripple(clientX, clientY, strength = 1) {
      if (prefersReducedMotion) return;
      silkUniforms.uRippleOrigin.value.set(
        (clientX / window.innerWidth * 2 - 1) * 8.5,
        (1 - clientY / window.innerHeight * 2) * 5.5
      );
      silkUniforms.uRippleTime.value = 0;
      rippleAmp = strength;
    }
    document.addEventListener('click', (e) => {
      if (e.detail > 0) ripple(e.clientX, e.clientY, 1); // detail is 0 for keyboard activation
    }, { passive: true });

    // --- Frame ---
    let time = 0;
    let last = 0;
    let raf = null;
    let sampleSum = 0;
    let sampleCount = 0;

    function drawScene(dt) {
      const ease = Math.min(1, dt * 3.2);
      time += dt * motionSpeed;
      smoothX += (pointerX - smoothX) * ease;
      smoothY += (pointerY - smoothY) * ease;
      pointerEnergy *= Math.pow(0.35, dt);

      silkUniforms.uTime.value = time;
      silkUniforms.uFlow.value = window.scrollY * 0.00028;
      silkUniforms.uPointer.value.set(smoothX * 8.5, smoothY * 5.5);
      silkUniforms.uPointerAmp.value = pointerEnergy;
      rippleAmp *= Math.pow(0.28, dt);
      silkUniforms.uRippleAmp.value = rippleAmp;
      silkUniforms.uRippleTime.value += dt;
      // The wave briefly lifts the silk, so it also shows behind dimmed content.
      silkUniforms.uDim.value += (targetDim + rippleAmp * 0.2 - silkUniforms.uDim.value) * Math.min(1, dt * 4);
      ['uDeep', 'uBase', 'uSheen', 'uGlint'].forEach((k) => silkUniforms[k].value.lerp(targetPalette[k], Math.min(1, dt * 2.4)));

      camera.position.x = smoothX * 0.55;
      camera.position.y = smoothY * 0.38;
      camera.lookAt(0, 0, 0);

      motes.rotation.y = time * 0.018 + smoothX * 0.05;
      motes.position.y = Math.sin(time * 0.12) * 0.35;
      moteMaterial.opacity = 0.15 + 0.7 * Math.min(1, silkUniforms.uDim.value);

      if (monogram) {
        const base = monogram.userData.base;
        const intro = 1 - Math.pow(1 - Math.min(1, time / 1.8), 3);
        monogram.visible = monogramEnabled && heroProgress < 0.98;
        const scale = base.s * (0.72 + 0.28 * intro);
        monogram.scale.setScalar(scale);
        monogram.position.set(
          base.x,
          base.y + Math.sin(time * 0.6) * 0.1 + heroProgress * 3.4 + (1 - intro) * -0.9,
          2.2 - heroProgress * 2.5
        );
        monogram.rotation.y = -0.34 + Math.sin(time * 0.32) * 0.3 + smoothX * 0.32 + (1 - intro) * -1.5 + heroProgress * 1.4;
        monogram.rotation.x = Math.sin(time * 0.27) * 0.07 - smoothY * 0.2;
        monogram.rotation.z = -0.03 + Math.sin(time * 0.2) * 0.02;
        monogramStar.rotation.z = time * 0.35;
      }

      renderer.render(scene, camera);
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const elapsed = now - last;
      if (elapsed < minFrameMs) return;
      last = now;
      if (elapsed > 500) return; // returning from a hidden tab; do not jump
      drawScene(elapsed / 1000);

      // Adaptive quality: step down rather than hurt scrolling on slow GPUs.
      sampleSum += elapsed;
      sampleCount += 1;
      if (sampleCount >= 50) {
        const average = sampleSum / sampleCount;
        sampleSum = 0;
        sampleCount = 0;
        if (average > Math.max(minFrameMs, 16.7) * 1.7 && pixelRatio > 0.75) {
          pixelRatio = Math.max(0.75, pixelRatio * 0.78);
          renderer.setPixelRatio(pixelRatio);
          resize();
        } else if (average > 85 && pixelRatio <= 0.75) {
          cancelAnimationFrame(raf); // keep the last frame as a still backdrop
          raf = null;
        }
      }
    }

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      root.classList.remove('has-stage'); // falls back to the CSS backdrop and hero photograph
    });

    resize();
    silkUniforms.uDim.value = targetDim;
    if (prefersReducedMotion) {
      time = 6;
      drawScene(2);
      silkUniforms.uDim.value = targetDim;
      renderer.render(scene, camera);
      window.addEventListener('scroll', () => {
        silkUniforms.uDim.value = targetDim;
        renderer.render(scene, camera);
      }, { passive: true });
    } else {
      raf = requestAnimationFrame((now) => {
        last = now;
        frame(now);
      });
    }

    // Called by Site Studio with the published colours and movement.
    function setLook(look = {}) {
      const accent = SILK_PALETTES[look.accent] ? look.accent : 'rouge';
      colourPalette = accent === 'rouge' ? 'silk' : accent;
      const mode = look.silkColor === 'monolith' ? 'monolith' : colourPalette;
      Object.assign(targetPalette, paletteOf(mode));
      silk.visible = look.silkEnabled !== false;
      monogramEnabled = look.monogramEnabled !== false;
      motionSpeed = MOTION_SPEEDS[look.motion] ?? 1;
      if (lacquer) lacquer.color.copy(linear(ACCENT_LACQUER[accent] ?? ACCENT_LACQUER.rouge));
      document.querySelectorAll('.hero-3d-btn').forEach((btn) => {
        const isColour = btn.dataset.mode === 'silk';
        if (isColour) btn.textContent = `✦ ${ACCENT_LABELS[accent]} Silk`;
        const active = isColour ? mode !== 'monolith' : mode === 'monolith';
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      if (prefersReducedMotion || !raf) {
        ['uDeep', 'uBase', 'uSheen', 'uGlint'].forEach((k) => silkUniforms[k].value.copy(targetPalette[k]));
        renderer.render(scene, camera);
      }
    }

    window.zaeviStage = { renderer, scene, ripple, setLook };
  }

  // =========================================================================
  // 2. 3D Atelier Product Studio & 360° Inspection Engine
  // =========================================================================
  let studioScene, studioCamera, studioRenderer, studioGroup, studioActive = false;
  let studioTargetRotX = 0, studioTargetRotY = 0, studioRotX = 0, studioRotY = 0;
  let studioZoom = 7.6, studioTargetZoom = 7.6;
  let isDragging = false, prevMouseX = 0, prevMouseY = 0;
  let studioProductData = null;

  function ensureStudioDOM() {
    let studio = document.getElementById('zaevi3dStudio');
    if (!studio) {
      studio = document.createElement('div');
      studio.id = 'zaevi3dStudio';
      studio.setAttribute('role', 'dialog');
      studio.setAttribute('aria-modal', 'true');
      studio.setAttribute('aria-label', '3D Atelier Product Studio');
      studio.innerHTML = `
        <div class="studio-header">
          <div>
            <div class="studio-title" id="studioProductName">Atelier Creation</div>
            <div class="studio-subtitle">360° Haute Couture Studio Inspection</div>
          </div>
          <button type="button" class="studio-close" id="studioCloseBtn" aria-label="Close 3D Studio">×</button>
        </div>

        <div class="studio-viewport" id="studioViewport">
          <canvas id="zaeviStudioCanvas"></canvas>

          <!-- Interactive 3D Hotspot Pins (Dynamically projected from 3D world coordinates) -->
          <div class="studio-hotspot" id="hotspot1">
            <div class="hotspot-pulse"></div>
            <div class="hotspot-beacon"></div>
            <div class="hotspot-card">
              <h4 class="hotspot-title"></h4>
              <p class="hotspot-desc"></p>
            </div>
          </div>

          <div class="studio-hotspot" id="hotspot2">
            <div class="hotspot-pulse"></div>
            <div class="hotspot-beacon"></div>
            <div class="hotspot-card">
              <h4 class="hotspot-title"></h4>
              <p class="hotspot-desc"></p>
            </div>
          </div>

          <div class="studio-hotspot" id="hotspot3">
            <div class="hotspot-pulse"></div>
            <div class="hotspot-beacon"></div>
            <div class="hotspot-card">
              <h4 class="hotspot-title">Made to order</h4>
              <p class="hotspot-desc">Produced for you after you order. Follow each stage from Track Order.</p>
            </div>
          </div>
        </div>

        <div class="studio-footer">
          <div class="studio-hint">
            <span>✦</span> Click &amp; Drag to Rotate · Scroll to Zoom · Hover Pins for Details
          </div>
          <div class="studio-lighting-modes">
            <button type="button" class="lighting-btn active" data-light="studio">Studio Light</button>
            <button type="button" class="lighting-btn" data-light="noir">Obsidian Noir</button>
            <button type="button" class="lighting-btn" data-light="warm">Warm Atelier</button>
            <button type="button" id="studioAddToBagBtn" class="button button--primary" style="margin-left:12px;padding:8px 20px;font-size:11px;">ADD TO BAG</button>
          </div>
        </div>
      `;
      document.body.appendChild(studio);

      // Wire close button & Escape key
      const closeBtn = document.getElementById('studioCloseBtn');
      closeBtn.addEventListener('click', close3DStudio);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && studioActive) close3DStudio();
      });

      // Lighting mode toggles
      const lightBtns = studio.querySelectorAll('.lighting-btn');
      lightBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          lightBtns.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          setStudioLightingMode(btn.dataset.light);
        });
      });

      // Desktop Mouse Drag Rotation & Wheel Zoom
      const viewport = document.getElementById('studioViewport');
      viewport.addEventListener('mousedown', (e) => {
        if (e.target.closest('.studio-hotspot') || e.target.closest('.hotspot-card')) return;
        isDragging = true;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
      });

      window.addEventListener('mouseup', () => { isDragging = false; });
      window.addEventListener('mousemove', (e) => {
        if (!isDragging || !studioActive) return;
        const dx = e.clientX - prevMouseX;
        const dy = e.clientY - prevMouseY;
        studioTargetRotY += dx * 0.008;
        studioTargetRotX += dy * 0.006;
        studioTargetRotX = Math.max(-0.6, Math.min(0.6, studioTargetRotX));
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
      });

      // Wheel Zoom
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        studioTargetZoom += e.deltaY * 0.005;
        studioTargetZoom = Math.max(3.8, Math.min(11, studioTargetZoom));
      }, { passive: false });

      // Mobile Touch Support (P1): 1-finger rotate, 2-finger pinch-to-zoom
      let isTouchRotating = false;
      let prevTouchX = 0;
      let prevTouchY = 0;
      let initialPinchDist = 0;
      let initialZoom = studioZoom;

      function getTouchDist(t1, t2) {
        return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      }

      viewport.addEventListener('touchstart', (e) => {
        if (e.target.closest('.studio-hotspot') || e.target.closest('.hotspot-card')) return;
        if (e.touches.length === 1) {
          isTouchRotating = true;
          prevTouchX = e.touches[0].clientX;
          prevTouchY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
          isTouchRotating = false;
          initialPinchDist = getTouchDist(e.touches[0], e.touches[1]);
          initialZoom = studioTargetZoom;
        }
      }, { passive: false });

      viewport.addEventListener('touchmove', (e) => {
        if (!studioActive) return;
        if (e.touches.length === 1 && isTouchRotating) {
          if (e.cancelable) e.preventDefault(); // Prevent page background scrolling during 3D rotation
          const curX = e.touches[0].clientX;
          const curY = e.touches[0].clientY;
          const dx = curX - prevTouchX;
          const dy = curY - prevTouchY;
          studioTargetRotY += dx * 0.009;
          studioTargetRotX += dy * 0.007;
          studioTargetRotX = Math.max(-0.6, Math.min(0.6, studioTargetRotX));
          prevTouchX = curX;
          prevTouchY = curY;
        } else if (e.touches.length === 2 && initialPinchDist > 0) {
          if (e.cancelable) e.preventDefault();
          const curDist = getTouchDist(e.touches[0], e.touches[1]);
          const scale = curDist / initialPinchDist;
          const newZoom = initialZoom / scale;
          studioTargetZoom = Math.max(3.8, Math.min(11, newZoom));
        }
      }, { passive: false });

      viewport.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
          isTouchRotating = false;
          initialPinchDist = 0;
        } else if (e.touches.length === 1) {
          isTouchRotating = true;
          prevTouchX = e.touches[0].clientX;
          prevTouchY = e.touches[0].clientY;
          initialPinchDist = 0;
        }
      });

      viewport.addEventListener('touchcancel', () => {
        isTouchRotating = false;
        initialPinchDist = 0;
      });

      // Add to bag button from studio
      const studioAdd = document.getElementById('studioAddToBagBtn');
      studioAdd.addEventListener('click', () => {
        if (studioProductData && typeof window.openQuickView === 'function') {
          close3DStudio();
          window.openQuickView(studioProductData.id);
        } else if (studioProductData) {
          window.zaeviToast?.('Added to Atelier Bag', `${studioProductData.name} · Added from 3D Studio`, '✦');
          close3DStudio();
        }
      });

      // Window resize coordination
      window.addEventListener('resize', () => {
        if (!studioActive || !studioRenderer || !studioCamera) return;
        const v = document.getElementById('studioViewport');
        const w2 = v ? v.clientWidth : window.innerWidth;
        const h2 = v ? v.clientHeight : window.innerHeight;
        studioCamera.aspect = w2 / h2;
        studioCamera.updateProjectionMatrix();
        studioRenderer.setSize(w2, h2);
      });
    }

    return studio;
  }

  let studioKeyLight, studioFillLight, studioRimLight;

  const STUDIO_PANEL_TINTS = { studio: [1, 1, 1], noir: [0.56, 0.54, 0.56], warm: [1, 0.9, 0.76] };
  let studioLightMode = 'studio';

  function tintStudioPanel(mode) {
    if (!studioPanel) return;
    const tint = STUDIO_PANEL_TINTS[mode] || STUDIO_PANEL_TINTS.studio;
    studioPanel.material.color.setRGB(tint[0], tint[1], tint[2]);
  }

  function setStudioLightingMode(mode) {
    studioLightMode = mode;
    tintStudioPanel(mode);
    if (!studioKeyLight || !studioFillLight) return;
    if (mode === 'noir') {
      studioKeyLight.color.setHex(0xa89a9a);
      studioKeyLight.intensity = 1.0;
      studioFillLight.color.setHex(0x222222);
      studioRimLight.color.setHex(0xcf0a1e);
      studioRimLight.intensity = 3.5;
    } else if (mode === 'warm') {
      studioKeyLight.color.setHex(0xffd9c9);
      studioKeyLight.intensity = 2.4;
      studioFillLight.color.setHex(0x7a2a2e);
      studioRimLight.color.setHex(0xff5a4a);
      studioRimLight.intensity = 2.5;
    } else {
      // Default Studio
      studioKeyLight.color.setHex(0xffffff);
      studioKeyLight.intensity = 2.0;
      studioFillLight.color.setHex(0xcf0a1e);
      studioFillLight.intensity = 1.4;
      studioRimLight.color.setHex(0xffffff);
      studioRimLight.intensity = 2.0;
    }
  }

  function initStudioThreeJS() {
    if (studioRenderer) return;
    const canvas = document.getElementById('zaeviStudioCanvas');
    const viewport = document.getElementById('studioViewport');
    const w = viewport.clientWidth || window.innerWidth;
    const h = viewport.clientHeight || window.innerHeight;

    studioScene = new THREE.Scene();
    studioCamera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    studioCamera.position.set(0, 0, studioZoom);

    studioRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    studioRenderer.setSize(w, h);
    studioRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    studioRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    studioRenderer.toneMappingExposure = 1.1;

    // Studio Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.8);
    studioScene.add(amb);

    studioKeyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    studioKeyLight.position.set(5, 7, 6);
    studioScene.add(studioKeyLight);

    studioFillLight = new THREE.DirectionalLight(0xcf0a1e, 1.4);
    studioFillLight.position.set(-6, -2, 4);
    studioScene.add(studioFillLight);

    studioRimLight = new THREE.PointLight(0xffffff, 2.0, 15);
    studioRimLight.position.set(0, 5, -5);
    studioScene.add(studioRimLight);

    // Sculptural Mannequin Pedestal & Garment Representation
    studioGroup = new THREE.Group();

    // Cylindrical Atelier Plinth
    const plinthGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.4, 48);
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x1a0b0e, metalness: 0.85, roughness: 0.3 });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = -2.2;
    studioGroup.add(plinth);

    // Gilded Trim Ring
    const trimGeo = new THREE.TorusGeometry(1.65, 0.025, 16, 64);
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xcf0a1e, metalness: 0.75, roughness: 0.2 });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = -2.0;
    studioGroup.add(trim);

    // Tailor's Haute Couture Torso Mannequin
    const torsoGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.4, -1.8),
        new THREE.Vector2(0.85, -1.2),
        new THREE.Vector2(0.72, -0.4),
        new THREE.Vector2(0.95, 0.6),
        new THREE.Vector2(1.15, 1.3),
        new THREE.Vector2(0.65, 1.7),
        new THREE.Vector2(0.35, 1.9),
      ],
      48
    );

    const garmentMat = new THREE.MeshPhysicalMaterial({
      color: 0x1d0d10,
      roughness: 0.32,
      metalness: 0.4,
      clearcoat: 0.8,
      clearcoatRoughness: 0.25,
      sheen: new THREE.Color(0xcf0a1e), // r128 takes a Color here; a number throws in uniform3fv
    });

    studioTorso = new THREE.Mesh(torsoGeo, garmentMat);
    studioGroup.add(studioTorso);

    // Floating Atelier Hem Ribbon
    const ribbonGeo = new THREE.TorusGeometry(1.2, 0.06, 16, 64);
    studioRibbon = new THREE.Mesh(ribbonGeo, trimMat);
    studioRibbon.rotation.x = Math.PI / 2.3;
    studioRibbon.position.y = -0.5;
    studioGroup.add(studioRibbon);

    studioScene.add(studioGroup);
  }

  // Hang the product's real photograph as a softly moving silk panel. The torso stays
  // as the fallback when no image can be loaded.
  let studioTorso = null;
  let studioRibbon = null;
  let studioPanel = null;
  let studioPanelBase = null;
  let studioLoadToken = 0;

  async function findCatalogProduct(product) {
    try {
      if (!product) return null;
      const api = await fetch('/api/products?limit=100');
      const body = api.ok ? await api.json() : null;
      if (Array.isArray(body?.data) && body.data.length) {
        const live = body.data.find((p) => p.id === product.id) || body.data.find((p) => p.name === product.name);
        return live ? { id: live.id, name: live.name, img: live.imageUrl, color: live.color, cat: live.category, gender: live.gender, sizes: live.sizes } : null;
      }
      const res = await fetch('data/products.json');
      if (!res.ok) return null;
      const list = await res.json();
      if (!Array.isArray(list)) return null;
      return list.find((p) => p.id === product.id) || list.find((p) => p.name === product.name) || null;
    } catch (e) {
      return null;
    }
  }

  function setStudioPin(id, title, description) {
    const pin = document.getElementById(id);
    if (!pin) return;
    pin.hidden = !title;
    pin.querySelector('.hotspot-title').textContent = title || '';
    pin.querySelector('.hotspot-desc').textContent = description || '';
  }

  function fillStudioPins(record) {
    const sizes = record && Array.isArray(record.sizes) ? record.sizes.join(' · ') : '';
    setStudioPin('hotspot1', record && record.color ? `Colour: ${record.color}` : '', record ? `${record.cat} · ${record.gender}` : '');
    setStudioPin('hotspot2', sizes ? 'Available sizes' : '', sizes);
  }

  async function loadStudioPanel(product) {
    const token = ++studioLoadToken;
    fillStudioPins(null);
    const record = await findCatalogProduct(product);
    if (token !== studioLoadToken || !studioGroup) return;
    fillStudioPins(record);
    const onPage = document.querySelector('#gallery img, .quick-view-img');
    const url = (record && record.img) || (onPage && onPage.src);
    if (!url) return;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(url, (texture) => {
      if (token !== studioLoadToken || !studioGroup) {
        texture.dispose();
        return;
      }
      const image = texture.image;
      const height = 3.75;
      const width = height * ((image && image.width && image.height) ? Math.min(1, image.width / image.height) : 0.75);
      const geometry = new THREE.PlaneGeometry(width, height, 36, 44);
      // Unlit and untoned, so shoppers see the photograph's true colours.
      const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
      studioPanel = new THREE.Mesh(geometry, material);
      studioPanel.position.y = 0;
      studioPanelBase = geometry.attributes.position.array.slice();
      studioGroup.add(studioPanel);
      tintStudioPanel(studioLightMode);
      if (studioTorso) studioTorso.visible = false;
      if (studioRibbon) studioRibbon.visible = false;
    });
  }

  function animateStudioPanel(seconds) {
    if (!studioPanel || !studioPanelBase) return;
    const position = studioPanel.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = studioPanelBase[i * 3];
      const y = studioPanelBase[i * 3 + 1];
      const hang = (1.9 - y) * 0.26; // pinned at the top, freer towards the hem
      position.setZ(i, Math.sin(x * 1.5 + 0.8) * 0.16 + Math.sin(y * 1.8 + x * 1.1 + seconds * 0.9) * 0.05 * hang);
    }
    position.needsUpdate = true;
    studioPanel.geometry.computeVertexNormals();
  }

  // 3D Hotspot definitions (P2): attached to local coordinates on the studio piece
  const STUDIO_HOTSPOTS = !window.THREE ? [] : [
    { id: 'hotspot1', localPos: new THREE.Vector3(0.82, 1.25, 0.28) },
    { id: 'hotspot2', localPos: new THREE.Vector3(-0.65, 0.05, 0.42) },
    { id: 'hotspot3', localPos: new THREE.Vector3(0.0, 0.65, 0.85) },
  ];

  function update3DHotspots() {
    if (!studioActive || !studioGroup || !studioCamera) return;
    const viewport = document.getElementById('studioViewport');
    if (!viewport) return;
    const w = viewport.clientWidth || window.innerWidth;
    const h = viewport.clientHeight || window.innerHeight;

    studioGroup.updateMatrixWorld(true);
    studioCamera.updateMatrixWorld(true);

    const groupPos = new THREE.Vector3();
    studioGroup.getWorldPosition(groupPos);

    for (const spot of STUDIO_HOTSPOTS) {
      const el = document.getElementById(spot.id);
      if (!el) continue;

      // Transform local coordinate to world space
      const worldPos = spot.localPos.clone().applyMatrix4(studioGroup.matrixWorld);

      // Facing test: normal from mannequin central axis to surface point
      const centerAtY = new THREE.Vector3(groupPos.x, worldPos.y, groupPos.z);
      const normal = worldPos.clone().sub(centerAtY).normalize();
      const viewDir = studioCamera.position.clone().sub(worldPos).normalize();
      const dot = normal.dot(viewDir);

      // Project to Normalized Device Coordinates (-1 to 1)
      const ndc = worldPos.clone().project(studioCamera);

      // Visible only when facing camera (not on the back) and inside camera frustum
      const isFacing = dot > -0.15;
      const inFrustum = ndc.z < 1.0 && Math.abs(ndc.x) <= 1.15 && Math.abs(ndc.y) <= 1.15;

      if (isFacing && inFrustum) {
        const x = (ndc.x * 0.5 + 0.5) * w;
        const y = (-(ndc.y * 0.5) + 0.5) * h;
        el.style.left = `${Math.round(x)}px`;
        el.style.top = `${Math.round(y)}px`;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      } else {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    }
  }

  // Dedicated Render Loop & GPU Lifecycle (P4/P6)
  let studioAnimId = null;

  function renderStudioFrame() {
    if (!studioActive || !studioRenderer || !studioScene || !studioCamera) return;
    studioAnimId = requestAnimationFrame(renderStudioFrame);

    // Smooth rotation damping
    studioRotX += (studioTargetRotX - studioRotX) * 0.08;
    studioRotY += (studioTargetRotY - studioRotY) * 0.08;
    studioZoom += (studioTargetZoom - studioZoom) * 0.08;

    studioCamera.position.z = studioZoom;
    studioGroup.rotation.y = studioRotY;
    studioGroup.rotation.x = studioRotX;

    animateStudioPanel(performance.now() / 1000);

    // Dynamically project 3D hotspots to screen coordinates
    update3DHotspots();

    studioRenderer.render(studioScene, studioCamera);
  }

  function startStudioLoop() {
    if (studioAnimId) cancelAnimationFrame(studioAnimId);
    studioActive = true;
    studioAnimId = requestAnimationFrame(renderStudioFrame);
  }

  function stopStudioLoop() {
    studioActive = false;
    if (studioAnimId) {
      cancelAnimationFrame(studioAnimId);
      studioAnimId = null;
    }
  }

  function disposeStudioResources() {
    stopStudioLoop();
    if (studioGroup) {
      studioGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          } else {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
        }
      });
      if (studioScene) studioScene.remove(studioGroup);
      studioGroup = null;
    }
    if (studioScene) {
      studioScene.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      studioScene = null;
    }
    if (studioRenderer) {
      studioRenderer.dispose();
      studioRenderer = null;
    }
    studioLoadToken += 1; // abandon any photograph still loading
    studioTorso = null;
    studioRibbon = null;
    studioPanel = null;
    studioPanelBase = null;
    studioCamera = null;
    studioKeyLight = null;
    studioFillLight = null;
    studioRimLight = null;

    // Refresh canvas to guarantee pristine WebGL context state on reopen
    const canvas = document.getElementById('zaeviStudioCanvas');
    if (canvas && canvas.parentNode) {
      const freshCanvas = document.createElement('canvas');
      freshCanvas.id = 'zaeviStudioCanvas';
      canvas.parentNode.replaceChild(freshCanvas, canvas);
    }
  }

  function open3DStudio(product) {
    if (!window.THREE || !isWebGLAvailable()) {
      window.zaeviToast?.('3D Studio', 'WebGL acceleration is loading for your device.', '✦');
      return;
    }

    ensureStudioDOM();
    initStudioThreeJS();

    studioProductData = product;
    const nameEl = document.getElementById('studioProductName');
    if (nameEl) nameEl.textContent = (product && product.name) || 'ZAEVI Bespoke Piece';

    const studio = document.getElementById('zaevi3dStudio');
    studio.classList.add('active');
    document.body.classList.add('lock');

    // Reset rotation & zoom
    studioTargetRotX = 0;
    studioTargetRotY = 0;
    studioRotX = 0;
    studioRotY = 0;
    studioTargetZoom = 7.6;
    studioZoom = 7.6;
    studioLightMode = 'studio';
    document.querySelectorAll('#zaevi3dStudio .lighting-btn').forEach((b) => b.classList.toggle('active', b.dataset.light === 'studio'));

    // Viewport resize sync
    const v = document.getElementById('studioViewport');
    if (v && studioRenderer && studioCamera) {
      const w = v.clientWidth || window.innerWidth;
      const h = v.clientHeight || window.innerHeight;
      studioCamera.aspect = w / h;
      studioCamera.updateProjectionMatrix();
      studioRenderer.setSize(w, h);
    }

    // Start render loop cleanly (fixes reopen freeze bug)
    startStudioLoop();
    loadStudioPanel(product);

    window.zaeviToast?.('3D Atelier Studio Opened', 'Click or swipe anywhere to inspect every angle.', '✦');
  }

  function close3DStudio() {
    const studio = document.getElementById('zaevi3dStudio');
    if (studio) studio.classList.remove('active');
    document.body.classList.remove('lock');
    disposeStudioResources();
  }

  window.open3DStudio = open3DStudio;
  window.close3DStudio = close3DStudio;
  window.disposeStudioResources = disposeStudioResources;

  // =========================================================================
  // 3. Inject "3D Atelier View" Trigger Buttons
  // =========================================================================
  function inject3DStudioTriggers() {
    // 1. PDP Trigger Button
    const pdpMeta = document.querySelector('.pdp-meta') || document.querySelector('.product-meta') || document.querySelector('.detail-actions') || document.querySelector('.info');
    if (pdpMeta && !document.getElementById('pdp3dBtn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'pdp3dBtn';
      btn.className = 'button button--3d-atelier';
      btn.innerHTML = '<span class="studio-sparkle">✦</span> EXPERIENCE IN 3D ATELIER STUDIO';

      btn.addEventListener('click', () => {
        const titleEl = document.querySelector('h1') || document.querySelector('#pname') || document.querySelector('.pdp-title');
        const pName = titleEl ? titleEl.textContent.trim() : 'Atelier Garment';
        open3DStudio({ name: pName, id: new URLSearchParams(window.location.search).get('id') || 'ZV001' });
      });

      const addBtn = document.querySelector('#addProduct') || document.querySelector('.pdp-add') || document.querySelector('.add');
      if (addBtn && addBtn.parentNode) {
        addBtn.parentNode.insertBefore(btn, addBtn.nextSibling);
      } else {
        pdpMeta.appendChild(btn);
      }
    }

    // 2. Quick View 3D Trigger Button
    const qvDialog = document.getElementById('quickViewDialog');
    if (qvDialog && !qvDialog.querySelector('.qv-3d-btn')) {
      const qvBtn = document.createElement('button');
      qvBtn.type = 'button';
      qvBtn.className = 'qv-3d-btn';
      qvBtn.style.cssText = 'position:absolute;bottom:18px;left:18px;background:rgba(11,7,8,0.78);color:#fff;backdrop-filter:blur(6px);border:1px solid var(--zaevi-gold);padding:6px 14px;font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;border-radius:20px;cursor:pointer;z-index:10;display:flex;align-items:center;gap:6px;';
      qvBtn.innerHTML = '<span>✦</span> 3D Studio';

      qvBtn.addEventListener('click', () => {
        const title = qvDialog.querySelector('h2');
        open3DStudio({ name: title ? title.textContent : 'ZAEVI Piece' });
      });

      const imgCol = qvDialog.querySelector('.quick-view-img')?.parentNode;
      if (imgCol) imgCol.appendChild(qvBtn);
    }
  }

  // =========================================================================
  // 4. Initialize Everything on DOM Ready
  // =========================================================================
  function init3DEngine() {
    initLiveStage();
    inject3DStudioTriggers();

    // Re-check for Quick View or PDP action insertion with debounced & targeted observer
    let studioTriggerDebounce = null;
    const observer = new MutationObserver((mutations) => {
      const isRelevant = mutations.some((m) => {
        const target = m.target;
        if (!target || !(target instanceof HTMLElement)) return false;
        // Ignore internal studio, particles, and cursor mutations
        if (target.closest?.('#zaevi3dStudio') || target.closest?.('#zaevi-cursor-ring') || target.closest?.('#zaevi-cursor-dot')) {
          return false;
        }
        if (target.classList?.contains('wish-burst-particle') || target.classList?.contains('fly-to-bag-particle')) {
          return false;
        }
        // Only react to relevant commerce action containers or quick-view dialogs
        return target.id === 'quickViewDialog' ||
               target.classList?.contains('quick-view-overlay') ||
               target.classList?.contains('quick-view-dialog') ||
               target.classList?.contains('detail-actions') ||
               target.classList?.contains('info') ||
               target.querySelector?.('#quickViewDialog, .detail-actions, #addProduct, .info');
      });

      if (!isRelevant) return;

      if (studioTriggerDebounce) clearTimeout(studioTriggerDebounce);
      studioTriggerDebounce = setTimeout(() => {
        inject3DStudioTriggers();
        studioTriggerDebounce = null;
      }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init3DEngine);
  } else {
    init3DEngine();
  }
})();

