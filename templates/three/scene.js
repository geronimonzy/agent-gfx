import * as THREE from 'three';
import { tween } from '/runner/lib/tween.js';
import { inOutCubic, inOutSine } from '/runner/lib/ease.js';
import { drawGrid } from '/runner/lib/style.js';

let renderer, scene, camera, cube;

export default {
  async setup({ root, width, height, style }) {
    // Grid lives on a 2D canvas behind the (transparent) WebGL canvas.
    // @gfx background
    const bg = document.createElement('canvas');
    bg.width = width;
    bg.height = height;
    bg.style.cssText = 'position:absolute;left:0;top:0';
    bg.setAttribute('data-gfx', 'background'); // named: shows up as a layer in the studio
    drawGrid(bg.getContext('2d'), style);
    root.appendChild(bg);
    // @end

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'position:absolute;left:0;top:0';
    root.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
    cube = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: style.colors.stroke }));
    scene.add(cube);
  },

  render(t, { duration }) {
    // Slow, eased turn over the whole piece.
    const k = inOutSine(t / duration);
    cube.rotation.set(0.5 + k * 0.6, k * Math.PI, 0.15);

    // Gentle dolly-in, eased.
    const z = tween(t, 0, duration, 9, 6.5, inOutCubic);
    camera.position.set(0, 0.6, z);
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  },
};
