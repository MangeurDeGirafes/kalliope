/**
 * Synthétiseur d'effets sonores 100 % procédural (Web Audio API).
 * Aucun fichier audio : tout est généré à partir d'oscillateurs et de bruit filtré.
 */

type LoopChannel = {
  gain: GainNode;
  filter: BiquadFilterNode;
  level: number;
};

export class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private slowFilter!: BiquadFilterNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private wallRunLoop: LoopChannel | null = null;
  private slideLoop: LoopChannel | null = null;
  private sandevistanHum: { gain: GainNode; osc: OscillatorNode } | null = null;
  private chargeHum: { gain: GainNode; osc: OscillatorNode; sub: OscillatorNode; level: number } | null = null;
  /** Facteur de hauteur global (abaissé pendant le Sandevistan). */
  private pitch = 1;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Doit être appelé suite à un geste utilisateur (clic). */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(compressor);

    this.slowFilter = ctx.createBiquadFilter();
    this.slowFilter.type = 'lowpass';
    this.slowFilter.frequency.value = 20000;
    this.slowFilter.Q.value = 0.8;
    this.slowFilter.connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.slowFilter);

    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.0;
    this.ambience.connect(this.slowFilter);

    const length = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.startAmbience();
    this.wallRunLoop = this.createLoop('bandpass', 2400, 1.2);
    this.slideLoop = this.createLoop('lowpass', 900, 0.7);
    this.createSandevistanHum();
    this.createChargeHum();
  }

  // ---------------------------------------------------------------------------
  // État global
  // ---------------------------------------------------------------------------

  setSlowMotion(active: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.pitch = active ? 0.62 : 1;
    this.slowFilter.frequency.cancelScheduledValues(t);
    this.slowFilter.frequency.setTargetAtTime(active ? 1500 : 20000, t, active ? 0.08 : 0.15);
    if (this.sandevistanHum) {
      this.sandevistanHum.gain.gain.setTargetAtTime(active ? 0.05 : 0, t, 0.1);
    }
  }

  setWallRunning(active: boolean): void {
    this.setLoop(this.wallRunLoop, active ? 0.07 : 0);
  }

  setSliding(active: boolean): void {
    this.setLoop(this.slideLoop, active ? 0.12 : 0);
  }

  stopLoops(): void {
    this.setWallRunning(false);
    this.setSliding(false);
    this.setCharge(0);
  }

  /** Bourdonnement montant pendant la charge de l'attaque (0 = silence). */
  setCharge(level: number): void {
    const h = this.chargeHum;
    if (!h || !this.ctx) return;
    const q = Math.round(level * 50) / 50;
    if (q === h.level) return;
    h.level = q;
    const t = this.ctx.currentTime;
    h.gain.gain.setTargetAtTime(q > 0 ? 0.02 + q * 0.05 : 0, t, 0.05);
    h.osc.frequency.setTargetAtTime(110 + q * 520, t, 0.05);
    h.sub.frequency.setTargetAtTime(55 + q * 260, t, 0.05);
  }

  playChargeReady(): void {
    this.tone({ type: 'sine', from: 1320, to: 1320, duration: 0.12, volume: 0.08, raw: true });
    this.tone({ type: 'sine', from: 1980, to: 1980, duration: 0.18, volume: 0.07, delay: 0.07, raw: true });
    this.tone({ type: 'triangle', from: 2640, to: 2640, duration: 0.25, volume: 0.05, delay: 0.14, raw: true });
  }

  playChargedStrike(): void {
    this.noise({ duration: 0.45, volume: 0.55, type: 'bandpass', from: 300, to: 5200, q: 0.8 });
    this.tone({ type: 'sawtooth', from: 90, to: 900, duration: 0.35, volume: 0.12 });
    this.tone({ type: 'sine', from: 70, to: 35, duration: 0.5, volume: 0.35, delay: 0.05 });
  }

  // ---------------------------------------------------------------------------
  // Effets
  // ---------------------------------------------------------------------------

  playSlash(): void {
    this.noise({ duration: 0.22, volume: 0.5, type: 'bandpass', from: 5200, to: 900, q: 1.4 });
    this.tone({ type: 'sawtooth', from: 2400, to: 3600, duration: 0.09, volume: 0.05 });
    this.tone({ type: 'sine', from: 5200, to: 4800, duration: 0.35, volume: 0.04, delay: 0.03 });
  }

  playBladeHit(): void {
    this.tone({ type: 'square', from: 180, to: 40, duration: 0.18, volume: 0.25 });
    this.noise({ duration: 0.12, volume: 0.45, type: 'highpass', from: 3000, to: 1500, q: 0.7 });
    this.tone({ type: 'sine', from: 3100, to: 2900, duration: 0.4, volume: 0.06, delay: 0.01 });
  }

  playDeflect(): void {
    this.tone({ type: 'triangle', from: 2600, to: 2400, duration: 0.45, volume: 0.18 });
    this.tone({ type: 'sine', from: 3900, to: 3700, duration: 0.35, volume: 0.08 });
    this.noise({ duration: 0.08, volume: 0.3, type: 'highpass', from: 5000, to: 4000, q: 0.5 });
  }

  playShot(): void {
    this.tone({ type: 'square', from: 1400, to: 160, duration: 0.13, volume: 0.16 });
    this.tone({ type: 'sawtooth', from: 2600, to: 300, duration: 0.09, volume: 0.08 });
    this.noise({ duration: 0.06, volume: 0.35, type: 'highpass', from: 2500, to: 1200, q: 0.6 });
    this.tone({ type: 'sine', from: 90, to: 45, duration: 0.12, volume: 0.3 });
  }

  playJump(): void {
    this.tone({ type: 'sine', from: 220, to: 420, duration: 0.12, volume: 0.12 });
    this.noise({ duration: 0.1, volume: 0.12, type: 'lowpass', from: 1800, to: 600, q: 0.5 });
  }

  playDoubleJump(): void {
    this.tone({ type: 'triangle', from: 380, to: 900, duration: 0.16, volume: 0.12 });
    this.tone({ type: 'sine', from: 760, to: 1500, duration: 0.14, volume: 0.06, delay: 0.02 });
    this.noise({ duration: 0.18, volume: 0.15, type: 'bandpass', from: 900, to: 3200, q: 1.1 });
  }

  playDash(): void {
    this.noise({ duration: 0.3, volume: 0.45, type: 'bandpass', from: 400, to: 3800, q: 0.9 });
    this.tone({ type: 'sawtooth', from: 120, to: 480, duration: 0.2, volume: 0.07 });
  }

  playLand(intensity: number): void {
    const v = Math.min(1, intensity);
    this.tone({ type: 'sine', from: 140, to: 45, duration: 0.15, volume: 0.25 * v + 0.05 });
    this.noise({ duration: 0.09, volume: 0.25 * v + 0.05, type: 'lowpass', from: 1200, to: 300, q: 0.6 });
  }

  playFootstep(): void {
    this.noise({
      duration: 0.05,
      volume: 0.07,
      type: 'bandpass',
      from: 1400 + Math.random() * 500,
      to: 600,
      q: 1.5,
    });
    this.tone({ type: 'sine', from: 110, to: 60, duration: 0.05, volume: 0.05 });
  }

  playWallRunStart(): void {
    this.noise({ duration: 0.18, volume: 0.18, type: 'bandpass', from: 1200, to: 2600, q: 1.2 });
    this.tone({ type: 'triangle', from: 300, to: 520, duration: 0.12, volume: 0.06 });
  }

  playSlideStart(): void {
    this.noise({ duration: 0.25, volume: 0.25, type: 'lowpass', from: 2200, to: 500, q: 0.8 });
  }

  playVault(): void {
    this.tone({ type: 'sine', from: 180, to: 320, duration: 0.1, volume: 0.1 });
    this.noise({ duration: 0.12, volume: 0.12, type: 'bandpass', from: 700, to: 1600, q: 1 });
  }

  playJumpPad(): void {
    this.tone({ type: 'sine', from: 120, to: 900, duration: 0.45, volume: 0.25 });
    this.tone({ type: 'square', from: 240, to: 1800, duration: 0.35, volume: 0.05 });
    this.noise({ duration: 0.4, volume: 0.2, type: 'bandpass', from: 500, to: 4000, q: 0.9 });
  }

  playExplosion(): void {
    this.noise({ duration: 0.7, volume: 0.65, type: 'lowpass', from: 3500, to: 120, q: 0.7 });
    this.tone({ type: 'sine', from: 160, to: 30, duration: 0.6, volume: 0.45 });
    this.tone({ type: 'sawtooth', from: 900, to: 60, duration: 0.25, volume: 0.08 });
    this.noise({ duration: 0.35, volume: 0.2, type: 'highpass', from: 6000, to: 2000, q: 0.5, delay: 0.05 });
  }

  playEnemyAim(volume = 1): void {
    this.tone({ type: 'square', from: 600, to: 1400, duration: 0.5, volume: 0.035 * volume });
    this.tone({ type: 'sine', from: 1200, to: 2400, duration: 0.5, volume: 0.03 * volume, delay: 0.05 });
  }

  playEnemyShot(volume = 1): void {
    this.tone({ type: 'sawtooth', from: 900, to: 120, duration: 0.22, volume: 0.12 * volume });
    this.noise({ duration: 0.15, volume: 0.22 * volume, type: 'bandpass', from: 2000, to: 500, q: 0.8 });
  }

  playHurt(): void {
    this.tone({ type: 'sawtooth', from: 220, to: 70, duration: 0.3, volume: 0.25 });
    this.noise({ duration: 0.25, volume: 0.35, type: 'lowpass', from: 2500, to: 200, q: 1 });
    this.tone({ type: 'square', from: 1800, to: 1700, duration: 0.12, volume: 0.05, delay: 0.05 });
  }

  playDeath(): void {
    this.tone({ type: 'sawtooth', from: 400, to: 30, duration: 1.4, volume: 0.25 });
    this.tone({ type: 'square', from: 205, to: 25, duration: 1.6, volume: 0.1 });
    this.noise({ duration: 1.2, volume: 0.3, type: 'lowpass', from: 3000, to: 80, q: 1 });
  }

  playSandevistan(on: boolean): void {
    if (on) {
      this.tone({ type: 'sawtooth', from: 1800, to: 90, duration: 0.6, volume: 0.15, raw: true });
      this.tone({ type: 'sine', from: 900, to: 50, duration: 0.8, volume: 0.25, raw: true });
      this.noise({ duration: 0.5, volume: 0.25, type: 'bandpass', from: 4000, to: 200, q: 1.5, raw: true });
    } else {
      this.tone({ type: 'sawtooth', from: 90, to: 1400, duration: 0.4, volume: 0.1, raw: true });
      this.tone({ type: 'sine', from: 60, to: 700, duration: 0.45, volume: 0.18, raw: true });
    }
  }

  /** Petit bip d'interface (navigation du tutoriel). */
  playUiBlip(): void {
    this.tone({ type: 'square', from: 880, to: 1320, duration: 0.05, volume: 0.035, raw: true });
  }

  playDenied(): void {
    this.tone({ type: 'square', from: 220, to: 200, duration: 0.09, volume: 0.07 });
    this.tone({ type: 'square', from: 180, to: 160, duration: 0.12, volume: 0.07, delay: 0.1 });
  }

  /** Déploiement mécanique des lames : servo + verrouillage. */
  playBladeDeploy(): void {
    this.tone({ type: 'square', from: 260, to: 820, duration: 0.2, volume: 0.035 });
    this.noise({ duration: 0.22, volume: 0.12, type: 'bandpass', from: 1200, to: 3800, q: 2 });
    this.tone({ type: 'triangle', from: 2600, to: 2300, duration: 0.08, volume: 0.07, delay: 0.24 });
    this.noise({ duration: 0.05, volume: 0.22, type: 'highpass', from: 5000, to: 3000, q: 0.7, delay: 0.24 });
    this.tone({ type: 'sine', from: 5200, to: 5000, duration: 0.3, volume: 0.025, delay: 0.26 });
  }

  playWeaponSwitch(): void {
    this.tone({ type: 'square', from: 900, to: 1300, duration: 0.05, volume: 0.05 });
    this.noise({ duration: 0.12, volume: 0.15, type: 'highpass', from: 4500, to: 2500, q: 0.6, delay: 0.04 });
    this.tone({ type: 'triangle', from: 2200, to: 2000, duration: 0.15, volume: 0.04, delay: 0.08 });
  }

  playKillConfirm(): void {
    this.tone({ type: 'sine', from: 1320, to: 1320, duration: 0.07, volume: 0.06, raw: true });
    this.tone({ type: 'sine', from: 1980, to: 1980, duration: 0.1, volume: 0.05, delay: 0.06, raw: true });
  }

  playFinish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', from: f, to: f, duration: 0.35, volume: 0.1, delay: i * 0.09, raw: true });
      this.tone({ type: 'sine', from: f * 2, to: f * 2, duration: 0.25, volume: 0.03, delay: i * 0.09, raw: true });
    });
  }

  playStart(): void {
    this.tone({ type: 'sawtooth', from: 60, to: 240, duration: 0.6, volume: 0.12, raw: true });
    this.tone({ type: 'sine', from: 880, to: 1760, duration: 0.25, volume: 0.06, delay: 0.35, raw: true });
  }

  // ---------------------------------------------------------------------------
  // Briques de synthèse
  // ---------------------------------------------------------------------------

  private tone(opts: {
    type: OscillatorType;
    from: number;
    to: number;
    duration: number;
    volume: number;
    delay?: number;
    raw?: boolean;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = opts.raw ? 1 : this.pitch;
    const stretch = 1 / p;
    const t0 = ctx.currentTime + (opts.delay ?? 0) * stretch;
    const dur = opts.duration * stretch;

    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(Math.max(20, opts.from * p), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to * p), t0 + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.volume), t0 + Math.min(0.01, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain).connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(opts: {
    duration: number;
    volume: number;
    type: BiquadFilterType;
    from: number;
    to: number;
    q: number;
    delay?: number;
    raw?: boolean;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = opts.raw ? 1 : this.pitch;
    const stretch = 1 / p;
    const t0 = ctx.currentTime + (opts.delay ?? 0) * stretch;
    const dur = opts.duration * stretch;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = p;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.Q.value = opts.q;
    filter.frequency.setValueAtTime(Math.max(20, opts.from * p), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to * p), t0 + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.volume), t0 + Math.min(0.012, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(gain).connect(this.sfx);
    const offset = Math.random() * (this.noiseBuffer.duration - dur - 0.1);
    src.start(t0, Math.max(0, offset));
    src.stop(t0 + dur + 0.05);
  }

  private createLoop(type: BiquadFilterType, freq: number, q: number): LoopChannel | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfx);
    src.start();
    return { gain, filter, level: 0 };
  }

  private setLoop(loop: LoopChannel | null, level: number): void {
    if (!loop || !this.ctx || loop.level === level) return;
    loop.level = level;
    loop.gain.gain.setTargetAtTime(level, this.ctx.currentTime, level > 0 ? 0.04 : 0.08);
  }

  private createSandevistanHum(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 48;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // Le bourdonnement contourne le filtre de ralenti pour rester audible.
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    lfo.start();
    this.sandevistanHum = { gain, osc };
  }

  private createChargeHum(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 110;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(this.sfx);
    osc.start();
    sub.start();
    this.chargeHum = { gain, osc, sub, level: 0 };
  }

  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // Pluie : bruit blanc filtré
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuffer;
    rain.loop = true;
    const rainHP = ctx.createBiquadFilter();
    rainHP.type = 'highpass';
    rainHP.frequency.value = 900;
    const rainLP = ctx.createBiquadFilter();
    rainLP.type = 'lowpass';
    rainLP.frequency.value = 7500;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.09;
    rain.connect(rainHP).connect(rainLP).connect(rainGain).connect(this.ambience);
    rain.start();

    // Grondement urbain lointain
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noiseBuffer;
    rumble.loop = true;
    rumble.playbackRate.value = 0.5;
    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.value = 160;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.35;
    rumble.connect(rumbleLP).connect(rumbleGain).connect(this.ambience);
    rumble.start();

    // Nappe synthétique sombre
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 380;
    padFilter.Q.value = 3;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    padFilter.connect(padGain).connect(this.ambience);
    for (const f of [55, 55.4, 82.4, 110.2]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(padFilter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(padFilter.frequency);
    lfo.start();

    this.ambience.gain.setTargetAtTime(0.9, ctx.currentTime, 1.5);
  }
}
