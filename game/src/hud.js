// Ember Yard — HUD. One module owns every DOM element: crosshair spread,
// health/ammo/money, timer and score, killfeed, buy menu, plant bar, round
// banners and the top-down minimap. The sim calls update() once per frame
// with the match state; nothing here touches the game logic.
import { WEAPONS, ECON } from './state.js';
import { WALLS, SITES, WAYPOINTS } from './map.js';

export class HUD {
  constructor(doc) {
    this.d = doc;
    this.el = {};
    for (const id of ['hud', 'crosshair', 'hitmarker', 'dmgflash', 'lowhp', 'timer', 'score', 'alive', 'bombstat', 'healthnum', 'healthfill', 'money', 'ammo', 'weaponname', 'killfeed', 'minimap', 'plantbar', 'hint', 'banner', 'buy', 'buytimer', 'buyitems', 'menu', 'pause']) {
      this.el[id] = doc.getElementById(id);
    }
    this.mm = this.el.minimap.getContext('2d');
    this.killT = [];
    this.bannerT = 0;
    this.hitT = 0;
  }

  showGame() { this.el.hud.classList.remove('hidden'); this.el.menu.classList.add('hidden'); }
  showMenu() { this.el.hud.classList.add('hidden'); this.el.menu.classList.remove('hidden'); }
  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }

  setHint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.classList.toggle('hidden', !text);
  }

  banner(big, sub, ms = 2600) {
    this.el.banner.querySelector('.big').textContent = big;
    this.el.banner.querySelector('.sub').textContent = sub || '';
    this.el.banner.classList.remove('hidden');
    this.bannerT = ms / 1000;
  }

  hitmarker(kill) {
    this.el.hitmarker.classList.toggle('kill', !!kill);
    this.el.hitmarker.style.opacity = '1';
    this.hitT = 0.18;
  }

  damageFlash() {
    this.el.dmgflash.style.opacity = '1';
    setTimeout(() => { this.el.dmgflash.style.opacity = '0'; }, 130);
  }

  killfeedAdd(text, head) {
    const div = this.d.createElement('div');
    div.innerHTML = text + (head ? ' <span class="hs">HEADSHOT</span>' : '');
    this.el.killfeed.prepend(div);
    this.killT.unshift(6);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    while (this.killT.length > 5) this.killT.pop();
  }

  // Buy menu: rebuilt each time it opens (money and ownership change).
  openBuy(player, onBuy) {
    const items = [
      { key: '2', id: 'vk47', label: 'VK-47 Rifle', desc: 'Auto · 36 dmg · headshot ×4 · 30 rounds' },
      { key: '3', id: 'breacher', label: 'Breacher Shotgun', desc: '8 pellets · huge close damage · 5 shells' },
      { key: '4', id: 'frag', label: 'Frag Grenade', desc: 'Throw with G · 120 dmg in 6.5 m' },
    ];
    this.el.buyitems.innerHTML = '';
    for (const it of items) {
      const w = WEAPONS[it.id];
      const owned = it.id === 'frag' ? player.frags >= 2 : player.owned.includes(it.id);
      const afford = player.money >= w.price;
      const row = this.d.createElement('div');
      row.className = 'item' + (owned || !afford ? ' owned' : '');
      row.innerHTML = `<div><div class="nm">${it.key} · ${it.label}</div><div class="ds">${it.desc}</div></div><div class="pr">${owned ? 'OWNED' : '$' + w.price}</div>`;
      if (!owned && afford) row.addEventListener('click', () => onBuy(it.id));
      this.el.buyitems.appendChild(row);
    }
    this.el.buy.classList.remove('hidden');
  }

  closeBuy() { this.el.buy.classList.add('hidden'); }

  update(match, player, dt) {
    const p = player;
    // crosshair gap grows with spread: moving, firing, airborne
    const w = WEAPONS[p.weapon];
    const gap = 6 + (w.spread + w.moveSpread * p.moveMag + p.bloom) * 420 + (p.ads ? -2 : 0);
    this.el.crosshair.style.setProperty('--gap', Math.max(3, gap).toFixed(1) + 'px');
    // timer + score
    const t = Math.max(0, Math.ceil(match.roundT));
    this.el.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('low', t <= 15 && match.phase === 'play');
    this.el.score.innerHTML = `<span class="ember">EMBER ${match.score.ember}</span> — <span class="ash">${match.score.ash} ASH</span>`;
    const eAlive = match.fighters.filter((f) => f.team === 'ember' && f.alive).length;
    const aAlive = match.fighters.filter((f) => f.team === 'ash' && f.alive).length;
    this.el.alive.textContent = `EMBER ${eAlive} · ASH ${aAlive} · ROUND ${match.round}/9`;
    // bomb status line
    const b = match.bomb;
    this.el.bombstat.textContent =
      b.state === 'planted' ? `💣 CHARGE PLANTED ${b.site} — ${Math.ceil(b.fuseT)}s` :
      b.state === 'carried' ? (b.carrier === 'player' ? 'YOU CARRY THE CHARGE — E TO PLANT AT A / B' : 'CHARGE WITH A TEAMMATE') :
      b.state === 'dropped' ? 'CHARGE DROPPED — PICK IT UP' :
      b.state === 'defused' ? 'CHARGE DEFUSED' : '';
    // health / money / ammo
    this.el.healthnum.textContent = Math.max(0, Math.ceil(p.hp));
    this.el.healthfill.style.width = Math.max(0, p.hp) + '%';
    this.el.healthfill.style.background = p.hp > 50 ? 'linear-gradient(90deg,#37c978,#7be495)' : p.hp > 25 ? 'linear-gradient(90deg,#d8a020,#f0c040)' : 'linear-gradient(90deg,#d83a20,#f06040)';
    this.el.lowhp.style.opacity = p.hp <= 30 && p.alive ? '0.7' : '0';
    this.el.money.textContent = '$' + p.money;
    const res = p.reserve === Infinity ? '∞' : p.reserve;
    this.el.ammo.innerHTML = `${p.mag} <span class="res">/ ${res}</span>`;
    this.el.weaponname.textContent = `${w.short} · ${w.auto ? 'AUTO' : w.kind === 'shotgun' ? 'PUMP' : 'SEMI'}${p.reloadT > 0 ? ' · RELOADING…' : ''}${p.frags ? ` · FRAG ×${p.frags}` : ''}`;
    // buy timer
    if (match.phase === 'buy') this.el.buytimer.textContent = `— ${Math.ceil(match.phaseT)}s`;
    // banner + hitmarker fade
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.classList.add('hidden'); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.el.hitmarker.style.opacity = '0'; }
    // killfeed expiry
    for (let i = this.killT.length - 1; i >= 0; i--) {
      this.killT[i] -= dt;
      if (this.killT[i] <= 0) {
        const child = this.el.killfeed.children[this.killT.length - 1 - i];
        if (child) child.remove();
        this.killT.splice(i, 1);
      }
    }
    this.drawMinimap(match, player);
  }

  drawMinimap(match, player) {
    const g = this.mm, W = 150, H = 112;
    g.clearRect(0, 0, W, H);
    const sx = (x) => ((x + 33) / 66) * W;
    const sz = (z) => ((z + 25) / 50) * H;
    // walls
    g.fillStyle = 'rgba(232,228,218,0.35)';
    for (const [x1, z1, x2, z2] of WALLS) g.fillRect(sx(x1), sz(z1), Math.max(1, sx(x2) - sx(x1)), Math.max(1, sz(z2) - sz(z1)));
    // sites
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      g.fillStyle = key === 'A' ? 'rgba(255,122,47,0.35)' : 'rgba(127,168,201,0.35)';
      g.fillRect(sx(s.zone[0]), sz(s.zone[1]), sx(s.zone[2]) - sx(s.zone[0]), sz(s.zone[3]) - sz(s.zone[1]));
      g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center';
      g.fillText(key, sx(s.cx), sz(s.cz) + 3);
    }
    // bomb
    const b = match.bomb;
    if (b.state === 'planted' || b.state === 'dropped') {
      g.fillStyle = '#ff2f2f';
      g.beginPath(); g.arc(sx(b.x), sz(b.z), 3.5, 0, Math.PI * 2); g.fill();
    }
    // fighters
    for (const f of match.fighters) {
      if (!f.alive) continue;
      g.fillStyle = f.isPlayer ? '#ffffff' : f.team === 'ember' ? '#ff7a2f' : '#7fa8c9';
      g.beginPath(); g.arc(sx(f.x), sz(f.z), f.isPlayer ? 3.5 : 2.5, 0, Math.PI * 2); g.fill();
      if (f.isPlayer) {
        g.strokeStyle = '#fff'; g.beginPath();
        g.moveTo(sx(f.x), sz(f.z));
        g.lineTo(sx(f.x) - Math.sin(f.yaw) * 8, sz(f.z) - Math.cos(f.yaw) * 8);
        g.stroke();
      }
    }
    void WAYPOINTS;
  }
}

export { ECON };
