import { BLADES, CHARGED, DASH, MONOWIRE, MOVEMENT, PLAYER, SANDEVISTAN } from '../config';

/** Marchand qui vend une amélioration. */
export type VendorId = 'clinic' | 'atelier' | 'armory' | 'ink';

/** Lien avec Sacha, choisi par le joueur. */
export type Sibling = 'frere' | 'soeur';

export interface UpgradeDef {
  id: string;
  vendor: VendorId;
  name: string;
  desc: string;
  price: number;
  /** Encre des lames (cosmétique, une seule équipée) : couleurs droite / gauche. */
  ink?: [number, number];
}

export const DEFAULT_INK = 'ink-default';

/** Améliorations permanentes achetées à la Plaza. */
export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'dash3', vendor: 'clinic', name: 'PROPULSEURS MK.II', desc: '+1 charge de dash (3 au lieu de 2).', price: 260 },
  { id: 'dashfast', vendor: 'clinic', name: 'CONDENSATEURS RAPIDES', desc: 'Les charges de dash reviennent 30 % plus vite.', price: 160 },
  { id: 'armor', vendor: 'clinic', name: 'DERME BLINDÉ', desc: '+1 point d\'intégrité (4 au lieu de 3).', price: 220 },
  { id: 'sandy', vendor: 'clinic', name: 'SANDEVISTAN MK.II', desc: 'La jauge du Sandevistan se vide 35 % moins vite.', price: 200 },
  { id: 'blades', vendor: 'atelier', name: 'LAMES ALLONGÉES', desc: 'Portée des lames +25 % et fente plus longue.', price: 150 },
  { id: 'airjump', vendor: 'atelier', name: 'RESSORTS DE MOLLETS', desc: 'Un saut en l\'air de plus : triple saut.', price: 320 },
  { id: 'magnet', vendor: 'atelier', name: 'PUCE DE NÉGOCE', desc: 'Crédits gagnés en fin de niveau +25 %.', price: 180 },
  { id: 'coolant', vendor: 'clinic', name: 'REFROIDISSEUR', desc: 'Les attaques chargées (lames, monowire) se rechargent 40 % plus vite.', price: 150 },
  { id: 'monowire', vendor: 'armory', name: 'MONOWIRE', desc: 'Fouet monofilament : portée 10 m, deux touches pour tuer. Maintenir puis relâcher : double balayage de zone. Touche 3.', price: 240 },
  { id: 'buckshot', vendor: 'armory', name: 'CHEVROTINE', desc: 'Le tir chargé du pistolet lâche 5 projectiles au lieu de 3.', price: 170 },
  { id: 'wirelong', vendor: 'armory', name: 'FIL HAUTE TENSION', desc: 'Portée du monowire +2,5 m, zone du balayage chargé +2,5 m.', price: 150 },
  { id: DEFAULT_INK, vendor: 'ink', name: 'ENCRE D\'ORIGINE', desc: 'Cyan et magenta, comme au premier jour.', price: 0, ink: [0x00e5ff, 0xff2bd6] },
  { id: 'ink-gold', vendor: 'ink', name: 'ENCRE OR', desc: 'Or chaud et ambre. Discret, comme un lingot.', price: 35, ink: [0xffc83a, 0xff7a1a] },
  { id: 'ink-toxic', vendor: 'ink', name: 'ENCRE TOXIQUE', desc: 'Vert acide et menthe radioactive.', price: 35, ink: [0x9dff5c, 0x2bffb0] },
  { id: 'ink-blood', vendor: 'ink', name: 'ENCRE SANG', desc: 'Rouge alarme et orange incendie.', price: 35, ink: [0xff2040, 0xff8a2b] },
  { id: 'ink-ice', vendor: 'ink', name: 'ENCRE GLACE', desc: 'Blanc givré et bleu nuit.', price: 35, ink: [0xbfe8ff, 0x7a8aff] },
];

/**
 * Valeurs de jeu modifiables par les améliorations. Le reste du code lit ces
 * valeurs (et non directement la config) pour que les achats s'appliquent.
 */
export const STATS = {
  dashMax: DASH.maxCharges as number,
  dashRecharge: DASH.rechargeTime as number,
  maxHealth: PLAYER.maxHealth as number,
  sandDrain: SANDEVISTAN.drainPerSecond as number,
  bladeRange: BLADES.range as number,
  lungeRange: BLADES.lungeRange as number,
  airJumps: MOVEMENT.maxAirJumps as number,
  creditBonus: 1,
  chargeCooldown: CHARGED.cooldown as number,
  shotgunPellets: 3,
  wireRange: MONOWIRE.range as number,
  wireChargeRadius: MONOWIRE.chargeRadius as number,
  wireChargeCooldown: MONOWIRE.chargeCooldown as number,
};

/** Récompense de fin de niveau, détaillée pour l'écran d'arrivée. */
export interface Reward {
  total: number;
  lines: string[];
}

interface SaveData {
  credits: number;
  owned: string[];
  eggs: string[];
  coins: number;
  sibling?: Sibling;
  ink?: string;
  raceBest?: number;
}

const SAVE_KEY = 'neon-vertigo-progress';

/** Crédits, améliorations et easter eggs trouvés, sauvegardés dans le navigateur. */
export class Progress {
  credits = 0;
  /** Pièces jetées dans la fontaine. */
  coins = 0;
  sibling: Sibling = 'frere';
  /** Encre équipée sur les lames. */
  ink = DEFAULT_INK;
  /** Meilleur temps de la course de la Plaza (s). */
  raceBest: number | null = null;
  private readonly owned = new Set<string>();
  private readonly eggs = new Set<string>();

  constructor() {
    this.load();
    this.applyStats();
  }

  has(id: string): boolean {
    return id === DEFAULT_INK || this.owned.has(id);
  }

  /** Drapeaux de progression (quêtes, secrets, fragments) : alias des easter eggs. */
  hasFlag(id: string): boolean {
    return this.eggs.has(id);
  }

  setFlag(id: string): boolean {
    return this.findEgg(id);
  }

  equipInk(id: string): boolean {
    if (!this.has(id) || !UPGRADES.some((u) => u.id === id && u.ink)) return false;
    this.ink = id;
    this.save();
    return true;
  }

  inkColors(): [number, number] {
    return UPGRADES.find((u) => u.id === this.ink)?.ink ?? [0x00e5ff, 0xff2bd6];
  }

  hasEgg(id: string): boolean {
    return this.eggs.has(id);
  }

  /** Marque un easter egg comme trouvé ; vrai si c'est la première fois. */
  findEgg(id: string): boolean {
    if (this.eggs.has(id)) return false;
    this.eggs.add(id);
    this.save();
    return true;
  }

  countEggs(prefix: string): number {
    let n = 0;
    for (const e of this.eggs) if (e.startsWith(prefix)) n++;
    return n;
  }

  addCredits(amount: number): void {
    this.credits = Math.max(0, Math.round(this.credits + amount));
    this.save();
  }

  spend(amount: number): boolean {
    if (this.credits < amount) return false;
    this.credits -= amount;
    this.save();
    return true;
  }

  buy(id: string): boolean {
    const up = UPGRADES.find((u) => u.id === id);
    if (!up || this.has(id) || this.credits < up.price) return false;
    this.credits -= up.price;
    this.owned.add(id);
    if (up.ink) this.ink = id;
    this.applyStats();
    this.save();
    return true;
  }

  /** Crédits gagnés en terminant un niveau. */
  levelReward(difficulty: number, kills: number, firstClear: boolean, record: boolean): Reward {
    const lines: string[] = [];
    let total = 0;
    const add = (label: string, v: number) => {
      if (v <= 0) return;
      total += v;
      lines.push(`${label} +${v}`);
    };
    add('EXTRACTION', 40 + 20 * difficulty);
    add(`CIBLES ×${kills}`, kills * 8);
    if (firstClear) add('PREMIÈRE FOIS', 80);
    if (record) add('RECORD', 25);
    if (STATS.creditBonus > 1) {
      const bonus = Math.round(total * (STATS.creditBonus - 1));
      add('PUCE DE NÉGOCE', bonus);
    }
    return { total, lines };
  }

  private applyStats(): void {
    STATS.dashMax = DASH.maxCharges + (this.has('dash3') ? 1 : 0);
    STATS.dashRecharge = DASH.rechargeTime * (this.has('dashfast') ? 0.7 : 1);
    STATS.maxHealth = PLAYER.maxHealth + (this.has('armor') ? 1 : 0);
    STATS.sandDrain = SANDEVISTAN.drainPerSecond * (this.has('sandy') ? 0.65 : 1);
    STATS.bladeRange = BLADES.range * (this.has('blades') ? 1.25 : 1);
    STATS.lungeRange = BLADES.lungeRange + (this.has('blades') ? 2 : 0);
    STATS.airJumps = MOVEMENT.maxAirJumps + (this.has('airjump') ? 1 : 0);
    STATS.creditBonus = this.has('magnet') ? 1.25 : 1;
    STATS.chargeCooldown = CHARGED.cooldown * (this.has('coolant') ? 0.6 : 1);
    STATS.shotgunPellets = this.has('buckshot') ? 5 : 3;
    STATS.wireRange = MONOWIRE.range + (this.has('wirelong') ? 2.5 : 0);
    STATS.wireChargeRadius = MONOWIRE.chargeRadius + (this.has('wirelong') ? 2.5 : 0);
    STATS.wireChargeCooldown = MONOWIRE.chargeCooldown * (this.has('coolant') ? 0.6 : 1);
  }

  private load(): void {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<SaveData>;
      this.credits = typeof data.credits === 'number' && data.credits >= 0 ? Math.round(data.credits) : 0;
      this.coins = typeof data.coins === 'number' ? data.coins : 0;
      for (const id of data.owned ?? []) if (UPGRADES.some((u) => u.id === id)) this.owned.add(id);
      for (const id of data.eggs ?? []) if (typeof id === 'string') this.eggs.add(id);
      if (data.sibling === 'frere' || data.sibling === 'soeur') this.sibling = data.sibling;
      if (typeof data.ink === 'string' && this.has(data.ink)) this.ink = data.ink;
      if (typeof data.raceBest === 'number' && data.raceBest > 0) this.raceBest = data.raceBest;
    } catch {
      /* sauvegarde illisible ou stockage indisponible : on repart de zéro */
    }
  }

  save(): void {
    const data: SaveData = {
      credits: this.credits,
      owned: [...this.owned],
      eggs: [...this.eggs],
      coins: this.coins,
      sibling: this.sibling,
      ink: this.ink,
      raceBest: this.raceBest ?? undefined,
    };
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* stockage indisponible : la progression dure le temps de la session */
    }
  }
}
