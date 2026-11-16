import './style.css';
import * as THREE from 'three';
import { markReady, screenshotMode } from './screenshot-mode';

function $<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

// STEP 0 hello-world: proves Vite + TS + Three.js (WebGL2) + SVG pointer input + PWA.
const app = $<HTMLDivElement>('#app');
app.innerHTML = `
  <header><strong>Modulo: Room</strong><span id="status">hello-world pipeline check</span></header>
  <main>
    <section class="pane" aria-label="2D plan"><svg id="plan" viewBox="0 0 400 300" role="img" aria-label="Pointer test area">
      <rect x="40" y="40" width="320" height="220" fill="none" stroke="currentColor" stroke-width="6"/>
      <circle id="dot" cx="200" cy="150" r="14" fill="#d9a441"/>
    </svg><output id="ptr">pointer: none</output></section>
    <section class="pane" aria-label="3D view"><canvas id="view"></canvas></section>
  </main>`;

// --- 2D pointer test (mouse, touch, pen all go through Pointer Events) ---
const svg = $<SVGSVGElement>('#plan');
const dot = $<SVGCircleElement>('#dot');
const out = $<HTMLOutputElement>('#ptr');
svg.addEventListener('pointerdown', (e) => {
  svg.setPointerCapture(e.pointerId);
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
    (svg.getScreenCTM() ?? new DOMMatrix()).inverse(),
  );
  dot.setAttribute('cx', pt.x.toFixed(1));
  dot.setAttribute('cy', pt.y.toFixed(1));
  out.textContent = `pointer: ${e.pointerType} @ ${pt.x.toFixed(0)},${pt.y.toFixed(0)}`;
  out.dataset.type = e.pointerType;
});

// --- 3D WebGL2 test ---
const canvas = $<HTMLCanvasElement>('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: screenshotMode });
renderer.setPixelRatio(screenshotMode ? 1 : Math.min(devicePixelRatio, 2));
const gl = renderer.getContext();
const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const glRenderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2b3036');
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(4, 3.2, 5);
camera.lookAt(0, 0.6, 0);
scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 2);
sun.position.set(3, 6, 2);
scene.add(sun);
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(4, 0.05, 3),
  new THREE.MeshStandardMaterial({ color: '#c8c2b4' }),
);
scene.add(floor);
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.5, 0.9),
  new THREE.MeshStandardMaterial({ color: '#7d8fa3' }),
);
box.position.y = 0.275;
scene.add(box);

function resize(): void {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  resize();
  if (screenshotMode) renderer.render(scene, camera);
}).observe(canvas);
resize();

$('#status').textContent = `${isWebGL2 ? 'WebGL2' : 'WebGL1'} · ${glRenderer}`;

if (screenshotMode) {
  box.rotation.y = 0.4;
  renderer.render(scene, camera);
  requestAnimationFrame(() => markReady({ webgl2: isWebGL2, glRenderer }));
} else {
  renderer.setAnimationLoop((t) => {
    box.rotation.y = t / 2000;
    renderer.render(scene, camera);
  });
  markReady({ webgl2: isWebGL2, glRenderer });
}
