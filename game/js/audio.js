// Tiny procedural sound engine (WebAudio). All sounds synthesized.
(function () {
  class Audio {
    constructor() { this.ctx = null; this.muted = false; this.master = null; }
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 1.0; const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      } catch (e) { this.ctx = null; }
    }
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }
    noise(dur, freq, q, vol, type) {
      if (!this.ctx || this.muted) return; const c = this.ctx, t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
    }
    tone(freq, dur, vol, type, slide) {
      if (!this.ctx || this.muted) return; const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(); o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    dig(hard) { this.noise(0.08, hard ? 900 : 500, 1.2, 0.35); }
    breakBlock(kind) {
      if (kind === 'stone') { this.noise(0.18, 700, 0.8, 0.5); this.noise(0.25, 250, 1, 0.4, 'lowpass'); }
      else if (kind === 'wood') { this.noise(0.14, 400, 1.5, 0.45); this.tone(180, 0.1, 0.15, 'triangle', 0.6); }
      else if (kind === 'sand') { this.noise(0.2, 1400, 0.6, 0.35, 'highpass'); }
      else if (kind === 'leaves') { this.noise(0.15, 2500, 0.6, 0.25, 'highpass'); }
      else { this.noise(0.16, 380, 1, 0.45, 'lowpass'); }
    }
    place() { this.noise(0.09, 600, 1, 0.35); this.tone(140, 0.08, 0.12, 'triangle', 0.7); }
    step(kind) { this.noise(0.07, kind === 'stone' ? 1200 : 700, 1, 0.09, kind === 'sand' ? 'highpass' : 'bandpass'); }
    jump() { this.tone(220, 0.12, 0.08, 'triangle', 1.6); }
    hurt() { this.tone(160, 0.25, 0.3, 'sawtooth', 0.5); this.noise(0.2, 300, 1, 0.3, 'lowpass'); }
    pickup() {
      const seq = [660, 880, 1320, 1760];
      seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 0.18, 'square'), i * 70));
    }
    growl() { this.tone(70 + Math.random() * 30, 0.5, 0.18, 'sawtooth', 0.7); }
    hit() { this.noise(0.1, 500, 1, 0.4); this.tone(300, 0.08, 0.15, 'square', 0.5); }
    splash() { this.noise(0.35, 900, 0.5, 0.35, 'lowpass'); }
    craft() { this.tone(440, 0.08, 0.15, 'square'); setTimeout(() => this.tone(660, 0.12, 0.15, 'square'), 80); }
    win() {
      const seq = [523, 659, 784, 1047, 784, 1047, 1319];
      seq.forEach((f, i) => setTimeout(() => { this.tone(f, 0.35, 0.2, 'square'); this.tone(f / 2, 0.35, 0.1, 'triangle'); }, i * 140));
    }
    dawn() { [330, 415, 494].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 0.1, 'triangle'), i * 180)); }
    night() { [330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.6, 0.1, 'triangle'), i * 220)); }
  }
  window.GameAudio = Audio;
})();
