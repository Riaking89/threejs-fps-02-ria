// Ember Yard — geometry helpers. Everything here is pure math on plain arrays,
// no three.js, so the sim and the bots share one collision truth. A wall is
// [x1, z1, x2, z2, h]: an axis-aligned box from the ground up to height h.

// Ray (origin ox,oy,oz + direction dx,dy,dz, unit) vs one AABB. Returns the
// distance along the ray, or Infinity when it misses. Slab method, no allocation.
export function rayAABB(ox, oy, oz, dx, dy, dz, b, maxD) {
  let tmin = 0, tmax = maxD;
  // X slab
  if (dx === 0) { if (ox < b[0] || ox > b[2]) return Infinity; }
  else {
    let a = (b[0] - ox) / dx, c = (b[2] - ox) / dx;
    if (a > c) { const t = a; a = c; c = t; }
    if (a > tmin) tmin = a; if (c < tmax) tmax = c; if (tmin > tmax) return Infinity;
  }
  // Z slab
  if (dz === 0) { if (oz < b[1] || oz > b[3]) return Infinity; }
  else {
    let a = (b[1] - oz) / dz, c = (b[3] - oz) / dz;
    if (a > c) { const t = a; a = c; c = t; }
    if (a > tmin) tmin = a; if (c < tmax) tmax = c; if (tmin > tmax) return Infinity;
  }
  // Y slab (box spans 0..h)
  if (dy === 0) { if (oy < 0 || oy > b[4]) return Infinity; }
  else {
    let a = (0 - oy) / dy, c = (b[4] - oy) / dy;
    if (a > c) { const t = a; a = c; c = t; }
    if (a > tmin) tmin = a; if (c < tmax) tmax = c; if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Nearest wall hit along a ray, or Infinity. `walls` is the map's wall list.
export function rayWalls(ox, oy, oz, dx, dy, dz, walls, maxD) {
  let best = maxD;
  for (let i = 0; i < walls.length; i++) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, walls[i], best);
    if (t < best) best = t;
  }
  return best;
}

// Line of sight between two points at a given eye height: true when no wall
// blocks the segment. Used by bot perception and by the bomb-site checks.
export function hasLOS(x1, y1, z1, x2, y2, z2, walls) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.001) return true;
  const t = rayWalls(x1, y1, z1, dx / len, dy / len, dz / len, walls, len);
  return t >= len - 0.05;
}

// Move a circle (radius r, at x,z) by (mx,mz) against the walls, axis by axis
// so it slides along them instead of sticking. Returns [nx, nz].
export function moveCircle(x, z, mx, mz, r, walls) {
  let nx = x + mx;
  for (let i = 0; i < walls.length; i++) {
    const b = walls[i];
    if (z + r > b[1] && z - r < b[3] && nx + r > b[0] && nx - r < b[2]) {
      nx = mx > 0 ? b[0] - r : b[2] + r;
    }
  }
  let nz = z + mz;
  for (let i = 0; i < walls.length; i++) {
    const b = walls[i];
    if (nx + r > b[0] && nx - r < b[2] && nz + r > b[1] && nz - r < b[3]) {
      nz = mz > 0 ? b[1] - r : b[3] + r;
    }
  }
  return [nx, nz];
}

// Is point (x,z) inside a rectangular zone [x1,z1,x2,z2]?
export function inZone(x, z, zone) {
  return x >= zone[0] && x <= zone[2] && z >= zone[1] && z <= zone[3];
}

// Distance from a point to the nearest wall, for bot "too close to a wall" nudges.
export function wallClearance(x, z, walls) {
  let best = 99;
  for (let i = 0; i < walls.length; i++) {
    const b = walls[i];
    const cx = Math.max(b[0], Math.min(x, b[2]));
    const cz = Math.max(b[1], Math.min(z, b[3]));
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) best = d;
  }
  return best;
}
