import * as THREE from 'three';
import { makeGLTFLoader } from '../loaders/gltf-loader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from '../core/config.js';

const { hallW, hallH, hallL, roomW, roomH, doorW, doorH, rooms, exitZ } = CFG.world;
const HALF_W = hallW / 2;
const ROOM_LIGHT_COLORS = [0xffaa44, 0x4488ff, 0x44ff88];
const FLUORESCENT_MODEL_PATH = '/assets/3D/fluorescent/mounted_fluorescent_lights_1k.gltf';
const HALL_LIGHT_ZS = [5.5, 16.5, 27, 38, 49];

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

// ═══════════════════════════════════════════════════════════════════════════════
//  MATERIALS
//  Large surfaces (walls, floor, ceiling) → MeshLambertMaterial so point lights
//  create the horror atmosphere (dark corners, candle glow, flickering).
//  Small furniture → MeshBasicMaterial (zero lighting cost, invisible diff).
//  Hallway lockers stay Lambert so fluorescent flicker visibly changes the hall.
// ═══════════════════════════════════════════════════════════════════════════════
const wallMat      = new THREE.MeshLambertMaterial({ map: grungeTex('#3c3c3c'), emissive: 0x050608, emissiveIntensity: 0.22 });
const doorPanelMat = new THREE.MeshLambertMaterial({ map: grungeTex('#41301c'), emissive: 0x080503, emissiveIntensity: 0.3 });
const floorMat     = new THREE.MeshLambertMaterial({ map: floorTex(), emissive: 0x070707, emissiveIntensity: 0.28 });
const ceilMat      = new THREE.MeshLambertMaterial({ color: 0x202020, emissive: 0x030304, emissiveIntensity: 0.16 });
// — furniture stays MeshBasicMaterial (saves lighting calc on tiny geometry) —
const lockerMat    = new THREE.MeshLambertMaterial({ map: lockerTex(), emissive: 0x020602, emissiveIntensity: 0.18 });
const deskMat      = new THREE.MeshBasicMaterial({ color: 0x2e2010 });
const darkMat      = new THREE.MeshBasicMaterial({ color: 0x0e0e0e });
const doorFrameMat = new THREE.MeshBasicMaterial({ color: 0x1c1208 });
const candleMat    = new THREE.MeshBasicMaterial({ color: 0xddeedd });
const exitSignMat  = new THREE.MeshBasicMaterial({ color: 0xff2200 });
const ceilLightMat = new THREE.MeshBasicMaterial({ color: 0x2a3322 });
const bookMats     = [0x6b1a1a, 0x1a3a5b, 0x1a5b2a, 0x5b4a1a, 0x3a1a5b]
  .map(c => new THREE.MeshBasicMaterial({ color: c }));

// ═══════════════════════════════════════════════════════════════════════════════
//  GEOMETRY BATCH SYSTEM — merge all static geometry by material
//  → ~300 draw calls collapse to ~15 total
// ═══════════════════════════════════════════════════════════════════════════════
const _batch = new Map();
const _v1 = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler();
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

const bx = (w,h,d,x,y,z,mat)      => _push(_bxGeo(w,h,d), mat, x, y, z);
const pl = (w,h,x,y,z,rx,ry,mat)  => _push(_plGeo(w,h),   mat, x, y, z, rx, ry);

// ═══════════════════════════════════════════════════════════════════════════════
//  HALLWAY
// ═══════════════════════════════════════════════════════════════════════════════
function buildHallway() {
  const hw = HALF_W, hh = hallH, hl = hallL;

  pl(hl, hw*2,  0,  0,  hl/2, -Math.PI/2, 0, floorMat);
  pl(hl, hw*2,  0, hh,  hl/2,  Math.PI/2, 0, ceilMat);
  pl(hl, hh,  -hw, hh/2, hl/2, 0, Math.PI/2, wallMat);   // left wall

  // Right wall — segments around door openings
  let pz = 0;
  rooms.forEach(([,,dzS,dzE]) => {
    if (pz < dzS) { const l=dzS-pz; pl(l, hh, hw, hh/2, pz+l/2, 0, -Math.PI/2, wallMat); }
    const topH = hh - doorH;
    if (topH > 0.05) { const l=dzE-dzS; pl(l, topH, hw, hh-topH/2, (dzS+dzE)/2, 0, -Math.PI/2, wallMat); }
    pz = dzE;
  });
  if (pz < hl) { const l=hl-pz; pl(l, hh, hw, hh/2, pz+l/2, 0, -Math.PI/2, wallMat); }

  pl(hw*2, hh, 0, hh/2, 0, 0, 0, wallMat);   // back wall (z = 0)
  const exDW = 2.4, sideW = (hallW - exDW) / 2;
  pl(sideW, hh, -hw+sideW/2, hh/2, hl, 0, Math.PI, wallMat);
  pl(sideW, hh,  hw-sideW/2, hh/2, hl, 0, Math.PI, wallMat);
  const exTopH = hh - doorH;
  if (exTopH > 0) pl(exDW, exTopH, 0, hh-exTopH/2, hl, 0, Math.PI, wallMat);

  // ~56 lockers → all merged into ONE draw call
  const lW = 0.9, lH = 2.5, lD = 0.35;
  for (let z = 0.5; z < hl - 1; z += lW + 0.05)
    bx(lW, lH, lD, -hw+lD/2, lH/2, z+lW/2, lockerMat);

  // Fluorescent fixtures are loaded as GLTF in addLights().
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROOMS
// ═══════════════════════════════════════════════════════════════════════════════
function buildRoom(scene, roomIndex, interactiveObjects) {
  const [zS, zE, dzS, dzE] = rooms[roomIndex];
  const rW = roomW, rH = roomH, rL = zE - zS;
  const cx = HALF_W + rW / 2, cz = (zS + zE) / 2;

  pl(rW, rL, cx, 0,  cz, -Math.PI/2, 0, floorMat);
  pl(rW, rL, cx, rH, cz,  Math.PI/2, 0, ceilMat);
  pl(rL, rH, HALF_W+rW, rH/2, cz,  0, -Math.PI/2, wallMat);
  pl(rW, rH, cx, rH/2, zS,   0,         0, wallMat);
  pl(rW, rH, cx, rH/2, zE,   0, Math.PI, wallMat);

  const preDoor = dzS-zS, postDoor = zE-dzE, topH = rH-doorH, dCx = (dzS+dzE)/2;
  if (preDoor  > 0) pl(preDoor,  rH, HALF_W, rH/2, zS+preDoor/2,   0, Math.PI/2, wallMat);
  if (postDoor > 0) pl(postDoor, rH, HALF_W, rH/2, dzE+postDoor/2, 0, Math.PI/2, wallMat);
  if (topH > 0.05)  pl(doorW, topH,  HALF_W, rH-topH/2, dCx,       0, Math.PI/2, wallMat);

  const fT = 0.12;
  bx(fT, doorH, fT, HALF_W-fT/2, doorH/2, dzS, doorFrameMat);
  bx(fT, doorH, fT, HALF_W-fT/2, doorH/2, dzE, doorFrameMat);
  bx(doorW, fT, fT, HALF_W-fT/2, doorH+fT/2, dCx, doorFrameMat);

  // Chalkboard — unique texture per room, added directly
  const cbW = 4.5, cbH = 2.0;
  const cbMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(cbW, cbH),
    new THREE.MeshBasicMaterial({ map: chalkboardTex(['ROOM '+(roomIndex+1), 'SOLVE TO ESCAPE']) })
  );
  cbMesh.position.set(HALF_W+rW-0.05, cbH/2+0.9, cz);
  cbMesh.rotation.y = -Math.PI/2;
  scene.add(cbMesh);
  bx(0.06, cbH+0.12, cbW+0.12, HALF_W+rW-0.06, cbH/2+0.9, cz, doorFrameMat);

  // Teacher's desk
  const tdx = HALF_W+rW-1.5, tdz = cz+1;
  bx(1.8, 0.08, 0.9, tdx, 0.78, tdz, deskMat);
  bx(0.08, 0.78, 0.9, tdx-0.8, 0.39, tdz, deskMat);
  bx(0.08, 0.78, 0.9, tdx+0.8, 0.39, tdz, deskMat);

  // 6 student desks + chairs
  [[cx-2.5,zS+2],[cx,zS+2],[cx+2.5,zS+2],[cx-2.5,zS+4.5],[cx,zS+4.5],[cx+2.5,zS+4.5]]
  .forEach(([dx,dz]) => {
    bx(0.9, 0.06, 0.65, dx, 0.72, dz, deskMat);
    bx(0.05,0.72,0.05,dx-0.4,0.36,dz-0.28,darkMat); bx(0.05,0.72,0.05,dx+0.4,0.36,dz-0.28,darkMat);
    bx(0.05,0.72,0.05,dx-0.4,0.36,dz+0.28,darkMat); bx(0.05,0.72,0.05,dx+0.4,0.36,dz+0.28,darkMat);
    bx(0.7, 0.05, 0.6, dx, 0.48, dz+0.6, deskMat);
    bx(0.05,0.48,0.05,dx-0.3,0.24,dz+0.35,darkMat); bx(0.05,0.48,0.05,dx+0.3,0.24,dz+0.35,darkMat);
    bx(0.05,0.48,0.05,dx-0.3,0.24,dz+0.85,darkMat); bx(0.05,0.48,0.05,dx+0.3,0.24,dz+0.85,darkMat);
  });

  // Bookshelf
  const bsx = HALF_W+0.5, bsz = zS+1.5;
  bx(0.25,2.2,1.4,bsx,1.1,bsz,deskMat);
  [0.2,0.8,1.4,2.0].forEach(sy => bx(0.22,0.04,1.4,bsx+0.01,sy,bsz,darkMat));
  bookMats.forEach((bm,i) => bx(0.04,0.24,0.18,bsx+0.1,0.3+i*0.02,bsz-0.6+i*0.22,bm));

  // Candle
  bx(0.06,0.18,0.06,tdx-0.5,0.87,tdz-0.2,candleMat);

  // Exit sign
  bx(0.7,0.25,0.05,HALF_W+rW-0.8,rH-0.2,zE-0.1,exitSignMat);

  // Interactive notes — one per question, scattered around the room so the
  // player hunts for the next problem after solving each (spec req 4 & 5).
  // Order: teacher's desk → front student desk → back student desk →
  // bookshelf side → back wall by the exit sign.
  const noteSpots = [
    { x: tdx,     y: 0.84, z: tdz+0.1,  rx: -Math.PI/2, ry: 0 },          // teacher's desk
    { x: cx-2.5,  y: 0.78, z: zS+2,     rx: -Math.PI/2, ry: 0 },          // front-left student desk
    { x: cx+2.5,  y: 0.78, z: zS+4.5,   rx: -Math.PI/2, ry: 0 },          // back-right student desk
    { x: bsx+0.14, y: 1.3, z: bsz,      rx: 0,          ry: Math.PI/2 },  // bookshelf side
    { x: cx+2,    y: 1.4,  z: zE-0.02,  rx: 0,          ry: Math.PI },    // back wall near exit sign
  ];
  const roomNoteMeshes = noteSpots.map((s, noteIndex) => {
    const noteMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.35, 0.45),
      new THREE.MeshBasicMaterial({ color: 0xffffaa })
    );
    noteMesh.position.set(s.x, s.y, s.z);
    noteMesh.rotation.set(s.rx, s.ry, 0);
    noteMesh.userData.isInteractive = true;
    noteMesh.userData.roomIndex = roomIndex;
    noteMesh.userData.noteIndex = noteIndex;
    scene.add(noteMesh);
    interactiveObjects.push(noteMesh);
    return noteMesh;
  });
  return roomNoteMeshes;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROOM DOORS — rooms 2 and 3 stay locked until the previous room is cleared
//  (spec 1.4). The hinge group sits at the doorway's near edge; main.js swings
//  rotation.y open once the gate condition is met.
// ═══════════════════════════════════════════════════════════════════════════════
export const DOOR_OPEN_ANGLE = 1.92;   // ~110°, swings into the room past the bookshelf

function buildDoor(scene, roomIndex, interactiveObjects) {
  const [, , dzS, dzE] = rooms[roomIndex];
  const w = dzE - dzS;

  const group = new THREE.Group();
  group.position.set(HALF_W, 0, dzS);

  // Panel is a child offset from the hinge, so the group's rotation swings it
  // and getWorldPosition() (used by the interact check) tracks the door centre.
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, doorH - 0.05, w - 0.06),
    doorPanelMat
  );
  panel.position.set(0, (doorH - 0.05) / 2, (w - 0.06) / 2 + 0.03);
  panel.userData.isDoor    = true;
  panel.userData.doorIndex = roomIndex;
  panel.userData.locked    = roomIndex > 0;
  group.add(panel);
  interactiveObjects.push(panel);

  // Handle plates on both faces, latch side
  const handleGeo = new THREE.BoxGeometry(0.05, 0.2, 0.06);
  [-0.08, 0.08].forEach(hx => {
    const handle = new THREE.Mesh(handleGeo, darkMat);
    handle.position.set(hx, 1.05, w - 0.35);
    group.add(handle);
  });

  scene.add(group);
  return { group, panel };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXIT DOOR
// ═══════════════════════════════════════════════════════════════════════════════
function buildExitDoor(scene, interactiveObjects) {
  const hl = hallL, hh = hallH;

  bx(0.15,doorH,0.15,-1.3,doorH/2,hl,doorFrameMat);
  bx(0.15,doorH,0.15, 1.3,doorH/2,hl,doorFrameMat);
  bx(2.8, 0.15, 0.15,   0,doorH+0.08,hl,doorFrameMat);

  const doorFill = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, doorH),
    new THREE.MeshBasicMaterial({ color: 0x050510, transparent: true, opacity: 0.92 })
  );
  doorFill.position.set(0, doorH/2, hl-0.01);
  scene.add(doorFill);

  const keypad = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x003322 })
  );
  keypad.position.set(1.55, 1.4, hl-0.15);
  keypad.userData.isKeypad = true;
  scene.add(keypad);
  interactiveObjects.push(keypad);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x00ff88 })
  );
  screen.position.set(1.55, 1.55, hl-0.1);
  scene.add(screen);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIGHTS — restored for atmosphere
//  Large surface Lambert materials respond to these lights, creating dark corners,
//  warm candle glow, and the flickering broken-fluorescent hallway effect.
// ═══════════════════════════════════════════════════════════════════════════════
export const flickerLights = [];   // populated below; main.js updates intensity each frame

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

function addFluorescentFixture(scene, z, syncTarget) {
  if (!fluorescentTemplate) {
    pendingFluorescentFixtures.push({ scene, z, syncTarget });
    if (!fluorescentLoading) {
      fluorescentLoading = true;
      makeGLTFLoader().load(FLUORESCENT_MODEL_PATH, gltf => {
        fluorescentTemplate = gltf.scene;
        pendingFluorescentFixtures.splice(0).forEach(item => addFluorescentFixture(item.scene, item.z, item.syncTarget));
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
  group.position.set(0, hallH - 0.14, z);
  group.add(fixture);
  scene.add(group);

  syncTarget.emissiveMaterials.push(...emissiveMaterials);
}

function addLights(scene) {
  // Very dim cool ambient — keeps absolute-black areas just barely visible
  scene.add(new THREE.AmbientLight(0x242a38, 3.25));

  // Hallway fluorescents — cool blue-white, occasional sudden dim (broken tubes)
  HALL_LIGHT_ZS.forEach(z => {
    const l = new THREE.PointLight(0xa8b9d8, 5.4, 24);
    l.position.set(0, hallH - 0.3, z);
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
    glow.position.set(0, hallH - 0.22, z);
    glow.rotation.x = Math.PI / 2;
    scene.add(glow);
    syncTarget.glowMaterials.push(glowMat);

    addFluorescentFixture(scene, z, syncTarget);
  });

  // Candle per room — warm orange, gentle organic flicker
  rooms.forEach(([zS, zE]) => {
    const tdx = HALF_W + roomW - 1.5;
    const tdz = (zS + zE) / 2 + 1;
    const c = new THREE.PointLight(0xff7722, 5.8, 15);
    c.position.set(tdx - 0.5, 1.1, tdz - 0.2);
    scene.add(c);
    flickerLights.push({ light: c, base: 5.8, speed: 3 + Math.random(), amp: 1.5, type: 'candle' });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COLLISION
// ═══════════════════════════════════════════════════════════════════════════════
function buildCollision() {
  const hl = hallL, hw = HALF_W;
  const boxes = [];
  const add = (minX,maxX,minZ,maxZ) => boxes.push({minX,maxX,minZ,maxZ});
  const addBox = (x, z, w, d, pad = 0.08) =>
    add(x - w / 2 - pad, x + w / 2 + pad, z - d / 2 - pad, z + d / 2 + pad);

  add(-hw-0.3,-hw, 0, hl);
  add(-hw, hw, -0.3, 0);
  let pz = 0;
  rooms.forEach(([,,dzS,dzE]) => { add(hw,hw+0.3,pz,dzS); pz=dzE; });
  add(hw,hw+0.3,pz,hl);
  add(-hw,-1.3,hl,hl+0.3);
  add( 1.3, hw,hl,hl+0.3);
  rooms.forEach(([zS,zE]) => {
    add(hw,hw+roomW+0.3,zS-0.3,zS);
    add(hw,hw+roomW+0.3,zE,zE+0.3);
    add(hw+roomW,hw+roomW+0.3,zS,zE);
  });
  // Hall lockers protrude into the walking lane slightly.
  add(-hw-0.3,-hw+0.5,0,hl);

  // Room doors — main.js skips these boxes once the door is open.
  rooms.forEach(([,,dzS,dzE], i) =>
    boxes.push({ minX: hw-0.15, maxX: hw+0.15, minZ: dzS, maxZ: dzE, doorIndex: i }));

  rooms.forEach(([zS, zE]) => {
    const cx = HALF_W + roomW / 2;
    const cz = (zS + zE) / 2;

    // Teacher's desk / table.
    addBox(HALF_W + roomW - 1.5, cz + 1, 1.9, 1.0, 0.1);

    // Student desks and chairs.
    [[cx-2.5,zS+2],[cx,zS+2],[cx+2.5,zS+2],[cx-2.5,zS+4.5],[cx,zS+4.5],[cx+2.5,zS+4.5]]
      .forEach(([dx, dz]) => {
        addBox(dx, dz, 1.0, 0.75, 0.08);
        addBox(dx, dz + 0.6, 0.8, 0.7, 0.08);
      });

    // Bookshelf / side table area.
    addBox(HALF_W + 0.5, zS + 1.5, 0.5, 1.55, 0.08);
  });

  return boxes;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
export function buildWorld(scene) {
  buildHallway();
  const interactiveObjects = [];
  const roomNotes = rooms.map((_, i) => buildRoom(scene, i, interactiveObjects));
  const roomDoors = rooms.map((_, i) => buildDoor(scene, i, interactiveObjects));
  rooms.forEach(([zS, zE], i) => {
    const light = new THREE.PointLight(ROOM_LIGHT_COLORS[i], 1.15, 12, 2);
    light.position.set(HALF_W + roomW / 2, 2.0, (zS + zE) / 2);
    scene.add(light);
  });
  buildExitDoor(scene, interactiveObjects);
  addLights(scene);
  _flush(scene);   // merge all batched geometry → ~15 draw calls total
  return { wallBoxes: buildCollision(), interactiveObjects, roomNotes, roomDoors, exitZ };
}
