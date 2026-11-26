import type { KillCause } from '../enemies/EnemyManager';

/**
 * Jauge de style : chaque élimination rapporte des points, multipliés par le
 * combo (éliminations enchaînées en moins de 4 s) et bonifiés selon la
 * manière (en l'air, en wall-run, projectile renvoyé, attaque chargée…).
 * La « chaleur » donne la lettre affichée en jeu ; le score final donne le rang.
 */

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';
export type Medal = 'gold' | 'silver' | 'bronze' | null;

export interface KillContext {
  air: boolean;
  wall: boolean;
  slow: boolean;
}

const CAUSE_BONUS: Record<KillCause, [number, string | null]> = {
  melee: [20, null],
  shot: [0, null],
  deflect: [120, 'RENVOI'],
  charged: [60, 'CHARGÉE'],
  wire: [30, 'FOUET'],
  slam: [80, 'SÉISME'],
  grapple: [70, 'HARPON'],
  blast: [90, 'EXPLOSION'],
};

const RANKS: Rank[] = ['D', 'C', 'B', 'A', 'S'];
const COMBO_WINDOW = 4;

export class StyleMeter {
  points = 0;
  combo = 0;
  bestCombo = 0;
  /** Aucun dégât subi pendant la course. */
  flawless = true;
  /** Chaleur de style (0 → 5) : donne la lettre affichée en jeu. */
  private heat = 0;
  private comboTimer = 0;

  reset(): void {
    this.points = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.flawless = true;
    this.heat = 0;
    this.comboTimer = 0;
  }

  kill(cause: KillCause, ctx: KillContext): { gain: number; labels: string[]; combo: number } {
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = COMBO_WINDOW;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const [bonus, label] = CAUSE_BONUS[cause];
    let base = 100 + bonus;
    const labels: string[] = [];
    if (label) labels.push(label);
    if (ctx.wall) {
      base += 90;
      labels.push('MURAL');
    } else if (ctx.air) {
      base += 60;
      labels.push('AÉRIEN');
    }
    if (ctx.slow) {
      base += 30;
      labels.push('RALENTI');
    }
    const gain = Math.round(base * this.multiplier);
    this.points += gain;
    this.heat = Math.min(5, this.heat + gain / 320);
    return { gain, labels, combo: this.combo };
  }

  /** Points de style exceptionnels (cœur du boss détruit…), multipliés par le combo. */
  bonus(points: number): number {
    const gain = Math.round(points * this.multiplier);
    this.points += gain;
    this.heat = Math.min(5, this.heat + gain / 320);
    return gain;
  }

  /** Un coup encaissé casse le combo et refroidit la jauge. */
  hurt(): void {
    this.flawless = false;
    this.combo = 0;
    this.comboTimer = 0;
    this.heat = Math.max(0, this.heat - 1.2);
  }

  update(dt: number): void {
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;
    this.heat = Math.max(0, this.heat - dt * 0.12);
  }

  get multiplier(): number {
    return Math.min(3, 1 + 0.25 * Math.max(0, this.combo - 1));
  }

  /** Lettre courante et progression vers la suivante (0 → 1). */
  get letter(): { rank: Rank; progress: number; visible: boolean } {
    const i = Math.min(4, Math.floor(this.heat));
    return { rank: RANKS[i], progress: this.heat >= 5 ? 1 : this.heat - Math.floor(this.heat), visible: this.heat > 0.05 };
  }

  get comboProgress(): number {
    return this.comboTimer / COMBO_WINDOW;
  }
}

export function medalFor(time: number, par: readonly [number, number, number]): Medal {
  if (par[0] <= 0) return null;
  if (time <= par[0]) return 'gold';
  if (time <= par[1]) return 'silver';
  if (time <= par[2]) return 'bronze';
  return null;
}

export const MEDAL_LABEL: Record<Exclude<Medal, null>, string> = { gold: 'OR', silver: 'ARGENT', bronze: 'BRONZE' };

export interface RunScore {
  score: number;
  rank: Rank;
  lines: string[];
}

/** Score final : vitesse, éliminations, style et course sans dégât. */
export function scoreRun(time: number, par: readonly [number, number, number], kills: number, total: number, style: StyleMeter): RunScore {
  const [gold, , bronze] = par;
  const slow = bronze * 1.5;
  const speed = Math.round(3000 * Math.max(0, Math.min(1, (slow - time) / (slow - gold))));
  const hunt = total > 0 ? Math.round((1500 * kills) / total) : 0;
  const flawless = style.flawless ? 500 : 0;
  const score = speed + hunt + style.points + flawless;
  const rank: Rank = score >= 6500 ? 'S' : score >= 5000 ? 'A' : score >= 3500 ? 'B' : score >= 2000 ? 'C' : 'D';
  const lines = [`VITESSE ${speed}`, `CHASSE ${hunt}`, `STYLE ${style.points}`];
  if (flawless) lines.push(`SANS UNE ÉGRATIGNURE ${flawless}`);
  return { score, rank, lines };
}

export const RANK_ORDER: readonly Rank[] = RANKS;

/** Crédits bonus selon le rang. */
export function rankBonus(rank: Rank): number {
  return rank === 'S' ? 80 : rank === 'A' ? 50 : rank === 'B' ? 25 : 0;
}
