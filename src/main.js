import * as THREE from '../lib/three.module.min.js';
import { Music, BEAT, SONG_LEN } from './audio.js';
import { buildMap } from './map.js';

const AMBER = 0xffb347, TEAL = 0x35e0d0;
const COLORS = [AMBER, TEAL];
const CSS = ['#ffb347', '#35e0d0'];
const HIT_Z = -0.85;                       // 判定平面（玩家身前）
const COLS = [-0.7, -0.35, 0, 0.35, 0.7];
const ROWS = [-0.38, 0, 0.38];
const NOTE_R = 0.2, HIT_R = 0.3;
const SPAWN_DIST = 24;
const BLADE_LEN = 1.0, BLADE_START = 0.1;
const BLADE_TILT = 0.35;                   // 光刃相对手柄指向上翘的角度（弧度）
const MIN_SWING = 1.3;                     // 有效挥砍的最低刃尖速度 m/s
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const AUTO = new URLSearchParams(location.search).has('auto');

// ---------------------------------------------------------------- 渲染基础
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200);
camera.position.set(0, 1.6, 0);
scene.add(camera);
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const music = new Music();
const clock = new THREE.Clock();
let now = 0;

// ---------------------------------------------------------------- 贴图小工具
function canvasTex(w, h, paint) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  paint(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glowTex = canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const beamTex = canvasTex(32, 256, (g) => {
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.75, 'rgba(255,255,255,0.7)');
  v.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = v; g.fillRect(0, 0, 32, 256);
  const h = g.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h; g.fillRect(0, 0, 32, 256);
});

function makePanel(w, h, px = 220) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * px); cv.height = Math.round(h * px);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  const g = cv.getContext('2d');
  return {
    mesh,
    draw(fn) { g.clearRect(0, 0, cv.width, cv.height); fn(g, cv.width, cv.height); tex.needsUpdate = true; },
  };
}
function text(g, str, x, y, size, color, align = 'center', weight = 700) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align; g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(str, x, y);
}

// ---------------------------------------------------------------- 环境：夜空、月亮、湖面、远山
{
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x02030a), hor = new THREE.Color(0x1b2558), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 900);
    c.copy(hor).lerp(top, Math.pow(h, 0.45));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false })));

  const n = 1400, sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.random() * 0.96 + 0.04;
    const r = Math.sqrt(1 - v * v) * 700;
    sp.set([Math.cos(u) * r, v * 700, Math.sin(u) * r], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false })));
}

const moon = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshBasicMaterial({ color: 0xfff2d6 }));
moon.position.set(0, 36, -220);
scene.add(moon);
const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffdfa8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
moonHalo.position.copy(moon.position); moonHalo.position.z += 1;
moonHalo.scale.setScalar(110);
scene.add(moonHalo);

{
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshBasicMaterial({ color: 0x04070f }));
  lake.rotation.x = -Math.PI / 2; lake.position.y = -0.08;
  scene.add(lake);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(16, 210), new THREE.MeshBasicMaterial({ map: beamTex, color: 0xffdfa8, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.28, depthWrite: false }));
  path.rotation.x = -Math.PI / 2; path.rotation.z = Math.PI; path.position.set(0, -0.06, -112);
  scene.add(path);

  // 远山剪影
  const seg = 120, R = 420, verts = [];
  const hs = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    hs.push(10 + 16 * (0.5 + 0.5 * Math.sin(a * 5 + 1)) * (0.6 + 0.4 * Math.sin(a * 13 + 2)) + Math.random() * 6);
  }
  hs[seg] = hs[0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
    verts.push(x0, -1, z0, x1, -1, z1, x1, hs[i + 1], z1, x0, -1, z0, x1, hs[i + 1], z1, x0, hs[i], z0);
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  scene.add(new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0x070b1c, side: THREE.DoubleSide })));
}

scene.add(new THREE.HemisphereLight(0x9aa8ff, 0x0a0a14, 1.0));
const key = new THREE.DirectionalLight(0xfff0d8, 1.4);
key.position.set(0.4, 2.5, 1.5);
scene.add(key);

// 站台
const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x141828, roughness: 0.8 }));
platform.position.y = -0.06;
scene.add(platform);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x6fb8ff });
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.012, 8, 72), ringMat);
ring.rotation.x = Math.PI / 2; ring.position.y = 0.005;
scene.add(ring);

// 星轨：两条导轨 + 随节拍滑来的横线
const railMat = new THREE.MeshBasicMaterial({ color: 0x2c4c88 });
for (const x of [-1.3, 1.3]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 60), railMat);
  rail.position.set(x, -0.02, -31.7);
  scene.add(rail);
}
const beatBars = [];
const beatBarMat = new THREE.MeshBasicMaterial({ color: 0x4a78d8, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.6, depthWrite: false });
for (let i = 0; i < 14; i++) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.01, 0.05), beatBarMat);
  b.position.y = -0.02;
  scene.add(b); beatBars.push(b);
}
// 两侧光柱，随鼓点明灭
const pillarMats = COLORS.map((c) => new THREE.MeshBasicMaterial({ map: beamTex, color: c, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
for (let i = 0; i < 8; i++) {
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 18), pillarMats[(i + (side > 0 ? 1 : 0)) % 2]);
    p.position.set(side * (4.5 + i * 0.35), 9, -8 - i * 6.5);
    p.rotation.z = Math.PI;
    scene.add(p);
  }
}

// ---------------------------------------------------------------- 粒子与碎片
const PN = 600;
const pPos = new Float32Array(PN * 3).fill(-999), pCol = new Float32Array(PN * 3);
const pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN), pBase = new Float32Array(PN * 3);
let pNext = 0;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ map: glowTex, size: 0.07, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
particles.frustumCulled = false;
scene.add(particles);
const _c = new THREE.Color();
function burst(p, hex, count, speed = 3) {
  _c.setHex(hex);
  for (let k = 0; k < count; k++) {
    const i = pNext; pNext = (pNext + 1) % PN;
    const u = Math.random() * Math.PI * 2, v = Math.random() * 2 - 1, r = Math.sqrt(1 - v * v);
    const s = speed * (0.3 + Math.random() * 0.9);
    pPos.set([p.x, p.y, p.z], i * 3);
    pVel.set([Math.cos(u) * r * s, v * s + 0.8, Math.sin(u) * r * s + 1.5], i * 3);
    pBase.set([_c.r, _c.g, _c.b], i * 3);
    pLife[i] = pMax[i] = 0.35 + Math.random() * 0.4;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    const j = i * 3;
    if (pLife[i] <= 0) { pPos[j + 1] = -999; continue; }
    pVel[j + 1] -= 4 * dt;
    pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
    const f = pLife[i] / pMax[i];
    pCol[j] = pBase[j] * f; pCol[j + 1] = pBase[j + 1] * f; pCol[j + 2] = pBase[j + 2] * f;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

const halfGeo = new THREE.ConeGeometry(NOTE_R * 0.98, NOTE_R, 4);
halfGeo.translate(0, NOTE_R / 2, 0);
halfGeo.scale(1, 1, 0.6);
const debris = [];
for (let i = 0; i < 28; i++) {
  const m = new THREE.Mesh(halfGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.25, transparent: true }));
  m.visible = false;
  scene.add(m);
  debris.push({ m, vel: new THREE.Vector3(), spin: 0, life: 0 });
}
let dNext = 0;
function shatter(p, hex, cut, speed) {
  // cut：挥砍方向（XY 平面单位向量）；两半沿垂直方向分开
  const nx = -cut[1], ny = cut[0];
  for (const s of [1, -1]) {
    const d = debris[dNext]; dNext = (dNext + 1) % debris.length;
    d.m.position.copy(p);
    d.m.rotation.set(0, 0, Math.atan2(ny * s, nx * s) - Math.PI / 2);
    d.m.material.color.setHex(hex);
    d.m.material.emissive.setHex(hex);
    d.m.material.emissiveIntensity = 0.6;
    d.m.material.opacity = 1;
    d.m.visible = true;
    d.vel.set(nx * s * 1.5 + cut[0] * 1.2, ny * s * 1.5 + cut[1] * 1.2, speed * 0.3);
    d.spin = s * (3 + Math.random() * 4);
    d.life = 0.7;
  }
}
function updateDebris(dt) {
  for (const d of debris) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.m.visible = false; continue; }
    d.vel.y -= 5 * dt;
    d.m.position.addScaledVector(d.vel, dt);
    d.m.rotation.z += d.spin * dt;
    d.m.rotation.x += d.spin * 0.6 * dt;
    d.m.material.opacity = Math.min(1, d.life / 0.35);
  }
}

// ---------------------------------------------------------------- 光刃
const TRAIL_N = 12;
function makeBlade(hand) {
  const color = COLORS[hand];
  const group = new THREE.Group();
  group.rotation.x = BLADE_TILT;
  const mid = -(BLADE_START + BLADE_LEN / 2);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, BLADE_LEN, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  core.rotation.x = -Math.PI / 2; core.position.z = mid;
  const glowMat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.55, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, BLADE_LEN + 0.03, 10), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.z = mid;
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x2a2f42, roughness: 0.5, metalness: 0.6 }));
  hilt.rotation.x = -Math.PI / 2; hilt.position.z = -0.02;
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 20), new THREE.MeshBasicMaterial({ color }));
  guard.position.z = -BLADE_START;
  group.add(core, glow, hilt, guard);
  group.visible = false;

  // 拖尾
  const tPos = new Float32Array(TRAIL_N * 6), tCol = new Float32Array(TRAIL_N * 6), idx = [];
  const c = new THREE.Color(color);
  for (let i = 0; i < TRAIL_N; i++) {
    const f = Math.pow(1 - i / (TRAIL_N - 1), 2) * 0.55;
    tCol.set([c.r * f * 0.2, c.g * f * 0.2, c.b * f * 0.2, c.r * f, c.g * f, c.b * f], i * 6);
    if (i < TRAIL_N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tg.setIndex(idx);
  const trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  trail.frustumCulled = false; trail.visible = false;
  scene.add(trail);

  return {
    hand, color, group, glowMat, trail, tPos,
    base: new THREE.Vector3(), tip: new THREE.Vector3(),
    prevBase: new THREE.Vector3(), prevTip: new THREE.Vector3(),
    vel: new THREE.Vector3(), active: false, fresh: true, wild: false, source: null,
  };
}
const blades = [makeBlade(0), makeBlade(1)];
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3();

function updateBlades(dt) {
  for (const b of blades) {
    b.trail.visible = b.active;
    if (!b.active) { b.fresh = true; continue; }
    b.group.updateWorldMatrix(true, false);
    b.prevBase.copy(b.base); b.prevTip.copy(b.tip);
    b.base.set(0, 0, -BLADE_START).applyMatrix4(b.group.matrixWorld);
    b.tip.set(0, 0, -(BLADE_START + BLADE_LEN)).applyMatrix4(b.group.matrixWorld);
    _m.lerpVectors(b.base, b.tip, 0.3);
    if (b.fresh) {
      b.prevBase.copy(b.base); b.prevTip.copy(b.tip); b.vel.set(0, 0, 0);
      for (let i = 0; i < TRAIL_N; i++) b.tPos.set([_m.x, _m.y, _m.z, b.tip.x, b.tip.y, b.tip.z], i * 6);
      b.fresh = false;
    } else {
      _v.subVectors(b.tip, b.prevTip).divideScalar(Math.max(dt, 1e-3));
      b.vel.lerp(_v, 0.65);
      b.tPos.copyWithin(6, 0, (TRAIL_N - 1) * 6);
      b.tPos.set([_m.x, _m.y, _m.z, b.tip.x, b.tip.y, b.tip.z], 0);
    }
    b.trail.geometry.attributes.position.needsUpdate = true;
  }
}
function distPointSeg(p, a, b) {
  _v.subVectors(b, a);
  const t = THREE.MathUtils.clamp(_m.subVectors(p, a).dot(_v) / _v.lengthSq(), 0, 1);
  return _m.copy(a).addScaledVector(_v, t).distanceTo(p);
}
// 刃在这一帧扫过的面到点 p 的最近距离（取 3 个插值位置）
function bladeDist(b, p) {
  let best = 1e9;
  for (const k of [0, 0.5, 1]) {
    _a.lerpVectors(b.prevBase, b.base, k);
    _b.lerpVectors(b.prevTip, b.tip, k);
    best = Math.min(best, distPointSeg(p, _a, _b));
  }
  return best;
}
function pulse(b, strength, ms) {
  try { b.source?.gamepad?.hapticActuators?.[0]?.pulse(strength, ms); } catch (e) { /* 不支持震动就算了 */ }
}

// VR 手柄
for (let i = 0; i < 2; i++) {
  const ctl = renderer.xr.getController(i);
  scene.add(ctl);
  ctl.addEventListener('connected', (e) => {
    if (e.data.targetRayMode !== 'tracked-pointer') return;
    const hand = e.data.handedness === 'left' ? 0 : e.data.handedness === 'right' ? 1 : i;
    const b = blades[hand];
    ctl.add(b.group);
    b.group.rotation.x = BLADE_TILT;
    b.group.visible = true;
    b.active = true; b.fresh = true; b.wild = false; b.source = e.data;
    ctl.userData.blade = b;
  });
  ctl.addEventListener('disconnected', () => {
    const b = ctl.userData.blade;
    if (!b) return;
    ctl.remove(b.group);
    b.active = false; b.source = null; b.group.visible = false;
    ctl.userData.blade = null;
  });
}

// 桌面预览：鼠标带动一把不分颜色的光刃
const mouse = new THREE.Vector2(0, -0.3);
const deskRig = new THREE.Object3D();
scene.add(deskRig);
const _look = new THREE.Matrix4();
window.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
function updateDeskBlade() {
  _a.set(mouse.x, mouse.y, 0.5).unproject(camera).sub(camera.position).normalize();
  const t = (HIT_Z - camera.position.z) / _a.z;
  _b.copy(camera.position).addScaledVector(_a, t);            // 鼠标在判定平面上的点
  _a.set(_b.x * 0.45, 0.7, -0.05);                            // 握把大致位置
  _v.subVectors(_b, _a).normalize();
  deskRig.position.copy(_b).addScaledVector(_v, -(BLADE_START + BLADE_LEN));
  _look.lookAt(deskRig.position, _b, camera.up);
  deskRig.quaternion.setFromRotationMatrix(_look);
}

// ---------------------------------------------------------------- 星晶
const noteGeo = new THREE.OctahedronGeometry(NOTE_R, 0);
noteGeo.scale(1, 1, 0.6);
const noteMats = COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.22, metalness: 0.1, flatShading: true }));
const haloMats = COLORS.map((c) => new THREE.SpriteMaterial({ map: glowTex, color: c, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, depthWrite: false }));
const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const chevGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.085, 0.05); s.lineTo(0.085, 0.05); s.lineTo(0, -0.075); s.closePath();
  return new THREE.ShapeGeometry(s);
})();
const ringGeo = new THREE.RingGeometry(0.04, 0.068, 28);

function makeNoteObj() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(noteGeo, noteMats[0]);
  const mark = new THREE.Mesh(chevGeo, markMat);
  mark.position.z = NOTE_R * 0.6 + 0.012;
  const halo = new THREE.Sprite(haloMats[0]);
  halo.scale.setScalar(0.95); halo.position.z = -0.06;
  g.add(halo, body, mark);
  g.userData = { body, mark, halo };
  scene.add(g);
  return g;
}
function styleNote(g, hand, dir) {
  const u = g.userData;
  u.body.material = noteMats[hand];
  u.halo.material = haloMats[hand];
  u.mark.geometry = dir ? chevGeo : ringGeo;
  u.mark.rotation.z = dir ? Math.atan2(dir[1], dir[0]) + Math.PI / 2 : 0;
}
const notePool = [];
const active = [];

// ---------------------------------------------------------------- HUD 与菜单
const comboPanel = makePanel(1.8, 1.1);
comboPanel.mesh.position.set(-2.5, 1.75, -5.5); comboPanel.mesh.rotation.y = 0.38;
const scorePanel = makePanel(1.8, 1.1);
scorePanel.mesh.position.set(2.5, 1.75, -5.5); scorePanel.mesh.rotation.y = -0.38;
const bigPanel = makePanel(3.6, 1.9, 200);
bigPanel.mesh.position.set(0, 2.55, -4.2); bigPanel.mesh.rotation.x = 0.12;
scene.add(comboPanel.mesh, scorePanel.mesh, bigPanel.mesh);

const progBack = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.03), new THREE.MeshBasicMaterial({ color: 0x1c2640 }));
progBack.position.set(0, 0.62, -5.5);
const progFill = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.03), new THREE.MeshBasicMaterial({ color: 0xdfe6ff }));
progFill.position.set(0, 0.62, -5.49);
scene.add(progBack, progFill);

const game = {
  state: 'menu', mode: null, since: 0,
  diff: 0, map: [], ptr: 0, speed: 10, travel: 2.4,
  score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, bads: 0, total: 0,
  midY: 1.2, headY: 1.6, flash: 0,
};
window.__game = game;
window.__start = (d) => startSong(d);   // 调试用：控制台里直接开始一局

function makeMenuItem(label, hand, x, action) {
  const obj = makeNoteObj();
  styleNote(obj, hand, null);
  const lab = makePanel(0.7, 0.24, 260);
  lab.draw((g, w, h) => text(g, label, w / 2, h / 2, h * 0.62, CSS[hand]));
  scene.add(lab.mesh);
  return { obj, lab, hand, x, action, phase: Math.random() * 6 };
}
const menuItems = {
  menu: [
    makeMenuItem('普通', 0, -0.42, () => startSong(0)),
    makeMenuItem('困难', 1, 0.42, () => startSong(1)),
  ],
  results: [makeMenuItem('再来一次', 1, 0, () => gotoMenu())],
};

const mult = (c) => (c >= 28 ? 8 : c >= 12 ? 4 : c >= 4 ? 2 : 1);

function drawHud() {
  comboPanel.draw((g, w, h) => {
    text(g, '连击', w / 2, h * 0.2, h * 0.17, '#8f9bbd', 'center', 600);
    text(g, String(game.combo), w / 2, h * 0.62, h * 0.52, '#ffffff', 'center', 800);
  });
  scorePanel.draw((g, w, h) => {
    text(g, '分数', w / 2, h * 0.2, h * 0.17, '#8f9bbd', 'center', 600);
    text(g, String(game.score), w / 2, h * 0.55, h * 0.36, '#ffffff', 'center', 800);
    const m = mult(game.combo);
    text(g, `×${m}`, w / 2, h * 0.86, h * 0.2, m >= 4 ? CSS[0] : m >= 2 ? CSS[1] : '#8f9bbd');
  });
}

function setVisible() {
  const playing = game.state === 'playing';
  comboPanel.mesh.visible = scorePanel.mesh.visible = progBack.visible = progFill.visible = playing;
  bigPanel.mesh.visible = !playing;
  for (const k in menuItems) for (const it of menuItems[k]) it.obj.visible = it.lab.mesh.visible = game.state === k;
}

function clearNotes() {
  for (const n of active) { n.obj.visible = false; notePool.push(n.obj); }
  active.length = 0;
}

function gotoMenu() {
  clearNotes();
  music.stop();
  game.state = 'menu'; game.since = now;
  bigPanel.draw((g, w, h) => {
    g.font = `800 ${h * 0.42}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = CSS[0]; g.fillText('碎', w / 2 - h * 0.27, h * 0.36);
    g.fillStyle = CSS[1]; g.fillText('星', w / 2 + h * 0.27, h * 0.36);
    text(g, '挥动光刃，劈开一颗星晶开始', w / 2, h * 0.76, h * 0.105, '#c3cbe2', 'center', 500);
  });
  setVisible();
}

function startSong(diff) {
  clearNotes();
  const m = buildMap(diff);
  Object.assign(game, {
    state: 'playing', since: now, diff, map: m.notes, ptr: 0, speed: m.speed, travel: SPAWN_DIST / m.speed,
    score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, bads: 0, total: m.notes.length,
    midY: THREE.MathUtils.clamp(game.headY - 0.42, 0.8, 1.4),
  });
  music.init();
  music.start(1.5);
  drawHud();
  setVisible();
}

function endSong() {
  clearNotes();
  music.stop();
  game.state = 'results'; game.since = now;
  const acc = game.total ? game.hits / game.total : 0;
  const rank = acc >= 0.98 ? 'SS' : acc >= 0.92 ? 'S' : acc >= 0.8 ? 'A' : acc >= 0.65 ? 'B' : 'C';
  bigPanel.draw((g, w, h) => {
    text(g, rank, w * 0.2, h * 0.5, h * 0.62, acc >= 0.8 ? CSS[0] : '#ffffff', 'center', 800);
    const rows = [
      ['分数', String(game.score)],
      ['命中', `${game.hits} / ${game.total}（${Math.round(acc * 100)}%）`],
      ['最高连击', String(game.maxCombo)],
      ['难度', game.diff ? '困难' : '普通'],
    ];
    rows.forEach(([k, v], i) => {
      const y = h * (0.2 + i * 0.2);
      text(g, k, w * 0.42, y, h * 0.1, '#8f9bbd', 'left', 500);
      text(g, v, w * 0.95, y, h * 0.12, '#ffffff', 'right', 700);
    });
  });
  setVisible();
}

// ---------------------------------------------------------------- 判定
function goodHit(n, blade, cut, swing) {
  game.combo++; game.hits++;
  game.maxCombo = Math.max(game.maxCombo, game.combo);
  const q = THREE.MathUtils.clamp((swing - MIN_SWING) / 4, 0, 1);
  game.score += Math.round((70 + 30 * q) * mult(game.combo));
  shatter(n.obj.position, COLORS[n.hand], cut, game.speed);
  burst(n.obj.position, COLORS[n.hand], 22);
  music.hitSound(n.hand);
  if (blade) pulse(blade, 0.9, 55);
  drawHud();
}
function fail(n, bad, blade) {
  if (bad) {
    game.bads++;
    burst(n.obj.position, 0x8890a8, 10, 1.5);
    music.badSound();
    if (blade) pulse(blade, 0.4, 120);
  } else {
    music.missSound();
  }
  game.misses++;
  if (game.combo > 0) { game.combo = 0; drawHud(); }
  game.flash = 1;
}
function removeNote(i) {
  const n = active[i];
  n.obj.visible = false;
  notePool.push(n.obj);
  active.splice(i, 1);
}

function updatePlaying(st) {
  const g = game;
  while (g.ptr < g.map.length && g.map[g.ptr].t - st < g.travel) {
    const d = g.map[g.ptr++];
    const obj = notePool.pop() || makeNoteObj();
    styleNote(obj, d.hand, d.dir);
    obj.position.set(COLS[d.col], g.midY + ROWS[d.row], -99);
    obj.visible = true;
    active.push({ ...d, obj });
  }
  for (let i = active.length - 1; i >= 0; i--) {
    const n = active[i];
    const z = HIT_Z - (n.t - st) * g.speed;
    n.obj.position.z = z;
    n.obj.scale.setScalar(Math.min(1, Math.max(0.01, (g.travel - (n.t - st)) / 0.3)));
    if (z > 0.7) { fail(n, false); removeNote(i); continue; }
    if (AUTO && z >= HIT_Z) { goodHit(n, null, n.dir || [0, -1], 5); removeNote(i); continue; }
    if (z < HIT_Z - 1.4) continue;
    for (const b of blades) {
      if (!b.active || bladeDist(b, n.obj.position) > HIT_R) continue;
      const swing = b.vel.length();
      if (swing < MIN_SWING) continue;
      if (!b.wild && b.hand !== n.hand) {
        if (swing < 2) continue;
        fail(n, true, b); removeNote(i); break;
      }
      const len = Math.hypot(b.vel.x, b.vel.y) || 1;
      const cut = [b.vel.x / len, b.vel.y / len];
      if (n.dir) {
        const dot = cut[0] * n.dir[0] + cut[1] * n.dir[1];
        if (dot < -0.4) { fail(n, true, b); removeNote(i); break; }
        if (dot < 0.15) continue;                      // 擦到边，不算，还可以重新劈
      }
      goodHit(n, b, n.dir || cut, swing); removeNote(i); break;
    }
  }
  progFill.scale.x = Math.max(0.001, Math.min(1, st / SONG_LEN));
  progFill.position.x = -1.2 * (1 - progFill.scale.x);
  if (st > SONG_LEN + 0.5) endSong();
}

function updateMenu() {
  const items = menuItems[game.state];
  if (!items) return;
  const y = THREE.MathUtils.clamp(game.headY - 0.38, 0.8, 1.5);
  for (const it of items) {
    it.obj.position.set(it.x, y + Math.sin(now * 1.6 + it.phase) * 0.03, HIT_Z);
    it.obj.rotation.y = Math.sin(now * 0.9 + it.phase) * 0.35;
    it.lab.mesh.position.set(it.x, y + 0.36, HIT_Z);
    if (now - game.since < 0.7) continue;
    for (const b of blades) {
      if (!b.active || b.vel.length() < MIN_SWING || bladeDist(b, it.obj.position) > HIT_R) continue;
      const len = Math.hypot(b.vel.x, b.vel.y) || 1;
      shatter(it.obj.position, COLORS[it.hand], [b.vel.x / len, b.vel.y / len], 4);
      burst(it.obj.position, COLORS[it.hand], 26);
      music.hitSound(it.hand);
      pulse(b, 0.9, 70);
      it.action();
      return;
    }
  }
}

function updateEnv(st, dt) {
  const playing = game.state === 'playing';
  const t = playing ? st : now;
  const speed = playing ? game.speed : 6;
  const phase = ((t / BEAT) % 1 + 1) % 1;
  const kickPulse = Math.exp(-phase * 5);
  const beatIdx = Math.floor(t / BEAT);
  pillarMats[0].opacity = 0.1 + (beatIdx % 2 === 0 ? 0.4 * kickPulse : 0.04);
  pillarMats[1].opacity = 0.1 + (beatIdx % 2 !== 0 ? 0.4 * kickPulse : 0.04);
  moonHalo.scale.setScalar(110 + 10 * kickPulse);
  const k0 = Math.ceil(t / BEAT);
  for (let i = 0; i < beatBars.length; i++) {
    const z = HIT_Z - ((k0 + i) * BEAT - t) * speed;
    beatBars[i].position.z = z;
    beatBars[i].visible = z < -1.7;
  }
  game.flash = Math.max(0, game.flash - dt * 3);
  ringMat.color.setRGB(0.15 + 0.5 * game.flash + 0.1 * kickPulse, 0.35 - 0.2 * game.flash + 0.2 * kickPulse, 0.75 - 0.5 * game.flash + 0.2 * kickPulse);
}

// ---------------------------------------------------------------- 主循环
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  now += dt;
  if (camera.position.y > 0.5) game.headY += (camera.position.y - game.headY) * 0.05;
  if (game.mode === 'desktop') updateDeskBlade();
  updateBlades(dt);
  music.update();
  const st = music.time;
  if (game.state === 'playing') updatePlaying(st);
  else updateMenu();
  updateDebris(dt);
  updateParticles(dt);
  updateEnv(st, dt);
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- 进入方式
const overlay = document.getElementById('overlay');
const btnVR = document.getElementById('btn-vr');
const btnDesk = document.getElementById('btn-desktop');
const statusEl = document.getElementById('status');
const hint = document.getElementById('hint');

function leave() {
  game.mode = null;
  overlay.classList.remove('hidden');
  hint.style.display = 'none';
  const b = blades[1];
  if (b.wild) { deskRig.remove(b.group); b.active = false; b.wild = false; b.group.visible = false; }
  gotoMenu();
}

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    btnVR.disabled = !ok;
    statusEl.textContent = ok ? '已检测到 VR 设备' : '这个浏览器不支持 VR，可以用桌面预览看效果';
  }).catch(() => { statusEl.textContent = '无法检测 VR 支持'; });
} else {
  statusEl.textContent = '这个浏览器不支持 WebXR，可以用桌面预览看效果';
}

btnVR.addEventListener('click', async () => {
  try {
    music.init();
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    session.addEventListener('end', leave);
    await renderer.xr.setSession(session);
    game.mode = 'vr';
    overlay.classList.add('hidden');
    gotoMenu();
  } catch (e) {
    statusEl.textContent = '进入 VR 失败：' + e.message;
  }
});

btnDesk.addEventListener('click', () => {
  music.init();
  game.mode = 'desktop';
  overlay.classList.add('hidden');
  hint.style.display = 'block';
  const b = blades[1];
  deskRig.add(b.group);
  b.group.rotation.x = 0;
  b.group.visible = true;
  b.active = true; b.fresh = true; b.wild = true;
  gotoMenu();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && game.mode === 'desktop') leave(); });

gotoMenu();
