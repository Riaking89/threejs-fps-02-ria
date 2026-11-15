// Ember Yard — the human player. Acceleration-based movement (so stopping to
// aim is a real decision), crouch and sprint, pointer-lock mouse look with a
// drag-look fallback, and the plant/defuse channel that wins rounds.
import { MATCH } from './state.js';
import { moveCircle, inZone } from './collide.js';
import { WALLS, SITES } from './map.js';
import { aimDir, fire, startReload, finishReload, throwGrenade, eyeHeight } from './weapons.js';

const RADIUS = 0.35;
const ACCEL = 34; // m/s^2 toward the target velocity
const FRICTION = 12; // 1/s decay when no input

export function createInput() {
  return {
    fwd: false, back: false, left: false, right: false,
    sprint: false, crouch: false, fire: false, ads: false,
    reload: false, use: false, grenade: false,
    weaponSlot: 0, buyKey: 0, lookDX: 0, lookDY: 0,
  };
}

// One fixed step of player movement + actions. `events` collects things the
// caller must render or sound (shots, reloads, plants) — the sim never draws.
export function stepPlayer(match, p, input, dt, events) {
  if (!p.alive) return;
  p.crouched = input.crouch;
  const speed = p.crouched ? MATCH.crouchSpeed : (input.sprint && !input.ads ? MATCH.sprintSpeed : MATCH.walkSpeed);
  // wish direction in world space from yaw
  let wx = 0, wz = 0;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  if (input.fwd) { wx -= sy; wz -= cy; }
  if (input.back) { wx += sy; wz += cy; }
  if (input.left) { wx -= cy; wz += sy; }
  if (input.right) { wx += cy; wz -= sy; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const tx = wx * speed, tz = wz * speed;
  // accelerate toward the target velocity; friction when idle
  const k = wl > 0 ? ACCEL * dt : FRICTION * dt;
  p.vx += (tx - p.vx) * Math.min(1, k);
  p.vz += (tz - p.vz) * Math.min(1, k);
  const [nx, nz] = moveCircle(p.x, p.z, p.vx * dt, p.vz * dt, RADIUS, WALLS);
  p.x = nx; p.z = nz;
  p.moveMag = Math.min(1, Math.hypot(p.vx, p.vz) / MATCH.walkSpeed);
  p.sprinting = input.sprint && wl > 0 && !p.crouched && !input.ads;
  p.ads = input.ads && !p.sprinting;

  // look: accumulated mouse deltas, sensitivity tightens while aiming
  const sens = p.ads ? 0.0011 : 0.0021;
  p.yaw -= input.lookDX * sens;
  p.pitch -= input.lookDY * sens;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  input.lookDX = 0; input.lookDY = 0;

  // bloom recovery (firing on the move stays punished until you stop)
  p.bloom = Math.max(0, p.bloom - dt * 0.055);

  // reload
  if (input.reload) { input.reload = false; if (startReload(p)) events.push({ type: 'reload', f: p }); }
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) { finishReload(p); events.push({ type: 'reloaded', f: p }); }
  }
  // weapon switching
  if (input.weaponSlot) {
    const slot = input.weaponSlot; input.weaponSlot = 0;
    const owned = p.owned;
    if (slot >= 1 && slot <= owned.length) {
      const w = owned[slot - 1];
      if (w !== p.weapon) { p.weapon = w; p.reloadT = 0; events.push({ type: 'switch', f: p }); }
    }
  }
  // firing (semi-auto weapons need a fresh click; the caller clears input.fire)
  if (input.fire) {
    const dir = aimDir(p, [0, 0, 0]);
    const ev = fire(match, p, dir, match.rng);
    if (ev) events.push({ type: 'shot', ...ev });
  }
  // grenade
  if (input.grenade) {
    input.grenade = false;
    if (p.frags > 0) {
      const dir = aimDir(p, [0, 0, 0]);
      throwGrenade(match, p, dir);
      events.push({ type: 'throw', f: p });
    }
  }

  // plant / defuse channel: hold E inside a site (attackers) or near the
  // planted charge (defenders). Moving or taking damage breaks the channel.
  stepChannel(match, p, input, dt, events);
}

function stepChannel(match, p, input, dt, events) {
  const bomb = match.bomb;
  const inSite = (site) => inZone(p.x, p.z, SITES[site].zone);
  if (p.team === 'ember' && bomb.state === 'carried' && bomb.carrier === 'player') {
    const site = inSite('A') ? 'A' : inSite('B') ? 'B' : null;
    if (site && input.use && p.moveMag < 0.15) {
      bomb.plantT += dt;
      events.push({ type: 'channel', f: p, kind: 'plant', t: bomb.plantT / MATCH.plantSeconds });
      if (bomb.plantT >= MATCH.plantSeconds) {
        bomb.state = 'planted'; bomb.site = site;
        bomb.x = p.x; bomb.z = p.z; bomb.fuseT = MATCH.bombFuseSeconds;
        bomb.plantT = 0;
        events.push({ type: 'planted', f: p, site });
      }
    } else if (bomb.plantT > 0) { bomb.plantT = 0; }
    return;
  }
  if (p.team === 'ash' && bomb.state === 'planted') {
    const d = Math.hypot(p.x - bomb.x, p.z - bomb.z);
    if (d < 2.2 && input.use && p.moveMag < 0.15) {
      bomb.defuseT += dt;
      events.push({ type: 'channel', f: p, kind: 'defuse', t: bomb.defuseT / MATCH.defuseSeconds });
      if (bomb.defuseT >= MATCH.defuseSeconds) {
        bomb.state = 'defused';
        events.push({ type: 'defused', f: p });
      }
    } else if (bomb.defuseT > 0) { bomb.defuseT = 0; }
  }
}

// The bomb drops where its carrier dies; a teammate walking over it picks it up.
export function dropBomb(match, carrier) {
  const bomb = match.bomb;
  if (bomb.state !== 'carried') return;
  bomb.state = 'dropped'; bomb.carrier = null;
  bomb.x = carrier.x; bomb.z = carrier.z;
}

export function tryPickupBomb(match, f) {
  const bomb = match.bomb;
  if (bomb.state !== 'dropped' || f.team !== 'ember' || !f.alive) return;
  if (Math.hypot(f.x - bomb.x, f.z - bomb.z) < 1.1) {
    bomb.state = 'carried'; bomb.carrier = f.id;
  }
}

export { eyeHeight };
