/**
 * Musique synthwave 100 % procédurale : séquenceur à doubles croches
 * (grosse caisse, caisse claire, charleston, basse, arpège avec écho, nappe).
 * L'intensité (0 → 1) ajoute ou retire des couches : nappe seule au calme,
 * batterie complète et filtre ouvert en plein combat.
 */

export interface MusicTheme {
  id: string;
  bpm: number;
  /** Note MIDI de la tonique (ex. 45 = la grave). */
  root: number;
  /** Accords d'une mesure chacun : décalage (demi-tons) et qualité. */
  chords: readonly { r: number; q: 'm' | 'M' }[];
  /** Arpège : index de note d'accord par double croche (-1 = silence). */
  arp: readonly number[];
  /** Motifs de batterie sur 16 pas : x = frappe, o = accent / ouvert. */
  kick: string;
  snare: string;
  hat: string;
  /** Basse sur 16 pas : x = fondamentale, o = octave, . = silence. */
  bass: string;
}

const MINOR = [0, 3, 7, 12];
const MAJOR = [0, 4, 7, 12];

export const MUSIC_THEMES: Record<string, MusicTheme> = {
  plaza: {
    id: 'plaza',
    bpm: 90,
    root: 45,
    chords: [
      { r: 0, q: 'm' },
      { r: -4, q: 'M' },
      { r: 3, q: 'M' },
      { r: -2, q: 'M' },
    ],
    arp: [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 1, -1, 0, -1, 2, -1],
    kick: 'x.......x.......',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    bass: 'x.......x...o...',
  },
  'toits-de-neon': {
    id: 'toits-de-neon',
    bpm: 118,
    root: 45,
    chords: [
      { r: 0, q: 'm' },
      { r: -4, q: 'M' },
      { r: 3, q: 'M' },
      { r: -2, q: 'M' },
    ],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 3, 2],
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.xo',
    bass: 'x.xox.xox.xox.xo',
  },
  'marche-de-nuit': {
    id: 'marche-de-nuit',
    bpm: 108,
    root: 50,
    chords: [
      { r: 0, q: 'm' },
      { r: 5, q: 'M' },
      { r: 7, q: 'm' },
      { r: 3, q: 'M' },
    ],
    arp: [0, -1, 1, 2, -1, 1, 3, -1, 2, -1, 1, 0, -1, 2, 1, -1],
    kick: 'x.....x...x.....',
    snare: '....x.......x..x',
    hat: '..x...x...x...xo',
    bass: 'x..x..x.o..x..x.',
  },
  'tours-de-verre': {
    id: 'tours-de-verre',
    bpm: 124,
    root: 40,
    chords: [
      { r: 0, q: 'm' },
      { r: -4, q: 'M' },
      { r: 3, q: 'M' },
      { r: -2, q: 'M' },
    ],
    arp: [0, 2, 1, 3, 0, 2, 1, 3, 2, 0, 3, 1, 2, 0, 3, 1],
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: 'xxx.xxx.xxx.xxxo',
    bass: 'xxoxxxoxxxoxxxox',
  },
  'la-chute': {
    id: 'la-chute',
    bpm: 128,
    root: 48,
    chords: [
      { r: 0, q: 'm' },
      { r: -4, q: 'M' },
      { r: 3, q: 'M' },
      { r: -2, q: 'M' },
    ],
    arp: [0, -1, 0, 3, -1, 2, -1, 1, 0, -1, 0, 3, -1, 2, 1, -1],
    kick: 'x..x..x...x..x..',
    snare: '....x.......x.x.',
    hat: 'x.xox.xox.xox.xo',
    bass: 'x..x..x.x..x..ox',
  },
  'la-purge': {
    id: 'la-purge',
    bpm: 140,
    root: 42,
    chords: [
      { r: 0, q: 'm' },
      { r: -4, q: 'M' },
      { r: -2, q: 'M' },
      { r: -5, q: 'm' },
    ],
    arp: [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 3, 2, 1, 2],
    kick: 'x.x.x.x.x.x.x.x.',
    snare: '....x..x....x.xx',
    hat: 'xoxxxoxxxoxxxoxx',
    bass: 'xxoxxxoxxxoxxoxo',
  },
  /** L'Antenne : aérien et ample, mode majeur qui s'élève (espoir du dernier signal). */
  'l-antenne': {
    id: 'l-antenne',
    bpm: 132,
    root: 47,
    chords: [
      { r: 0, q: 'M' },
      { r: 7, q: 'M' },
      { r: 9, q: 'm' },
      { r: 5, q: 'M' },
    ],
    arp: [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 2, 1, 3, 2, 3],
    kick: 'x...x...x...x...',
    snare: '....x.......x..x',
    hat: '.xxx.xxx.xxx.xxo',
    bass: 'x.ox.xo.x.ox.xox',
  },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  private readonly ctx: AudioContext;
  private readonly noise: AudioBuffer;
  private readonly out: GainNode;
  private readonly delayIn: GainNode;
  private theme: MusicTheme = MUSIC_THEMES.plaza;
  private pending: MusicTheme | null = null;
  private target = 0.2;
  private intensity = 0.2;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private enabled = true;
  private paused = false;

  constructor(ctx: AudioContext, destination: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0.22;
    this.out.connect(destination);
    // Écho de l'arpège (croche pointée)
    this.delayIn = ctx.createGain();
    this.delayIn.gain.value = 1;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    this.delayIn.connect(delay);
    delay.connect(tone).connect(feedback).connect(delay);
    tone.connect(this.out);
    this.delayIn.connect(this.out);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Change de morceau (effectif à la mesure suivante). */
  setTheme(id: string): void {
    const t = MUSIC_THEMES[id] ?? MUSIC_THEMES.plaza;
    if (t === this.theme) return;
    this.pending = t;
  }

  /** Intensité visée (0 calme → 1 combat). */
  setIntensity(level: number): void {
    this.target = Math.max(0, Math.min(1, level));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVolume();
  }

  /** Pause : musique étouffée et plus basse. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyVolume();
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  private applyVolume(): void {
    const v = !this.enabled ? 0 : this.paused ? 0.08 : 0.22;
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  private schedule(): void {
    if (this.ctx.state !== 'running') {
      this.nextTime = this.ctx.currentTime + 0.1;
      return;
    }
    // Rattrapage après une longue suspension (onglet en arrière-plan)
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.nextTime);
      const sixteenth = 60 / this.theme.bpm / 4;
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar++;
        if (this.pending) {
          this.theme = this.pending;
          this.pending = null;
          this.bar = 0;
        }
      }
    }
  }

  private playStep(t: number): void {
    // L'intensité suit sa cible en douceur (quelques mesures)
    this.intensity += (this.target - this.intensity) * 0.05;
    const k = this.intensity;
    const th = this.theme;
    const s = this.step;
    const chord = th.chords[this.bar % th.chords.length];
    const tones = (chord.q === 'm' ? MINOR : MAJOR).map((x) => th.root + chord.r + x);
    const beat = 60 / th.bpm;

    if (s === 0) this.pad(t, tones, beat * 4, k);
    if (k > 0.12) {
      const a = th.arp[s];
      if (a >= 0) this.arp(t, tones[a % tones.length] + 24, k);
    }
    if (k > 0.3 && th.bass[s] !== '.') this.bassNote(t, tones[0] - 12 + (th.bass[s] === 'o' ? 12 : 0), beat / 4, k);
    if (k > 0.45 && th.hat[s] !== '.') this.hat(t, th.hat[s] === 'o', k);
    if (k > 0.5 && th.kick[s] !== '.') this.kick(t, k);
    if (k > 0.7 && th.snare[s] !== '.') this.snare(t, k);
  }

  // ---------------------------------------------------------------------------
  // Instruments
  // ---------------------------------------------------------------------------

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private kick(t: number, k: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = this.env(t, 0.9 * (0.6 + k * 0.4), 0.004, 0.32);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number, k: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.7;
    const g = this.env(t, 0.38 * k, 0.002, 0.17);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.22);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g2 = this.env(t, 0.18 * k, 0.002, 0.08);
    o.connect(g2).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, open: boolean, k: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7600;
    const g = this.env(t, (open ? 0.12 : 0.08) * k, 0.002, open ? 0.12 : 0.035);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.16);
  }

  private bassNote(t: number, note: number, dur: number, k: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(note);
    const sub = this.ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = midi(note - 12);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    const open = 260 + k * 1100;
    f.frequency.setValueAtTime(open * 2.2, t);
    f.frequency.exponentialRampToValueAtTime(open, t + dur * 0.9);
    const g = this.env(t, 0.26, 0.005, dur * 1.6);
    const sg = this.ctx.createGain();
    sg.gain.value = 0.4;
    o.connect(f);
    sub.connect(sg).connect(f);
    f.connect(g).connect(this.out);
    o.start(t);
    sub.start(t);
    o.stop(t + dur * 2);
    sub.stop(t + dur * 2);
  }

  private arp(t: number, note: number, k: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midi(note);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200 + k * 2200;
    const g = this.env(t, 0.05 + k * 0.04, 0.004, 0.16);
    o.connect(f).connect(g).connect(this.delayIn);
    o.start(t);
    o.stop(t + 0.22);
  }

  private pad(t: number, tones: number[], dur: number, k: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700 + k * 600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.25);
    g.gain.setValueAtTime(0.05, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g).connect(this.out);
    for (const [i, n] of tones.slice(0, 3).entries()) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n + 12);
      o.detune.value = (i - 1) * 7;
      o.connect(f);
      o.start(t);
      o.stop(t + dur * 1.1);
    }
  }
}
