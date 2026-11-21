// 程序合成的原创曲目 + 音效。全部用 WebAudio 实时生成，没有任何音频文件。

export const BPM = 120;
export const BEAT = 60 / BPM;
export const BARS = 48;
export const SONG_LEN = BARS * 4 * BEAT;

const SECTIONS = [
  [4, 'intro'], [12, 'verse'], [16, 'build'], [24, 'chorus'],
  [28, 'break'], [36, 'verse2'], [44, 'chorus2'], [48, 'outro'],
];
export function sectionOf(bar) {
  for (const [end, name] of SECTIONS) if (bar < end) return name;
  return 'outro';
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const ROOTS = [45, 41, 48, 43];                                    // A F C G
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
// 8 小节主旋律：[拍, 音高, 时值(拍)]
const MELODY = [
  [[0, 76, 1], [1, 74, 0.5], [1.5, 72, 0.5], [2, 69, 1], [3, 72, 1]],
  [[0, 69, 1.5], [1.5, 72, 0.5], [2, 74, 1], [3, 72, 1]],
  [[0, 76, 1], [1, 79, 1], [2, 76, 0.5], [2.5, 74, 0.5], [3, 72, 1]],
  [[0, 74, 2], [2, 71, 1], [3, 74, 1]],
  [[0, 81, 1], [1, 79, 0.5], [1.5, 76, 0.5], [2, 74, 1], [3, 76, 1]],
  [[0, 72, 1.5], [1.5, 74, 0.5], [2, 76, 1], [3, 77, 1]],
  [[0, 79, 1], [1, 76, 1], [2, 72, 1], [3, 76, 1]],
  [[0, 74, 1.5], [1.5, 76, 0.5], [2, 74, 2]],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1];

export class Music {
  constructor() {
    this.ctx = null;
    this.events = [];
    this.ptr = 0;
    this.t0 = 0;
    this.playing = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    const delay = ctx.createDelay(1);
    delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    delay.connect(fb); fb.connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    delay.connect(wet); wet.connect(this.bus);
    this.send = delay;

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._build();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  get time() {
    if (!this.ctx || !this.playing) return 0;
    return this.ctx.currentTime - this.t0;
  }

  start(leadIn = 1.5) {
    const now = this.ctx.currentTime;
    this.t0 = now + leadIn;
    this.ptr = 0;
    this.playing = true;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(1, Math.max(now, this.t0 - 0.2));
  }

  stop() {
    if (!this.ctx) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0, now, 0.08);
  }

  // 每帧调用：把未来 0.3 秒内的音符排进 WebAudio 时间线
  update() {
    if (!this.playing) return;
    const horizon = this.time + 0.3;
    while (this.ptr < this.events.length && this.events[this.ptr].t < horizon) {
      const e = this.events[this.ptr++];
      e.fn(this.t0 + e.t);
    }
  }

  // ---------- 音色 ----------
  _osc(type, freq, t, dur, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }
  _noise(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.connect(dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  _gain(dest) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(dest);
    return g;
  }
  _decay(g, t, v, dur) {
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  }
  _hold(g, t, v, dur, a = 0.01, r = 0.05) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v, Math.max(t + a, t + dur - r));
    g.gain.linearRampToValueAtTime(0, t + dur);
  }
  _filter(type, freq, dest, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  kick(t, v = 1) {
    const g = this._gain(this.bus);
    this._decay(g, t, v, 0.32);
    const o = this._osc('sine', 160, t, 0.34, g);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
  }
  clap(t, v = 1) {
    const g = this._gain(this.bus);
    this._decay(g, t, 0.5 * v, 0.17);
    this._noise(t, 0.2, this._filter('bandpass', 1600, g, 0.8));
  }
  hat(t, v = 1) {
    const g = this._gain(this.bus);
    this._decay(g, t, 0.16 * v, 0.05);
    this._noise(t, 0.06, this._filter('highpass', 8000, g));
  }
  crash(t, v = 1) {
    const g = this._gain(this.bus);
    this._decay(g, t, 0.28 * v, 1.6);
    this._noise(t, 1.7, this._filter('highpass', 5000, g));
  }
  bass(t, m, dur) {
    const g = this._gain(this.bus);
    this._hold(g, t, 0.3, dur, 0.008, 0.04);
    const f = this._filter('lowpass', 800, g, 4);
    f.frequency.setValueAtTime(800, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    this._osc('sawtooth', mtof(m), t, dur, f);
  }
  pluck(t, m, dur, v, wet = false) {
    const g = this._gain(this.bus);
    this._decay(g, t, v, dur);
    if (wet) g.connect(this.send);
    this._osc('triangle', mtof(m), t, dur, g);
  }
  lead(t, m, dur, v) {
    const g = this._gain(this.bus);
    this._hold(g, t, v, dur, 0.02, 0.08);
    g.connect(this.send);
    const f = this._filter('lowpass', 2600, g, 1);
    this._osc('sawtooth', mtof(m), t, dur, f, -8);
    this._osc('sawtooth', mtof(m), t, dur, f, 8);
    this._osc('square', mtof(m - 12), t, dur, f).detune.value = 3;
  }
  pad(t, ms, dur, v) {
    const g = this._gain(this.bus);
    this._hold(g, t, v, dur + 0.3, 0.4, 0.6);
    const f = this._filter('lowpass', 1100, g);
    for (const m of ms) {
      this._osc('sawtooth', mtof(m), t, dur + 0.3, f, -10);
      this._osc('sawtooth', mtof(m), t, dur + 0.3, f, 10);
    }
  }
  riser(t, dur) {
    const g = this._gain(this.bus);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    const f = this._filter('bandpass', 300, g, 2);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    this._noise(t, dur + 0.05, f);
  }

  // ---------- 编曲 ----------
  _build() {
    const ev = this.events = [];
    for (let bar = 0; bar < BARS; bar++) {
      const s = sectionOf(bar);
      const c = bar % 4;
      const bt = bar * 4 * BEAT;
      const at = (beat, fn) => ev.push({ t: bt + beat * BEAT, fn });
      const chord = CHORDS[c];
      const root = ROOTS[c];
      const arp = (vol, step = 0.25) => {
        for (let i = 0; i < 4 / step; i++) {
          const m = chord[ARP[i % 16]] + 12;
          at(i * step, (t) => this.pluck(t, m, 0.22, vol, i % 4 === 0));
        }
      };
      const kicks = (beats) => beats.forEach((b) => at(b, (t) => this.kick(t)));
      const melody = (idx, fn) => MELODY[idx].forEach(([b, m, d]) => at(b, (t) => fn(t, m, d * BEAT)));

      if (s !== 'break') at(0, (t) => this.pad(t, chord, 4 * BEAT, 0.035));

      if (s === 'intro') {
        arp(0.03 + bar * 0.02);
        if (bar >= 2) {
          kicks([0, 2]);
          for (let i = 0; i < 8; i++) at(i * 0.5, (t) => this.hat(t, 0.6));
        }
      } else if (s === 'verse' || s === 'verse2') {
        kicks([0, 1, 2, 3]);
        for (let i = 0; i < 4; i++) at(i + 0.5, (t) => this.hat(t, 1));
        for (let i = 0; i < 8; i++) at(i * 0.5, (t) => this.bass(t, root, BEAT * 0.42));
        arp(0.1);
        if (s === 'verse2') {
          at(1, (t) => this.clap(t, 0.8));
          at(3, (t) => this.clap(t, 0.8));
          melody((bar - 28) % 8, (t, m, d) => this.pluck(t, m, Math.min(d, 0.5), 0.12, true));
          if (bar === 28) at(0, (t) => this.crash(t));
        }
      } else if (s === 'build') {
        if (bar < 15) kicks([0, 1, 2, 3]);
        arp(0.1);
        const div = bar === 12 ? 1 : bar === 13 ? 0.5 : 0.25;
        const n = 4 / div;
        for (let i = 0; i < n; i++) {
          const v = 0.35 + 0.65 * ((bar - 12) * 4 + i * div) / 16;
          at(i * div, (t) => this.clap(t, v));
        }
        if (bar === 14) at(0, (t) => this.riser(t, 8 * BEAT));
      } else if (s === 'chorus' || s === 'chorus2') {
        const big = s === 'chorus2';
        if (bar === 16 || bar === 36) at(0, (t) => this.crash(t, 1.2));
        kicks([0, 1, 2, 3]);
        at(1, (t) => this.clap(t));
        at(3, (t) => this.clap(t));
        const hs = big ? 0.25 : 0.5;
        for (let i = 0; i < 4 / hs; i++) {
          const off = (i * hs) % 1 === 0.5;
          at(i * hs, (t) => this.hat(t, off ? 1.1 : 0.5));
        }
        for (let i = 0; i < 8; i++) {
          at(i * 0.5, (t) => this.bass(t, root + (i % 2 ? 12 : 0), BEAT * 0.42));
        }
        arp(0.06);
        melody((bar - (big ? 36 : 16)) % 8, (t, m, d) => this.lead(t, m, d, 0.085));
      } else if (s === 'break') {
        at(0, (t) => this.pad(t, chord, 4 * BEAT, 0.06));
        arp(0.09, 0.5);
        melody(bar - 24, (t, m, d) => this.pluck(t, m, d + 0.3, 0.16, true));
        if (bar === 27) at(0, (t) => this.riser(t, 4 * BEAT));
      } else {
        arp(Math.max(0.02, 0.09 - (bar - 44) * 0.02));
        if (bar < 47) kicks([0, 2]);
        else at(0, (t) => { this.kick(t); this.crash(t, 1.2); this.pad(t, CHORDS[0], 3 * BEAT, 0.07); });
      }
    }
    ev.sort((a, b) => a.t - b.t);
  }

  // ---------- 音效 ----------
  hitSound(hand) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bar = Math.max(0, Math.floor(this.time / (4 * BEAT)));
    const chord = CHORDS[bar % 4];
    const m = chord[(Math.random() * 3) | 0] + (hand === 0 ? 12 : 24);
    const g = this._gain(this.sfx);
    this._decay(g, t, 0.22, 0.18);
    this._osc('triangle', mtof(m), t, 0.2, g);
    const n = this._gain(this.sfx);
    this._decay(n, t, 0.25, 0.06);
    this._noise(t, 0.07, this._filter('highpass', 3000, n));
  }
  missSound() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this._gain(this.sfx);
    this._decay(g, t, 0.25, 0.22);
    const o = this._osc('sine', 120, t, 0.24, g);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.2);
  }
  badSound() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this._gain(this.sfx);
    this._decay(g, t, 0.12, 0.14);
    this._osc('square', 92, t, 0.15, this._filter('lowpass', 600, g));
  }
}
