// Ember Yard — the map. One original industrial yard at dusk: two lanes, a
// cluttered mid, and two bombsites on the defenders' side. Walls are data
// first ([x1,z1,x2,z2,h]) so collision, line-of-sight and rendering all agree;
// buildWorld turns the same data into three.js meshes.
import * as THREE from 'three';
import { hasLOS } from './collide.js';

export const BOUNDS = { x1: -32, z1: -24, x2: 32, z2: 24 };

// [x1, z1, x2, z2, height, kind] — kind picks the material.
export const WALLS = [
  // perimeter
  [-33, -25, 33, -24, 4, 'wall'], [-33, 24, 33, 25, 4, 'wall'],
  [-33, -25, -32, 25, 4, 'wall'], [32, -25, 33, 25, 4, 'wall'],
  // mid chokes: two tall slabs force the fight around their ends
  [-12, -6, -9, 6, 3.2, 'wall'], [9, -6, 12, 6, 3.2, 'wall'],
  // mid crates
  [-2, -3, 2, -1, 1.2, 'crate'], [-4, 1, -1, 3, 2.6, 'metal'],
  [2, 2, 5, 4, 1.2, 'crate'], [-6, -6, -3, -4, 2.6, 'metal'],
  [4, -5, 7, -3, 2.6, 'metal'], [0, 8, 3, 10, 1.2, 'crate'],
  [-3, -10, 0, -8, 1.2, 'crate'],
  // A lane (north) cover
  [-14, -20, -10, -16, 3.0, 'wall'], [2, -20, 6, -17, 3.0, 'wall'],
  [12, -14, 15, -11, 2.6, 'metal'], [-22, -14, -19, -11, 2.6, 'metal'],
  // B lane (south) cover
  [-14, 16, -10, 20, 3.0, 'wall'], [2, 17, 6, 20, 3.0, 'wall'],
  [12, 11, 15, 14, 2.6, 'metal'], [-22, 11, -19, 14, 2.6, 'metal'],
  // Site A (Furnace) cover
  [24, -21, 27, -18, 2.6, 'metal'], [16, -13, 19, -10, 1.2, 'hazard'],
  [26, -13, 29, -11, 2.6, 'metal'],
  // Site B (Depot) cover
  [24, 18, 27, 21, 2.6, 'metal'], [16, 10, 19, 13, 1.2, 'hazard'],
  [26, 11, 29, 13, 2.6, 'metal'],
];

export const SITES = {
  A: { name: 'Furnace', zone: [15, -22, 30, -10], cx: 22, cz: -16, color: 0xff7a2f },
  B: { name: 'Depot', zone: [15, 10, 30, 22], cx: 22, cz: 16, color: 0x7fa8c9 },
};

export const SPAWNS = {
  ember: [[-28, -4.5], [-28, -1.5], [-28, 1.5], [-28, 4.5]],
  ash: [[28, -4.5], [28, -1.5], [28, 1.5], [28, 4.5]],
};

// Waypoint graph for bot routes. Edges are auto-built: two nodes link when
// they are within 13 m and have line of sight at head height.
export const WAYPOINTS = [
  [-28, 0], [-22, -10], [-22, 10], [-20, 0], [-14, -14], [-14, 14],
  [-6, -18], [-6, 18], [-6, 0], [0, -8], [0, 8], [0, 0],
  [6, -14], [6, 14], [6, 0], [14, -18], [14, 18], [14, -6], [14, 6],
  [22, -16], [22, 16], [28, 0], [16, 0],
];

export function buildEdges() {
  const edges = WAYPOINTS.map(() => []);
  for (let i = 0; i < WAYPOINTS.length; i++) {
    for (let j = i + 1; j < WAYPOINTS.length; j++) {
      const [ax, az] = WAYPOINTS[i], [bx, bz] = WAYPOINTS[j];
      const d = Math.hypot(ax - bx, az - bz);
      if (d < 13.5 && hasLOS(ax, 1.2, az, bx, 1.2, bz, WALLS)) {
        edges[i].push(j); edges[j].push(i);
      }
    }
  }
  return edges;
}

export const EDGES = buildEdges();

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const d = (WAYPOINTS[i][0] - x) ** 2 + (WAYPOINTS[i][1] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// BFS over the waypoint graph. Returns an array of node indices, start excluded.
export function findPath(sx, sz, tx, tz) {
  const start = nearestWaypoint(sx, sz), goal = nearestWaypoint(tx, tz);
  if (start === goal) return [goal];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [start]; prev[start] = start;
  while (queue.length) {
    const n = queue.shift();
    if (n === goal) break;
    for (const m of EDGES[n]) {
      if (prev[m] === -1) { prev[m] = n; queue.push(m); }
    }
  }
  if (prev[goal] === -1) return [goal];
  const path = []; let n = goal;
  while (n !== start) { path.unshift(n); n = prev[n]; }
  return path;
}

// ---- rendering -------------------------------------------------------------

const MATS = {};
function mat(kind) {
  if (MATS[kind]) return MATS[kind];
  const defs = {
    wall: { color: 0x4a525e, roughness: 0.95 },
    crate: { color: 0x7a5c38, roughness: 0.9 },
    metal: { color: 0x4a5a68, roughness: 0.55, metalness: 0.45 },
    hazard: { color: 0xd8a020, roughness: 0.7 },
  };
  const d = defs[kind] || defs.wall;
  return (MATS[kind] = new THREE.MeshStandardMaterial(d));
}

function letterTexture(letter, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 128, 128);
  g.strokeStyle = color; g.lineWidth = 6;
  g.strokeRect(8, 8, 112, 112);
  g.fillStyle = color; g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  return t;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x141a26);
  scene.fog = new THREE.Fog(0x141a26, 30, 95);

  const hemi = new THREE.HemisphereLight(0x8fa3c7, 0x2a2018, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb347, 1.35);
  sun.position.set(-30, 38, -18);
  scene.add(sun);

  // ground: dark asphalt with a subtle grid painted by texture
  const gc = document.createElement('canvas'); gc.width = gc.height = 256;
  const gg = gc.getContext('2d');
  gg.fillStyle = '#33383f'; gg.fillRect(0, 0, 256, 256);
  gg.strokeStyle = 'rgba(255,255,255,0.045)'; gg.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) {
    gg.beginPath(); gg.moveTo(i, 0); gg.lineTo(i, 256); gg.stroke();
    gg.beginPath(); gg.moveTo(0, i); gg.lineTo(256, i); gg.stroke();
  }
  const gtex = new THREE.CanvasTexture(gc);
  gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping; gtex.repeat.set(16, 12);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 54),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 0);
  scene.add(ground);

  // walls and crates from the same data the sim uses
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [x1, z1, x2, z2, h, kind] of WALLS) {
    const m = new THREE.Mesh(boxGeo, mat(kind));
    m.scale.set(x2 - x1, h, z2 - z1);
    m.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
    scene.add(m);
    // a bright cap on low crates so they read as cover, not floor
    if (h <= 1.2) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(x2 - x1 + 0.08, 0.08, z2 - z1 + 0.08),
        new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.8 }),
      );
      cap.position.set((x1 + x2) / 2, h + 0.04, (z1 + z2) / 2);
      scene.add(cap);
    }
  }

  // site floor plates + floating letters
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(s.zone[2] - s.zone[0], s.zone[3] - s.zone[1]),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.10 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(s.cx, 0.02, s.cz);
    scene.add(plate);
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ map: letterTexture(key, key === 'A' ? '#ff7a2f' : '#7fa8c9'), transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.cx, 0.03, s.cz);
    scene.add(letter);
  }

  // sodium lamps on poles: warm pools of light at the chokes and sites
  const lampSpots = [[-10, 0], [10, 0], [22, -16], [22, 16], [-28, 0], [28, 0]];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.6, metalness: 0.5 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0xff9a2f, emissiveIntensity: 2.2 });
  for (const [lx, lz] of lampSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), poleMat);
    pole.position.set(lx + 0.8, 2.7, lz + 0.8); scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), bulbMat);
    bulb.position.set(lx + 0.8, 5.5, lz + 0.8); scene.add(bulb);
    const light = new THREE.PointLight(0xff9a2f, 22, 20, 1.8);
    light.position.set(lx + 0.8, 5.2, lz + 0.8); scene.add(light);
  }

  // distant skyline silhouettes outside the walls, for depth
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x1d2636 });
  const skyline = [[-45, -35, 8, 18], [-20, -38, 12, 26], [5, -36, 7, 14], [30, -34, 10, 22], [45, -20, 8, 16], [-48, 10, 9, 20], [46, 18, 11, 24], [-30, 38, 10, 18], [10, 40, 8, 15]];
  for (const [sx, sz, w, h] of skyline) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyMat);
    b.position.set(sx, h / 2 - 1, sz); scene.add(b);
  }

  // the charge: a small device with a blinking light, hidden until planted/dropped
  const bomb = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.22, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.4, metalness: 0.6 }),
  );
  bomb.add(body);
  const blink = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2f2f }),
  );
  blink.position.set(0.18, 0.14, 0); bomb.add(blink);
  bomb.visible = false;
  scene.add(bomb);
  return { bomb, blink };
}
