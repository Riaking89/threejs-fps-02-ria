// Ember Yard — central state. One object owns every mutable fact of a match so
// the sim, the bots and the HUD all read the same truth. Nothing here touches
// the DOM or three.js; it is plain data plus the constants that tune the game.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TEAMS = { EMBER: 'ember', ASH: 'ash' };

// Weapon catalogue: one definition per gun. Damage is per pellet (shotgun fires 8).
// headMult multiplies body damage on a head hit. falloff is [nearM, farM, farMult].
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', short: 'P9', kind: 'pistol', price: 0,
    damage: 34, headMult: 2, rpm: 320, auto: false, mag: 12, reserve: Infinity,
    spread: 0.011, moveSpread: 0.030, recoil: 0.011, range: [12, 32, 0.7],
    reloadMs: 1400, tracer: 0xffe08a, adsMult: 0.55,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', short: 'VK-47', kind: 'rifle', price: 2700,
    damage: 36, headMult: 4, rpm: 600, auto: true, mag: 30, reserve: 90,
    spread: 0.010, moveSpread: 0.038, recoil: 0.016, range: [18, 45, 0.75],
    reloadMs: 2400, tracer: 0xffc46b, adsMult: 0.55,
  },
  breacher: {
    id: 'breacher', name: 'Breacher Shotgun', short: 'BREACHER', kind: 'shotgun', price: 1800,
    damage: 12, headMult: 2, rpm: 70, auto: false, mag: 5, reserve: 25, pellets: 8,
    spread: 0.052, moveSpread: 0.045, recoil: 0.055, range: [7, 16, 0.45],
    reloadMs: 2600, tracer: 0xffd27a, adsMult: 0.7,
  },
  frag: {
    id: 'frag', name: 'Frag Grenade', short: 'FRAG', kind: 'grenade', price: 300,
    damage: 120, radius: 6.5, fuseMs: 1600,
  },
};

// Economy: CS-style, but smaller numbers so a lost round still buys.
export const ECON = {
  startMoney: 800, kill: 300, win: 3000, loss: 1900, lossStreakBonus: 500,
  lossStreakCap: 3400, plantBonus: 300,
};

export const MATCH = {
  roundsToWin: 5, maxRounds: 9, roundSeconds: 100, buySeconds: 15,
  plantSeconds: 3.5, defuseSeconds: 5, bombFuseSeconds: 35,
  playerHealth: 100, walkSpeed: 4.3, sprintSpeed: 6.2, crouchSpeed: 2.2,
};

// Fresh match state. Bots and the player are "fighters" with the same fields.
export function newMatch(seed) {
  const rng = mulberry32(seed);
  return {
    seed, rng,
    phase: 'menu', // menu | buy | play | roundEnd | matchEnd
    round: 1, score: { ember: 0, ash: 0 },
    phaseT: 0, roundT: MATCH.roundSeconds,
    bomb: { state: 'carried', carrier: 'player', x: 0, z: 0, fuseT: 0, plantT: 0, defuseT: 0, site: null },
    lossStreak: { ember: 0, ash: 0 },
    fighters: [], // {id, team, isPlayer, name, x,z,y, yaw, pitch, hp, alive, weapon, mag, reserve, money, kills, deaths, ...bot fields}
    killfeed: [],
    winner: null, winReason: '',
    time: 0, shotsFired: 0, shotsHit: 0,
  };
}

export function fighter(id, team, isPlayer, name, x, z, yaw) {
  return {
    id, team, isPlayer, name, x, z, y: 0, yaw, pitch: 0,
    hp: MATCH.playerHealth, alive: true,
    weapon: 'p9', mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
    owned: ['p9'], frags: 0, money: ECON.startMoney,
    kills: 0, deaths: 0, crouched: false, sprinting: false,
    // movement state (sim-owned)
    vx: 0, vz: 0, moveMag: 0, onGround: true,
    // gun state
    lastShotT: -9, reloadT: 0, bloom: 0, ads: false,
    // bot brain (unused for the player)
    bot: null,
    // per-frame render cache
    mesh: null, headMesh: null, gunMesh: null,
    damageFlashT: 0, lastDamageFrom: null,
  };
}
