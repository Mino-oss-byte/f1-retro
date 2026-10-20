// Small synthesized sound set: engine drone, start-light beeps and contact thuds. No audio files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastThud = 0;
  }

  // Browsers only allow audio after a user gesture; call this from a click/keypress.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc1.connect(filter);
    this.osc2.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.osc1.start();
    this.osc2.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  // Fake gearbox: pitch climbs through each "gear" then drops back.
  setEngine(speed, throttle, boosting = false) {
    if (!this.ctx) return;
    const v = Math.abs(speed);
    const gearSpan = 13;
    const gear = Math.min(7, Math.floor(v / gearSpan));
    const inGear = (v - gear * gearSpan) / gearSpan;
    const f = (70 + gear * 9 + inGear * 110) * (boosting ? 1.15 : 1); // boost: higher-pitched whine
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.501, t, 0.03);
    this.engineGain.gain.setTargetAtTime(boosting ? 0.17 : throttle ? 0.13 : 0.06, t, 0.08);
  }

  silence() {
    if (this.ctx) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  beep(freq, duration) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.12;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + duration * 0.7, 0.03);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + duration);
  }

  thud(intensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastThud < 0.25) return;
    this.lastThud = now;
    const len = 0.15;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * len), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(0.5, 0.1 + intensity / 80);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }
}
