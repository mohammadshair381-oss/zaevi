/**
 * ZAEVI — Maison 3D
 *
 * 1. Hero silk: a live WebGL scene of draped crimson satin with drifting champagne dust,
 *    shown only in the homepage banner. It follows the pointer, ripples when clicked,
 *    pauses when off screen, and draws a single still frame for visitors who prefer
 *    reduced motion. Without WebGL the banner keeps its CSS silk gradient.
 * 2. Coverflow: the New Season pieces on a 3D carousel that can be dragged, swiped,
 *    stepped with the arrow keys or buttons, and that advances slowly on its own.
 *
 * Site Studio drives the silk through window.zaeviStage.setLook(look):
 *   look.accent     rouge | sapphire | emerald | amber   (silk colour)
 *   look.silkColor  silk | monolith                      (brand colour or noir)
 *   look.motion     still | calm | normal | lively
 *   look.silkEnabled false hides the silk and shows the gradient instead.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Studio can publish a look before the scene exists; the latest one is kept here.
  var pendingLook = null;
  var stage = null;
  window.zaeviStage = {
    setLook: function (look) {
      pendingLook = look || {};
      if (stage) stage.setLook(pendingLook);
    },
    ripple: function (x, y, strength) {
      if (stage) stage.ripple(x, y, strength);
    },
  };

  function webglAvailable() {
    try {
      var c = doc.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Hero silk
  // ---------------------------------------------------------------------------
  var SILK_VERTEX = [
    'uniform float uTime, uPointerAmp, uRippleTime, uRippleAmp;',
    'uniform vec2 uPointer, uRippleOrigin;',
    'varying vec3 vWorld;',
    'varying vec3 vNormalW;',
    'varying float vFold;',
    'vec3 permute(vec3 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }',
    'float snoise(vec2 v){',
    '  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);',
    '  vec2 i = floor(v + dot(v, C.yy));',
    '  vec2 x0 = v - i + dot(i, C.xx);',
    '  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '  vec4 x12 = x0.xyxy + C.xxzz;',
    '  x12.xy -= i1;',
    '  i = mod(i, 289.0);',
    '  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));',
    '  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);',
    '  m = m * m; m = m * m;',
    '  vec3 x = 2.0 * fract(p * C.www) - 1.0;',
    '  vec3 h = abs(x) - 0.5;',
    '  vec3 ox = floor(x + 0.5);',
    '  vec3 a0 = x - ox;',
    '  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);',
    '  vec3 g;',
    '  g.x = a0.x * x0.x + h.x * x0.y;',
    '  g.yz = a0.yz * x12.xz + h.yz * x12.yw;',
    '  return 130.0 * dot(m, g);',
    '}',
    // Long diagonal folds with a slowly wandering phase, so they read as draped satin.
    'float fold(vec2 p){',
    '  float t = uTime * 0.075;',
    '  float across = p.x * 0.8 + p.y * 0.6;',
    '  float along = -p.x * 0.6 + p.y * 0.8;',
    '  float wander = snoise(vec2(along * 0.07 + t * 0.5, across * 0.045 - t * 0.3)) * 2.4;',
    '  float h = sin(across * 0.46 + wander + t * 1.5) * 1.15;',
    '  h += sin(across * 0.93 + wander * 1.6 - t * 1.1 + 1.3) * 0.46;',
    '  h += snoise(vec2(across * 0.2 - t * 0.4, along * 0.1 + t * 0.2)) * 0.34;',
    '  float d = distance(p, uPointer);',
    '  h += uPointerAmp * exp(-d * d * 0.16) * sin(d * 1.9 - uTime * 1.6) * 0.55;',
    '  if (uRippleAmp > 0.001) {',
    '    float front = distance(p, uRippleOrigin) - uRippleTime * 7.0;',
    '    h += uRippleAmp * exp(-front * front * 0.22) * sin(front * 1.7) * 0.7;',
    '  }',
    '  return h;',
    '}',
    'void main(){',
    '  vec3 pos = position;',
    '  const float e = 0.12;',
    '  float h = fold(pos.xy);',
    '  vec3 n = normalize(vec3(h - fold(pos.xy + vec2(e, 0.0)), h - fold(pos.xy + vec2(0.0, e)), e));',
    '  pos.z += h;',
    '  vec4 world = modelMatrix * vec4(pos, 1.0);',
    '  vWorld = world.xyz;',
    '  vNormalW = normalize(mat3(modelMatrix) * n);',
    '  vFold = h;',
    '  gl_Position = projectionMatrix * viewMatrix * world;',
    '}',
  ].join('\n');

  var SILK_FRAGMENT = [
    'precision highp float;',
    'uniform vec3 uDeep, uBase, uSheen, uGlint, uFloor;',
    'uniform vec2 uRes, uFocus;',
    'varying vec3 vWorld;',
    'varying vec3 vNormalW;',
    'varying float vFold;',
    'void main(){',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  vec3 L1 = normalize(vec3(0.5, 0.62, 0.62));',
    '  vec3 L2 = normalize(vec3(-0.75, -0.3, 0.55));',
    '  float wrap = clamp(dot(N, L1) * 0.6 + 0.4, 0.0, 1.0);',
    '  float n1 = max(dot(N, normalize(L1 + V)), 0.0);',
    '  float n2 = max(dot(N, normalize(L2 + V)), 0.0);',
    '  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);',
    // Satin: a wide soft lobe carries the fold, a tight champagne lobe adds the glint.
    '  vec3 c = mix(uDeep, uBase, wrap * wrap * wrap);',
    '  c += uSheen * pow(n1, 18.0) * 0.7 + uGlint * pow(n1, 160.0) * 0.26;',
    '  c += uGlint * pow(n2, 34.0) * 0.07 + uBase * fres * 0.2;',
    '  c *= 0.55 + 0.45 * smoothstep(-1.3, 1.2, vFold);',
    // Light gathers at the focus point, leaving the headline side in shadow.
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  c *= mix(0.32, 1.0, smoothstep(1.1, 0.15, distance(uv, uFocus)));',
    '  c = c / (1.0 + c * 0.4);',
    '  vec3 g = pow(c, vec3(1.0 / 2.2));',
    '  gl_FragColor = vec4(uFloor + g, 1.0);',
    '}',
  ].join('\n');

  // sRGB values; converted to linear when applied.
  var PALETTES = {
    rouge: { deep: 0x0e0504, base: 0x6c0611, sheen: 0xb0122a, glint: 0xf1d6b4 },
    sapphire: { deep: 0x04060c, base: 0x13284e, sheen: 0x2c4e8e, glint: 0xe0e7f2 },
    emerald: { deep: 0x030907, base: 0x113a2c, sheen: 0x226c56, glint: 0xe2eee4 },
    amber: { deep: 0x0b0704, base: 0x4c371b, sheen: 0x977244, glint: 0xf6e5c8 },
    noir: { deep: 0x050404, base: 0x1d1815, sheen: 0x564b43, glint: 0xf1e3d0 },
  };
  var MOTION_SPEEDS = { still: 0, calm: 0.5, normal: 1, lively: 1.6 };

  function paletteFor(look) {
    if (look && look.silkColor === 'monolith') return PALETTES.noir;
    return PALETTES[look && look.accent] || PALETTES.rouge;
  }

  function initHeroSilk() {
    var hero = doc.querySelector('.home-page .hero');
    if (!hero || !window.THREE || !webglAvailable()) return null;
    var THREE = window.THREE;

    var canvas = doc.createElement('canvas');
    canvas.className = 'hero-silk';
    canvas.setAttribute('aria-hidden', 'true');
    hero.insertBefore(canvas, hero.firstChild);

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      canvas.remove();
      return null;
    }
    var small = Math.min(window.innerWidth, window.innerHeight) < 700;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.6));
    renderer.setClearColor(0x171311, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    camera.position.set(0, 0, 12);

    var linear = function (hex) { return new THREE.Color(hex).convertSRGBToLinear(); };
    var initial = paletteFor(pendingLook);
    var uniforms = {
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uPointerAmp: { value: 0 },
      uRippleOrigin: { value: new THREE.Vector2(0, 0) },
      uRippleTime: { value: 0 },
      uRippleAmp: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uFocus: { value: new THREE.Vector2(0.68, 0.58) },
      uFloor: { value: linear(0x0a0706) },
      uDeep: { value: linear(initial.deep) },
      uBase: { value: linear(initial.base) },
      uSheen: { value: linear(initial.sheen) },
      uGlint: { value: linear(initial.glint) },
    };
    var target = { uDeep: uniforms.uDeep.value.clone(), uBase: uniforms.uBase.value.clone(), uSheen: uniforms.uSheen.value.clone(), uGlint: uniforms.uGlint.value.clone() };

    var segments = small ? [110, 72] : [220, 140];
    var silk = new THREE.Mesh(new THREE.PlaneGeometry(38, 25, segments[0], segments[1]), new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: SILK_VERTEX,
      fragmentShader: SILK_FRAGMENT,
      toneMapped: false,
    }));
    silk.rotation.x = -0.38;
    silk.rotation.z = 0.12;
    silk.position.z = -3;
    silk.frustumCulled = false;
    scene.add(silk);

    // Champagne dust drifting in front of the silk gives the scene depth.
    var dustCount = small ? 46 : 96;
    var dustPositions = new Float32Array(dustCount * 3);
    var dustSeeds = new Float32Array(dustCount);
    for (var i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 22;
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      dustPositions[i * 3 + 2] = Math.random() * 7 - 2;
      dustSeeds[i] = Math.random() * Math.PI * 2;
    }
    var dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    var dot = doc.createElement('canvas');
    dot.width = dot.height = 48;
    var ctx = dot.getContext('2d');
    var grad = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
    grad.addColorStop(0, 'rgba(255,244,226,1)');
    grad.addColorStop(0.35, 'rgba(232,206,170,.45)');
    grad.addColorStop(1, 'rgba(216,195,165,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 48, 48);
    var dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
      size: 0.1,
      map: new THREE.CanvasTexture(dot),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));
    scene.add(dust);

    // ---- Sizing ----
    var width = 1;
    var height = 1;
    function resize() {
      width = Math.max(1, hero.clientWidth);
      height = Math.max(1, hero.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Narrow screens see a closer crop, so the folds stay large.
      camera.position.z = camera.aspect < 0.8 ? 9.5 : 12;
      camera.updateProjectionMatrix();
      var buf = new THREE.Vector2();
      renderer.getDrawingBufferSize(buf);
      uniforms.uRes.value.copy(buf);
      uniforms.uFocus.value.set(camera.aspect < 0.8 ? 0.6 : 0.68, camera.aspect < 0.8 ? 0.7 : 0.58);
      if (!running) renderFrame();
    }

    // ---- Pointer: the silk lifts under the pointer, and the camera leans ----
    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var pointerIn = false;
    var lean = { x: 0, y: 0 };
    var leanTarget = { x: 0, y: 0 };
    function toSilk(clientX, clientY) {
      var r = hero.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      var hit = raycaster.intersectObject(silk)[0];
      return hit ? silk.worldToLocal(hit.point.clone()) : null;
    }
    hero.addEventListener('pointermove', function (e) {
      pointerIn = true;
      var p = toSilk(e.clientX, e.clientY);
      if (p) uniforms.uPointer.value.set(p.x, p.y);
      leanTarget.x = ndc.x;
      leanTarget.y = ndc.y;
    }, { passive: true });
    hero.addEventListener('pointerleave', function () {
      pointerIn = false;
      leanTarget.x = 0;
      leanTarget.y = 0;
    });
    hero.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      ripple(e.clientX, e.clientY, 1);
    });

    function ripple(clientX, clientY, strength) {
      var p = toSilk(clientX, clientY);
      if (!p) return;
      uniforms.uRippleOrigin.value.set(p.x, p.y);
      uniforms.uRippleTime.value = 0;
      uniforms.uRippleAmp.value = Math.min(1.6, strength || 1);
      if (!running) start();
    }

    // ---- Loop ----
    var speed = 1;
    var time = 6;
    var last = 0;
    var running = false;
    var raf = 0;
    var visible = true;
    var enabled = true;

    function renderFrame() {
      uniforms.uTime.value = time;
      renderer.render(scene, camera);
    }

    function tick(now) {
      raf = requestAnimationFrame(tick);
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      time += dt * speed;

      uniforms.uPointerAmp.value += ((pointerIn ? 1 : 0) - uniforms.uPointerAmp.value) * 0.05;
      if (uniforms.uRippleAmp.value > 0.001) {
        uniforms.uRippleTime.value += dt;
        uniforms.uRippleAmp.value *= 0.985;
      }
      ['uDeep', 'uBase', 'uSheen', 'uGlint'].forEach(function (k) { uniforms[k].value.lerp(target[k], 0.05); });

      // The camera leans with the pointer and drifts back as the page scrolls away.
      lean.x += (leanTarget.x - lean.x) * 0.04;
      lean.y += (leanTarget.y - lean.y) * 0.04;
      var scrolled = Math.min(1, window.scrollY / Math.max(1, height));
      camera.position.x = lean.x * 0.7;
      camera.position.y = lean.y * 0.45 - scrolled * 1.2;
      camera.lookAt(0, -scrolled * 0.6, 0);

      var pos = dustGeometry.attributes.position.array;
      for (var j = 0; j < dustCount; j++) {
        pos[j * 3 + 1] += dt * speed * 0.12;
        pos[j * 3] += Math.sin(time * 0.4 + dustSeeds[j]) * dt * 0.05;
        if (pos[j * 3 + 1] > 7) pos[j * 3 + 1] = -7;
      }
      dustGeometry.attributes.position.needsUpdate = true;

      renderFrame();

      // Stand still once the motion is off and every transition has settled.
      if (speed === 0 && uniforms.uRippleAmp.value < 0.002 && Math.abs(leanTarget.x - lean.x) < 0.001) stop();
    }

    function start() {
      if (running || !visible || !enabled || doc.hidden) return;
      if (reducedMotion) {
        renderFrame();
        return;
      }
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    function setLook(look) {
      var p = paletteFor(look);
      target.uDeep = linear(p.deep);
      target.uBase = linear(p.base);
      target.uSheen = linear(p.sheen);
      target.uGlint = linear(p.glint);
      var s = MOTION_SPEEDS[look && look.motion];
      speed = typeof s === 'number' ? s : 1;
      enabled = !(look && look.silkEnabled === false);
      hero.classList.toggle('has-silk', enabled);
      if (!enabled) {
        stop();
        return;
      }
      if (reducedMotion || !running) {
        ['uDeep', 'uBase', 'uSheen', 'uGlint'].forEach(function (k) { uniforms[k].value.copy(target[k]); });
        renderFrame();
      }
      start();
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start(); else stop();
      }).observe(hero);
    }
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) stop(); else start();
    });
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero);
    else window.addEventListener('resize', resize);

    hero.classList.add('has-silk');
    resize();
    renderFrame();
    if (pendingLook) setLook(pendingLook); else start();

    return { renderer: renderer, scene: scene, setLook: setLook, ripple: ripple, start: start, stop: stop };
  }

  // ---------------------------------------------------------------------------
  // Products (same source order as main.js: the API first, then the bundled catalogue)
  // ---------------------------------------------------------------------------
  var productsPromise = null;
  function loadProducts() {
    if (productsPromise) return productsPromise;
    function fromApi(rows) {
      return rows.map(function (p) {
        return { id: p.id, name: p.name, price: p.price, img: p.imageUrl, hover: p.hoverImageUrl, cat: p.category || p.cat };
      });
    }
    productsPromise = fetch('/api/products?limit=100', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        var rows = Array.isArray(data) ? data : (data && (data.products || data.data || data.items)) || [];
        var valid = rows.length && rows.every(function (p) { return p && typeof p.imageUrl === 'string' && p.imageUrl; });
        if (!valid) return Promise.reject();
        return fromApi(rows);
      })
      .catch(function () {
        return fetch('data/products.json').then(function (r) { return r.ok ? r.json() : []; });
      })
      .catch(function () { return []; });
    return productsPromise;
  }

  function formatPrice(value) {
    var n = Number(value);
    if (!isFinite(n)) return '';
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
    } catch (e) { return '₹' + Math.round(n); }
  }

  function safeImage(url) {
    var u = String(url || '').trim();
    if (!u || /[\s"'()\\]/.test(u)) return '';
    if (/^https:\/\//i.test(u)) return u;
    return /^[a-z][a-z0-9+.-]*:/i.test(u) || u.indexOf('//') === 0 ? '' : u;
  }

  // ---------------------------------------------------------------------------
  // 2. Coverflow: New Season pieces on a 3D carousel
  // ---------------------------------------------------------------------------
  function initCoverflows() {
    var hosts = doc.querySelectorAll('[data-coverflow]');
    if (!hosts.length) return;
    loadProducts().then(function (products) {
      var list = (products || []).filter(function (p) { return p && p.id && safeImage(p.img); }).slice(0, 12);
      if (list.length < 3) return;
      hosts.forEach(function (host) { buildCoverflow(host, list); });
    });
  }

  function buildCoverflow(host, products) {
    var n = products.length;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-roledescription', 'carousel');
    host.setAttribute('aria-label', 'New season pieces');
    host.tabIndex = 0;

    var stageEl = doc.createElement('div');
    stageEl.className = 'coverflow-stage';
    var cards = products.map(function (p, i) {
      var a = doc.createElement('a');
      a.className = 'coverflow-card';
      a.href = 'product.html?id=' + encodeURIComponent(p.id);
      a.setAttribute('aria-label', p.name + ', ' + formatPrice(p.price) + ' (' + (i + 1) + ' of ' + n + ')');
      a.draggable = false;
      var media = doc.createElement('span');
      media.className = 'coverflow-media';
      var img = doc.createElement('img');
      img.src = safeImage(p.img);
      img.alt = '';
      img.loading = i < 4 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      media.appendChild(img);
      var cap = doc.createElement('span');
      cap.className = 'coverflow-caption';
      var name = doc.createElement('span');
      name.className = 'coverflow-name';
      name.textContent = p.name;
      var price = doc.createElement('span');
      price.className = 'coverflow-price';
      price.textContent = formatPrice(p.price);
      cap.appendChild(name);
      cap.appendChild(price);
      a.appendChild(media);
      a.appendChild(cap);
      stageEl.appendChild(a);
      return a;
    });

    var ui = doc.createElement('div');
    ui.className = 'coverflow-ui';
    ui.innerHTML =
      '<button class="coverflow-btn" type="button" data-step="-1" aria-label="Previous piece"><span aria-hidden="true">←</span></button>' +
      '<div class="coverflow-count" aria-live="polite"><span class="coverflow-index">01</span><i class="coverflow-bar"><b></b></i><span>' + String(n).padStart(2, '0') + '</span></div>' +
      '<button class="coverflow-btn" type="button" data-step="1" aria-label="Next piece"><span aria-hidden="true">→</span></button>';
    host.appendChild(stageEl);
    host.appendChild(ui);
    var indexEl = ui.querySelector('.coverflow-index');
    var barEl = ui.querySelector('.coverflow-bar b');

    var pos = 0; // continuous position, in cards
    var goal = 0;
    var spacing = 200;
    var raf = 0;
    var dragging = false;
    var moved = 0;
    var startX = 0;
    var startPos = 0;
    var velocity = 0;
    var lastX = 0;
    var lastT = 0;
    var hovering = false;
    var inView = true;

    function wrapDelta(d) {
      d = ((d % n) + n) % n;
      return d > n / 2 ? d - n : d;
    }

    function measure() {
      var w = cards[0].offsetWidth || 260;
      spacing = w * (window.innerWidth < 720 ? 0.72 : 0.64);
    }

    function layout() {
      var current = ((Math.round(pos) % n) + n) % n;
      cards.forEach(function (card, i) {
        var d = wrapDelta(i - pos);
        var ad = Math.abs(d);
        var side = d < 0 ? -1 : 1;
        var turn = Math.min(ad, 1);
        var x = d * spacing + side * turn * spacing * 0.18;
        var z = -ad * 140 - turn * 60;
        var rot = -side * turn * 42;
        card.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,' + z.toFixed(1) + 'px) rotateY(' + rot.toFixed(2) + 'deg)';
        card.style.zIndex = String(100 - Math.round(ad * 10));
        card.style.opacity = ad > 3.2 ? '0' : String(Math.max(0, 1 - Math.max(0, ad - 2.2)));
        card.style.setProperty('--shade', Math.min(0.55, ad * 0.22).toFixed(3));
        card.classList.toggle('is-current', i === current);
        card.tabIndex = ad < 2.5 ? 0 : -1;
      });
      indexEl.textContent = String(current + 1).padStart(2, '0');
      barEl.style.transform = 'scaleX(' + ((current + 1) / n).toFixed(3) + ')';
    }

    function animate() {
      raf = 0;
      if (!dragging) pos += (goal - pos) * (reducedMotion ? 1 : 0.12);
      if (Math.abs(goal - pos) < 0.001) pos = goal;
      layout();
      if (dragging || pos !== goal) raf = requestAnimationFrame(animate);
    }
    function kick() {
      if (!raf) raf = requestAnimationFrame(animate);
    }
    function go(step) {
      goal = Math.round(goal) + step;
      kick();
    }

    ui.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-step]');
      if (btn) go(Number(btn.getAttribute('data-step')));
    });
    host.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });
    // Tabbing to a card brings it to the centre.
    stageEl.addEventListener('focusin', function (e) {
      var i = cards.indexOf(e.target.closest('.coverflow-card'));
      if (i < 0) return;
      goal = Math.round(pos) + wrapDelta(i - pos);
      kick();
    });

    // Dragging and swiping
    stageEl.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      dragging = true;
      moved = 0;
      startX = lastX = e.clientX;
      lastT = performance.now();
      startPos = pos;
      velocity = 0;
      host.classList.add('is-dragging');
      kick();
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      pos = startPos - dx / spacing;
      var now = performance.now();
      var dt = Math.max(1, now - lastT);
      velocity = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastT = now;
    }, { passive: true });
    window.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      host.classList.remove('is-dragging');
      goal = Math.round(pos - velocity * 4);
      kick();
    });
    // A drag never opens a product; a click on a side card brings it forward instead.
    stageEl.addEventListener('click', function (e) {
      var card = e.target.closest('.coverflow-card');
      if (!card) return;
      if (moved > 6) {
        e.preventDefault();
        return;
      }
      var i = cards.indexOf(card);
      var d = wrapDelta(i - pos);
      if (Math.abs(d) > 0.5) {
        e.preventDefault();
        goal = Math.round(pos) + Math.round(d);
        kick();
      }
    });

    // Slow automatic advance, paused while the visitor is engaged or the carousel is off screen.
    host.addEventListener('pointerenter', function () { hovering = true; });
    host.addEventListener('pointerleave', function () { hovering = false; });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; }).observe(host);
    }
    if (!reducedMotion) {
      setInterval(function () {
        if (!hovering && !dragging && inView && !doc.hidden && !host.contains(doc.activeElement)) go(1);
      }, 4200);
    }

    window.addEventListener('resize', function () { measure(); layout(); });
    measure();
    layout();
    host.classList.add('is-ready');
    var section = host.closest('.feature');
    if (section) section.classList.add('has-coverflow');
  }

  // ---------------------------------------------------------------------------
  function init() {
    stage = initHeroSilk();
    initCoverflows();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
