import * as THREE from 'three';
import { makeGLTFLoader } from '../loaders/gltf-loader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from '../core/config.js';

const {
  hallW, hallH, leg1Len, leg2EndX, leg2Z0, leg2Z1,
  roomW, roomH, doorW, doorH, classrooms, vacants, vacantDepth,
} = CFG.world;
const HALF_W = hallW / 2;
const VACANT_DOOR_H = 2.6;
const ROOM_LIGHT_COLORS = [0xffaa44, 0x4488ff, 0x44ff88];
const FLUORESCENT_MODEL_PATH = '/assets/3D/fluorescent/mounted_fluorescent_lights_1k.gltf';
// Leg-1 fixtures sit at x=0 along z; leg-2 fixtures at z=49 along x (rotated 90°)
const LEG1_LIGHT_ZS = [5.5, 16.5, 27, 38, 49];
const LEG2_LIGHT_XS = [10, 21, 32, 41];

// ═══════════════════════════════════════════════════════════════════════════════
//  ROOM FRAMES — every room hangs off a corridor wall (orient E/W/N/S) and is
//  built in LOCAL coords: u = depth into the room (0 at the door wall),
//  v = along the door wall (0 at one edge). A per-room frame maps local → world
//  and adds the frame's yaw to every rotation, so one set of interior code
//  builds rooms facing any direction.
// ═══════════════════════════════════════════════════════════════════════════════
function frameFor(def) {
  switch (def.orient) {
    case 'E': return { ox:  HALF_W, oz: def.v0, ix:  1, iz: 0, lx: 0, lz:  1, theta: 0 };
    case 'W': return { ox: -HALF_W, oz: def.v1, ix: -1, iz: 0, lx: 0, lz: -1, theta: Math.PI };
    case 'N': return { ox: def.v1, oz: leg2Z1, ix: 0, iz:  1, lx: -1, lz: 0, theta: -Math.PI / 2 };
    case 'S': return { ox: def.v0, oz: leg2Z0, ix: 0, iz: -1, lx:  1, lz: 0, theta:  Math.PI / 2 };
  }
}

function frameHelpers(def) {
  const f = frameFor(def);
  const W = def.v1 - def.v0;
  const P = (u, v) => ({ x: f.ox + u * f.ix + v * f.lx, z: f.oz + u * f.iz + v * f.lz });
  const latPos = (f.lx + f.lz) > 0;
  const dLoc = latPos
    ? [def.door[0] - def.v0, def.door[1] - def.v0]
    : [def.v1 - def.door[1], def.v1 - def.door[0]];
  const rect = (u0, u1, v0, v1) => {
    const a = P(u0, v0), b = P(u1, v1);
    return {
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
      minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
    };
  };
  const BX = (w, h, d, u, y, v, mat, rx = 0, ry = 0) => {
    const p = P(u, v); _push(_bxGeo(w, h, d), mat, p.x, y, p.z, rx, ry + f.theta);
  };
  const PL = (w, h, u, y, v, rx, ry, mat) => {
    const p = P(u, v); _push(_plGeo(w, h), mat, p.x, y, p.z, rx, ry + f.theta);
  };
  return { f, W, P, dLoc, rect, BX, PL };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CANVAS TEXTURES
// ═══════════════════════════════════════════════════════════════════════════════
function grungeTex(base = '#181818') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    const g = Math.floor(Math.random() * 28);
    ctx.fillStyle = `rgba(${g},${g},${g},0.55)`;
    ctx.fillRect(Math.random()*256, Math.random()*256, Math.random()*5+1, Math.random()*4+1);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = Math.random()*256, y = Math.random()*256;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) { x += (Math.random()-.5)*50; y += (Math.random()-.5)*50; ctx.lineTo(x,y); }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function floorTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#282828'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#1d1d1d'; ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.arc(Math.random()*256, Math.random()*256, Math.random()*14+3, 0, Math.PI*2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

function chalkboardTex(lines) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#152e15'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#2a1a0a';
  ctx.fillRect(0, 0, 512, 16); ctx.fillRect(0, 240, 512, 16);
  ctx.fillRect(0, 0, 16, 256); ctx.fillRect(496, 0, 16, 256);
  ctx.fillStyle = 'rgba(225,220,200,0.85)';
  ctx.font = 'bold 34px monospace'; ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, 256, 95 + i * 50));
  return new THREE.CanvasTexture(cv);
}

// Water-damaged, partly-collapsed drop ceiling — heavy stains, mold, sagging
// browned panels and a couple of missing tiles opening into the dark void above.
function ceilTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2b2c26'; ctx.fillRect(0, 0, 256, 256);            // grimier panel base
  for (let i = 0; i < 450; i++) {                                     // panel noise
    const g = 34 + Math.floor(Math.random() * 16);
    ctx.fillStyle = `rgba(${g},${g},${g-4},0.32)`;
    ctx.fillRect(Math.random()*256, Math.random()*256, Math.random()*4+1, Math.random()*3+1);
  }
  // a couple of whole panels browned/sagging from water damage
  ctx.fillStyle = 'rgba(60,44,22,0.5)'; ctx.fillRect(68, 4, 56, 56);
  ctx.fillStyle = 'rgba(52,38,18,0.42)'; ctx.fillRect(132, 132, 56, 56);
  // missing / collapsed tiles → dark holes into the ceiling void
  [[4, 128], [192, 4]].forEach(([tx, ty]) => {
    ctx.fillStyle = '#0a0b08'; ctx.fillRect(tx + 3, ty + 3, 58, 58);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; _blob(ctx, tx + 32, ty + 32, 30, 0.35);
    ctx.strokeStyle = 'rgba(46,40,30,0.5)'; ctx.lineWidth = 1;        // a batten crossing the gap
    ctx.beginPath(); ctx.moveTo(tx + 8, ty + 18); ctx.lineTo(tx + 56, ty + 24); ctx.stroke();
  });
  ctx.strokeStyle = '#191a16'; ctx.lineWidth = 3;                     // tile grid (drawn over so gaps keep their frame)
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {                                       // irregular water stains
    ctx.fillStyle = `rgba(58,44,22,${0.16 + Math.random()*0.2})`;
    _blob(ctx, Math.random()*256, Math.random()*256, 12 + Math.random()*26, 0.5);
  }
  for (let i = 0; i < 6; i++) {                                       // mold blooms
    ctx.fillStyle = `rgba(${26+Math.random()*16|0},${34+Math.random()*16|0},${22+Math.random()*10|0},0.32)`;
    _blob(ctx, Math.random()*256, Math.random()*256, 6 + Math.random()*14, 0.55);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

// Battered, rusted school locker — faded paint, rust streaks, dents, grime.
function lockerTex() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1e271c'; ctx.fillRect(0, 0, 128, 256);          // faded green paint
  for (let i = 0; i < 260; i++) {                                   // grime speckle
    const g = Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgba(${g},${g+3},${g},0.5)`;
    ctx.fillRect(Math.random()*128, Math.random()*256, Math.random()*3+1, Math.random()*2+1);
  }
  ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 2;                   // door + panel outlines
  ctx.strokeRect(4, 4, 120, 248); ctx.strokeRect(4, 4, 120, 124); ctx.strokeRect(4, 128, 120, 124);
  for (let y = 20; y < 120; y += 12) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(108, y); ctx.stroke(); }
  for (let y = 148; y < 248; y += 12) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(108, y); ctx.stroke(); }
  // rust streaks bleeding down from the vents, handles and edges
  for (let i = 0; i < 9; i++) {
    const x = 8 + Math.random()*112, y0 = Math.random()*150, len = 30 + Math.random()*90;
    const grad = ctx.createLinearGradient(0, y0, 0, y0+len);
    grad.addColorStop(0, `rgba(${90+Math.random()*40|0},${40+Math.random()*20|0},14,0.5)`);
    grad.addColorStop(1, 'rgba(70,32,10,0)');
    ctx.fillStyle = grad; ctx.fillRect(x, y0, 2 + Math.random()*4, len);
  }
  for (let i = 0; i < 7; i++) {                                     // rust/dent blotches
    ctx.fillStyle = `rgba(${70+Math.random()*35|0},${34+Math.random()*18|0},12,0.4)`;
    _blob(ctx, Math.random()*128, Math.random()*256, 4 + Math.random()*10, 0.55);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;           // scratches
  for (let i = 0; i < 10; i++) {
    const x = Math.random()*128, y = Math.random()*256;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random()-0.5)*30, y + (Math.random()-0.5)*30); ctx.stroke();
  }
  ctx.fillStyle = '#3a3a2a';                                        // corroded handles/vents
  ctx.beginPath(); ctx.arc(100, 66, 5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(100, 194, 5, 0, 7); ctx.fill();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Weathered, rotting wooden door with two recessed panels — aged to match the
// abandoned school (grime, water stains, scratches, rot creeping up the bottom).
function doorTex() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#33230f'; ctx.fillRect(0, 0, 256, 512);              // dark aged wood
  for (let x = 0; x < 256; x += 3) {                                    // high-contrast grain
    const g = 26 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgba(${g},${Math.floor(g*0.7)},${Math.floor(g*0.4)},0.42)`;
    ctx.fillRect(x, 0, 2, 512);
  }
  for (let i = 0; i < 500; i++) {                                       // grime speckle
    ctx.fillStyle = `rgba(0,0,0,${0.2+Math.random()*0.3})`;
    ctx.fillRect(Math.random()*256, Math.random()*512, Math.random()*3+1, Math.random()*3+1);
  }
  const panel = (y, h) => {                                             // two recessed panels
    ctx.fillStyle = 'rgba(0,0,0,0.44)'; ctx.fillRect(38, y, 180, h);
    ctx.strokeStyle = 'rgba(14,9,3,0.92)'; ctx.lineWidth = 6; ctx.strokeRect(38, y, 180, h);
    ctx.strokeStyle = 'rgba(88,64,36,0.28)'; ctx.lineWidth = 2; ctx.strokeRect(46, y + 8, 164, h - 16);
  };
  panel(42, 180);
  panel(272, 180);
  for (let i = 0; i < 8; i++) {                                         // water stains / rot blooms
    ctx.fillStyle = `rgba(${30+Math.random()*20|0},${22+Math.random()*14|0},${10+Math.random()*8|0},0.32)`;
    _blob(ctx, Math.random()*256, Math.random()*512, 12 + Math.random()*30, 0.5);
  }
  const rot = ctx.createLinearGradient(0, 512, 0, 372);                 // rot creeping up from the floor
  rot.addColorStop(0, 'rgba(7,5,2,0.72)'); rot.addColorStop(1, 'rgba(7,5,2,0)');
  ctx.fillStyle = rot; ctx.fillRect(0, 372, 256, 140);
  ctx.strokeStyle = 'rgba(12,7,3,0.55)'; ctx.lineWidth = 1;             // scratches / gouges
  for (let i = 0; i < 14; i++) {
    const x = Math.random()*256, y = Math.random()*512, len = 20 + Math.random()*120;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random()-0.5)*20, y + len); ctx.stroke();
  }
  for (let i = 0; i < 22; i++) {                                        // paint-chip flecks
    ctx.fillStyle = 'rgba(120,100,72,0.22)';
    ctx.fillRect(Math.random()*256, Math.random()*512, Math.random()*4+1, Math.random()*6+2);
  }
  const grad = ctx.createLinearGradient(0, 0, 256, 0);                  // edge shading
  grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(0.12, 'rgba(0,0,0,0)');
  grad.addColorStop(0.88, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 512);
  return new THREE.CanvasTexture(cv);
}

// Wall scrawls use the "Horror Game Wall Scratches" font. Canvas rasterises text
// at draw time, so we draw once now (Georgia fallback) and redraw each scrawl
// once the scratchy font finishes loading (see the document.fonts.load below).
const _scrawlRedraws = [];
function scrawlTex(lines) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  const jit = lines.map(() => ({ dx: (Math.random()-0.5)*24, rot: (Math.random()-0.5)*0.08 }));  // fixed so redraw doesn't shift
  const draw = () => {
    ctx.clearRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(178,158,148,0.92)';
    const scratchy = document.fonts && document.fonts.check('40px HorrorScratch');
    ctx.font = scratchy ? '56px HorrorScratch' : 'bold 40px Georgia';
    ctx.textAlign = 'center';
    const y0 = lines.length > 1 ? 92 : 150;
    lines.forEach((l, i) => {
      ctx.save();
      ctx.translate(256 + jit[i].dx, y0 + i * 72);
      ctx.rotate(jit[i].rot);
      ctx.fillText(l, 0, 0);
      ctx.restore();
    });
    tex.needsUpdate = true;
  };
  draw();
  _scrawlRedraws.push(draw);
  return tex;
}
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.load('40px HorrorScratch').then(() => _scrawlRedraws.forEach(fn => fn())).catch(() => {});
}

// Scary messages clawed onto walls around the school.
const SCARY_SCRAWLS = [
  ['GET OUT'],            ['HELP US'],              ['IT SEES YOU'],
  ['RUN'],               ['NO WAY OUT'],           ['YOU’RE NEXT'],
  ['TURN BACK'],         ['STAY QUIET'],           ['TOO LATE'],
  ['DON’T LOOK', 'BEHIND YOU'],   ['WE NEVER', 'LEFT'],   ['THEY’RE', 'WATCHING'],
  ['IT KNOWS', 'YOUR NAME'],      ['NOBODY', 'ESCAPES'],  ['DON’T TRUST', 'THE DOORS'],
  ['THE ODDS', 'ARE ZERO'],       ['P(LIVE) = 0'],
];
const randScrawl = () => SCARY_SCRAWLS[Math.floor(Math.random() * SCARY_SCRAWLS.length)];

// A wall-scrawl decal. ry orients it to face the viewer; canvas is 2:1 so h = w/2.
function scrawlDecal(scene, x, y, z, ry, w, lines, opacity = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, w * 0.5),
    new THREE.MeshBasicMaterial({ map: scrawlTex(lines), transparent: true, opacity })
  );
  m.position.set(x, y, z);
  m.rotation.order = 'YXZ';
  m.rotation.set(0, ry, 0);
  scene.add(m);
  return m;
}

// A scrawl on a room's DOOR-side wall (u≈0), in the wider gap beside the doorway,
// FACING INTO the room. Single-sided + facing away from the corridor means it's
// invisible (and un-splittable) from the hallway, and only revealed once you step
// inside and look back. helpers = the room's { f, P, dLoc, W }.
function roomScrawl(scene, { f, P, dLoc, W }, lines, opacity = 0.5) {
  const pre = dLoc[0], post = W - dLoc[1];
  const vc = post >= pre ? (dLoc[1] + W) / 2 : dLoc[0] / 2;   // centre of the wider side
  const w  = Math.min(2.2, Math.max(pre, post) - 0.5);
  if (w < 1.0) return;                                        // too narrow to read
  const p = P(0.06, vc);
  scrawlDecal(scene, p.x, 1.5, p.z, Math.PI/2 + f.theta, w, lines, opacity);  // faces +u (into room)
}

// Classroom wall posters — themed to the probability lessons.
function posterTex(kind) {
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 280;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = { chart: '#d8d2c0', dice: '#c9d8e0', num: '#e0dcc4' }[kind];
  ctx.fillRect(0, 0, 200, 280);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.strokeRect(5, 5, 190, 270);
  ctx.fillStyle = '#20202a'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
  if (kind === 'chart') {
    ctx.fillText('PROBABILITY', 100, 36);
    ctx.fillStyle = '#31586e';
    [70, 120, 160, 100, 140].forEach((h, i) => ctx.fillRect(22 + i*34, 250 - h, 26, h));
  } else if (kind === 'dice') {
    ctx.fillText('CHANCE', 100, 36);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const x = 26 + c*56, y = 70 + r*90; ctx.strokeRect(x, y, 44, 44);
      ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x+22, y+22, 5, 0, 7); ctx.fill();
    }
  } else {
    ctx.fillText('NUMBER LINE', 100, 36);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(18, 150); ctx.lineTo(182, 150); ctx.stroke();
    for (let i = 0; i <= 8; i++) { const x = 18 + i*20.5; ctx.beginPath(); ctx.moveTo(x, 142); ctx.lineTo(x, 158); ctx.stroke(); }
  }
  return new THREE.CanvasTexture(cv);
}

// A cracked, stopped wall clock.
function clockTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#e8e6de'; ctx.beginPath(); ctx.arc(64, 64, 58, 0, 7); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 4; ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) { const a = i*Math.PI/6; ctx.beginPath();
    ctx.moveTo(64+50*Math.sin(a), 64-50*Math.cos(a)); ctx.lineTo(64+56*Math.sin(a), 64-56*Math.cos(a)); ctx.stroke(); }
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64+28*Math.sin(2), 64-28*Math.cos(2)); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64+42*Math.sin(4.2), 64-42*Math.cos(4.2)); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(38, 22); ctx.lineTo(72, 66); ctx.lineTo(52, 104); ctx.stroke();   // crack
  return new THREE.CanvasTexture(cv);
}

// A pull-down world map.
function mapTex() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 176;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#aebfcc'; ctx.fillRect(0, 0, 256, 176);          // ocean
  ctx.fillStyle = '#8fae72';                                        // land
  for (let i = 0; i < 6; i++) { ctx.beginPath();
    ctx.ellipse(28+Math.random()*200, 24+Math.random()*128, 14+Math.random()*30, 10+Math.random()*18, Math.random()*3, 0, 7); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  for (let x = 0; x <= 256; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 176); ctx.stroke(); }
  for (let y = 0; y <= 176; y += 29) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  ctx.fillStyle = '#2a1a0a'; ctx.fillRect(0, 0, 256, 8);            // top roller
  return new THREE.CanvasTexture(cv);
}

// Draws an irregular, ragged-edged blob (mold, blood pools, paint peel) — much
// more organic than a smooth ellipse.
function _blob(ctx, cx, cy, r, jitter) {
  const steps = 12 + Math.floor(Math.random() * 6);
  ctx.beginPath();
  for (let k = 0; k <= steps; k++) {
    const a  = (k / steps) * Math.PI * 2;
    const rr = r * (1 - jitter + Math.random() * jitter * 2);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
}

// Heavily abandoned classroom wall — water stains, mold, peeling paint, cracks.
// Canvas is wall-aspect (≈3.3:1) and used at repeat 1×1 so nothing tiles into an
// obvious grid of repeated blotches.
function roomWallTex() {
  const W = 480, H = 144;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2f2c27'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {                                   // grime speckle
    const g = Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgba(${g},${Math.max(0,g-4)},${Math.max(0,g-8)},0.5)`;
    ctx.fillRect(Math.random()*W, Math.random()*H, Math.random()*4+1, Math.random()*3+1);
  }
  for (let i = 0; i < 11; i++) {                                    // water streaks from the top
    const x = Math.random()*W, w = 5 + Math.random()*18, h = 40 + Math.random()*100;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(52,40,22,0.42)'); grad.addColorStop(1, 'rgba(52,40,22,0)');
    ctx.fillStyle = grad; ctx.fillRect(x, 0, w, h);
  }
  for (let i = 0; i < 10; i++) {                                    // mold — clusters of ragged blobs
    const cx = Math.random()*W, cy = Math.random()*H;
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = `rgba(${18+Math.random()*18|0},${26+Math.random()*20|0},${16+Math.random()*12|0},0.3)`;
      _blob(ctx, cx + (Math.random()-0.5)*22, cy + (Math.random()-0.5)*16, 5 + Math.random()*13, 0.55);
    }
  }
  for (let i = 0; i < 8; i++) {                                     // peeling paint — darker underlayer + flake
    const cx = Math.random()*W, cy = Math.random()*H, r = 9 + Math.random()*20;
    ctx.fillStyle = 'rgba(58,52,44,0.38)'; _blob(ctx, cx, cy, r + 3, 0.45);
    ctx.fillStyle = 'rgba(150,140,124,0.15)'; _blob(ctx, cx - 2, cy - 2, r, 0.5);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;           // cracks
  for (let i = 0; i < 6; i++) {
    let x = Math.random()*W, y = Math.random()*H; ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 6; j++) { x += (Math.random()-.5)*70; y += (Math.random()-.5)*40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;   // so _wallTiled can repeat it along long corridors
  return t;
}

// Filthy classroom floor — grime, brown stains, cracked and broken tiles.
function roomFloorTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#242320'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#161512'; ctx.lineWidth = 2;                  // tile grid
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  ctx.fillStyle = '#141311'; [[0,128],[192,64]].forEach(([x,y]) => ctx.fillRect(x+3, y+3, 58, 58));  // missing tiles
  for (let i = 0; i < 26; i++) {                                   // grime blotches
    ctx.fillStyle = `rgba(0,0,0,${0.2+Math.random()*0.25})`;
    ctx.beginPath(); ctx.arc(Math.random()*256, Math.random()*256, Math.random()*20+4, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 8; i++) {                                    // brown stains
    ctx.fillStyle = 'rgba(50,36,20,0.3)';
    ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 10+Math.random()*24, 8+Math.random()*18, Math.random()*3, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;         // cracks
  for (let i = 0; i < 6; i++) {
    let x = Math.random()*256, y = Math.random()*256; ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) { x += (Math.random()-.5)*70; y += (Math.random()-.5)*70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); return t;
}

// Warm scuffed wood grain for desks / chairs / shelves. Vertical wavy grain
// streaks + a couple of knots + aged dark blotches and scratches so the school
// furniture looks worn, not painted.
function woodTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, '#5a3d22'); g.addColorStop(0.5, '#4a3018'); g.addColorStop(1, '#402913');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {                                   // vertical grain streaks
    const x = Math.random() * 256, dark = Math.random() < 0.6;
    ctx.strokeStyle = dark ? `rgba(30,18,8,${0.15+Math.random()*0.3})` : `rgba(120,88,52,${0.1+Math.random()*0.25})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.8; ctx.beginPath(); ctx.moveTo(x, 0);
    let xx = x; for (let y = 0; y <= 256; y += 16) { xx += (Math.random() - 0.5) * 6; ctx.lineTo(xx, y); }
    ctx.stroke();
  }
  for (let k = 0; k < 3; k++) {                                    // knots
    const kx = 30 + Math.random() * 200, ky = 30 + Math.random() * 200;
    for (let r = 9; r > 0; r -= 1.6) {
      ctx.strokeStyle = `rgba(24,14,6,${0.12 + (9 - r) * 0.03})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(kx, ky, r, r * 0.7, Math.random(), 0, 7); ctx.stroke();
    }
  }
  for (let i = 0; i < 14; i++) {                                   // aged dark blotches
    ctx.fillStyle = `rgba(18,10,4,${0.12 + Math.random() * 0.22})`;
    _blob(ctx, Math.random() * 256, Math.random() * 256, 8 + Math.random() * 20, 0.6);
  }
  ctx.strokeStyle = 'rgba(150,120,80,0.25)'; ctx.lineWidth = 1;   // pale scratches
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, len = 12 + Math.random() * 40, a = Math.random() * Math.PI;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

// Scratched, faintly rusted painted metal for legs / frames / trash can.
function metalTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#26262b'; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {                                   // brushed streaks
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? 60 : 12},${Math.random() < 0.5 ? 60 : 12},${Math.random() < 0.5 ? 66 : 14},0.4)`;
    ctx.lineWidth = 0.6; ctx.beginPath(); const y = Math.random() * 128;
    ctx.moveTo(0, y); ctx.lineTo(128, y + (Math.random() - 0.5) * 4); ctx.stroke();
  }
  for (let i = 0; i < 10; i++) {                                   // rust spots
    ctx.fillStyle = `rgba(${110 + Math.random() * 50},${50 + Math.random() * 30},20,${0.2 + Math.random() * 0.3})`;
    _blob(ctx, Math.random() * 128, Math.random() * 128, 3 + Math.random() * 8, 0.7);
  }
  return new THREE.CanvasTexture(cv);
}

// Cloth weave for dropped bags — tinted per-bag via the material's colour.
function fabricTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1;
  for (let i = 0; i < 64; i += 3) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(64, i); ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {                                   // grime + wear
    ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.15})`;
    ctx.beginPath(); ctx.arc(Math.random() * 64, Math.random() * 64, Math.random() * 4, 0, 7); ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return t;
}

// A painted classroom globe: pale ocean with irregular green/tan landmasses and
// faint lat/long lines.
function globeTex() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#3b6f92'; ctx.fillRect(0, 0, 256, 128);          // ocean
  const land = ['#6a8a3a', '#7d9445', '#9a8a54'];
  for (let i = 0; i < 7; i++) {                                    // continents
    ctx.fillStyle = land[i % land.length];
    const cx = Math.random() * 256, cy = 20 + Math.random() * 88;
    for (let j = 0; j < 4; j++) _blob(ctx, cx + (Math.random() - 0.5) * 40, cy + (Math.random() - 0.5) * 30, 10 + Math.random() * 22, 0.7);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.7;  // graticule
  for (let x = 0; x <= 256; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
  for (let y = 0; y <= 128; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// A collectible question note — deliberately made to look like just another
// scrap of the grey floor debris (same tone + grime as paperMat), so it doesn't
// stand out. Only very faint ruled lines / scribbles betray it on a close look;
// the [E] Examine prompt is what actually singles it out.
function noteTex() {
  const cv = document.createElement('canvas'); cv.width = 180; cv.height = 230;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#a89f88'; ctx.fillRect(0, 0, 180, 230);          // worn off-white paper (a touch lighter than the grey debris)
  for (let i = 0; i < 260; i++) {                                    // grunge speckle (like grungeTex)
    const g = 120 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgba(${g},${g},${g-8},0.45)`;
    ctx.fillRect(Math.random()*180, Math.random()*230, Math.random()*4+1, Math.random()*3+1);
  }
  const grad = ctx.createRadialGradient(90, 115, 30, 90, 115, 150);  // slight edge grime
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(20,18,12,0.45)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 180, 230);
  ctx.strokeStyle = 'rgba(40,42,52,0.22)'; ctx.lineWidth = 1;        // very faint ruled lines
  for (let y = 40; y < 214; y += 22) { ctx.beginPath(); ctx.moveTo(16, y); ctx.lineTo(164, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(30,30,36,0.3)'; ctx.lineWidth = 1.6;       // faint handwriting scribbles
  for (let y = 34; y < 210; y += 22) {
    let x = 22; ctx.beginPath(); ctx.moveTo(x, y - 4);
    const n = 6 + Math.floor(Math.random() * 8);
    for (let k = 0; k < n; k++) { x += 6 + Math.random() * 10; ctx.lineTo(x, y - 4 - Math.random() * 6); }
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) {                                     // grime blotches
    ctx.fillStyle = `rgba(20,18,10,${0.12 + Math.random() * 0.2})`;
    _blob(ctx, Math.random() * 180, Math.random() * 230, 6 + Math.random() * 16, 0.6);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MATERIALS
// ═══════════════════════════════════════════════════════════════════════════════
const wallMat      = new THREE.MeshLambertMaterial({ map: grungeTex('#3c3c3c'), emissive: 0x050608, emissiveIntensity: 0.22, side: THREE.DoubleSide });
const doorPanelMat = new THREE.MeshLambertMaterial({ map: doorTex(), emissive: 0x080502, emissiveIntensity: 0.3 });
const doorTrimMat  = new THREE.MeshLambertMaterial({ map: grungeTex('#1f1206'), emissive: 0x050301, emissiveIntensity: 0.28 });
const floorMat     = new THREE.MeshLambertMaterial({ map: floorTex(), emissive: 0x070707, emissiveIntensity: 0.28 });
const ceilMat      = new THREE.MeshLambertMaterial({ map: ceilTex(), emissive: 0x14140f, emissiveIntensity: 0.5 });
const lockerMat    = new THREE.MeshLambertMaterial({ map: lockerTex(), emissive: 0x020602, emissiveIntensity: 0.18 });
// Wood furniture + metal legs are now textured + light-responsive (Lambert) so
// the flashlight reveals grain and form instead of a flat colour cutout. One
// shared wood texture and one metal texture cover every desk/chair/shelf/leg.
const _woodTex = woodTex(), _metalTex = metalTex();
const deskMat      = new THREE.MeshLambertMaterial({ map: _woodTex,  emissive: 0x0b0805, emissiveIntensity: 0.32 });
const darkMat      = new THREE.MeshLambertMaterial({ map: _metalTex, emissive: 0x050506, emissiveIntensity: 0.25 });
const doorFrameMat = new THREE.MeshLambertMaterial({ map: grungeTex('#1c1208'), emissive: 0x050301, emissiveIntensity: 0.26 });
const candleMat    = new THREE.MeshBasicMaterial({ color: 0xddeedd });
const exitSignMat  = new THREE.MeshBasicMaterial({ color: 0xff2200 });
const paperMat     = new THREE.MeshLambertMaterial({ map: grungeTex('#6e6a5e'), emissive: 0x0a0a08, emissiveIntensity: 0.3 });
const bookMats     = [0x6b1a1a, 0x1a3a5b, 0x1a5b2a, 0x5b4a1a, 0x3a1a5b]
  .map(c => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.12 }));
// Wall decor + extra clutter (posters are double-sided so orientation is forgiving)
const posterMats   = ['chart', 'dice', 'num'].map(k => new THREE.MeshBasicMaterial({ map: posterTex(k), side: THREE.DoubleSide }));
const clockMat     = new THREE.MeshBasicMaterial({ map: clockTex(), transparent: true, side: THREE.DoubleSide });
const mapMat       = new THREE.MeshBasicMaterial({ map: mapTex(), side: THREE.DoubleSide });
const _fabricTex   = fabricTex();
const globeMat     = new THREE.MeshLambertMaterial({ map: globeTex(), emissive: 0x0a0f14, emissiveIntensity: 0.3 });
const mugMat       = new THREE.MeshLambertMaterial({ color: 0xcfd6cf, emissive: 0x0c0e0c, emissiveIntensity: 0.3 });
const pageMat      = new THREE.MeshLambertMaterial({ color: 0xd8cfb0, emissive: 0x0e0d0a, emissiveIntensity: 0.3 });  // book page block
// Collectible question note — lit aged paper with only a faint self-glow, so the
// flashlight reveals it instead of it beaconing across a dark room.
const noteMat      = new THREE.MeshLambertMaterial({ map: noteTex(), emissive: 0x1a160e, emissiveIntensity: 0.44, side: THREE.DoubleSide });
const trashMat     = new THREE.MeshLambertMaterial({ map: _metalTex, color: 0x8890a0, emissive: 0x060708, emissiveIntensity: 0.28 });
const bagMats      = [0x7a2a2a, 0x243a6a, 0x35521f].map(c =>
  new THREE.MeshLambertMaterial({ map: _fabricTex, color: c, emissive: c, emissiveIntensity: 0.1 }));
const handleMat    = new THREE.MeshLambertMaterial({ color: 0x6a5a38, emissive: 0x161206, emissiveIntensity: 0.4 });  // tarnished pull
// Classroom-only abandoned surfaces + blood decals (corridors keep the plainer look)
const roomWallMat  = new THREE.MeshLambertMaterial({ map: roomWallTex(), emissive: 0x060505, emissiveIntensity: 0.2, side: THREE.DoubleSide });
const roomFloorMat = new THREE.MeshLambertMaterial({ map: roomFloorTex(), emissive: 0x060606, emissiveIntensity: 0.24 });
// Blood decals — transparent PNGs from public/assets/blood1. Textures load async;
// each decal appears once its image arrives. Aspect kept per-image so the
// handprint / smears aren't stretched.
const _texLoader = new THREE.TextureLoader();
// Dried-blood tint multiplied over the (vivid) source art. Set to 0xffffff for
// no tint (original bright red).
const BLOOD_TINT = 0x7a2a2a;
const bloodMats = [
  { f: 'blood-png-1.png',                                  aspect: 1024/751, scale: 1    },
  { f: 'blood-spatter-png-clipart-11.png',                 aspect: 320/264,  scale: 1    },
  { f: 'bloody-handprint-1-619x1024.png',                  aspect: 619/1024, scale: 0.16 },  // hand-sized
  { f: 'd319exp-3d46b91c-0ada-4965-9709-e84a194c9fe4.png', aspect: 573/288,  scale: 0.9  },
  { f: 'isolated-blood-splatter.png',                      aspect: 1,        scale: 0.9  },
].map(b => {
  const tex = _texLoader.load(`/assets/blood1/${b.f}`);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { mat: new THREE.MeshBasicMaterial({ map: tex, color: BLOOD_TINT, transparent: true, depthWrite: false, side: THREE.DoubleSide }), aspect: b.aspect, scale: b.scale };
});
// One blood decal plane. rx=-π/2 lays it flat on a floor (ry = spin); rx=0 hangs
// it on a wall (ry = face-into-room yaw). w = base width; per-image scale + aspect applied.
function bloodDecal(scene, x, y, z, rx, ry, w) {
  const b = bloodMats[Math.floor(Math.random() * bloodMats.length)];
  const s = w * b.scale;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s / b.aspect), b.mat);
  m.position.set(x, y, z);
  m.rotation.order = 'YXZ';
  m.rotation.set(rx, ry, 0);
  scene.add(m);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GEOMETRY BATCH SYSTEM — merge all static geometry by material
// ═══════════════════════════════════════════════════════════════════════════════
const _batch = new Map();
const _v1 = new THREE.Vector3(1, 1, 1);
// YXZ so a room's frame yaw composes correctly with per-prop pitch (floor/notes)
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat  = new THREE.Quaternion();
const _pos   = new THREE.Vector3();
const _mtx   = new THREE.Matrix4();

const _G = {};
const _bxGeo = (w,h,d) => { const k=`B${w}|${h}|${d}`; return _G[k]??(_G[k]=new THREE.BoxGeometry(w,h,d)); };
const _plGeo = (w,h)   => { const k=`P${w}|${h}`;       return _G[k]??(_G[k]=new THREE.PlaneGeometry(w,h)); };

function _push(geo, mat, x, y, z, rx = 0, ry = 0) {
  _euler.set(rx, ry, 0); _quat.setFromEuler(_euler); _pos.set(x, y, z);
  _mtx.compose(_pos, _quat, _v1);
  const g = geo.clone(); g.applyMatrix4(_mtx);
  if (!_batch.has(mat.uuid)) _batch.set(mat.uuid, { mat, geos: [] });
  _batch.get(mat.uuid).geos.push(g);
}

function _flush(scene) {
  for (const { mat, geos } of _batch.values()) {
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (merged) scene.add(new THREE.Mesh(merged, mat));
    if (geos.length > 1) geos.forEach(g => g.dispose());
  }
  _batch.clear();
}

const bx  = (w,h,d,x,y,z,mat)        => _push(_bxGeo(w,h,d), mat, x, y, z);
const bxr = (w,h,d,x,y,z,rx,ry,mat)  => _push(_bxGeo(w,h,d), mat, x, y, z, rx, ry);
const pl  = (w,h,x,y,z,rx,ry,mat)    => _push(_plGeo(w,h),   mat, x, y, z, rx, ry);

// Floor plane with size-proportional UVs so tiles stay square on the long
// corridor instead of stretching. ~3 world units per texture image, matching
// the room floors' density (which use the default 0..1 UV × repeat(4,4)).
const _floorTiled = (w, h, x, y, z, rx, ry, mat) => {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 12, uv.getY(i) * h / 12);
  _push(g, mat, x, y, z, rx, ry);
};

// Wall plane whose UVs repeat the abandoned wall texture at a fixed density
// (one 12-wide × 3.6-tall panel per copy) so long corridor walls tile cleanly
// instead of stretching one image the whole length. Same signature as pl().
const _wallTiled = (w, h, x, y, z, rx, ry, mat) => {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 12, uv.getY(i) * h / 3.6);
  _push(g, mat, x, y, z, rx, ry);
};

// ═══════════════════════════════════════════════════════════════════════════════
//  CORRIDORS — two legs + corner, walls segmented around door openings
// ═══════════════════════════════════════════════════════════════════════════════
const _collision = [];
// Collision boxes now carry a `top` (obstacle top height) so the player can
// step/jump over low things and only tall things block. Walls default to a big
// top (always block); furniture passes its real height via extra.top.
const WALL_TOP = 5;
const _addBox = (minX, maxX, minZ, maxZ, extra) =>
  _collision.push({ minX, maxX, minZ, maxZ, top: WALL_TOP, ...extra });

// ── Furniture (world-space) — upright and toppled-on-side desks/chairs, shared
// by classrooms and corridors. (x,z) = position, yaw = spin about vertical.
const _wrot = (dx, dz, a) => [dx*Math.cos(a) + dz*Math.sin(a), -dx*Math.sin(a) + dz*Math.cos(a)];
function deskUprightW(x, z, yaw) {
  bxr(0.66, 0.06, 0.9, x, 0.7, z, 0, yaw, deskMat);                       // top
  bxr(0.58, 0.03, 0.72, x, 0.5, z, 0, yaw, deskMat);                      // under-desk book cubby shelf
  [[-0.25,-0.37],[0.25,-0.37],[-0.25,0.37],[0.25,0.37]].forEach(([lx,lz]) => {
    const [ox,oz] = _wrot(lx, lz, yaw); bxr(0.05, 0.68, 0.05, x+ox, 0.34, z+oz, 0, yaw, darkMat);
  });
  _addBox(x-0.5, x+0.5, z-0.55, z+0.55, { top: 0.73 });
}
function deskTippedW(x, z, yaw) {                                          // knocked onto its side
  bxr(0.9, 0.66, 0.06, x, 0.33, z, 0, yaw, deskMat);                      // desktop standing on its long edge
  [[-0.4,0.13],[0.4,0.13],[-0.4,0.55],[0.4,0.55]].forEach(([dx,dy]) => {
    const [ox,oz] = _wrot(dx, 0.33, yaw); bxr(0.05, 0.05, 0.62, x+ox, dy, z+oz, 0, yaw, darkMat);   // legs jutting out
  });
  _addBox(x-0.55, x+0.55, z-0.55, z+0.55, { top: 0.63 });
}
function chairUprightW(x, z, yaw) {
  bxr(0.5, 0.05, 0.5, x, 0.46, z, 0, yaw, deskMat);                       // seat
  [[-0.2,-0.2],[0.2,-0.2],[-0.2,0.2],[0.2,0.2]].forEach(([lx,lz]) => {
    const [ox,oz] = _wrot(lx, lz, yaw); bxr(0.05, 0.46, 0.05, x+ox, 0.23, z+oz, 0, yaw, darkMat);
  });
  const [bx1,bz1] = _wrot(0, -0.22, yaw); bxr(0.48, 0.5, 0.05, x+bx1, 0.7, z+bz1, 0, yaw, deskMat);  // backrest
  _addBox(x-0.3, x+0.3, z-0.3, z+0.3, { top: 0.5 });
}
function chairTippedW(x, z, yaw) {                                         // knocked over
  bxr(0.5, 0.5, 0.05, x, 0.24, z, 0, yaw, deskMat);                       // seat on edge
  const [bx1,bz1] = _wrot(0, 0.26, yaw); bxr(0.5, 0.05, 0.5, x+bx1, 0.46, z+bz1, 0, yaw, deskMat);   // backrest fallen flat
  [[-0.2],[0.2]].forEach(([dx]) => {
    const [ox,oz] = _wrot(dx, -0.22, yaw); bxr(0.05, 0.05, 0.42, x+ox, 0.1, z+oz, 0, yaw, darkMat);  // legs out
  });
  _addBox(x-0.35, x+0.35, z-0.35, z+0.35, { top: 0.5 });
}

// A corridor wall with door gaps. runAxis 'z': plane x=at spanning z from..to.
// runAxis 'x': plane z=at spanning x from..to. Also emits collision boxes.
function segmentedWall(runAxis, at, from, to, gaps, ry, collide = true) {
  const T = 0.3;
  const seg = (a, b) => {
    if (b - a < 0.01) return;
    const len = b - a, mid = (a + b) / 2;
    if (runAxis === 'z') {
      _wallTiled(len, hallH, at, hallH/2, mid, 0, ry, roomWallMat);
      if (collide) _addBox(at < 0 ? at - T : at, at < 0 ? at : at + T, a, b);
    } else {
      _wallTiled(len, hallH, mid, hallH/2, at, 0, ry, roomWallMat);
      if (collide) _addBox(a, b, at < leg2Z0 + 0.1 ? at - T : at, at < leg2Z0 + 0.1 ? at : at + T);
    }
  };
  let p = from;
  [...gaps].sort((a, b) => a.a0 - b.a0).forEach(g => {
    seg(p, g.a0);
    const topH = hallH - g.h;
    if (topH > 0.05) {
      const mid = (g.a0 + g.a1) / 2, len = g.a1 - g.a0;
      if (runAxis === 'z') _wallTiled(len, topH, at, hallH - topH/2, mid, 0, ry, roomWallMat);
      else                 _wallTiled(len, topH, mid, hallH - topH/2, at, 0, ry, roomWallMat);
    }
    p = g.a1;
  });
  seg(p, to);
}

function doorGapsFor(orient) {
  const all = [
    ...classrooms.filter(c => c.orient === orient).map(c => ({ a0: c.door[0], a1: c.door[1], h: doorH })),
    ...vacants.filter(v => v.orient === orient).map(v => ({ a0: v.door[0], a1: v.door[1], h: VACANT_DOOR_H })),
  ];
  return all;
}

function buildCorridors(scene) {
  // Floors + ceilings (leg 1 owns the corner square)
  _floorTiled(hallW, leg1Len, 0, 0, leg1Len/2, -Math.PI/2, 0, roomFloorMat);
  pl(hallW, leg1Len, 0, hallH, leg1Len/2, Math.PI/2, 0, ceilMat);
  const leg2Len = leg2EndX - HALF_W;
  _floorTiled(leg2Len, hallW, HALF_W + leg2Len/2, 0, (leg2Z0+leg2Z1)/2, -Math.PI/2, 0, roomFloorMat);
  pl(leg2Len, hallW, HALF_W + leg2Len/2, hallH, (leg2Z0+leg2Z1)/2, Math.PI/2, 0, ceilMat);

  // Walls (visual + collision), segmented around the door openings
  segmentedWall('z', -HALF_W, 0, leg1Len, doorGapsFor('W'),  Math.PI/2);          // leg1 west
  segmentedWall('z',  HALF_W, 0, leg2Z0,  doorGapsFor('E'), -Math.PI/2);          // leg1 east (open past corner)
  segmentedWall('x',  leg2Z1, -HALF_W, leg2EndX, doorGapsFor('N'), Math.PI);      // north wall (leg1 end + leg2)
  segmentedWall('x',  leg2Z0,  HALF_W, leg2EndX, doorGapsFor('S'), 0);            // leg2 south
  _wallTiled(hallW, hallH, 0, hallH/2, 0, 0, 0, roomWallMat);                     // spawn back wall
  _addBox(-HALF_W, HALF_W, -0.3, 0);

  // Lockers — leg1 west wall + leg2 south wall, gaps at doorways.
  // Box depth goes INTO the wall so the wide textured door faces the corridor.
  const lW = 0.9, lH = 2.5, lD = 0.35, lGap = 0.04;   // lGap keeps the locker
  const wGaps = doorGapsFor('W'), sGaps = doorGapsFor('S');   // back off the wall
  for (let z = 0.5; z < leg1Len - 1; z += lW + 0.05) {
    if (wGaps.some(g => z + lW > g.a0 - 0.15 && z < g.a1 + 0.15)) continue;
    bxr(lD, lH, lW, -HALF_W + lGap + lD/2, lH/2, z + lW/2, 0, 0, lockerMat);
  }
  for (let x = HALF_W + 1; x < leg2EndX - 1; x += lW + 0.05) {
    if (sGaps.some(g => x + lW > g.a0 - 0.15 && x < g.a1 + 0.15)) continue;
    bxr(lD, lH, lW, x + lW/2, lH/2, leg2Z0 + lGap + lD/2, 0, Math.PI/2, lockerMat);
  }
  // Locker protrusion collision strips
  let p = 0;
  wGaps.sort((a,b)=>a.a0-b.a0).forEach(g => { _addBox(-HALF_W-0.3, -HALF_W+0.5, p, g.a0-0.15); p = g.a1+0.15; });
  _addBox(-HALF_W-0.3, -HALF_W+0.5, p, leg1Len);
  p = HALF_W;
  sGaps.sort((a,b)=>a.a0-b.a0).forEach(g => { _addBox(p, g.a0-0.15, leg2Z0-0.3, leg2Z0+0.5); p = g.a1+0.15; });
  _addBox(p, leg2EndX, leg2Z0-0.3, leg2Z0+0.5);

  // Litter — a few loose papers drifted across the corridor floors. Random flat
  // rotations, tiny y-stagger so overlapping sheets don't z-fight. Kept clear of
  // the locker strips so nothing pokes through a wall.
  const paper = (x, z, i) =>
    pl(0.24, 0.32, x, 0.012 + i * 0.002, z, -Math.PI/2, Math.random() * Math.PI, paperMat);
  for (let i = 0; i < 11; i++) paper((Math.random() - 0.5) * 4.4, 1.5 + Math.random() * (leg1Len - 3), i);
  for (let i = 0; i < 7; i++)  paper(HALF_W + 1.5 + Math.random() * (leg2EndX - HALF_W - 3), leg2Z0 + 0.7 + Math.random() * (hallW - 1.6), i);

  // Furniture dragged out into the halls — mostly knocked over. Kept between the
  // doorways and off the locker strips so the corridor stays passable.
  deskTippedW(1.4, 13.5,  0.5);   chairTippedW(2.1, 14.6, -0.7);   // leg1, between rooms 1 & 2
  deskUprightW(-1.2, 30.0, 0.3);  chairTippedW(-0.3, 31.0, 0.9);   // leg1, mid
  chairTippedW(1.0, 43.5,  1.2);  deskTippedW(-1.4, 44.2, -0.4);   // leg1, near the corner
  deskTippedW(11.0, 50.2, -0.4);  chairTippedW(12.2, 49.2, 0.6);   // leg2
  deskUprightW(28.0, 50.3, 0.2);  chairTippedW(40.0, 49.6, -1.0);  // leg2, toward the exit

  // Blood decals across the corridor floors + a few smears on the east wall.
  for (let i = 0; i < 7; i++)
    bloodDecal(scene, (Math.random()-0.5)*4.6, 0.02, 2 + Math.random()*(leg1Len-4), -Math.PI/2, Math.random()*Math.PI*2, 1.4 + Math.random()*1.9);
  for (let i = 0; i < 5; i++)
    bloodDecal(scene, HALF_W + 2 + Math.random()*(leg2EndX-HALF_W-4), 0.02, leg2Z0 + 0.9 + Math.random()*(hallW-1.9), -Math.PI/2, Math.random()*Math.PI*2, 1.4 + Math.random()*1.7);
  [14, 28, 44].forEach(z => { if (Math.random() < 0.7)   // east wall (x=HALF_W), between doorways, facing −x
    bloodDecal(scene, HALF_W - 0.05, 1.4 + (Math.random()-0.5)*0.6, z, 0, -Math.PI/2, 1.8 + Math.random()*1.0); });

  // ── SCRAWLS — clawed onto solid corridor walls only. Every spot is raycast-
  // validated (all 4 corners backed by wall, nothing behind to split them).
  // Sparse by design, with fixed narrative beats: a warning at spawn, and a
  // hopeless one right at the exit. The middle two are random each run.
  scrawlDecal(scene, 0, 1.7, 0.06, 0, 2.5, ['GET OUT'], 0.6);                       // turn from spawn → it's watching
  scrawlDecal(scene, HALF_W - 0.05, 1.7, 14, -Math.PI/2, 2.4, randScrawl(), 0.55);  // leg1 east
  scrawlDecal(scene, HALF_W - 0.05, 1.7, 31, -Math.PI/2, 2.4, randScrawl(), 0.55);  // leg1 east
  scrawlDecal(scene, 30, 1.7, leg2Z1 - 0.05, Math.PI, 2.4, randScrawl(), 0.55);     // leg2 north
  scrawlDecal(scene, 41, 1.7, leg2Z1 - 0.05, Math.PI, 2.4, ['NO WAY OUT'], 0.6);    // at the exit — no relief
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLASSROOMS — real levels AND decoys share this builder. Decoys get a lying
//  chalkboard label, desks turned to face the back wall, a faint scrawl, and
//  no notes. Everything is built in the room's local frame.
// ═══════════════════════════════════════════════════════════════════════════════
function buildClassroom(scene, def, interactiveObjects, containers) {
  const { f, W, P, dLoc, rect, BX, PL } = frameHelpers(def);
  const D = roomW, rH = roomH;
  const isDecoy = def.idx === null;

  // Classrooms use the more abandoned wall/floor textures (corridors stay plainer).
  PL(D, W, D/2, 0,  W/2, -Math.PI/2, 0, roomFloorMat);
  PL(D, W, D/2, rH, W/2,  Math.PI/2, 0, ceilMat);
  PL(W, rH, D, rH/2, W/2, 0, -Math.PI/2, roomWallMat);   // far wall
  PL(D, rH, D/2, rH/2, 0, 0, 0,        roomWallMat);     // v=0 side wall
  PL(D, rH, D/2, rH/2, W, 0, Math.PI,  roomWallMat);     // v=W side wall

  // The door-side wall (u=0) is the SAME plane as the corridor wall, which
  // already has the doorway gap — so we don't rebuild it here. Doing so made two
  // coincident planes that z-fought. Only dCv is needed, for the door-frame trim.
  const dCv = (dLoc[0] + dLoc[1]) / 2;

  // Door frame: jambs through the wall + a header SPANNING the opening
  // (the old header was a beam poking into the room), plus a threshold strip.
  const fT = 0.14;
  BX(0.34, doorH + 0.04, fT, 0, (doorH + 0.04)/2, dLoc[0] - fT/2, doorTrimMat);
  BX(0.34, doorH + 0.04, fT, 0, (doorH + 0.04)/2, dLoc[1] + fT/2, doorTrimMat);
  BX(0.34, 0.2, doorW + 2*fT, 0, doorH + 0.12, dCv, doorTrimMat);
  BX(0.36, 0.03, doorW, 0, 0.015, dCv, doorTrimMat);

  // Room shell collision (side + far walls; door wall handled by corridor)
  const r1 = rect(0, D + 0.3, -0.3, 0);   _addBox(r1.minX, r1.maxX, r1.minZ, r1.maxZ);
  const r2 = rect(0, D + 0.3, W, W + 0.3); _addBox(r2.minX, r2.maxX, r2.minZ, r2.maxZ);
  const r3 = rect(D, D + 0.3, 0, W);       _addBox(r3.minX, r3.maxX, r3.minZ, r3.maxZ);

  // Chalkboard — blank in every classroom (owner request 2026-07-19): no room
  // labels means real rooms and decoys are indistinguishable at a glance.
  const cbW = 4.5, cbH = 2.0;
  const cbPos = P(D - 0.12, W/2);
  const cbMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(cbW, cbH),
    new THREE.MeshBasicMaterial({ map: chalkboardTex([]) })
  );
  cbMesh.position.set(cbPos.x, cbH/2 + 0.9, cbPos.z);
  cbMesh.rotation.order = 'YXZ';
  cbMesh.rotation.set(0, -Math.PI/2 + f.theta, 0);
  scene.add(cbMesh);
  BX(0.06, cbH + 0.12, cbW + 0.12, D - 0.06, cbH/2 + 0.9, W/2, doorFrameMat);

  // Chalk tray under the board
  BX(0.12, 0.05, 3.2, D - 0.14, 0.84, W/2, doorFrameMat);

  // ── RANSACKED CLUTTER (real + decoy) ───────────────────────────────────────
  // The room's been torn apart: desks flipped, chairs tossed, a shelf toppled,
  // debris everywhere. Real and decoy rooms share the mess so you must actually
  // search each one to find (or not find) the notes.
  // Local (u,v) offset rotated to match BX's Y-rotation, so legs land exactly
  // under the rotated top's corners (Three.js Y-rotation: x'=x·c+z·s, z'=−x·s+z·c).
  const rot = (du, dv, yaw) => [du*Math.cos(yaw) + dv*Math.sin(yaw), -du*Math.sin(yaw) + dv*Math.cos(yaw)];

  // Build a 4-legged piece (desk or chair): a top slab + a leg at each corner,
  // legs aligned to the slab under any yaw. hu/hv are the top's half-extents.
  const legged = (u, v, yaw, hu, hv, topY, topH, legH, mat) => {
    BX(hu*2, topH, hv*2, u, topY, v, mat, 0, yaw);
    [[-hu+0.08, -hv+0.08], [hu-0.08, -hv+0.08], [-hu+0.08, hv-0.08], [hu-0.08, hv-0.08]]
      .forEach(([lu, lv]) => {
        const [ou, ov] = rot(lu, lv, yaw);
        BX(0.05, legH, 0.05, u + ou, legH/2, v + ov, darkMat, 0, yaw);
      });
  };

  // Student desk — upright but shoved to a random angle.
  const deskAt = (u, v, yaw) => {
    legged(u, v, yaw, 0.33, 0.45, 0.7, 0.06, 0.68, deskMat);
    BX(0.58, 0.03, 0.72, u, 0.5, v, deskMat, 0, yaw);   // under-desk book cubby shelf
    const r = rect(u - 0.5, u + 0.5, v - 0.55, v + 0.55); _addBox(r.minX, r.maxX, r.minZ, r.maxZ, { top: 0.73 });
  };

  // A proper chair: seat + 4 legs + backrest, tossed to a random angle.
  const chairAt = (u, v, yaw) => {
    legged(u, v, yaw, 0.24, 0.24, 0.46, 0.05, 0.44, deskMat);
    const [bu, bv] = rot(0, -0.22, yaw);                        // backrest along the rear edge
    BX(0.48, 0.5, 0.05, u + bu, 0.72, v + bv, deskMat, 0, yaw);
    const r = rect(u - 0.3, u + 0.3, v - 0.3, v + 0.3); _addBox(r.minX, r.maxX, r.minZ, r.maxZ, { top: 0.5 });
  };

  // A tipped crate / storage box.
  const crateAt = (u, v, s, yaw) => {
    BX(s, s * 0.8, s, u, s * 0.4, v, deskMat, 0, yaw);
    const r = rect(u - s/2, u + s/2, v - s/2, v + s/2); _addBox(r.minX, r.maxX, r.minZ, r.maxZ, { top: s * 0.8 });
  };

  // A book: coloured cover boards with a cream page block peeking out along the
  // fore-edges, so it reads as a closed book instead of a solid chip.
  const book = (u, y, v, yaw, mat, w = 0.24, h = 0.06, d = 0.18) => {
    BX(w, h, d, u, y, v, mat, 0, yaw);                                 // cover
    BX(w + 0.012, h * 0.62, d + 0.012, u, y, v, pageMat, 0, yaw);      // pages peeking on the sides
  };

  // Teacher's desk, shoved askew under the board
  const tdu = D - 1.9, tdv = W/2 + 0.5, tdYaw = 0.24;
  BX(0.95, 0.08, 1.85, tdu, 0.78, tdv, deskMat, 0, tdYaw);
  [[-0.35, -0.85], [-0.35, 0.85], [0.35, -0.85], [0.35, 0.85]].forEach(([lu, lv]) => {
    const [ou, ov] = rot(lu, lv, tdYaw);
    BX(0.06, 0.72, 0.06, tdu + ou, 0.39, tdv + ov, deskMat, 0, tdYaw);
  });
  const tdr = rect(tdu - 0.7, tdu + 0.7, tdv - 1.0, tdv + 1.0);
  _addBox(tdr.minX, tdr.maxX, tdr.minZ, tdr.maxZ, { top: 0.82 });
  BX(0.06, 0.18, 0.06, tdu - 0.3, 0.91, tdv - 0.7, candleMat);   // candle survives on it

  // Toppled variants (world-space helpers) placed in the room's local frame.
  const tipDesk  = (u, v, yw) => { const p = P(u, v); deskTippedW(p.x, p.z, yw + f.theta); };
  const tipChair = (u, v, yw) => { const p = P(u, v); chairTippedW(p.x, p.z, yw + f.theta); };

  // ── PER-ROOM SCATTER ────────────────────────────────────────────────────────
  // Desks/chairs/crates AND the small clutter (bags/books/trash) are scattered
  // at random each build, so every room (real AND decoy) is a different wreck.
  // An occupancy list keeps every piece from overlapping any other piece — each
  // reserves a radius and new pieces retry until they find a clear spot (or are
  // skipped). Positions stay clear of the door, board and wall units; collision
  // is added per-piece so moving them can't break anything.
  const ryaw = () => (Math.random() - 0.5) * 2.6;
  const IU0 = 1.7, IU1 = D - 3.0, IV0 = 1.5, IV1 = W - 1.5;   // interior clutter range
  const placed = [{ u: tdu, v: tdv, r: 1.1 }];               // teacher desk reserved
  const tryPlace = (r, u0 = IU0, u1 = IU1, v0 = IV0, v1 = IV1, tries = 40) => {
    for (let t = 0; t < tries; t++) {
      const u = u0 + Math.random() * (u1 - u0), v = v0 + Math.random() * (v1 - v0);
      if (placed.every(o => Math.hypot(o.u - u, o.v - v) >= o.r + r)) { placed.push({ u, v, r }); return [u, v]; }
    }
    return null;
  };

  const nDesks = 4 + Math.floor(Math.random() * 4);         // 4–7
  for (let k = 0; k < nDesks; k++)  { const s = tryPlace(0.72); if (s) (Math.random() < 0.4  ? tipDesk  : deskAt)(s[0], s[1], ryaw()); }
  const nChairs = 3 + Math.floor(Math.random() * 4);        // 3–6
  for (let k = 0; k < nChairs; k++) { const s = tryPlace(0.45); if (s) (Math.random() < 0.45 ? tipChair : chairAt)(s[0], s[1], ryaw()); }
  const nCrates = 1 + Math.floor(Math.random() * 3);        // 1–3
  for (let k = 0; k < nCrates; k++) { const s = tryPlace(0.45); if (s) crateAt(s[0], s[1], 0.45 + Math.random() * 0.22, ryaw()); }

  // Toppled bookshelf lying on its side at a random clear interior spot, books spilled
  const shSpot = tryPlace(1.3, 2.6, D - 2.6, 2.2, W - 2.2);
  if (shSpot) {
    const shu = shSpot[0], shv = shSpot[1], shYaw = ryaw();
    BX(1.5, 0.3, 2.4, shu, 0.15, shv, deskMat, 0, shYaw);
    [-0.75, -0.25, 0.25, 0.75].forEach(du => { const [ou, ov] = rot(du, 0, shYaw); BX(0.04, 0.28, 2.3, shu + ou, 0.15, shv + ov, darkMat, 0, shYaw); });
    bookMats.forEach((bm) => {
      const [ou, ov] = rot((Math.random() - 0.5) * 2, -1.4 - Math.random() * 1.0, shYaw);
      book(shu + ou, 0.05, shv + ov, Math.random() * Math.PI, bm, 0.22, 0.07, 0.16);
    });
    const shr = rect(shu - 1.3, shu + 1.3, shv - 1.3, shv + 1.3);
    _addBox(shr.minX, shr.maxX, shr.minZ, shr.maxZ, { top: 0.32 });
  }

  // Scattered floor debris (grey paper, non-interactive — distinct from the
  // glowing yellow note papers the player collects)
  for (let i = 0; i < 12; i++)
    PL(0.26, 0.34, 1 + Math.random()*(D-2), 0.02 + i*0.001, 1 + Math.random()*(W-2),
      -Math.PI/2, Math.random()*Math.PI, paperMat);

  // ── WALL DECOR — posters, a cracked clock, a pull-down map ──────────────────
  // faceRy values orient a plane to face into the room off each wall (works in
  // any frame once f.theta is added): far wall −π/2, v=0 wall 0, v=W wall π.
  const wallDecor = (mat, u, y, v, w, h, faceRy, tilt = 0) => {
    const p = P(u, v);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(p.x, y, p.z);
    m.rotation.order = 'YXZ';
    m.rotation.set(tilt, faceRy + f.theta, 0);
    scene.add(m);
  };
  const FAR = -Math.PI/2, SIDE0 = 0, SIDEW = Math.PI;
  // Wall decor varies per room: a shuffled subset of posters + a clock, dropped
  // onto random slots along the two side walls, so no two rooms hang the same.
  const decorSlots = [
    [2.0, 0.05, SIDE0], [3.6, 0.05, SIDE0], [5.4, 0.05, SIDE0],
    [3.0, W - 0.05, SIDEW], [5.2, W - 0.05, SIDEW], [7.4, W - 0.05, SIDEW],
  ];
  for (let i = decorSlots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [decorSlots[i], decorSlots[j]] = [decorSlots[j], decorSlots[i]]; }
  const posters = posterMats.slice();
  for (let i = posters.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [posters[i], posters[j]] = [posters[j], posters[i]]; }
  const nPosters = 2 + Math.floor(Math.random() * 2);   // 2–3 posters this room
  let slot = 0;
  for (let i = 0; i < nPosters; i++, slot++) {
    const [u, v, face] = decorSlots[slot];
    wallDecor(posters[i % posters.length], u, 1.85 + Math.random() * 0.18, v, 0.9, 1.2, face, (Math.random() - 0.5) * 0.18);
  }
  const [cu, cv, cface] = decorSlots[slot];             // clock on the next free slot
  wallDecor(clockMat, cu, 2.4 + Math.random() * 0.3, cv, 0.55, 0.55, cface, (Math.random() - 0.5) * 0.3);
  if (Math.random() < 0.8) wallDecor(mapMat, D - 0.05, 1.75, W - 2.4, 1.7, 1.15, FAR, 0);   // pull-down map by the board

  // ── BLOOD — decals on the floor and a smear/handprint on a wall. Randomized
  // per room so only some rooms/parts are marked.
  const nFloorBlood = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < nFloorBlood; i++) {
    const q = P(1.8 + Math.random()*(D-3.6), 1.8 + Math.random()*(W-3.6));
    bloodDecal(scene, q.x, 0.02, q.z, -Math.PI/2, Math.random()*Math.PI*2, 1.5 + Math.random()*1.6);
  }
  if (Math.random() < 0.8) {                                                 // v=0 wall, faces into room
    const q = P(2 + Math.random()*(D-4), 0.06);
    bloodDecal(scene, q.x, 1.35, q.z, 0, SIDE0 + f.theta, 1.5 + Math.random()*0.8);
  }
  if (Math.random() < 0.5) {                                                 // v=W wall
    const q = P(2 + Math.random()*(D-4), W - 0.06);
    bloodDecal(scene, q.x, 1.35, q.z, 0, SIDEW + f.theta, 1.5 + Math.random()*0.8);
  }

  // ── SMALL CLUTTER — dropped bags, book stacks, a tipped trash can ───────────
  // These are SEARCHABLE: interacting rummages them. A note may be randomized
  // inside (added to notePool below); otherwise the search comes up empty and
  // main.js flashes a "nothing here" message. An invisible Object3D at the item
  // is the interact target; the note (if any) reveals on the floor once searched.
  const searchNoteSpots = [];
  const addSearchable = (u, v, kind) => {
    const p = P(u, v);
    const proxy = new THREE.Object3D();
    proxy.position.set(p.x, 0.35, p.z);
    const rec = { isOpen: false, kind, parts: [], searched: false };
    proxy.userData.isSearch = true;
    proxy.userData.container = rec;
    scene.add(proxy);
    interactiveObjects.push(proxy);
    containers.push(rec);
    searchNoteSpots.push({ u, v, y: 0.04, container: rec });
  };

  // Dropped school backpack: rounded body + a front zip pocket, a top flap, two
  // shoulder straps on the back and a grab handle — not just a coloured box.
  const bagAt = (u, v, yaw, mat) => {
    BX(0.4, 0.42, 0.28, u, 0.21, v, mat, 0, yaw);                      // main body
    const [pu, pv] = rot(0, 0.17, yaw);                               // front zip pocket
    BX(0.32, 0.24, 0.06, u + pu, 0.16, v + pv, mat, 0, yaw);
    const [fu, fv] = rot(0, 0.08, yaw);                              // top flap over the pocket
    BX(0.36, 0.1, 0.16, u + fu, 0.4, v + fv, mat, 0, yaw);
    const [au, av] = rot(-0.1, -0.15, yaw), [bu, bv] = rot(0.1, -0.15, yaw);  // shoulder straps (back)
    BX(0.05, 0.36, 0.03, u + au, 0.23, v + av, darkMat, 0, yaw);
    BX(0.05, 0.36, 0.03, u + bu, 0.23, v + bv, darkMat, 0, yaw);
    BX(0.14, 0.05, 0.05, u, 0.44, v, darkMat, 0, yaw);               // grab handle on top
    addSearchable(u, v, 'bag');
  };
  const nBags = 2 + Math.floor(Math.random() * 2);     // 2–3 backpacks, random colours/clear spots
  for (let k = 0; k < nBags; k++) { const s = tryPlace(0.42); if (s) bagAt(s[0], s[1], (Math.random() - 0.5) * 3, bagMats[k % bagMats.length]); }

  const bookStackAt = (u, v, n) => {
    for (let i = 0; i < n; i++)
      book(u + (Math.random()-0.5)*0.08, 0.03 + i*0.07, v + (Math.random()-0.5)*0.08,
        Math.random()*0.5, bookMats[(i + (u|0)) % bookMats.length]);
  };
  const nStacks = 1 + Math.floor(Math.random() * 3);   // 1–3 book stacks
  for (let k = 0; k < nStacks; k++) { const s = tryPlace(0.3); if (s) bookStackAt(s[0], s[1], 2 + Math.floor(Math.random() * 4)); }

  const tSpot = tryPlace(0.42);                          // tipped trash can, clear spot
  if (tSpot) {
    const tcu = tSpot[0], tcv = tSpot[1];
    const tcp = P(tcu, tcv);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 12), trashMat);
    can.position.set(tcp.x, 0.2, tcp.z);
    can.rotation.set(Math.PI/2, Math.random()*Math.PI, 0);
    scene.add(can);
    for (let i = 0; i < 4; i++)
      PL(0.2, 0.26, tcu + (Math.random()-0.2)*1.1, 0.02 + i*0.001, tcv + (Math.random()-0.5)*1.1,
        -Math.PI/2, Math.random()*Math.PI, paperMat);
    addSearchable(tcu, tcv, 'trash');
  }

  // ── TEACHER-DESK STUFF — knocked-over globe, mug, strewn papers ─────────────
  const gp = P(tdu - 1.3, tdv + 1.1);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), globeMat);
  globe.position.set(gp.x, 0.19, gp.z); scene.add(globe);
  BX(0.05, 0.16, 0.05, tdu - 1.3, 0.08, tdv + 1.1, darkMat);          // snapped-off stand
  BX(0.1, 0.12, 0.1, tdu + 0.2, 0.86, tdv - 0.3, mugMat);            // mug on the desk
  PL(0.28, 0.36, tdu, 0.83, tdv - 0.55, -Math.PI/2, 0.3, paperMat);  // papers strewn on the desk
  PL(0.28, 0.36, tdu + 0.15, 0.83, tdv + 0.2, -Math.PI/2, -0.4, paperMat);

  // Exit sign on the v=W side wall
  BX(0.7, 0.25, 0.05, D - 0.8, rH - 0.2, W - 0.1, exitSignMat);

  // ── OPENABLE CONTAINERS — a rusted supply cabinet against the v=0 wall and a
  // wooden drawer unit against the v=W wall. Built for real AND decoy rooms so
  // opening one is never a tell. A note may be randomized inside (real rooms).
  const cabU = 4.8 + Math.random() * (D - 6.0);         // cabinet somewhere along the v=0 wall
  const cabP = P(cabU, CAB_D / 2);
  const cabRec = buildCabinet(scene, cabP.x, cabP.z, f.theta, interactiveObjects, containers);
  const drwU = 3.0 + Math.random() * (D - 4.5);         // drawer somewhere along the v=W wall
  const drwP = P(drwU, W - DRW_D / 2);
  const drwRec = buildDrawerUnit(scene, drwP.x, drwP.z, f.theta + Math.PI, interactiveObjects, containers);

  if (isDecoy) {
    roomScrawl(scene, { f, P, dLoc, W }, ['IT LIED'], 0.5);   // the tell — read once you're inside
    return null;
  }
  if (Math.random() < 0.55) roomScrawl(scene, { f, P, dLoc, W }, randScrawl(), 0.5);

  // Interactive notes — 5 per room, placed at run time into 5 of these vetted
  // hiding spots (see randomizeNotes). Spread across the whole room + varied
  // heights so the player has to sweep everywhere. {u, v, y}; papers lie flat.
  // Floor spots are valid under any arrangement (worst case a note sits beside a
  // desk — still findable, never floating). Fixed anchors (teacher desk, board
  // base, cabinet, drawer, bags, trash) follow their objects.
  const notePool = [
    { u: 1.1,   v: 1.1,      y: 0.03 },   // near-door corner (left)
    { u: 1.1,   v: W - 1.1,  y: 0.03 },   // near-door corner (right)
    { u: D-1,   v: 1.3,      y: 0.03 },   // far corner (left)
    { u: D-1,   v: W - 1.3,  y: 0.03 },   // far corner (right)
    { u: 6.0,   v: 6.0,      y: 0.03 },   // dead centre
    { u: 3.0,   v: 3.2,      y: 0.03 },
    { u: 4.6,   v: 8.6,      y: 0.03 },
    { u: 7.2,   v: 4.4,      y: 0.03 },
    { u: 2.4,   v: W / 2,    y: 0.03 },
    { u: 6.6,   v: W - 1.8,  y: 0.03 },
    { u: 8.0,   v: 7.6,      y: 0.03 },
    { u: 1.5,   v: 5.4,      y: 0.03 },
    { u: 5.0,   v: 0.6,      y: 0.03 },   // tight against left wall
    { u: 8.5,   v: W - 0.6,  y: 0.03 },   // tight against right wall
    { u: 3.5,   v: W - 2.3,  y: 0.03 },
    { u: D-0.7, v: 6.0,      y: 0.03 },   // base of the chalkboard
    { u: tdu,   v: tdv + 0.2, y: 0.86 },  // on the teacher's desk
    { u: cabU,  v: 0.2,      y: CAB_SHELF_Y,       container: cabRec },   // hidden on the cabinet shelf
    { u: drwU,  v: W - 0.59, y: DRW_TRAY_Y + 0.02, container: drwRec },   // hidden in the drawer tray
    ...searchNoteSpots,   // stuffed in a bag or the trash can (revealed on search)
  ];
  const noteMeshes = [];
  for (let i = 0; i < 5; i++) {
    const noteMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.42),
      noteMat
    );
    noteMesh.rotation.order = 'YXZ';
    noteMesh.userData.isInteractive = true;
    noteMesh.userData.roomIndex = def.idx;
    noteMesh.userData.noteIndex = i;
    scene.add(noteMesh);
    interactiveObjects.push(noteMesh);
    noteMeshes.push(noteMesh);
  }
  _noteRooms.push({ roomIdx: def.idx, P, theta: f.theta, pool: notePool, meshes: noteMeshes });
  return noteMeshes;
}

// Per-room note bookkeeping for run-time re-randomization.
const _noteRooms = [];

// Re-roll every real room's 5 notes into different pool spots. Called on each
// game start (resetProgress) so papers hide somewhere new each playthrough.
export function randomizeNotes() {
  for (const rr of _noteRooms) {
    const pool = rr.pool.slice();
    for (let i = pool.length - 1; i > 0; i--) {        // Fisher–Yates shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    rr.meshes.forEach((m, i) => {
      const s = pool[i];
      const p = rr.P(s.u, s.v);
      m.position.set(p.x, s.y, p.z);
      m.rotation.set(-Math.PI/2, Math.random() * Math.PI + rr.theta, 0);   // flat, random spin
      m.userData.container = s.container || null;   // gated: hidden until this container is opened
    });
  }
}

// Move one room's note to a hiding spot far from (px,pz) — used when a question
// is answered so the NEXT one never pops up right next to the player. Prefers a
// random spot beyond minDist; falls back to the farthest available.
export function relocateNote(roomIdx, noteIdx, px, pz, minDist = 4.5) {
  const rr = _noteRooms.find(r => r.roomIdx === roomIdx);
  if (!rr || !rr.meshes[noteIdx]) return;
  const dist = s => { const p = rr.P(s.u, s.v); return Math.hypot(p.x - px, p.z - pz); };
  const far = rr.pool.filter(s => dist(s) >= minDist);
  const spot = far.length
    ? far[Math.floor(Math.random() * far.length)]
    : rr.pool.reduce((a, b) => (dist(b) > dist(a) ? b : a));
  const m = rr.meshes[noteIdx];
  const p = rr.P(spot.u, spot.v);
  m.position.set(p.x, spot.y, p.z);
  m.rotation.set(-Math.PI/2, Math.random() * Math.PI + rr.theta, 0);
  m.userData.container = spot.container || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROOM DOORS — every classroom (real + decoy) gets a wooden door. Real rooms
//  2/3 stay locked until the previous level is done; decoys are unlocked and
//  open on interact. main.js drives rotation.y between baseTheta and
//  baseTheta + DOOR_OPEN_ANGLE.
// ═══════════════════════════════════════════════════════════════════════════════
export const DOOR_OPEN_ANGLE = 1.92;   // ~110°, swings into the room

function buildDoor(scene, def, doorIndex, interactiveObjects) {
  const { f, P, dLoc, rect } = frameHelpers(def);
  const w = dLoc[1] - dLoc[0];

  const group = new THREE.Group();
  const hp = P(0, dLoc[0]);
  group.position.set(hp.x, 0, hp.z);
  group.rotation.y = f.theta;

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, doorH - 0.05, w - 0.06),
    doorPanelMat
  );
  panel.position.set(0, (doorH - 0.05) / 2, (w - 0.06) / 2 + 0.03);
  panel.userData.isDoor    = true;
  panel.userData.doorIndex = doorIndex;
  panel.userData.locked    = false;   // main.js sets real lock state
  group.add(panel);
  interactiveObjects.push(panel);

  // Round knob + backplate on both faces, latch side
  const knobMat  = new THREE.MeshLambertMaterial({ color: 0x5f5438, emissive: 0x1c180f, emissiveIntensity: 0.45 });   // tarnished brass
  const plateGeo = new THREE.BoxGeometry(0.015, 0.24, 0.08);
  const knobGeo  = new THREE.SphereGeometry(0.045, 10, 8);
  [-1, 1].forEach(side => {
    const plate = new THREE.Mesh(plateGeo, darkMat);
    plate.position.set(side * 0.052, 1.05, w - 0.32);
    group.add(plate);
    const knob = new THREE.Mesh(knobGeo, knobMat);
    knob.position.set(side * 0.1, 1.05, w - 0.32);
    knob.scale.set(1, 1, 1.25);
    group.add(knob);
  });

  scene.add(group);
  const dr = rect(-0.15, 0.15, dLoc[0], dLoc[1]);
  _addBox(dr.minX, dr.maxX, dr.minZ, dr.maxZ, { doorIndex });
  return { group, panel, baseTheta: f.theta, realIdx: def.idx, key: def.key };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONTAINERS — openable storage that may hide a note. A rusted metal supply
//  cabinet (two hinged doors) and a worn wooden drawer unit (slides out). Both
//  are live Groups (not batched) so their moving parts animate; main.js flips
//  record.isOpen on interact and lerps the parts toward the open pose. The note
//  (when randomizeNotes places one inside) rests on the shelf / in the tray and
//  stays hidden until the container is opened.
// ═══════════════════════════════════════════════════════════════════════════════
const CAB_D = 0.42, CAB_SHELF_Y = 1.9 * 0.52 + 0.02;   // cabinet depth + interior shelf height
const DRW_D = 0.5,  DRW_TRAY_Y = 0.34, DRW_SLIDE = 0.34;

const _cabBox = (w, h, d, px, py, pz, mat, parent) => {
  const m = new THREE.Mesh(_bxGeo(w, h, d), mat); m.position.set(px, py, pz); parent.add(m); return m;
};
// Footprint collision for a wall-flush unit sized W(along wall)×D(into room), spun by yaw.
function _unitCollision(x, z, yaw, W, D, top) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  _addBox(x - (c*W/2 + s*D/2), x + (c*W/2 + s*D/2), z - (s*W/2 + c*D/2), z + (s*W/2 + c*D/2), { top });
}

// Rusted two-door supply cabinet. (x,z) = floor center; yaw faces the doors into
// the room (= f.theta when it backs onto the v=0 wall). Local +z is the front.
function buildCabinet(scene, x, z, yaw, io, containers) {
  const W = 1.0, H = 1.9, D = CAB_D, t = 0.03;
  const mount = new THREE.Group(); mount.position.set(x, 0, z); mount.rotation.y = yaw; scene.add(mount);
  _cabBox(W, H, t, 0, H/2, -D/2 + t/2, lockerMat, mount);   // back (wall side)
  _cabBox(t, H, D, -W/2 + t/2, H/2, 0, lockerMat, mount);   // left side
  _cabBox(t, H, D,  W/2 - t/2, H/2, 0, lockerMat, mount);   // right side
  _cabBox(W, t, D, 0, H - t/2, 0, lockerMat, mount);        // top
  _cabBox(W, t, D, 0, t/2, 0, lockerMat, mount);            // bottom
  _cabBox(W - 2*t, t, D - t, 0, H*0.52, 0, lockerMat, mount);   // interior shelf
  const doorH = H - 0.06, doorW = W/2 - 0.03;
  const parts = [];
  let target = null;
  [[-1, -1.5], [1, 1.5]].forEach(([side, openA]) => {       // doors swing OUTWARD into the room
    const pivot = new THREE.Group();
    pivot.position.set(side * (W/2 - t), H/2, D/2 - t/2);   // hinge at the outer front edge
    mount.add(pivot);
    const door = _cabBox(doorW, doorH, t, -side * doorW/2, 0, 0, lockerMat, pivot);
    _cabBox(0.04, 0.2, 0.05, -side * (doorW - 0.07), 0, t, handleMat, pivot);   // handle near free edge
    parts.push({ obj: pivot, prop: 'rotY', closed: 0, open: openA });
    if (side === -1) target = door;
  });
  const record = { isOpen: false, kind: 'cabinet', parts, sound: 'randomKnock' };
  target.userData.isContainer = true;
  target.userData.container = record;
  io.push(target);
  containers.push(record);
  _unitCollision(x, z, yaw, W, D, H);   // tall — always blocks
  return record;
}

// Worn wooden drawer unit — a low chest with one pull-out drawer. Local +z is
// the front; the drawer slides out along +z.
function buildDrawerUnit(scene, x, z, yaw, io, containers) {
  const W = 0.72, H = 0.72, D = DRW_D, t = 0.03;
  const mount = new THREE.Group(); mount.position.set(x, 0, z); mount.rotation.y = yaw; scene.add(mount);
  _cabBox(W, H, t, 0, H/2, -D/2 + t/2, deskMat, mount);     // back
  _cabBox(t, H, D, -W/2 + t/2, H/2, 0, deskMat, mount);     // left
  _cabBox(t, H, D,  W/2 - t/2, H/2, 0, deskMat, mount);     // right
  _cabBox(W, t, D, 0, H - t/2, 0, deskMat, mount);          // top
  _cabBox(W, t, D, 0, t/2, 0, deskMat, mount);              // bottom
  const slide = new THREE.Group(); mount.add(slide);         // the drawer that slides on +z
  const inW = W - 0.08, trayH = 0.16;
  const panel = _cabBox(W - 0.04, H - 0.16, t, 0, H*0.44, D/2 - t/2, deskMat, slide);   // drawer face
  _cabBox(inW, t, D - 0.1, 0, DRW_TRAY_Y - trayH/2, 0, deskMat, slide);                 // tray bottom
  _cabBox(inW, trayH, t, 0, DRW_TRAY_Y, -D/2 + 0.09, deskMat, slide);                   // tray back
  _cabBox(t, trayH, D - 0.12, -inW/2, DRW_TRAY_Y, 0, deskMat, slide);                    // tray side
  _cabBox(t, trayH, D - 0.12,  inW/2, DRW_TRAY_Y, 0, deskMat, slide);                    // tray side
  _cabBox(0.18, 0.04, 0.05, 0, H*0.44, D/2 + 0.02, handleMat, slide);                    // handle
  const parts = [{ obj: slide, prop: 'posZ', closed: 0, open: DRW_SLIDE }];
  const record = { isOpen: false, kind: 'drawer', parts, sound: 'pageTurn' };
  panel.userData.isContainer = true;
  panel.userData.container = record;
  io.push(panel);
  containers.push(record);
  _unitCollision(x, z, yaw, W, D, H);   // ~table height — must jump onto it
  return record;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VACANT ROOMS — abandoned, open dark doorways (spec 1.3)
// ═══════════════════════════════════════════════════════════════════════════════

function buildVacantRoom(scene, def, i) {
  const { f, W, P, dLoc, rect, BX, PL } = frameHelpers(def);
  const D = vacantDepth, rH = roomH;

  // Same abandoned wall/floor textures as the classrooms.
  PL(D, W, D/2, 0,  W/2, -Math.PI/2, 0, roomFloorMat);
  PL(D, W, D/2, rH, W/2,  Math.PI/2, 0, ceilMat);
  PL(W, rH, D, rH/2, W/2, 0, -Math.PI/2, roomWallMat);
  PL(D, rH, D/2, rH/2, 0, 0, 0,       roomWallMat);
  PL(D, rH, D/2, rH/2, W, 0, Math.PI, roomWallMat);

  // Door-side wall omitted — provided by the corridor wall (avoids z-fighting).

  // Doorway trim: jambs through the wall + header spanning the opening
  const vfT = 0.12, vdCv = (dLoc[0] + dLoc[1]) / 2;
  BX(0.32, VACANT_DOOR_H + 0.04, vfT, 0, (VACANT_DOOR_H + 0.04)/2, dLoc[0] - vfT/2, doorTrimMat);
  BX(0.32, VACANT_DOOR_H + 0.04, vfT, 0, (VACANT_DOOR_H + 0.04)/2, dLoc[1] + vfT/2, doorTrimMat);
  BX(0.32, 0.16, (dLoc[1] - dLoc[0]) + 2*vfT, 0, VACANT_DOOR_H + 0.1, vdCv, doorTrimMat);

  // Shell collision
  const r1 = rect(0, D + 0.3, -0.3, 0);    _addBox(r1.minX, r1.maxX, r1.minZ, r1.maxZ);
  const r2 = rect(0, D + 0.3, W, W + 0.3); _addBox(r2.minX, r2.maxX, r2.minZ, r2.maxZ);
  const r3 = rect(D, D + 0.3, 0, W);       _addBox(r3.minX, r3.maxX, r3.minZ, r3.maxZ);

  // Abandoned props
  const tip = 1.25 + Math.random() * 0.35;
  BX(0.9, 0.06, 0.65, 2 + Math.random(), 0.38, 1.5 + Math.random()*2, deskMat, tip, Math.random()*Math.PI);
  BX(0.9, 0.06, 0.65, 3, 0.72, W - 2.5, deskMat, 0, 0.4 + Math.random()*0.5);
  BX(0.05, 0.72, 0.05, 2.65, 0.36, W - 2.7, darkMat);
  BX(0.05, 0.72, 0.05, 3.35, 0.36, W - 2.3, darkMat);
  BX(0.7, 0.05, 0.6, 1.5, 0.3, W/2 + 0.5, deskMat, Math.PI/2 - 0.25, 1.1);
  const dr = rect(2.4, 3.6, W - 3.1, W - 1.9);
  _addBox(dr.minX, dr.maxX, dr.minZ, dr.maxZ);

  for (let p = 0; p < 6; p++) {
    PL(0.25, 0.33, 0.8 + Math.random()*(D - 1.6), 0.012 + p*0.002, 1 + Math.random()*(W - 2),
      -Math.PI/2, Math.random()*Math.PI, paperMat);
  }

  // Blood — a couple of floor decals, and often a smear on the v=0 wall.
  for (let b = 0, n = 1 + Math.floor(Math.random()*2); b < n; b++) {
    const q = P(1.4 + Math.random()*(D-2.8), 1.4 + Math.random()*(W-2.8));
    bloodDecal(scene, q.x, 0.02, q.z, -Math.PI/2, Math.random()*Math.PI*2, 1.3 + Math.random()*1.3);
  }
  if (Math.random() < 0.7) {
    const q = P(1.6 + Math.random()*(D-3.2), 0.06);
    bloodDecal(scene, q.x, 1.35, q.z, 0, f.theta, 1.4 + Math.random()*0.7);
  }

  // Scrawl on the door-side wall, facing in — hidden from the corridor, revealed
  // when you step inside (so the door frame can never split it).
  if (Math.random() < 0.6) roomScrawl(scene, { f, P, dLoc, W }, randScrawl(), 0.55);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXIT DOOR — end wall of leg 2 (x = leg2EndX), keypad beside it
// ═══════════════════════════════════════════════════════════════════════════════
function buildExitDoor(scene, interactiveObjects) {
  const cz = (leg2Z0 + leg2Z1) / 2;      // 49
  const exDW = 2.4;
  const d0 = cz - exDW/2, d1 = cz + exDW/2;

  // End wall segments around the opening
  _wallTiled(d0 - leg2Z0, hallH, leg2EndX, hallH/2, (leg2Z0 + d0)/2, 0, -Math.PI/2, roomWallMat);
  _wallTiled(leg2Z1 - d1, hallH, leg2EndX, hallH/2, (d1 + leg2Z1)/2, 0, -Math.PI/2, roomWallMat);
  const exTopH = hallH - doorH;
  if (exTopH > 0) _wallTiled(exDW, exTopH, leg2EndX, hallH - exTopH/2, cz, 0, -Math.PI/2, roomWallMat);
  _addBox(leg2EndX, leg2EndX + 0.3, leg2Z0, leg2Z1);   // whole end wall blocks (door never opens)

  bxr(0.15, doorH, 0.15, leg2EndX, doorH/2, d0 - 0.1, 0, 0, doorFrameMat);
  bxr(0.15, doorH, 0.15, leg2EndX, doorH/2, d1 + 0.1, 0, 0, doorFrameMat);
  bxr(exDW + 0.4, 0.15, 0.15, leg2EndX, doorH + 0.08, cz, 0, Math.PI/2, doorFrameMat);

  const doorFill = new THREE.Mesh(
    new THREE.PlaneGeometry(exDW, doorH),
    new THREE.MeshBasicMaterial({ color: 0x050510, transparent: true, opacity: 0.92 })
  );
  doorFill.position.set(leg2EndX - 0.01, doorH/2, cz);
  doorFill.rotation.y = -Math.PI/2;
  scene.add(doorFill);

  const keypad = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x003322 })
  );
  keypad.position.set(leg2EndX - 0.15, 1.4, d1 + 0.65);
  keypad.rotation.y = Math.PI/2;
  keypad.userData.isKeypad = true;
  scene.add(keypad);
  interactiveObjects.push(keypad);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x00ff88 })
  );
  screen.position.set(leg2EndX - 0.1, 1.55, d1 + 0.65);
  screen.rotation.y = -Math.PI/2;
  scene.add(screen);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIGHTS
// ═══════════════════════════════════════════════════════════════════════════════
export const flickerLights = [];

let fluorescentTemplate = null;
let fluorescentLoading = false;
const pendingFluorescentFixtures = [];

function collectEmissiveMaterials(root) {
  const materials = [];
  root.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    const sourceMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const clonedMats = sourceMats.map(mat => mat.clone());
    obj.material = Array.isArray(obj.material) ? clonedMats : clonedMats[0];
    clonedMats.forEach(mat => {
      const name = (mat.name || '').toLowerCase();
      const canGlow = mat.emissive && (mat.emissiveMap || name.includes('glass') || name.includes('light'));
      if (!canGlow) return;
      mat.emissive = new THREE.Color(0xcde9ff);
      mat.emissiveIntensity = 0.42;
      mat.needsUpdate = true;
      materials.push(mat);
    });
  });
  return materials;
}

function addFluorescentFixture(scene, x, z, rotY, syncTarget) {
  if (!fluorescentTemplate) {
    pendingFluorescentFixtures.push({ scene, x, z, rotY, syncTarget });
    if (!fluorescentLoading) {
      fluorescentLoading = true;
      makeGLTFLoader().load(FLUORESCENT_MODEL_PATH, gltf => {
        fluorescentTemplate = gltf.scene;
        pendingFluorescentFixtures.splice(0).forEach(item =>
          addFluorescentFixture(item.scene, item.x, item.z, item.rotY, item.syncTarget));
      }, undefined, err => console.warn('Fluorescent light asset failed to load.', err));
    }
    return;
  }

  const fixture = fluorescentTemplate.clone(true);
  const emissiveMaterials = collectEmissiveMaterials(fixture);
  fixture.scale.setScalar(2.1);

  const box = new THREE.Box3().setFromObject(fixture);
  const center = new THREE.Vector3();
  box.getCenter(center);
  fixture.position.sub(center);

  const group = new THREE.Group();
  group.position.set(x, hallH - 0.14, z);
  group.rotation.y = rotY;
  group.add(fixture);
  scene.add(group);

  syncTarget.emissiveMaterials.push(...emissiveMaterials);
}

function addCorridorLight(scene, x, z, rotY) {
  const l = new THREE.PointLight(0xa8b9d8, 5.4, 24);
  l.position.set(x, hallH - 0.3, z);
  scene.add(l);
  const syncTarget = {
    light: l,
    base: 2.75,
    speed: 6 + Math.random()*3,
    amp: 0.7,
    type: 'hall',
    cutTimer: 0,
    emissiveMaterials: [],
    glowMaterials: [],
    emissiveBase: 0.62,
  };
  flickerLights.push(syncTarget);

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xcde9ff,
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5), glowMat);
  glow.position.set(x, hallH - 0.22, z);
  glow.rotation.order = 'YXZ';
  glow.rotation.set(Math.PI/2, rotY, 0);
  scene.add(glow);
  syncTarget.glowMaterials.push(glowMat);

  addFluorescentFixture(scene, x, z, rotY, syncTarget);
}

function addLights(scene) {
  scene.add(new THREE.AmbientLight(0x242a38, 3.25));

  LEG1_LIGHT_ZS.forEach(z => addCorridorLight(scene, 0, z, 0));
  LEG2_LIGHT_XS.forEach(x => addCorridorLight(scene, x, (leg2Z0+leg2Z1)/2, Math.PI/2));

  // Candle + room light per classroom (decoys get a dimmer, colder light)
  classrooms.forEach(def => {
    const { P } = frameHelpers(def);
    const cp = P(roomW - 1.9, roomW/2 - 0.65);   // over the teacher's desk candle
    const c = new THREE.PointLight(0xff7722, 5.8, 15);
    c.position.set(cp.x, 1.15, cp.z);
    scene.add(c);
    flickerLights.push({ light: c, base: 5.8, speed: 3 + Math.random(), amp: 1.5, type: 'candle' });

    const center = P(roomW/2, roomW/2);
    const isDecoy = def.idx === null;
    const light = new THREE.PointLight(
      isDecoy ? 0x8899bb : ROOM_LIGHT_COLORS[def.idx],
      isDecoy ? 0.8 : 1.15, 12, 2);
    light.position.set(center.x, 2.0, center.z);
    scene.add(light);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
export function buildWorld(scene) {
  const interactiveObjects = [];
  _collision.length = 0;

  buildCorridors(scene);

  const roomNotes = [null, null, null];
  const roomContainers = [];
  classrooms.forEach(def => {
    const notes = buildClassroom(scene, def, interactiveObjects, roomContainers);
    if (def.idx !== null) roomNotes[def.idx] = notes;
  });
  const roomDoors = classrooms.map((def, i) => buildDoor(scene, def, i, interactiveObjects));
  vacants.forEach((def, i) => buildVacantRoom(scene, def, i));
  buildExitDoor(scene, interactiveObjects);
  addLights(scene);
  _flush(scene);
  randomizeNotes();   // initial note placement (re-rolled on every game start)

  const realRoomRects = [null, null, null];
  const decoyRects = [];
  classrooms.forEach(def => {
    const { rect } = frameHelpers(def);
    const r = rect(0, roomW, 0, def.v1 - def.v0);
    if (def.idx !== null) realRoomRects[def.idx] = r;
    else decoyRects.push(r);
  });
  const vacantRects = vacants.map(def => {
    const { rect } = frameHelpers(def);
    return rect(0, vacantDepth, 0, def.v1 - def.v0);
  });

  return {
    wallBoxes: _collision,
    interactiveObjects,
    roomNotes,
    roomDoors,
    roomContainers,
    realRoomRects,
    decoyRects,
    vacantRects,
    randomizeNotes,
    relocateNote,
  };
}
