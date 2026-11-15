// Ember Yard — entry point. Boots three.js, runs the fixed-step simulation
// apart from rendering, owns the round/economy flow, wires input, and keeps
// every fighter's mesh in sync with the sim. `?shot=start|play|end&seed=N`
// stages a deterministic scene for screenshots.
import * as THREE from 'three';
import { MATCH, ECON, WEAPONS, newMatch, fighter, TEAMS } from './state.js';
import { WALLS, SITES, SPAWNS, buildWorld } from './map.js';
import { createInput, stepPlayer, dropBomb, tryPickupBomb } from './player.js';
import { makeBot, assignRound, botBuy, stepBot, BOT_NAMES } from './bots.js';
import { Effects } from './effects.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';
import { explodeDamage, stepGrenade } from './weapons.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';
const SEED = Number(params.get('seed') || 1);

const hud = new HUD(document);
const audio = new AudioSys();
let renderer, scene, camera, world, effects;
let match, player, input;
let viewmodel, muzzleTip;
let spectate = null;
let stepAcc = 0;
const STEP = 1 / 60;
const _v = [0, 0, 0];
let lastStepSnd = 0;

function buildFighterMesh(f) {
  const g = new THREE.Group();
  const teamCol = f.team === 'ember' ? 0xff7a2f : 0x7fa8c9;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.05, 0.42),
    new THREE.MeshStandardMaterial({ color: f.team === 'ember' ? 0x8a4a22 : 0x2e4a63, roughness: 0.8 }),
  );
  body.position.y = 0.82;
  g.add(body);
  const vest = new THREE.Mesh(
    new THREE.BoxGeometry(0.74, 0.4, 0.46),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.7 }),
  );
  vest.position.y = 1.05;
  g.add(vest);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.38, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.85 }),
  );
  head.position.y = 1.52;
  g.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: teamCol, emissive: teamCol, emissiveIntensity: 0.9 }),
  );
  visor.position.set(0, 1.55, -0.21);
  g.add(visor);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.14, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.4, metalness: 0.6 }),
  );
  gun.position.set(0.28, 1.15, -0.3);
  g.add(gun);
  g.userData = { body, head, visor, gun };
  scene.add(g);
  return g;
}

function buildViewmodel() {
  const g = new THREE.Group();
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.13, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x2e333b, roughness: 0.35, metalness: 0.7 }),
  );
  g.add(gun);
  const sight = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.07, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x333a44, roughness: 0.4, metalness: 0.6 }),
  );
  sight.position.set(0, 0.1, -0.1);
  g.add(sight);
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.16, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.5 }),
  );
  mag.position.set(0, -0.12, 0.05);
  g.add(mag);
  g.position.set(0.28, -0.24, -0.5);
  camera.add(g);
  muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0.28, -0.18, -0.85);
  camera.add(muzzleTip);
  return g;
}

function spawnFighters() {
  match.fighters = [];
  const emberNames = BOT_NAMES.ember, ashNames = BOT_NAMES.ash;
  SPAWNS.ember.forEach(([x, z], i) => {
    if (i === 0) {
      player = fighter('player', 'ember', true, 'You', x, z, -Math.PI / 2);
      match.fighters.push(player);
    } else {
      const b = fighter('e' + i, 'ember', false, emberNames[i - 1], x, z, -Math.PI / 2);
      makeBot(b, 'attack', i < 2 ? 'A' : 'B', match.rng);
      match.fighters.push(b);
    }
  });
  SPAWNS.ash.forEach(([x, z], i) => {
    const b = fighter('a' + i, 'ash', false, ashNames[i], x, z, Math.PI / 2);
    makeBot(b, 'defend', i % 2 === 0 ? 'A' : 'B', match.rng);
    match.fighters.push(b);
  });
  for (const f of match.fighters) {
    f.mesh = buildFighterMesh(f);
    if (f.isPlayer) f.mesh.visible = false; // first person: only the viewmodel
  }
}

function newRound() {
  match.grenades = [];
  match.phase = 'buy';
  match.phaseT = MATCH.buySeconds;
  match.roundT = MATCH.roundSeconds;
  match.bomb = { state: 'carried', carrier: 'player', x: 0, z: 0, fuseT: 0, plantT: 0, defuseT: 0, site: null };
  for (const f of match.fighters) {
    const spawn = SPAWNS[f.team][match.fighters.filter((g) => g.team === f.team).indexOf(f)];
    f.x = spawn[0]; f.z = spawn[1]; f.y = 0;
    f.yaw = f.team === 'ember' ? -Math.PI / 2 : Math.PI / 2;
    f.pitch = 0; f.hp = MATCH.playerHealth; f.alive = true;
    f.vx = 0; f.vz = 0; f.bloom = 0; f.reloadT = 0; f.ads = false;
    f.mag = WEAPONS[f.weapon].mag; f.reserve = WEAPONS[f.weapon].reserve;
    f.frags = 0; f.crouched = false;
    if (f.mesh) { f.mesh.visible = !f.isPlayer; f.mesh.rotation.set(0, f.yaw, 0); }
    if (f.bot) { f.bot.enemy = null; f.bot.state = 'move'; f.bot.path = []; f.bot.pathI = 0; }
  }
  spectate = null;
  assignRound(match);
  for (const f of match.fighters) if (f.bot) botBuy(f, match.rng);
  hud.closeBuy();
  hud.openBuy(player, buyItem);
  hud.banner(`ROUND ${match.round}`, 'Buy your gear — B closes the menu', 3000);
}

function startMatch() {
  match = newMatch(SEED);
  match.grenades = [];
  spawnFighters();
  match.phase = 'menu';
  hud.showGame();
  newRound();
}

function buyItem(id) {
  const w = WEAPONS[id];
  if (match.phase !== 'buy' || !w) return;
  if (id === 'frag') {
    if (player.money < w.price || player.frags >= 2) return;
    player.money -= w.price; player.frags += 1;
  } else {
    if (player.money < w.price || player.owned.includes(id)) return;
    player.money -= w.price; player.owned.push(id);
    player.weapon = id;
    player.mag = w.mag; player.reserve = w.reserve;
  }
  audio.buy();
  hud.openBuy(player, buyItem);
}

function applyDamage(target, dmg, attacker, head) {
  if (!target.alive) return;
  target.hp -= dmg;
  target.damageFlashT = 0.15;
  target.lastDamageFrom = attacker;
  if (target === player) { hud.damageFlash(); audio.hurt(); }
  if (attacker === player && target !== player) {
    hud.hitmarker(target.hp <= 0);
    if (target.hp <= 0) audio.kill(); else audio.hit();
  }
  if (target.hp > 0) return;
  // death
  target.hp = 0; target.alive = false; target.deaths += 1;
  if (attacker && attacker !== target) {
    attacker.kills += 1; attacker.money += ECON.kill;
  }
  hud.killfeedAdd(`${attacker ? attacker.name : 'World'} → ${target.name}`, head);
  if (match.bomb.state === 'carried' && match.bomb.carrier === target.id) dropBomb(match, target);
  if (target === player) spectate = match.fighters.find((f) => f.team === 'ember' && f.alive && !f.isPlayer) || null;
  checkRoundEnd();
}

function aliveCount(team) {
  return match.fighters.filter((f) => f.team === team && f.alive).length;
}

function checkRoundEnd() {
  if (match.phase !== 'play') return;
  const eAlive = aliveCount('ember'), aAlive = aliveCount('ash');
  if (match.bomb.state !== 'planted') {
    if (eAlive === 0) return endRound('ash', 'EMBER ELIMINATED');
    if (aAlive === 0) return endRound('ember', 'ASH ELIMINATED');
  } else if (aAlive === 0) {
    return endRound('ember', 'ASH ELIMINATED — CHARGE WILL BLOW');
  }
}

function endRound(winner, reason) {
  if (match.phase !== 'play') return;
  match.phase = 'roundEnd';
  match.phaseT = 4;
  match.score[winner] += 1;
  match.winner = winner; match.winReason = reason;
  const loser = winner === 'ember' ? 'ash' : 'ember';
  match.lossStreak[loser] += 1; match.lossStreak[winner] = 0;
  for (const f of match.fighters) {
    if (f.team === winner) f.money += ECON.win;
    else f.money += Math.min(ECON.lossStreakCap, ECON.loss + (match.lossStreak[loser] - 1) * ECON.lossStreakBonus);
    if (f.team === winner && match.bomb.state === 'planted' && winner === 'ember') f.money += ECON.plantBonus;
  }
  const youWon = winner === 'ember';
  hud.banner(youWon ? 'EMBER WINS' : 'ASH WINS', `${reason} · ${match.score.ember} — ${match.score.ash}`, 3800);
  if (youWon) audio.roundWin(); else audio.roundLose();
}

function endMatch() {
  match.phase = 'matchEnd';
  const w = match.score.ember > match.score.ash ? 'ember' : 'ash';
  hud.banner(w === 'ember' ? 'EMBER TAKES THE YARD' : 'ASH HOLDS THE YARD', `Final ${match.score.ember} — ${match.score.ash} · thanks for playing`, 6000);
}

function handleShotEvents(events) {
  for (const ev of events) {
    if (ev.type === 'shot') {
      const w = ev.weapon;
      const dist = ev.shooter === player ? 0 : Math.hypot(ev.shooter.x - player.x, ev.shooter.z - player.z);
      audio.shot(w.kind, dist);
      // tracer from the shooter's muzzle to the bullet's end
      const [fx, fy, fz] = ev.from;
      effects.tracer([fx, fy, fz], ev.to, w.tracer);
      if (ev.shooter === player) {
        const tip = new THREE.Vector3();
        muzzleTip.getWorldPosition(tip);
        effects.muzzle([tip.x, tip.y, tip.z], player.yaw, player.pitch);
        viewmodel.position.z = -0.5 + 0.06; // recoil kick, decays in render
      }
      // impact sparks at the wall hit
      if (ev.wallT < 120) effects.sparksAt(ev.to[0], ev.to[1], ev.to[2], 4);
      for (const h of ev.hits) applyDamage(h.target, h.dmg, ev.shooter, h.head);
      // gunfire noise: defenders investigate nearby shots
      for (const f of match.fighters) {
        if (f.bot && f.team === 'ash' && f.alive) {
          const d = Math.hypot(f.x - ev.from[0], f.z - ev.from[2]);
          if (d < 26) { f.bot.noiseX = ev.from[0]; f.bot.noiseZ = ev.from[2]; f.bot.noiseT = match.time; }
        }
      }
    } else if (ev.type === 'reload') audio.reload();
    else if (ev.type === 'planted') {
      hud.banner('CHARGE PLANTED', `${ev.site === 'A' ? 'FURNACE' : 'DEPOT'} — ${MATCH.bombFuseSeconds}s TO DETONATION`, 3000);
      audio.plantBeep();
    } else if (ev.type === 'defused') {
      endRound('ash', 'CHARGE DEFUSED');
    } else if (ev.type === 'throw') {
      audio.shot('pistol', 0);
    }
  }
}

function simStep(dt) {
  match.time += dt;
  const events = [];
  if (match.phase === 'buy') {
    match.phaseT -= dt;
    stepPlayer(match, player, input, dt, events);
    if (match.phaseT <= 0) {
      match.phase = 'play';
      hud.closeBuy();
      hud.banner(`ROUND ${match.round}`, 'Fight!', 1800);
    }
  } else if (match.phase === 'play') {
    match.roundT -= dt;
    // firing input: auto weapons hold, semi weapons need a fresh click
    const w = WEAPONS[player.weapon];
    input.fire = w.auto ? input.fireHeld : input.fireEdge;
    stepPlayer(match, player, input, dt, events);
    input.fireEdge = false;
    for (const f of match.fighters) if (f.bot) stepBot(match, f, dt, events);
    // bomb carrier pickup
    for (const f of match.fighters) if (!f.isPlayer) tryPickupBomb(match, f);
    tryPickupBomb(match, player);
    // grenades
    for (let i = match.grenades.length - 1; i >= 0; i--) {
      const g = match.grenades[i];
      stepGrenade(match, g, dt, (gg) => {
        effects.explosion(gg.x, gg.y, gg.z);
        audio.explosion();
        for (const h of explodeDamage(match, gg)) applyDamage(h.target, h.dmg, gg.owner, false);
        match.grenades.splice(match.grenades.indexOf(gg), 1);
      });
    }
    // bomb fuse
    if (match.bomb.state === 'planted') {
      match.bomb.fuseT -= dt;
      if (match.bomb.fuseT <= 0) {
        effects.explosion(match.bomb.x, 0.6, match.bomb.z);
        audio.explosion();
        match.bomb.state = 'exploded';
        endRound('ember', 'CHARGE DETONATED');
      }
    }
    if (match.roundT <= 0 && match.bomb.state !== 'planted') endRound('ash', 'TIME EXPIRED — CHARGE NOT PLANTED');
  } else if (match.phase === 'roundEnd') {
    match.phaseT -= dt;
    for (const f of match.fighters) if (f.bot) stepBot(match, f, dt, events);
    if (match.phaseT <= 0) {
      if (match.score.ember >= MATCH.roundsToWin || match.score.ash >= MATCH.roundsToWin || match.round >= MATCH.maxRounds) endMatch();
      else { match.round += 1; newRound(); }
    }
  }
  handleShotEvents(events);
  // plant/defuse channel bar
  const b = match.bomb;
  const ch = events.find((e) => e.type === 'channel');
  if (ch) {
    hud.el.plantbar.classList.remove('hidden');
    hud.el.plantbar.querySelector('.lbl').textContent = ch.kind === 'plant' ? 'PLANTING…' : 'DEFUSING…';
    hud.el.plantbar.querySelector('.fill').style.width = `${Math.round(ch.t * 100)}%`;
  } else {
    hud.el.plantbar.classList.add('hidden');
  }
  // contextual hint
  let hint = '';
  if (match.phase === 'play' && player.alive) {
    if (b.state === 'carried' && b.carrier === 'player') {
      const inA = player.x >= SITES.A.zone[0] && player.x <= SITES.A.zone[2] && player.z >= SITES.A.zone[1] && player.z <= SITES.A.zone[3];
      const inB = player.x >= SITES.B.zone[0] && player.x <= SITES.B.zone[2] && player.z >= SITES.B.zone[1] && player.z <= SITES.B.zone[3];
      if (inA || inB) hint = 'Hold E to plant the charge';
    } else if (b.state === 'planted' && player.team === 'ember') hint = 'Defend the charge!';
    else if (b.state === 'dropped') hint = 'The charge is on the ground — walk over it';
  }
  if (!player.alive && match.phase === 'play') hint = 'You are down — spectating a teammate';
  hud.setHint(hint);
}

// ---- rendering ---------------------------------------------------------------

function syncMeshes() {
  for (const f of match.fighters) {
    if (!f.mesh) continue;
    const m = f.mesh;
    m.position.set(f.x, f.y, f.z);
    if (f.alive) {
      m.rotation.set(0, f.yaw, 0);
      m.scale.y = f.crouched ? 0.72 : 1;
      m.visible = !f.isPlayer;
    } else {
      m.rotation.set(0, f.yaw, Math.PI / 2);
      m.position.y = 0.25;
      m.visible = true; // the player's corpse stays visible to teammates
      if (f.isPlayer) m.visible = true;
    }
  }
  // bomb mesh
  const b = match.bomb;
  world.bomb.visible = b.state === 'planted' || b.state === 'dropped';
  if (world.bomb.visible) {
    world.bomb.position.set(b.x, 0.12, b.z);
    const blink = Math.sin(match.time * 8) > 0;
    world.blink.material.color.setHex(blink ? 0xff2f2f : 0x550000);
  }
}

function render(dt) {
  // camera follows the player, or a spectated teammate after death
  const focus = player.alive ? player : spectate;
  if (focus) {
    if (focus.isPlayer || !player.alive) {
      const eye = focus === player ? (player.crouched ? 1.05 : 1.55) : 1.7;
      if (player.alive) {
        camera.position.set(player.x, player.y + eye, player.z);
        camera.rotation.order = 'YXZ';
        camera.rotation.y = player.yaw;
        camera.rotation.x = player.pitch;
        camera.rotation.z = 0;
      } else {
        // third-person spectate: behind and above the teammate
        const bx = focus.x + Math.sin(focus.yaw) * 3.2, bz = focus.z + Math.cos(focus.yaw) * 3.2;
        camera.position.set(bx, 2.6, bz);
        camera.lookAt(focus.x, 1.2, focus.z);
      }
    }
  }
  // ADS fov
  const targetFov = player.ads && player.alive ? 55 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  // viewmodel bob + recoil decay
  if (viewmodel) {
    const bob = player.moveMag * 0.012 * Math.sin(match.time * 11);
    viewmodel.position.y = -0.24 + bob;
    viewmodel.position.x = 0.28 + (player.ads ? -0.14 : 0);
    viewmodel.position.z += (-0.5 - viewmodel.position.z) * Math.min(1, dt * 12);
  }
  // footsteps
  if (player.alive && player.moveMag > 0.3 && match.time - lastStepSnd > 0.42) {
    lastStepSnd = match.time;
    audio.step();
  }
  effects.step(dt);
  syncMeshes();
  renderer.render(scene, camera);
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - (frame._last || t)) / 1000 || 0.016);
  frame._last = t;
  if (match && match.phase !== 'menu' && match.phase !== 'matchEnd') {
    stepAcc += dt;
    let n = 0;
    while (stepAcc >= STEP && n < 5) { simStep(STEP); stepAcc -= STEP; n++; }
    if (n === 5) stepAcc = 0;
  } else if (match && match.phase === 'matchEnd') {
    match.time += dt;
  }
  if (match) {
    hud.update(match, player, dt);
    render(dt);
  }
}

// ---- input -------------------------------------------------------------------

function bindInput() {
  input = createInput();
  const keymap = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyC: 'crouch', ControlLeft: 'crouch', KeyE: 'use' };
  addEventListener('keydown', (e) => {
    if (e.code in keymap) { input[keymap[e.code]] = true; e.preventDefault(); }
    if (e.code === 'KeyR') input.reload = true;
    if (e.code === 'KeyB' && match && match.phase === 'buy') {
      if (hud.el.buy.classList.contains('hidden')) hud.openBuy(player, buyItem);
      else hud.closeBuy();
    }
    if (e.code === 'KeyG') input.grenade = true;
    if (e.code === 'Digit1') input.weaponSlot = 1;
    if (e.code === 'Digit2') input.weaponSlot = 2;
    if (e.code === 'Digit3') input.weaponSlot = 3;
    if (e.code === 'Digit2' && match && match.phase === 'buy') buyItem('vk47');
    if (e.code === 'Digit3' && match && match.phase === 'buy') buyItem('breacher');
    if (e.code === 'Digit4' && match && match.phase === 'buy') buyItem('frag');
  });
  addEventListener('keyup', (e) => {
    if (e.code in keymap) input[keymap[e.code]] = false;
  });
  const cvs = renderer.domElement;
  cvs.addEventListener('mousedown', (e) => {
    if (match && match.phase !== 'menu') audio.unlock();
    if (e.button === 0) { input.fireHeld = true; input.fireEdge = true; }
    if (e.button === 2) input.ads = true;
    if (document.pointerLockElement !== cvs && match && (match.phase === 'play' || match.phase === 'buy')) {
      cvs.requestPointerLock?.();
    }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fireHeld = false;
    if (e.button === 2) input.ads = false;
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === cvs) {
      input.lookDX += e.movementX; input.lookDY += e.movementY;
    } else if (e.buttons === 1 && match && match.phase === 'play') {
      // drag-look fallback when pointer lock is unavailable (headless, etc.)
      input.lookDX += e.movementX; input.lookDY += e.movementY;
    }
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === cvs;
    if (!locked && match && (match.phase === 'play' || match.phase === 'buy') && !SHOT) hud.showPause(true);
    else hud.showPause(false);
  });
  document.getElementById('deployBtn').addEventListener('click', () => {
    audio.unlock();
    startMatch();
    renderer.domElement.requestPointerLock?.();
  });
  document.getElementById('resumeBtn').addEventListener('click', () => {
    audio.unlock();
    hud.showPause(false);
    renderer.domElement.requestPointerLock?.();
  });
}

// ---- screenshot staging ------------------------------------------------------
// ?shot=start → buy phase at the Ember spawn, buy menu open.
// ?shot=play → mid-round: the player at mid facing an Ash bot, rifle in hand.
// ?shot=end  → round-end banner after an Ember round win.
function stageShot() {
  startMatch();
  if (SHOT === 'start') {
    player.x = -28; player.z = 0; player.yaw = -Math.PI / 2;
    // an Ash bot visible down the lane for depth
    const ash = match.fighters.find((f) => f.team === 'ash');
    ash.x = 6; ash.z = 0; ash.yaw = Math.PI / 2;
  } else if (SHOT === 'play') {
    match.phase = 'play'; match.roundT = 82;
    hud.closeBuy();
    player.weapon = 'vk47'; player.owned = ['p9', 'vk47'];
    player.mag = 30; player.reserve = 90;
    player.x = 14; player.z = -8; player.yaw = Math.PI / 2; player.pitch = 0;
    const ash = match.fighters.find((f) => f.team === 'ash');
    ash.x = 6; ash.z = -8; ash.yaw = -Math.PI / 2; ash.bot.state = 'hold';
    const ash2 = match.fighters.find((f) => f.team === 'ash' && f !== ash);
    ash2.x = 10; ash2.z = -6; ash2.yaw = -Math.PI / 2; ash2.bot.state = 'hold';
    const mate = match.fighters.find((f) => f.team === 'ember' && !f.isPlayer);
    mate.x = 12; mate.z = -5; mate.yaw = Math.PI / 2;
    // let the sim run a little so bots settle, then fire one tracer for the shot
    setTimeout(() => {
      if (!match) return;
      input.fireHeld = true; input.fireEdge = true;
      setTimeout(() => { input.fireHeld = false; }, 120);
    }, 900);
  } else if (SHOT === 'end') {
    match.phase = 'play'; match.roundT = 40;
    endRound('ember', 'ASH ELIMINATED');
  }
  // expose a tiny debug handle for the screenshot driver
  window.__ember = {
    match, get player() { return player; },
    fireOnce() { input.fireHeld = true; input.fireEdge = true; setTimeout(() => { input.fireHeld = false; }, 120); },
    setView(x, z, yaw, pitch) { player.x = x; player.z = z; player.yaw = yaw; player.pitch = pitch || 0; },
  };
}

// ---- boot --------------------------------------------------------------------
function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').prepend(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 220);
  scene.add(camera);
  world = buildWorld(scene);
  effects = new Effects(scene);
  viewmodel = buildViewmodel();
  bindInput();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  if (SHOT) stageShot();
  requestAnimationFrame(frame);
}

boot();
