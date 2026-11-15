// Ember Yard — weapons. Hitscan guns with spread, recoil bloom, damage falloff
// and headshots; a thrown frag grenade with a fuse. All shooting is one ray
// (or a pellet fan) against wall AABBs and fighter hitboxes, so what the
// player sees is exactly what the sim scores.
import { WEAPONS } from './state.js';
import { rayWalls, rayAABB } from './collide.js';
import { WALLS } from './map.js';

const EYE = 1.55; // standing eye height
const CROUCH_EYE = 1.05;

// Ray vs an arbitrary 3D box [x1,y1,z1,x2,y2,z2]. Slab test, no allocation.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxD) {
  let tmin = 0, tmax = maxD;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [b[0], b[1], b[2]], hi = [b[3], b[4], b[5]];
  for (let a = 0; a < 3; a++) {
    if (d[a] === 0) { if (o[a] < lo[a] || o[a] > hi[a]) return Infinity; }
    else {
      let x = (lo[a] - o[a]) / d[a], y = (hi[a] - o[a]) / d[a];
      if (x > y) { const t = x; x = y; y = t; }
      if (x > tmin) tmin = x;
      if (y < tmax) tmax = y;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Hitbox of a fighter: [bodyBox, headBox] in world coords.
export function hitboxes(f) {
  const h = f.crouched ? 0.95 : 1.35;
  const headY = f.crouched ? 0.95 : 1.35;
  const headTop = f.crouched ? 1.25 : 1.70;
  return [
    [f.x - 0.35, 0, f.z - 0.35, f.x + 0.35, h, f.z + 0.35],
    [f.x - 0.22, headY, f.z - 0.22, f.x + 0.22, headTop, f.z + 0.22],
  ];
}

export function eyeHeight(f) {
  return f.crouched ? CROUCH_EYE : EYE;
}

// Unit direction of a fighter's aim from yaw/pitch.
export function aimDir(f, out) {
  const cp = Math.cos(f.pitch);
  out[0] = -Math.sin(f.yaw) * cp;
  out[1] = Math.sin(f.pitch);
  out[2] = -Math.cos(f.yaw) * cp;
  return out;
}

// Can this fighter fire right now? (rate, ammo, reload, alive)
export function canFire(match, f) {
  if (!f.alive || f.reloadT > 0) return false;
  const w = WEAPONS[f.weapon];
  if (f.mag <= 0) return false;
  const gap = 60 / w.rpm;
  return match.time - f.lastShotT >= gap;
}

// One shot (or one pellet fan for the shotgun). `dir` is the base aim unit
// vector; spread and bloom are applied per pellet. Returns an event object
// the caller feeds to effects + audio, or null when the shot cannot happen.
export function fire(match, f, dir, rng) {
  if (!canFire(match, f)) return null;
  const w = WEAPONS[f.weapon];
  f.lastShotT = match.time;
  f.mag -= 1;
  match.shotsFired += 1;
  // Spread: base + movement penalty + bloom from recent fire; crouch and ADS
  // tighten it. Standing still and aiming down sights is the accurate play.
  let spread = w.spread + w.moveSpread * f.moveMag + f.bloom;
  if (f.crouched) spread *= 0.75;
  if (f.ads) spread *= w.adsMult;
  f.bloom = Math.min(0.09, f.bloom + w.recoil);
  const pellets = w.pellets || 1;
  const ox = f.x, oy = f.y + eyeHeight(f), oz = f.z;
  const hits = [];
  let endX = ox + dir[0] * 120, endY = oy + dir[1] * 120, endZ = oz + dir[2] * 120;
  let wallT = 120;
  for (let p = 0; p < pellets; p++) {
    // random cone offset, no allocation beyond the loop locals
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * spread;
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    // build a perturbed direction from the aim vector (orthonormal-ish basis)
    const rx = dir[2], rz = -dir[0]; // right vector on the XZ plane
    const ux = -dir[1] * dir[0], uy = 1 - dir[1] * dir[1], uz = -dir[1] * dir[2]; // up-ish
    let dx = dir[0] + rx * px + ux * py;
    let dy = dir[1] + uy * py;
    let dz = dir[2] + rz * px + uz * py;
    const len = Math.hypot(dx, dy, dz);
    dx /= len; dy /= len; dz /= len;
    const wT = rayWalls(ox, oy, oz, dx, dy, dz, WALLS, 120);
    let bestT = wT, bestF = null, bestHead = false;
    for (const other of match.fighters) {
      if (other === f || !other.alive || other.team === f.team) continue;
      const [body, head] = hitboxes(other);
      const th = rayBox(ox, oy, oz, dx, dy, dz, head, bestT);
      if (th < bestT) { bestT = th; bestF = other; bestHead = true; continue; }
      const tb = rayBox(ox, oy, oz, dx, dy, dz, body, bestT);
      if (tb < bestT) { bestT = tb; bestF = other; bestHead = false; }
    }
    if (bestF) {
      const dist = bestT;
      const [near, far, farMult] = w.range;
      const fall = dist <= near ? 1 : dist >= far ? farMult : 1 - (1 - farMult) * (dist - near) / (far - near);
      const dmg = Math.max(1, Math.round(w.damage * fall * (bestHead ? w.headMult : 1)));
      hits.push({ target: bestF, dmg, head: bestHead, dist });
      match.shotsHit += 1;
    }
    if (wT < wallT) {
      wallT = wT;
      endX = ox + dx * wT; endY = oy + dy * wT; endZ = oz + dz * wT;
    }
  }
  return {
    shooter: f, weapon: w, hits,
    from: [ox, oy, oz], to: [endX, endY, endZ], wallT,
  };
}

export function startReload(f) {
  const w = WEAPONS[f.weapon];
  if (f.reloadT > 0 || f.mag >= w.mag || f.reserve <= 0) return false;
  f.reloadT = w.reloadMs / 1000;
  return true;
}

export function finishReload(f) {
  const w = WEAPONS[f.weapon];
  const need = w.mag - f.mag;
  const take = Math.min(need, f.reserve);
  f.mag += take;
  if (f.reserve !== Infinity) f.reserve -= take;
  f.reloadT = 0;
}

// ---- frag grenade ----------------------------------------------------------
// A live grenade: simple ballistic arc, bounces once off the floor, then
// explodes after its fuse. Stored on match.grenades by main.js.
export function throwGrenade(match, f, dir) {
  const speed = 17;
  match.grenades.push({
    x: f.x, y: f.y + eyeHeight(f), z: f.z,
    vx: dir[0] * speed, vy: dir[1] * speed + 3.5, vz: dir[2] * speed,
    fuse: WEAPONS.frag.fuseMs / 1000, owner: f, bounced: false,
  });
  f.frags -= 1;
}

export function stepGrenade(match, g, dt, onExplode) {
  g.fuse -= dt;
  g.vy -= 18 * dt;
  let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
  if (ny < 0.12) {
    ny = 0.12;
    if (!g.bounced) { g.vy = -g.vy * 0.45; g.vx *= 0.7; g.vz *= 0.7; g.bounced = true; }
    else { g.vy = 0; g.vx *= 0.8; g.vz *= 0.8; }
  }
  // cheap wall stop: if the next spot is inside a wall box, kill velocity
  for (const b of WALLS) {
    if (nx > b[0] && nx < b[2] && nz > b[1] && nz < b[3] && ny < b[4]) {
      g.vx *= -0.3; g.vz *= -0.3; nx = g.x; nz = g.z;
      break;
    }
  }
  g.x = nx; g.y = ny; g.z = nz;
  if (g.fuse <= 0) onExplode(g);
}

// Explosion damage: full at the centre, linear falloff to the radius edge,
// halved through a wall.
export function explodeDamage(match, g) {
  const out = [];
  const w = WEAPONS.frag;
  for (const f of match.fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.x - g.x, (f.y + 0.9) - g.y, f.z - g.z);
    if (d > w.radius) continue;
    let dmg = Math.round(w.damage * (1 - (d / w.radius) * 0.75));
    if (!rayWallsClear(g.x, g.y, g.z, f.x, f.y + 0.9, f.z)) dmg = Math.round(dmg * 0.5);
    out.push({ target: f, dmg, head: false, dist: d });
  }
  return out;
}

function rayWallsClear(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return true;
  return rayWalls(x1, y1, z1, dx / len, dy / len, dz / len, WALLS, len) >= len - 0.05;
}

export { rayAABB };
