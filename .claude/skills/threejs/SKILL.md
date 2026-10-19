---
name: threejs
description: Use when building a gfx scene of kind "three" - 3D objects, wireframes, product-in-space shots, camera moves, lighting, bloom, GLTF models - rendered deterministically with three.js in the motion-graphics harness.
---

# three.js scenes (kind: three)

Contract: `<engine>/docs/CONTRACT.md` "Kind conventions" (`<engine>` from `.gfx/engine.json`, see `motion-graphics`). Workflow and verification: `motion-graphics` skill. Start from `templates/three` via `gfx new <name> --kind three`.

## Rules
- Renderer: `new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })`, `setPixelRatio(1)`, `setSize(ctx.width, ctx.height)`, append `renderer.domElement` to `ctx.root`. Set clear color from `ctx.style.colors.bg` (`renderer.setClearColor(new THREE.Color(bg), 1)`).
- `render(t)` sets EVERY animated property from `t`, then calls `renderer.render(scene, camera)` (or `composer.render()` when post-processing). Never accumulate (`mesh.rotation.y += ...` is banned; use `= t * speed`).
- Banned: `THREE.Clock`, `clock.getDelta`, `OrbitControls`, `requestAnimationFrame`, `mixer.update(delta)`, `Math.random()` unseeded (use `mulberry32`).
- Background grid / fill: a separate canvas BEHIND a transparent WebGL canvas (`alpha: true`, `setClearColor(0, 0)`), named `bg.setAttribute('data-gfx', 'background')`, drawn once with `drawGrid` (as in `templates/three`). With post-processing (bloom) keep `scene.background` opaque instead and name the renderer canvas `ctx.el('scene3d', renderer.domElement)`.
- Mark each named object's code (studio "Open code", motion-graphics step 9c): creation, `ctx.el` registration and the per-frame lines in `render` in `// @gfx <name>` … `// @end` blocks (without markers the studio can only trace identifiers, approximately). If the studio should be able to move/scale it, read `ctx.tweak('<name>')` in `render`:
  ```js
  // @gfx moon
  moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 32, 24), mat);
  moonPivot.add(moon);
  ctx.el('moon', { bounds: () => bounds(moon, MOON_R, W, H) });
  moonClock = ctx.clock('moon'); // studio can retime it (drag its layer bar)
  // @end
  // … in render(t, ctx):
  // @gfx moon
  const m = moonSpeed * moonClock(t); // its own time, not t
  moon.position.set(Math.cos(m) * MOON_ORBIT, 0, -Math.sin(m) * MOON_ORBIT);
  moon.scale.setScalar(ctx.tweak('moon').scale);
  // @end
  ```
- Colors: `new THREE.Color(ctx.style.colors.accent)`; never literal hex.
- Headless runs on swiftshader (CPU GL): keep geometry modest (< ~200k triangles), few lights (<= 4), no big shadow maps (1024 max, prefer none), no MSAA-heavy post chains, small/few textures. Budget ~100-500 ms/frame is normal; prefer 30 fps for heavy scenes.
- Imports: `import * as THREE from 'three'`; addons from `three/addons/...` (preferred; maps to `examples/jsm/*`; `three/examples/jsm/...` also works; both tested under the runner's vite, three 0.186). NOTE: the first run after adding a NEW addon import can fail with `504 Outdated Optimize Dep` / `Failed to fetch dynamically imported module` (vite re-optimizing deps); just re-run the command.

## Example (wireframe icosahedron, orbiting camera, accent glow point)
```js
import * as THREE from 'three';
import { outExpo, inOutCubic } from '/runner/lib/ease.js';
import { progress, keyframes } from '/runner/lib/tween.js';

let renderer, scene, camera, wire, core;
export default {
  async setup(ctx) {
    const { width: W, height: H, style: s } = ctx;
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H);
    renderer.setClearColor(new THREE.Color(s.colors.bg), 1);
    ctx.root.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);

    const geo = new THREE.IcosahedronGeometry(1.2, 1);
    wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: new THREE.Color(s.colors.stroke), transparent: true }));
    core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2),
      new THREE.MeshStandardMaterial({ color: s.colors.surface, emissive: new THREE.Color(s.colors.accent),
        emissiveIntensity: 0.8, roughness: 0.4 }));
    scene.add(wire, core);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(3, 4, 5); scene.add(key);
  },
  render(t, ctx) {
    const d = ctx.duration;
    const a = (t / d) * Math.PI * 2;                       // loops seamlessly
    const dist = keyframes(t, [{ t: 0, v: 9 }, { t: 1.5, v: 6, ease: outExpo }, { t: d, v: 6 }]);
    camera.position.set(Math.sin(a) * dist, 1.5, Math.cos(a) * dist);
    camera.lookAt(0, 0, 0);
    wire.rotation.y = t * 0.4;
    wire.scale.setScalar(0.6 + 0.4 * outExpo(progress(t, 0, 1.2)));
    wire.material.opacity = inOutCubic(progress(t, 0, 0.8));
    core.scale.setScalar(1 + 0.05 * Math.sin(a * 4));
    renderer.render(scene, camera);
  },
};
```
`keyframes` `ease` must be a FUNCTION imported from `ease.js` (a string name would throw), and segment i uses the ease of keyframe i+1 (the segment's END keyframe; the first keyframe's ease is ignored). Ends are held. `tween(t, start, end, from, to, ease)` also takes a function; `from`/`to` may be arrays. Example rendered and checked.

## Camera and lens
- Product/hero: FOV 25-40 (telephoto-ish, flatter, premium). Wide drama/architecture: 50-70. Avoid > 75 (distortion).
- `camera.aspect = W/H` set once; for portrait 1080x1920 move the camera back or raise FOV so the subject fits width.
- Camera moves are keyframed functions of t: orbit (`sin/cos` of angle), dolly (distance), crane (y), always finish with `camera.lookAt(target)`; ease the parameter, not the final position. Slow push-in (5-15% over the shot) makes static scenes feel alive.
- Use `camera.setViewOffset` for off-center framing if you need space for overlaid text.

## Lighting
- Three-point: key `DirectionalLight` (intensity ~2, 3/4 front-above), fill `HemisphereLight` or low ambient (0.2-0.5), rim `DirectionalLight` from behind in `style.colors.accent` for edge separation.
- Line art / wireframes: NO lights; `LineBasicMaterial` / `MeshBasicMaterial` only (lights do nothing to them).
- Emissive accents: `MeshStandardMaterial({ emissive: accent, emissiveIntensity })`; with bloom, set emissiveIntensity > 1 and let tone mapping handle it.
- Color management: three r152+ defaults to sRGB output; pass colors as CSS strings/`THREE.Color` and they convert correctly. For `MeshBasicMaterial` colors to match the CSS palette exactly, set `renderer.toneMapping = THREE.NoToneMapping` (default).

## Wireframes and lines
- Clean edges: `new THREE.LineSegments(new THREE.EdgesGeometry(geo, thresholdAngle=15), new THREE.LineBasicMaterial({ color }))`. `mesh.material.wireframe = true` shows all triangles (noisy).
- WebGL lines are always 1px. For thicker lines use `Line2` + `LineMaterial` + `LineGeometry`/`LineSegmentsGeometry` (`import { Line2 } from 'three/addons/lines/Line2.js'`, likewise `LineMaterial.js`, `LineGeometry.js`; `geo.setPositions([x,y,z,...])`). `LineMaterial` needs `material.resolution.set(width, height)` and `linewidth` in CSS px (`worldUnits: false`, the default).
- Draw-on effect: `geometry.setDrawRange(0, Math.floor(count * p))` for `Line`; for `Line2` set `geometry.instanceCount = Math.floor((nPoints - 1) * p)` each frame (counts segments; tested).
- Fading: `material.transparent = true; material.opacity = ...`.

## Materials
- Default: `MeshStandardMaterial` (roughness 0.3-0.6, metalness 0-0.2). Glass/clearcoat: `MeshPhysicalMaterial` (cost higher; `transmission` is slow on swiftshader - avoid, fake with opacity + rim light).
- Environment reflections need an env map: build a tiny one with `RoomEnvironment` via `PMREMGenerator` (`three/addons/environments/RoomEnvironment.js`): `scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture`. Cheap and makes metals look right.
- Flat/stylised: `MeshToonMaterial` or `MeshBasicMaterial` plus an edge overlay.

## Text and labels
Avoid 3D text geometry. Labels: draw to an offscreen 2D canvas (font from `ctx.style.fonts.sans`, color from style), wrap in `new THREE.CanvasTexture(canvas)`, put on a `Sprite` (always faces camera) or a `PlaneGeometry` with `transparent:true`. Render the canvas at 2x the on-screen size for sharpness; set `texture.colorSpace = THREE.SRGBColorSpace`. Await `document.fonts.ready` before drawing (the player already does before setup). troika-three-text is not available. One scene = one kind, so do not overlay HTML text; if the piece is text-heavy, use an `anime` scene and concat.

## Post-processing (bloom)
```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
// setup:
composer = new EffectComposer(renderer);
composer.setPixelRatio(1); composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.8 /*strength*/, 0.5 /*radius*/, 0.2 /*threshold*/));
composer.addPass(new OutputPass());   // tone mapping + sRGB; needed for correct colors
// render(t): set transforms, then
composer.render();                    // NOT renderer.render
```
With a composer set `scene.background = new THREE.Color(colors.bg)`; relying on `setClearColor` alone gave a washed-out grey bg after bloom (observed). Bloom is expensive on swiftshader (several full-res blur passes). Use sparingly; consider W/2 x H/2 bloom resolution via the Vector2 argument. Animate `bloomPass.strength` from t if wanted.

## GLTF
```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const gltf = await new GLTFLoader().loadAsync(new URL('./model.glb', import.meta.url).href); // in setup
scene.add(gltf.scene);
```
Await in `setup`. Keep models < ~50k triangles and textures <= 2048. Clips: `mixer = new THREE.AnimationMixer(gltf.scene); mixer.clipAction(gltf.animations[0]).play();` then in `render(t)`: `mixer.setTime(t)` (NOT `update(dt)`; setTime is absolute). Normalize size/center with `new THREE.Box3().setFromObject(obj)` once in setup.

## Determinism and checks
- Seeded randomness only: `const r = mulberry32(42)` in setup to place instances; store results.
- Any time-based shader uniform: set `uniforms.uTime.value = t`.
- Verify: `gfx still` at several t; check nothing is black (missing lights/env), subject framed with >= 5% margin, and the first/last frame match for loops.
- Black screen causes: no lights on Standard material, camera inside object, near/far clipping, `lookAt` before position set, forgot `composer.render()`.
