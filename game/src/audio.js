// Ember Yard — sound. Every effect is synthesized with WebAudio (noise
// bursts, filtered clicks, short tones), so the game ships no audio assets
// and makes no network request. Volume scales with distance for enemy shots.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
    } catch { this.enabled = false; }
  }

  _noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = type; flt.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start();
  }

  _tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur);
  }

  shot(kind, dist) {
    // distant shots are quieter and duller
    const att = Math.max(0.12, 1 - (dist || 0) / 60);
    if (kind === 'rifle') { this._noise(0.14, 2400, 0.5 * att); this._tone(160, 0.09, 0.25 * att, 'square', 60); }
    else if (kind === 'pistol') { this._noise(0.09, 3200, 0.32 * att); this._tone(220, 0.06, 0.15 * att, 'square', 90); }
    else if (kind === 'shotgun') { this._noise(0.22, 1400, 0.6 * att); this._tone(110, 0.14, 0.3 * att, 'square', 45); }
  }

  dryFire() { this._tone(1400, 0.03, 0.08, 'square'); }
  reload() { this._tone(900, 0.05, 0.12, 'square'); setTimeout(() => this._tone(600, 0.05, 0.12, 'square'), 160); }
  hit() { this._tone(2100, 0.05, 0.16, 'sine'); }
  kill() { this._tone(1500, 0.07, 0.2, 'sine'); setTimeout(() => this._tone(2100, 0.09, 0.2, 'sine'), 70); }
  hurt() { this._noise(0.12, 700, 0.3); this._tone(90, 0.15, 0.25, 'sawtooth', 50); }
  step() { this._noise(0.04, 500, 0.05); }
  plantBeep() { this._tone(1200, 0.08, 0.15, 'sine'); }
  explosion() { this._noise(0.8, 300, 0.9); this._tone(55, 0.7, 0.5, 'sine', 28); }
  roundWin() { this._tone(523, 0.14, 0.18); setTimeout(() => this._tone(784, 0.22, 0.18), 130); }
  roundLose() { this._tone(392, 0.16, 0.16); setTimeout(() => this._tone(262, 0.26, 0.16), 150); }
  buy() { this._tone(880, 0.06, 0.14, 'sine'); }
  click() { this._tone(1000, 0.03, 0.1, 'square'); }
}
