# Ember Yard — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Riaking89/threejs-fps-02-ria/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Riaking89/threejs-fps-02-ria/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

My entry for the [threejs-fps-02](https://make.fun/bounty/threejs-fps-02) bounty on [make.fun](https://make.fun/bounty/threejs-fps-02): **Ember Yard**, a round-based tactical first-person shooter in the style Counter-Strike made famous — original map, art, sounds and names throughout.

## The game

- **Two teams, short rounds:** Ember (attack, you + 3 bots) vs Ash (defend, 4 bots). First to 5 rounds wins, max 9.
- **Objective beyond killing:** carry the charge to Site A (Furnace) or Site B (Depot), hold E to plant, defend it for 35 seconds — or eliminate the other team. Ash wins by stopping the plant, running the clock out, or defusing.
- **Money between rounds:** kills pay $300, round wins $3,000, losses $1,900+ (streak bonus). Spend it in the buy menu (B): VK-47 rifle ($2,700), Breacher shotgun ($1,800), frag grenade ($300).
- **Gunplay where accuracy pays:** hitscan with headshots (×2–×4), recoil bloom, spread that punishes firing on the move, ADS (right-click), crouch for stability, sprint for speed. Shotgun fires 8 pellets with fast falloff.
- **Bots that play:** waypoint routes through three lanes, hold positions, investigate gunfire, rotate to a planted charge, plant and defuse, fight in bursts with reaction time and aim error — all on the same movement, spread and damage rules as you.
- **The map:** a dusk industrial yard — two lanes, a cluttered mid with two choke slabs, sodium lamps, site plates, a skyline silhouette. Fixed-step simulation (60 Hz) kept apart from rendering; effects (tracers, muzzle flash, sparks, explosions) from fixed pools, no per-frame allocation in hot loops.

## Controls

WASD move · mouse aim · click fire · R reload · Shift sprint · C crouch · right-click aim down sights · B buy menu · E plant/defuse · G throw grenade · 1/2/3 switch weapon.

## Run it

```sh
node serve.ts   # serves game/ on http://localhost:8080
```

Or hand it in like the grader does:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, stdlib only) copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's `vendor/makefun-threejs.ts`. three.js 0.187.0 is vendored byte-for-byte under `game/vendor/three/` and mapped by `index.html`'s single import map. No build step, no network request.

## Layout

- `main.ts` — entry program (copies game + screenshots, writes dossier)
- `serve.ts` — tiny static server for local play-testing
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged
- `game/index.html` — the game page: import map, canvas, HUD
- `game/src/` — `main.js` (loop + rounds + economy), `state.js` (state + weapons + economy), `map.js` (yard, waypoints, rendering), `collide.js` (AABB math), `weapons.js` (hitscan + grenade), `player.js` (movement + plant/defuse), `bots.js` (bot AI), `hud.js` (HUD + buy menu + minimap), `audio.js` (synthesized SFX), `effects.js` (pooled tracers/sparks/explosions)
- `screenshots/` — 3 real renders of the game's own code

## License

MIT — see [LICENSE](LICENSE).
