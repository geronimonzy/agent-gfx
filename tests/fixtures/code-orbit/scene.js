import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { mulberry32 } from '/runner/lib/rng.js';

// Orbit geometry (world units). Every periodic motion has an integer cycle count per loop.
const ORBIT = { a: 5.0, b: 3.3 };            // earth ellipse semi-axes (x, z)
const EARTH_R = 0.62, SUN_R = 1.0, MOON_R = 0.17;
const MOON_ORBIT = 1.15;                      // moon distance from earth (before earth scale)
const SPINS = 3, MOON_LAPS = 3, GLOW_PULSES = 2, SUN_SPINS = 1, SUN_CHURN = 2;
const PHASE = Math.PI * 0.35;                 // where earth starts on the ellipse
const TAU = Math.PI * 2;

let renderer, scene, camera, earth, earthSpin, moonPivot, moon, moonRing, glow, sun, sunMat, lineMats = [];
const v = new THREE.Vector3();

// Sun surface: simplex-noise plasma + granulation + sunspots + limb darkening, all in object space.
// Time enters only as a loop phase angle (uPhase), so the surface is periodic over the scene.
const SUN_VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vPos = position;
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const SUN_FRAG = /* glsl */ `
  uniform float uPhase;
  uniform vec3 uDeep, uMid, uHot, uCore;
  varying vec3 vPos;
  varying vec3 vNormalV;
  varying vec3 vViewPos;

  // 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm(vec3 p) {
    float f = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { f += a * snoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return f;
  }

  void main() {
    vec3 p = normalize(vPos);
    // periodic drift: the noise domain travels around a closed loop as uPhase goes 0 -> 2pi*k
    vec3 drift = vec3(cos(uPhase), sin(uPhase), 0.0) * 0.35;
    // domain-warped plasma
    vec3 q = p * 2.2 + drift;
    vec3 w = vec3(fbm(q + vec3(0.0, 1.3, 2.1)), fbm(q + vec3(5.2, 0.7, 4.4)), fbm(q + vec3(2.9, 6.1, 0.3)));
    float plasma = fbm(p * 3.0 + w * 0.9 - drift * 0.6) * 0.5 + 0.5;
    // fine granulation cells
    float gran = snoise(p * 18.0 + drift * 2.0) * 0.5 + 0.5;
    gran = smoothstep(0.2, 0.9, gran);
    // sunspots: rare low-frequency dips
    float spotN = snoise(p * 1.2 + vec3(3.0, 0.0, 0.0) + drift * 0.3);
    float spot = smoothstep(0.78, 0.9, spotN) * smoothstep(0.85, 0.3, abs(p.y)); // a few, kept off the poles

    float heat = clamp((plasma - 0.5) * 2.2 + 0.55 + (gran - 0.5) * 0.18, 0.0, 1.0);
    vec3 col = mix(uDeep, uMid, smoothstep(0.15, 0.5, heat));
    col = mix(col, uHot, smoothstep(0.45, 0.8, heat));
    col = mix(col, uCore, smoothstep(0.75, 1.0, heat) * 0.55);
    col = mix(col, uDeep * 0.5, spot * 0.8);
    col *= 1.15;

    // limb darkening (view-space)
    float mu = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);
    col *= 0.45 + 0.55 * pow(mu, 0.45);
    // slight warm rim so the edge melts into the glow
    col += uMid * pow(1.0 - mu, 3.0) * 0.35;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

// Seeded value noise for the procedural earth texture.
function noise2(seed) {
  const r = mulberry32(seed), G = 64, g = Array.from({ length: G * G }, () => r());
  const at = (x, y) => g[((y % G) + G) % G * G + ((x % G) + G) % G];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function earthTexture(c) {
  const W = 1024, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), n = noise2(7), m = noise2(19);
  const col = (k) => new THREE.Color(c[k]);
  const ocean = col('ocean'), deep = col('oceanDeep'), land = col('land'), dry = col('landDry'), ice = col('ice');
  const img = g.createImageData(W, H), out = new THREE.Color();
  for (let y = 0; y < H; y++) {
    const lat = Math.abs(y / H - 0.5) * 2; // 0 equator .. 1 pole
    for (let x = 0; x < W; x++) {
      // wrap-safe sampling: noise on a circle in x so the seam at u=0/1 matches
      const ang = (x / W) * TAU, px = 8 + Math.cos(ang) * 6, pz = 8 + Math.sin(ang) * 6, py = (y / H) * 12;
      let f = 0, amp = 0.5, fr = 1;
      for (let o = 0; o < 4; o++) { f += amp * n(px * fr + pz * fr * 0.7, py * fr + pz * fr * 0.3); amp *= 0.5; fr *= 2.1; }
      const dryness = m(px * 0.8, py * 0.8);
      if (lat > 0.86 - 0.05 * f) out.copy(ice);
      else if (f > 0.53) out.copy(land).lerp(dry, Math.min(1, Math.max(0, (dryness - 0.45) * 2.2)));
      else out.copy(deep).lerp(ocean, Math.min(1, Math.max(0, (f - 0.3) * 4)));
      out.convertLinearToSRGB();
      const i = (y * W + x) * 4;
      img.data[i] = out.r * 255; img.data[i + 1] = out.g * 255; img.data[i + 2] = out.b * 255; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function moonTexture(c) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d'), r = mulberry32(3);
  g.fillStyle = c.moon; g.fillRect(0, 0, 256, 128);
  g.fillStyle = c.moonDark;
  for (let i = 0; i < 40; i++) {
    g.globalAlpha = 0.25 + r() * 0.4;
    g.beginPath(); g.arc(r() * 256, 10 + r() * 108, 2 + r() * 9, 0, TAU); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  const c = new THREE.Color(color), rgb = `${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0}`;
  grd.addColorStop(0, `rgba(${rgb},0.9)`);
  grd.addColorStop(0.25, `rgba(${rgb},0.35)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ring(points, color, width, opacity, W, H) {
  const geo = new LineGeometry();
  geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const mat = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity });
  mat.resolution.set(W, H);
  lineMats.push(mat);
  return new Line2(geo, mat);
}

const ellipse = (t) => new THREE.Vector3(Math.cos(t) * ORBIT.a, 0, Math.sin(t) * ORBIT.b);

// screen-space bounds of a sphere, for studio selection
function bounds(obj, radius, W, H) {
  obj.getWorldPosition(v);
  const d = v.distanceTo(camera.position);
  v.project(camera);
  const r = (radius / (d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * (H / 2);
  const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
  return { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
}

export default {
  async setup(ctx) {
    const { root, width: W, height: H, style } = ctx;
    const c = style.colors;

    // Background layer: flat bg + seeded starfield on a 2D canvas under the WebGL canvas.
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    bg.style.cssText = 'position:absolute;left:0;top:0';
    const g = bg.getContext('2d'), r = mulberry32(42);
    g.fillStyle = c.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = c.star;
    for (let i = 0; i < 260; i++) {
      g.globalAlpha = 0.15 + r() ** 2 * 0.7;
      g.beginPath(); g.arc(r() * W, r() * H, 0.6 + r() * 1.3, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    root.appendChild(bg);
    ctx.el('background', bg);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'position:absolute;left:0;top:0';
    root.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 100);
    camera.position.set(0, 4.6, 11.5);
    camera.lookAt(0, -0.35, 0);

    // Sun: emissive core + additive glow sprite; it is also the light source.
    const accent = new THREE.Color(c.accent);
    sunMat = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      uniforms: {
        uPhase: { value: 0 },
        uDeep: { value: accent.clone().multiplyScalar(0.45) },
        uMid: { value: accent },
        uHot: { value: new THREE.Color(c.accentSoft) },
        uCore: { value: new THREE.Color(c.text) },
      },
    });
    sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 96, 64), sunMat);
    glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(c.accentSoft), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    scene.add(sun, glow);
    const light = new THREE.PointLight(new THREE.Color(c.accentSoft).lerp(new THREE.Color(c.text), 0.7), 7, 0, 0);
    scene.add(light);
    scene.add(new THREE.AmbientLight(new THREE.Color(c.text), 0.35));

    // Orbit path.
    scene.add(ring(Array.from({ length: 181 }, (_, i) => ellipse((i / 180) * TAU)), c.muted, 1.5, 0.45, W, H));

    // Earth: tilted axis group > spinning sphere.
    earth = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.z = THREE.MathUtils.degToRad(23.4);
    earthSpin = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R, 64, 48),
      new THREE.MeshStandardMaterial({ map: earthTexture(c), roughness: 0.75, metalness: 0 }),
    );
    tilt.add(earthSpin);
    earth.add(tilt);

    // Moon orbit (tilted ~5 deg), ring + moon on a pivot that follows the earth.
    moonPivot = new THREE.Group();
    moonPivot.rotation.x = THREE.MathUtils.degToRad(5);
    moonRing = ring(Array.from({ length: 97 }, (_, i) => {
      const a = (i / 96) * TAU;
      return new THREE.Vector3(Math.cos(a) * MOON_ORBIT, 0, Math.sin(a) * MOON_ORBIT);
    }), c.muted, 1, 0.3, W, H);
    moon = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_R, 32, 24),
      new THREE.MeshStandardMaterial({ map: moonTexture(c), roughness: 1, metalness: 0 }),
    );
    moonPivot.add(moonRing, moon);
    earth.add(moonPivot);
    scene.add(earth);

    ctx.el('sun', { bounds: () => bounds(sun, SUN_R, W, H) });
    ctx.el('earth', { bounds: () => bounds(earthSpin, EARTH_R * earth.scale.x, W, H) });
    ctx.el('moon', { bounds: () => bounds(moon, MOON_R * earth.scale.x, W, H) });
  },

  render(t, ctx) {
    const p = t / ctx.duration; // 0..1 over the loop

    // Earth along the ellipse (counter-clockwise seen from above). Extra scale on top of perspective:
    // biggest on the near side (z = +b), smallest on the far side.
    const a = PHASE + p * TAU;
    earth.position.copy(ellipse(a));
    const near = Math.sin(a); // +1 near the camera, -1 far
    earth.scale.setScalar((1 + 0.2 * near) * ctx.tweak('earth').scale);
    earthSpin.rotation.y = p * SPINS * TAU;

    // Moon: laps around the earth, tidally locked (same face toward earth).
    const m = p * MOON_LAPS * TAU;
    moon.position.set(Math.cos(m) * MOON_ORBIT, 0, -Math.sin(m) * MOON_ORBIT);
    moon.rotation.y = m;

    // Sun surface: one slow turn plus churning plasma, both periodic over the loop.
    sun.rotation.y = p * SUN_SPINS * TAU;
    sunMat.uniforms.uPhase.value = p * SUN_CHURN * TAU;

    // Sun glow breathes gently.
    glow.scale.setScalar(SUN_R * 5.2 * (1 + 0.04 * Math.sin(p * GLOW_PULSES * TAU)));

    renderer.render(scene, camera);
  },
};
