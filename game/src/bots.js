// Ember Yard — bot brains. One state machine per bot: routes through the
// waypoint graph, holds positions, reacts to what it sees and hears, and
// fights in bursts with human-like reaction time and aim error. Bots use the
// same movement, weapons and spread rules as the player, so they win and lose
// fair fights.
import { MATCH, WEAPONS } from './state.js';
import { moveCircle, hasLOS, inZone } from './collide.js';
import { WALLS, SITES, WAYPOINTS, findPath, nearestWaypoint } from './map.js';
import { aimDir, fire, startReload, finishReload, eyeHeight, throwGrenade } from './weapons.js';
import { dropBomb, tryPickupBomb } from './player.js';

const BOT_NAMES = {
  ember: ['Rook', 'Vex', 'Pip'],
  ash: ['Sable', 'Mira', 'Onyx', 'Frost'],
};

export function makeBot(f, role, site, rng) {
  f.bot = {
    role, site,
    state: 'move', path: [], pathI: 0, holdT: 0,
    enemy: null, lastSeenT: -9, lastSeenX: 0, lastSeenZ: 0,
    reactT: 0, burstLeft: 0, burstPauseT: 0, aimErr: 0,
    strafeDir: 1, strafeT: 0, thinkT: 0, noiseX: 0, noiseZ: 0, noiseT: -9,
    destX: 0, destZ: 0, planted: false,
  };
  return f;
}

// Assign routes at round start: attackers split across the sites, defenders
// hold one site each, and the bomb carrier is the first attacker bot.
export function assignRound(match) {
  const emberBots = match.fighters.filter((f) => f.team === 'ember' && !f.isPlayer);
  const ashBots = match.fighters.filter((f) => f.team === 'ash');
  emberBots.forEach((b, i) => {
    b.bot.site = i < 2 ? 'A' : 'B';
    b.bot.role = 'attack';
    const s = SITES[b.bot.site];
    b.bot.path = findPath(b.x, b.z, s.cx, s.cz);
    b.bot.pathI = 0; b.bot.state = 'move';
  });
  ashBots.forEach((b, i) => {
    b.bot.site = i % 2 === 0 ? 'A' : 'B';
    b.bot.role = 'defend';
    const s = SITES[b.bot.site];
    // hold a waypoint just outside the site, watching an approach lane
    const hold = s.cx - 8 + (i % 2) * 3;
    b.bot.path = findPath(b.x, b.z, hold, s.cz + (i % 2 === 0 ? -6 : 6));
    b.bot.pathI = 0; b.bot.state = 'move';
  });
  // bomb carrier: the player carries it unless dead; else first living ember bot
  if (match.bomb.state === 'carried' && match.bomb.carrier !== 'player') {
    match.bomb.carrier = emberBots[0] ? emberBots[0].id : null;
  }
}

// Auto-buy for bots during the buy phase.
export function botBuy(f, rng) {
  if (f.money >= WEAPONS.vk47.price && !f.owned.includes('vk47')) {
    f.money -= WEAPONS.vk47.price;
    f.owned.push('vk47'); f.weapon = 'vk47';
    f.mag = WEAPONS.vk47.mag; f.reserve = WEAPONS.vk47.reserve;
  }
  if (f.money >= WEAPONS.frag.price && f.frags < 1 && rng() < 0.5) {
    f.money -= WEAPONS.frag.price; f.frags = 1;
  }
}

function perceive(match, f) {
  const b = f.bot;
  let best = null, bestD = 55;
  const eyeY = f.y + eyeHeight(f);
  for (const e of match.fighters) {
    if (!e.alive || e.team === f.team) continue;
    const d = Math.hypot(e.x - f.x, e.z - f.z);
    if (d > bestD) continue;
    // field of view: 110 degrees, or point-blank hearing range
    const ang = Math.atan2(-(e.x - f.x), -(e.z - f.z));
    let da = ang - f.yaw;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const inView = Math.abs(da) < 0.96 || d < 6;
    if (!inView) continue;
    if (!hasLOS(f.x, eyeY, f.z, e.x, e.y + eyeHeight(e) * 0.8, e.z, WALLS)) continue;
    best = e; bestD = d;
  }
  if (best) {
    if (b.enemy !== best) b.reactT = match.time + 0.35 + match.rng() * 0.3;
    b.enemy = best; b.lastSeenT = match.time;
    b.lastSeenX = best.x; b.lastSeenZ = best.z;
  } else if (b.enemy && match.time - b.lastSeenT > 1.2) {
    b.enemy = null;
  }
}

// Steer toward (tx,tz) at walk speed with acceleration, like the player.
function steer(f, tx, tz, dt, speed) {
  const dx = tx - f.x, dz = tz - f.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return true;
  const vx = (dx / d) * speed, vz = (dz / d) * speed;
  f.vx += (vx - f.vx) * Math.min(1, 20 * dt);
  f.vz += (vz - f.vz) * Math.min(1, 20 * dt);
  const [nx, nz] = moveCircle(f.x, f.z, f.vx * dt, f.vz * dt, 0.35, WALLS);
  f.x = nx; f.z = nz;
  f.moveMag = Math.min(1, Math.hypot(f.vx, f.vz) / MATCH.walkSpeed);
  return false;
}

function aimAt(f, tx, ty, tz, err, dt) {
  const dx = tx - f.x, dy = ty - (f.y + eyeHeight(f)), dz = tz - f.z;
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
  let dyaw = wantYaw - f.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const turn = 4.5 * dt;
  f.yaw += Math.max(-turn, Math.min(turn, dyaw));
  f.pitch += Math.max(-turn, Math.min(turn, wantPitch - f.pitch));
  f.aimErr = err;
}

export function stepBot(match, f, dt, events) {
  const b = f.bot;
  if (!f.alive || !b) return;
  perceive(match, f);
  const now = match.time;
  const bomb = match.bomb;

  // --- think at 5 Hz: pick a destination and a state -----------------------
  if (now >= b.thinkT) {
    b.thinkT = now + 0.2;
    const enemy = b.enemy;
    if (enemy && now >= b.reactT) b.state = 'engage';
    else if (b.role === 'attack') {
      if (bomb.state === 'dropped') {
        b.state = 'fetch';
        b.path = findPath(f.x, f.z, bomb.x, bomb.z); b.pathI = 0;
      } else if (bomb.state === 'carried' && bomb.carrier === f.id) {
        const s = SITES[b.site];
        if (inZone(f.x, f.z, s.zone)) b.state = 'plant';
        else { b.state = 'move'; b.path = findPath(f.x, f.z, s.cx, s.cz); b.pathI = 0; }
      } else if (bomb.state === 'planted') {
        b.state = 'guard'; // hold near the planted charge
        b.path = findPath(f.x, f.z, bomb.x + 4, bomb.z); b.pathI = 0;
      } else if (b.state !== 'engage') {
        b.state = 'move';
        const s = SITES[b.site];
        if (b.pathI >= b.path.length) { b.path = findPath(f.x, f.z, s.cx, s.cz); b.pathI = 0; }
      }
    } else {
      // defender
      if (bomb.state === 'planted') {
        b.state = 'defuse';
        b.path = findPath(f.x, f.z, bomb.x, bomb.z); b.pathI = 0;
      } else if (now - b.noiseT < 3 && b.noiseX !== 0) {
        b.state = 'investigate';
        b.path = findPath(f.x, f.z, b.noiseX, b.noiseZ); b.pathI = 0;
      } else if (b.state !== 'engage' && b.state !== 'hold') {
        b.state = b.pathI >= b.path.length ? 'hold' : 'move';
      }
    }
    // reload when safe and low
    const w = WEAPONS[f.weapon];
    if (!enemy && f.mag <= w.mag * 0.3 && f.reloadT <= 0 && f.reserve > 0) {
      if (startReload(f)) events.push({ type: 'reload', f });
    }
  }

  // --- act ------------------------------------------------------------------
  f.bloom = Math.max(0, f.bloom - dt * 0.05);
  if (f.reloadT > 0) {
    f.reloadT -= dt;
    if (f.reloadT <= 0) finishReload(f);
  }
  const enemy = b.enemy;
  if (b.state === 'engage' && enemy && enemy.alive) {
    // face the enemy, strafe a little, stop to shoot straight
    const head = match.rng() < 0.25;
    const ty = enemy.y + (head ? eyeHeight(enemy) + 0.12 : 0.9);
    const dist = Math.hypot(enemy.x - f.x, enemy.z - f.z);
    const err = 0.012 + dist * 0.0009 + enemy.moveMag * 0.02 + f.moveMag * 0.025;
    aimAt(f, enemy.x, ty, enemy.z, err, dt);
    // strafe perpendicular while the burst pauses, stand still while firing
    if (now >= b.strafeT) { b.strafeT = now + 0.5 + match.rng() * 0.7; b.strafeDir *= -1; }
    if (b.burstLeft <= 0 && now >= b.burstPauseT) {
      b.burstLeft = 3 + Math.floor(match.rng() * 3);
      b.burstPauseT = now + 0.45 + match.rng() * 0.5;
    }
    if (b.burstLeft > 0 && now >= b.reactT) {
      const dir = aimDir(f, [0, 0, 0]);
      // add the aim error as a small random cone
      const a = match.rng() * Math.PI * 2, r = Math.sqrt(match.rng()) * err * 2;
      const rx = dir[2], rz = -dir[0];
      let dx = dir[0] + rx * Math.cos(a) * r;
      let dy = dir[1] + Math.sin(a) * r;
      let dz = dir[2] + rz * Math.cos(a) * r;
      const len = Math.hypot(dx, dy, dz); dx /= len; dy /= len; dz /= len;
      const ev = fire(match, f, [dx, dy, dz], match.rng);
      if (ev) { events.push({ type: 'shot', ...ev }); b.burstLeft -= 1; }
      else if (f.mag <= 0 && f.reloadT <= 0) { startReload(f); }
      f.vx *= 0.5; f.vz *= 0.5; // plant feet while shooting
    } else {
      // strafe step
      const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
      const mx = -cy * b.strafeDir * 1.6 * dt, mz = sy * b.strafeDir * 1.6 * dt;
      const [nx, nz] = moveCircle(f.x, f.z, mx, mz, 0.35, WALLS);
      f.x = nx; f.z = nz;
      f.moveMag = 0.4;
    }
    return;
  }

  if (b.state === 'plant' && bomb.state === 'carried' && bomb.carrier === f.id) {
    bomb.plantT += dt;
    events.push({ type: 'channel', f, kind: 'plant', t: bomb.plantT / MATCH.plantSeconds });
    if (bomb.plantT >= MATCH.plantSeconds) {
      const s = SITES[b.site];
      bomb.state = 'planted'; bomb.site = b.site;
      bomb.x = f.x; bomb.z = f.z; bomb.fuseT = MATCH.bombFuseSeconds; bomb.plantT = 0;
      events.push({ type: 'planted', f, site: b.site });
    }
    return;
  }
  if (b.state === 'defuse' && bomb.state === 'planted') {
    const d = Math.hypot(f.x - bomb.x, f.z - bomb.z);
    if (d < 2.2) {
      bomb.defuseT += dt;
      events.push({ type: 'channel', f, kind: 'defuse', t: bomb.defuseT / MATCH.defuseSeconds });
      if (bomb.defuseT >= MATCH.defuseSeconds) {
        bomb.state = 'defused';
        events.push({ type: 'defused', f });
      }
      return;
    }
  }

  // follow the current path; hold when the path is done
  if (b.state === 'move' || b.state === 'fetch' || b.state === 'guard' || b.state === 'investigate' || b.state === 'defuse') {
    if (b.pathI < b.path.length) {
      const [wx, wz] = WAYPOINTS[b.path[b.pathI]];
      const arrived = steer(f, wx, wz, dt, MATCH.walkSpeed * 0.95);
      // face where we walk
      const wantYaw = Math.atan2(-(wx - f.x), -(wz - f.z));
      let dyaw = wantYaw - f.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      f.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));
      if (arrived) b.pathI += 1;
      if (b.state === 'fetch') tryPickupBomb(match, f);
    } else {
      b.state = b.role === 'defend' ? 'hold' : 'move';
      f.vx *= 0.8; f.vz *= 0.8; f.moveMag *= 0.8;
      if (b.role === 'attack' && b.state === 'move') {
        const s = SITES[b.site];
        b.path = findPath(f.x, f.z, s.cx, s.cz); b.pathI = 0;
      }
    }
  }
  // hold: scan slowly
  if (b.state === 'hold') {
    f.yaw += Math.sin(now * 0.4 + f.x) * 0.35 * dt;
    f.vx *= 0.8; f.vz *= 0.8; f.moveMag = 0;
  }
}

export { BOT_NAMES, dropBomb };
