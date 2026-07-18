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

function lockerTex() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1c2a1c'; ctx.fillRect(0, 0, 128, 256);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, 120, 248); ctx.strokeRect(4, 4, 120, 124); ctx.strokeRect(4, 128, 120, 124);
  for (let y = 20; y < 120; y += 12) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(108, y); ctx.stroke(); }
  ctx.fillStyle = '#555';
  ctx.beginPath(); ctx.arc(100, 66,  5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(100, 194, 5, 0, Math.PI*2); ctx.fill();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function scrawlTex(lines) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = 'rgba(170,150,140,0.85)';
  ctx.font = 'bold 40px Georgia';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    ctx.save();
    ctx.translate(256 + (Math.random()-0.5)*30, 100 + i * 62);
    ctx.rotate((Math.random()-0.5)*0.09);
    ctx.fillText(l, 0, 0);
    ctx.restore();
  });
  return new THREE.CanvasTexture(cv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MATERIALS
// ═══════════════════════════════════════════════════════════════════════════════
const wallMat      = new THREE.MeshLambertMaterial({ map: grungeTex('#3c3c3c'), emissive: 0x050608, emissiveIntensity: 0.22 });
const doorPanelMat = new THREE.MeshLambertMaterial({ map: grungeTex('#41301c'), emissive: 0x080503, emissiveIntensity: 0.3 });
const floorMat     = new THREE.MeshLambertMaterial({ map: floorTex(), emissive: 0x070707, emissiveIntensity: 0.28 });
const ceilMat      = new THREE.MeshLambertMaterial({ color: 0x202020, emissive: 0x030304, emissiveIntensity: 0.16 });
const lockerMat    = new THREE.MeshLambertMaterial({ map: lockerTex(), emissive: 0x020602, emissiveIntensity: 0.18 });
const deskMat      = new THREE.MeshBasicMaterial({ color: 0x2e2010 });
const darkMat      = new THREE.MeshBasicMaterial({ color: 0x0e0e0e });
const doorFrameMat = new THREE.MeshBasicMaterial({ color: 0x1c1208 });
const candleMat    = new THREE.MeshBasicMaterial({ color: 0xddeedd });
const exitSignMat  = new THREE.MeshBasicMaterial({ color: 0xff2200 });
const paperMat     = new THREE.MeshBasicMaterial({ color: 0x6e6a5e });
const bookMats     = [0x6b1a1a, 0x1a3a5b, 0x1a5b2a, 0x5b4a1a, 0x3a1a5b]
  .map(c => new THREE.MeshBasicMaterial({ color: c }));

// Searchable-container materials (design doc Proposal B)
const drawerMat   = new THREE.MeshBasicMaterial({ color: 0x3b2a15 });
const cabinetMat  = new THREE.MeshBasicMaterial({ color: 0x2f3d2f });
const backpackMat = new THREE.MeshBasicMaterial({ color: 0x4a2233 });
const bookPullMat = new THREE.MeshBasicMaterial({ color: 0x8a2525 });
const binMat      = new THREE.MeshBasicMaterial({ color: 0x2e2e34 });
const eraserMat   = new THREE.MeshBasicMaterial({ color: 0x555048 });

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

// ═══════════════════════════════════════════════════════════════════════════════
//  KENNEY FURNITURE (CC0, kenney.nl Furniture Kit) — loaded async and placed at
//  queued spots. Materials are flattened + darkened to sit in the horror light.
//  Per-model yaw offsets align each model's "front" with our local frames.
// ═══════════════════════════════════════════════════════════════════════════════
const FURNITURE_DIR = '/assets/3D/furniture/';
const FURNITURE_FILES = ['table', 'chair', 'desk', 'bookcaseOpen', 'books', 'trashcan'];
const _furnTemplates = {};
const _furnQueue = [];
let _furnLoading = false;

function _tuneFurnitureMaterials(root) {
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = (Array.isArray(o.material) ? mats : mats[0]);
    mats.forEach(m => {
      if ('roughness' in m) m.roughness = 1;
      if ('metalness' in m) m.metalness = 0;
      m.color?.multiplyScalar(0.55);
    });
  });
}

function _placeFurniture(item) {
  const tpl = _furnTemplates[item.name];
  const clone = tpl.scene.clone(true);
  const s = item.targetH / tpl.size.y;
  clone.scale.setScalar(s);
  clone.position.set(item.x, (item.y || 0) - tpl.min.y * s, item.z);
  clone.rotation.y = item.ry || 0;
  item.parent.add(clone);
}

function _requestFurniture(item) {
  if (_furnTemplates[item.name]) { _placeFurniture(item); return; }
  _furnQueue.push(item);
  if (_furnLoading) return;
  _furnLoading = true;
  const loader = makeGLTFLoader();
  FURNITURE_FILES.forEach(name => {
    loader.load(`${FURNITURE_DIR}${name}.glb`, gltf => {
      _tuneFurnitureMaterials(gltf.scene);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      _furnTemplates[name] = { scene: gltf.scene, size, min: box.min };
      for (let i = _furnQueue.length - 1; i >= 0; i--) {
        if (_furnQueue[i].name === name) _placeFurniture(_furnQueue.splice(i, 1)[0]);
      }
    }, undefined, err => console.warn(`Furniture "${name}" failed to load.`, err));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CORRIDORS — two legs + corner, walls segmented around door openings
// ═══════════════════════════════════════════════════════════════════════════════
const _collision = [];
const _addBox = (minX, maxX, minZ, maxZ, extra) =>
  _collision.push({ minX, maxX, minZ, maxZ, ...extra });

// A corridor wall with door gaps. runAxis 'z': plane x=at spanning z from..to.
// runAxis 'x': plane z=at spanning x from..to. Also emits collision boxes.
function segmentedWall(runAxis, at, from, to, gaps, ry, collide = true) {
  const T = 0.3;
  const seg = (a, b) => {
    if (b - a < 0.01) return;
    const len = b - a, mid = (a + b) / 2;
    if (runAxis === 'z') {
      pl(len, hallH, at, hallH/2, mid, 0, ry, wallMat);
      if (collide) _addBox(at < 0 ? at - T : at, at < 0 ? at : at + T, a, b);
    } else {
      pl(len, hallH, mid, hallH/2, at, 0, ry, wallMat);
      if (collide) _addBox(a, b, at < leg2Z0 + 0.1 ? at - T : at, at < leg2Z0 + 0.1 ? at : at + T);
    }
  };
  let p = from;
  [...gaps].sort((a, b) => a.a0 - b.a0).forEach(g => {
    seg(p, g.a0);
    const topH = hallH - g.h;
    if (topH > 0.05) {
      const mid = (g.a0 + g.a1) / 2, len = g.a1 - g.a0;
      if (runAxis === 'z') pl(len, topH, at, hallH - topH/2, mid, 0, ry, wallMat);
      else                 pl(len, topH, mid, hallH - topH/2, at, 0, ry, wallMat);
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

function buildCorridors() {
  // Floors + ceilings (leg 1 owns the corner square)
  pl(hallW, leg1Len, 0, 0, leg1Len/2, -Math.PI/2, 0, floorMat);
  pl(hallW, leg1Len, 0, hallH, leg1Len/2, Math.PI/2, 0, ceilMat);
  const leg2Len = leg2EndX - HALF_W;
  pl(leg2Len, hallW, HALF_W + leg2Len/2, 0, (leg2Z0+leg2Z1)/2, -Math.PI/2, 0, floorMat);
  pl(leg2Len, hallW, HALF_W + leg2Len/2, hallH, (leg2Z0+leg2Z1)/2, Math.PI/2, 0, ceilMat);

  // Walls (visual + collision), segmented around the door openings
  segmentedWall('z', -HALF_W, 0, leg1Len, doorGapsFor('W'),  Math.PI/2);          // leg1 west
  segmentedWall('z',  HALF_W, 0, leg2Z0,  doorGapsFor('E'), -Math.PI/2);          // leg1 east (open past corner)
  segmentedWall('x',  leg2Z1, -HALF_W, leg2EndX, doorGapsFor('N'), Math.PI);      // north wall (leg1 end + leg2)
  segmentedWall('x',  leg2Z0,  HALF_W, leg2EndX, doorGapsFor('S'), 0);            // leg2 south
  pl(hallW, hallH, 0, hallH/2, 0, 0, 0, wallMat);                                 // spawn back wall
  _addBox(-HALF_W, HALF_W, -0.3, 0);

  // Lockers — leg1 west wall + leg2 south wall, gaps at doorways
  const lW = 0.9, lH = 2.5, lD = 0.35;
  const wGaps = doorGapsFor('W'), sGaps = doorGapsFor('S');
  for (let z = 0.5; z < leg1Len - 1; z += lW + 0.05) {
    if (wGaps.some(g => z + lW > g.a0 - 0.15 && z < g.a1 + 0.15)) continue;
    bx(lW, lH, lD, -HALF_W + lD/2, lH/2, z + lW/2, lockerMat);
  }
  for (let x = HALF_W + 1; x < leg2EndX - 1; x += lW + 0.05) {
    if (sGaps.some(g => x + lW > g.a0 - 0.15 && x < g.a1 + 0.15)) continue;
    bxr(lW, lH, lD, x + lW/2, lH/2, leg2Z0 + lD/2, 0, Math.PI/2, lockerMat);
  }
  // Locker protrusion collision strips
  let p = 0;
  wGaps.sort((a,b)=>a.a0-b.a0).forEach(g => { _addBox(-HALF_W-0.3, -HALF_W+0.5, p, g.a0-0.15); p = g.a1+0.15; });
  _addBox(-HALF_W-0.3, -HALF_W+0.5, p, leg1Len);
  p = HALF_W;
  sGaps.sort((a,b)=>a.a0-b.a0).forEach(g => { _addBox(p, g.a0-0.15, leg2Z0-0.3, leg2Z0+0.5); p = g.a1+0.15; });
  _addBox(p, leg2EndX, leg2Z0-0.3, leg2Z0+0.5);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLASSROOMS — real levels AND decoys share this builder. Decoys get a lying
//  chalkboard label, desks turned to face the back wall, a faint scrawl, and
//  no notes. Everything is built in the room's local frame.
// ═══════════════════════════════════════════════════════════════════════════════
function buildClassroom(scene, def, interactiveObjects) {
  const { f, W, P, dLoc, rect, BX, PL } = frameHelpers(def);
  const D = roomW, rH = roomH;
  const isDecoy = def.idx === null;

  PL(D, W, D/2, 0,  W/2, -Math.PI/2, 0, floorMat);
  PL(D, W, D/2, rH, W/2,  Math.PI/2, 0, ceilMat);
  PL(W, rH, D, rH/2, W/2, 0, -Math.PI/2, wallMat);   // far wall
  PL(D, rH, D/2, rH/2, 0, 0, 0,        wallMat);     // v=0 side wall
  PL(D, rH, D/2, rH/2, W, 0, Math.PI,  wallMat);     // v=W side wall

  const preDoor = dLoc[0], postDoor = W - dLoc[1], topH = rH - doorH, dCv = (dLoc[0]+dLoc[1])/2;
  if (preDoor  > 0) PL(preDoor,  rH, 0, rH/2, preDoor/2,          0, Math.PI/2, wallMat);
  if (postDoor > 0) PL(postDoor, rH, 0, rH/2, dLoc[1]+postDoor/2, 0, Math.PI/2, wallMat);
  if (topH > 0.05)  PL(doorW, topH,  0, rH-topH/2, dCv,           0, Math.PI/2, wallMat);

  const fT = 0.12;
  BX(fT, doorH, fT, -fT/2, doorH/2, dLoc[0], doorFrameMat);
  BX(fT, doorH, fT, -fT/2, doorH/2, dLoc[1], doorFrameMat);
  BX(doorW, fT, fT, -fT/2, doorH+fT/2, dCv, doorFrameMat);

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

  // Teacher's desk (Kenney model — the drawer container slides out of it)
  const tdu = D - 1.5, tdv = W/2 + 1;
  {
    const p = P(tdu, tdv);
    _requestFurniture({ name: 'desk', parent: scene, x: p.x, z: p.z, ry: f.theta + Math.PI, targetH: 0.78 });
  }
  const tdr = rect(tdu - 1.05, tdu + 1.05, tdv - 0.6, tdv + 0.6);
  _addBox(tdr.minX, tdr.maxX, tdr.minZ, tdr.maxZ);

  // 6 student desks + chairs (decoys: chairs flipped — the class faces the wall)
  const chairSide = isDecoy ? -0.6 : 0.6;
  const chairRy   = f.theta + (isDecoy ? 0 : Math.PI);
  [[3.5, 2], [6, 2], [8.5, 2], [3.5, 4.5], [6, 4.5], [8.5, 4.5]].forEach(([du, dv]) => {
    const dp = P(du, dv);
    _requestFurniture({ name: 'table', parent: scene, x: dp.x, z: dp.z, ry: f.theta, targetH: 0.72 });
    const cp = P(du, dv + chairSide);
    _requestFurniture({ name: 'chair', parent: scene, x: cp.x, z: cp.z, ry: chairRy, targetH: 0.85 });
    const dr = rect(du - 0.58, du + 0.58, dv - 0.46, dv + 0.46);
    _addBox(dr.minX, dr.maxX, dr.minZ, dr.maxZ);
    const cr = rect(du - 0.44, du + 0.44, dv + chairSide - 0.43, dv + chairSide + 0.43);
    _addBox(cr.minX, cr.maxX, cr.minZ, cr.maxZ);
  });

  // Bookshelf (open bookcase against the door-side wall + a row of books)
  const bsu = 0.5, bsv = 1.5;
  {
    const bp = P(bsu, bsv);
    _requestFurniture({ name: 'bookcaseOpen', parent: scene, x: bp.x, z: bp.z, ry: f.theta + Math.PI/2, targetH: 2.1 });
    const kp = P(bsu + 0.05, bsv);
    _requestFurniture({ name: 'books', parent: scene, x: kp.x, y: 0.02, z: kp.z, ry: f.theta + Math.PI/2, targetH: 0.24 });
  }
  const bsr = rect(bsu - 0.35, bsu + 0.35, bsv - 0.85, bsv + 0.85);
  _addBox(bsr.minX, bsr.maxX, bsr.minZ, bsr.maxZ);

  // Candle on the teacher's desk
  BX(0.06, 0.18, 0.06, tdu - 0.5, 0.87, tdv - 0.2, candleMat);

  // Exit sign on the v=W side wall
  BX(0.7, 0.25, 0.05, D - 0.8, rH - 0.2, W - 0.1, exitSignMat);

  if (isDecoy) {
    // A faint scrawl gives the lie away — once you're already inside.
    const sPos = P(D - 0.03, W/2 - 1);
    const scrawl = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshBasicMaterial({ map: scrawlTex(['IT LIED']), transparent: true, opacity: 0.4 })
    );
    scrawl.position.set(sPos.x, 1.05, sPos.z);
    scrawl.rotation.order = 'YXZ';
    scrawl.rotation.set(0, -Math.PI/2 + f.theta, 0);
    scene.add(scrawl);
  }

  return buildContainers(scene, def, interactiveObjects);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEARCHABLE CONTAINERS (Proposal B) — 6 hiding spots per classroom. The
//  question notes live INSIDE these; main.js picks which one holds the current
//  note. Each container has a closed and an "opened / rummaged" pose so the
//  room visibly changes as the player searches it. Decoy classrooms get the
//  same containers — all permanently empty.
// ═══════════════════════════════════════════════════════════════════════════════
function buildContainers(scene, def, interactiveObjects) {
  const { f, P, rect, BX } = frameHelpers(def);
  const th = f.theta;
  const isDecoy = def.idx === null;
  const containers = [];
  const W3 = (u, y, v) => { const p = P(u, v); return { x: p.x, y, z: p.z }; };

  const reg = (obj, handle, closed, open) => {
    handle.userData.isContainer    = true;
    handle.userData.roomIndex      = def.idx;
    handle.userData.decoy          = isDecoy;
    handle.userData.containerIndex = containers.length;
    interactiveObjects.push(handle);
    obj.rotation.order = 'YXZ';
    const apply = t => {
      obj.position.set(t.pos.x, t.pos.y, t.pos.z);
      obj.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
    };
    apply(closed);
    scene.add(obj);
    containers.push({ handle, setOpen: o => apply(o ? open : closed) });
  };

  // 0 · teacher's desk drawer — slides out toward the class
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.42), drawerMat);
    reg(m, m,
      { pos: W3(10.5, 0.5, 7.0),  rot: [0, th, 0] },
      { pos: W3(10.5, 0.5, 6.55), rot: [0, th, 0] });
  }

  // 1 · storage cabinet in the back corner — door creaks open
  {
    BX(0.6, 2.1, 0.9, 11.05, 1.05, 0.95, deskMat);
    const cb = rect(10.75, 11.35, 0.5, 1.4);
    _addBox(cb.minX, cb.maxX, cb.minZ, cb.maxZ);
    const g = new THREE.Group();
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.86), cabinetMat);
    doorMesh.position.set(0, 0, 0.43);
    g.add(doorMesh);
    reg(g, doorMesh,
      { pos: W3(10.73, 1.1, 0.52), rot: [0, th, 0] },
      { pos: W3(10.73, 1.1, 0.52), rot: [0, th - 1.5, 0] });
  }

  // 2 · backpack dropped between the desk rows — tips over when rummaged
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.2), backpackMat);
    reg(m, m,
      { pos: W3(5.2, 0.22, 3.3),  rot: [0.12, th + 0.7, 0] },
      { pos: W3(5.25, 0.12, 3.4), rot: [1.35, th + 0.9, 0] });
  }

  // 3 · a red book on the bookcase shelf — pulls out and leans
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.2), bookPullMat);
    reg(m, m,
      { pos: W3(0.55, 0.85, 1.75), rot: [0, th, 0] },
      { pos: W3(0.78, 0.8, 1.78),  rot: [0, th, -0.4] });
  }

  // 4 · trash bin by the door — knocks over (Kenney trashcan model)
  {
    const g = new THREE.Group();
    _requestFurniture({ name: 'trashcan', parent: g, x: 0, z: 0, ry: 0, targetH: 0.48 });
    reg(g, g,
      { pos: W3(0.7, 0, 6.1),     rot: [0, 0, 0] },
      { pos: W3(0.88, 0.04, 6.35), rot: [0, th, 1.35] });
  }

  // 5 · chalkboard tray eraser — shoved aside
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.1), eraserMat);
    reg(m, m,
      { pos: W3(11.7, 0.86, 5.1),  rot: [0, th, 0] },
      { pos: W3(11.66, 0.86, 5.7), rot: [0, th + 0.6, 0] });
  }

  return containers;
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

  const handleGeo = new THREE.BoxGeometry(0.05, 0.2, 0.06);
  [-0.08, 0.08].forEach(hx => {
    const handle = new THREE.Mesh(handleGeo, darkMat);
    handle.position.set(hx, 1.05, w - 0.35);
    group.add(handle);
  });

  scene.add(group);
  const dr = rect(-0.15, 0.15, dLoc[0], dLoc[1]);
  _addBox(dr.minX, dr.maxX, dr.minZ, dr.maxZ, { doorIndex });
  return { group, panel, baseTheta: f.theta, realIdx: def.idx, key: def.key };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VACANT ROOMS — abandoned, open dark doorways (spec 1.3)
// ═══════════════════════════════════════════════════════════════════════════════
const VACANT_SCRAWLS = [
  ['HELP US'],
  ['IT COUNTS', 'THE OUTCOMES'],
  ['P(ESCAPE) = 0'],
  ['DON’T LOOK', 'BEHIND YOU'],
  ['NOTHING IS', 'CERTAIN HERE'],
];

function buildVacantRoom(scene, def, i) {
  const { f, W, P, dLoc, rect, BX, PL } = frameHelpers(def);
  const D = vacantDepth, rH = roomH;

  PL(D, W, D/2, 0,  W/2, -Math.PI/2, 0, floorMat);
  PL(D, W, D/2, rH, W/2,  Math.PI/2, 0, ceilMat);
  PL(W, rH, D, rH/2, W/2, 0, -Math.PI/2, wallMat);
  PL(D, rH, D/2, rH/2, 0, 0, 0,       wallMat);
  PL(D, rH, D/2, rH/2, W, 0, Math.PI, wallMat);

  const preDoor = dLoc[0], postDoor = W - dLoc[1], topH = rH - VACANT_DOOR_H;
  if (preDoor  > 0) PL(preDoor,  rH, 0, rH/2, preDoor/2,          0, Math.PI/2, wallMat);
  if (postDoor > 0) PL(postDoor, rH, 0, rH/2, dLoc[1]+postDoor/2, 0, Math.PI/2, wallMat);
  if (topH > 0.05)  PL(dLoc[1]-dLoc[0], topH, 0, rH-topH/2, (dLoc[0]+dLoc[1])/2, 0, Math.PI/2, wallMat);

  const fT = 0.1;
  BX(fT, VACANT_DOOR_H, fT, -fT/2, VACANT_DOOR_H/2, dLoc[0], doorFrameMat);
  BX(fT, VACANT_DOOR_H, fT, -fT/2, VACANT_DOOR_H/2, dLoc[1], doorFrameMat);
  BX(fT, fT, dLoc[1]-dLoc[0], -fT/2, VACANT_DOOR_H+fT/2, (dLoc[0]+dLoc[1])/2, doorFrameMat);

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

  const sPos = P(D - 0.03, W/2 + (Math.random()-0.5)*2);
  const scrawl = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.3),
    new THREE.MeshBasicMaterial({ map: scrawlTex(VACANT_SCRAWLS[i % VACANT_SCRAWLS.length]), transparent: true, opacity: 0.5 })
  );
  scrawl.position.set(sPos.x, 1.7, sPos.z);
  scrawl.rotation.order = 'YXZ';
  scrawl.rotation.set(0, -Math.PI/2 + f.theta, 0);
  scene.add(scrawl);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXIT DOOR — end wall of leg 2 (x = leg2EndX), keypad beside it
// ═══════════════════════════════════════════════════════════════════════════════
function buildExitDoor(scene, interactiveObjects) {
  const cz = (leg2Z0 + leg2Z1) / 2;      // 49
  const exDW = 2.4;
  const d0 = cz - exDW/2, d1 = cz + exDW/2;

  // End wall segments around the opening
  pl(d0 - leg2Z0, hallH, leg2EndX, hallH/2, (leg2Z0 + d0)/2, 0, -Math.PI/2, wallMat);
  pl(leg2Z1 - d1, hallH, leg2EndX, hallH/2, (d1 + leg2Z1)/2, 0, -Math.PI/2, wallMat);
  const exTopH = hallH - doorH;
  if (exTopH > 0) pl(exDW, exTopH, leg2EndX, hallH - exTopH/2, cz, 0, -Math.PI/2, wallMat);
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
    const cp = P(roomW - 2, roomW/2 + 0.8);
    const c = new THREE.PointLight(0xff7722, 5.8, 15);
    c.position.set(cp.x, 1.1, cp.z);
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

  buildCorridors();

  let decoyCounter = 0;
  const classroomContainers = classrooms.map(def => {
    const containers = buildClassroom(scene, def, interactiveObjects);
    if (def.idx === null) {
      const di = decoyCounter++;
      containers.forEach(c => { c.handle.userData.decoyIndex = di; });
    }
    return { key: def.key, realIdx: def.idx, containers };
  });
  const roomDoors = classrooms.map((def, i) => buildDoor(scene, def, i, interactiveObjects));
  vacants.forEach((def, i) => buildVacantRoom(scene, def, i));
  buildExitDoor(scene, interactiveObjects);
  addLights(scene);
  _flush(scene);

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
    classroomContainers,
    roomDoors,
    realRoomRects,
    decoyRects,
    vacantRects,
  };
}
