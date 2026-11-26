import type { BillboardKind, RoofStyle } from './PixelTextures';

/**
 * Définition des niveaux (données pures, interprétées par LevelBuilder).
 * Les parcours suivent l'axe -Z ; le décor urbain est commun à tous les niveaux.
 * Les aides `wallPair`, `descentWall` et `padTo` reproduisent des enchaînements
 * validés (distances et hauteurs franchissables) relativement au toit précédent.
 */

export const NEON = {
  cyan: 0x00e5ff,
  magenta: 0xff2bd6,
  purple: 0xa36bff,
  orange: 0xff8a2b,
  red: 0xff3b3b,
  green: 0x2bffb0,
  yellow: 0xffd23b,
  lime: 0x9dff5c,
  amber: 0xffb030,
  sodium: 0xff9a3c,
  pink: 0xff4fa3,
  teal: 0x2bd9c5,
  warm: 0xfff1d6,
} as const;

export type NeonColor = keyof typeof NEON;
type Vec3 = [number, number, number];

export interface BuildingDef {
  x: number;
  z: number;
  w: number;
  d: number;
  top: number;
  trim: NeonColor;
  /** Index de variante de façade (voir FACADES dans LevelBuilder). */
  facade: number;
  roof: RoofStyle;
  /** Graine des accessoires de toit (absente = toit nu). */
  props?: number;
}

export interface WallDef {
  x: number;
  z0: number;
  z1: number;
  top: number;
  face: 1 | -1;
  ad: BillboardKind;
}

export interface BarrierDef {
  x: number;
  z: number;
  roofWidth: number;
  roofY: number;
}

export interface PadDef {
  pos: Vec3;
  power: number;
  boost: Vec3;
}

export interface HoloDef {
  lines: string[];
  pos: Vec3;
  color: NeonColor;
  width: number;
}

export interface LightDef {
  pos: Vec3;
  color: NeonColor;
  intensity: number;
  distance: number;
}

export interface SignDef {
  text: string;
  scheme: number;
  x: number;
  y: number;
  z: number;
}

export interface ThemeDef {
  fog: number;
  fogDensity: number;
  /** Intensité de la pluie (0 → 1). */
  rain: number;
  skyHorizon: number;
  skyGlow: number;
  skyWarm: number;
  /** Teinte de la lumière ambiante venue du ciel. */
  ambient: number;
  /** Couleur de la lumière rasante principale (lampadaires). */
  key: number;
  /** Éclairs d'orage périodiques. */
  storm?: boolean;
}

export interface LevelDef {
  id: string;
  name: string;
  subtitle: string;
  difficulty: 1 | 2 | 3 | 4;
  spawn: Vec3;
  spawnYaw: number;
  buildings: BuildingDef[];
  walls: WallDef[];
  barriers: BarrierDef[];
  pads: PadDef[];
  guards: [number, number, number, number][];
  drones: Vec3[];
  holos: HoloDef[];
  /** Lumières décoratives ; absentes = une par grand toit, à sa couleur. */
  lights?: LightDef[];
  /** Enseignes de façade ; absentes = générées automatiquement. */
  signs?: SignDef[];
  finish: Vec3;
  theme: ThemeDef;
}

// -----------------------------------------------------------------------------
// Aides de construction
// -----------------------------------------------------------------------------

/** Toit défini par son bord avant (z0) et arrière (z1), z0 > z1. */
function roof(x: number, z0: number, z1: number, top: number, w: number, trim: NeonColor, facade: number, roofStyle: RoofStyle, props?: number): BuildingDef {
  return { x, z: (z0 + z1) / 2, w, d: z0 - z1, top, trim, facade, roof: roofStyle, props };
}

/** Plateforme carrée 7 × 7 (enchaînements de petits toits). */
function platform(x: number, z: number, top: number, trim: NeonColor, facade: number): BuildingDef {
  return { x, z, w: 7, d: 7, top, trim, facade, roof: 'tar' };
}

/**
 * Double mur de wall-run au-dessus d'un gouffre de 32 m : mur droit puis mur
 * gauche. Le toit suivant commence à `endZ - 32`, 0,5 m plus bas.
 */
function wallPair(endZ: number, roofTop: number, adA: BillboardKind, adB: BillboardKind): WallDef[] {
  return [
    { x: 3.9, z0: endZ + 1, z1: endZ - 18, top: roofTop + 8.5, face: -1, ad: adA },
    { x: -3.9, z0: endZ - 14, z1: endZ - 32, top: roofTop + 8.5, face: 1, ad: adB },
  ];
}

/** Mur de wall-run descendant (gauche) : le toit suivant commence à `endZ - 24`, 4 m plus bas. */
function descentWall(endZ: number, roofTop: number, ad: BillboardKind): WallDef {
  return { x: -3.9, z0: endZ + 1, z1: endZ - 23, top: roofTop + 6, face: 1, ad };
}

/** Tremplin 4 m avant le bord : le toit suivant commence 10 m plus loin, 8 m plus haut. */
function padTo(endZ: number, roofTop: number, x = 0): PadDef {
  return { pos: [x, roofTop, endZ + 4], power: 22.5, boost: [0, 0, -6] };
}

// -----------------------------------------------------------------------------
// Niveaux
// -----------------------------------------------------------------------------

/** Niveau 1 : le parcours d'origine, avec les panneaux du tutoriel. */
const NEON_ROOFTOPS: LevelDef = {
  id: 'toits-de-neon',
  name: 'TOITS DE NÉON',
  subtitle: 'Le parcours d\'initiation : toutes les mécaniques',
  difficulty: 1,
  spawn: [0, 0, 6],
  spawnYaw: 0,
  buildings: [
    { x: 0, z: -9, w: 16, d: 42, top: 0, trim: 'amber', facade: 0, roof: 'tar', props: 11 },
    { x: 0, z: -55, w: 18, d: 34, top: 0.5, trim: 'pink', facade: 1, roof: 'concrete', props: 23 },
    { x: 0, z: -120, w: 18, d: 32, top: 0, trim: 'teal', facade: 2, roof: 'green', props: 37 },
    { x: 0, z: -164, w: 16, d: 36, top: 8, trim: 'red', facade: 3, roof: 'rust', props: 41 },
    { x: 0, z: -221, w: 18, d: 30, top: 4, trim: 'purple', facade: 4, roof: 'concrete', props: 53 },
    platform(0, -244, 5, 'lime', 5),
    platform(4, -255, 6, 'amber', 6),
    platform(-2, -266, 7, 'cyan', 1),
    { x: 0, z: -291, w: 20, d: 30, top: 9, trim: 'warm', facade: 7, roof: 'tar', props: 67 },
  ],
  walls: [
    { x: 3.9, z0: -71, z1: -90, top: 9, face: -1, ad: 'vertigo' },
    { x: -3.9, z0: -86, z1: -104, top: 9, face: 1, ad: 'koi' },
    { x: -3.9, z0: -181, z1: -205, top: 14, face: 1, ad: 'ramen' },
  ],
  barriers: [
    { x: 0, z: -50, roofWidth: 18, roofY: 0.5 },
    { x: 0, z: -160, roofWidth: 16, roofY: 8 },
  ],
  pads: [
    { pos: [0, 0, -132], power: 22.5, boost: [0, 0, -6] },
    { pos: [-2, 7, -266.5], power: 14.5, boost: [0.6, 0, -6] },
  ],
  guards: [
    [4.5, 0, -27, 0],
    [-4, 0.5, -63, 0],
    [5.5, 0.5, -69, -0.3],
    [-5, 0, -117, 0.2],
    [5, 0, -125, -0.2],
    [5, 8, -170, 0],
    [-4.5, 8, -176, 0.3],
    [3, 4, -216, 0],
    [-5, 4, -229, 0.4],
    [-6, 9, -284, 0],
    [6, 9, -290, 0],
    [0, 9, -297, 0],
  ],
  drones: [
    [0, 6.5, -114],
    [0, 14, -166],
    [6, 10, -193],
    [-1, 13, -201],
    [7, 12, -255],
    [0, 15.5, -290],
  ],
  holos: [
    { lines: ['ZQSD / WASD : COURIR', 'SOURIS : VISER'], pos: [0, 2.7, -3], color: 'cyan', width: 5.5 },
    { lines: ['ESPACE : SAUTER', 'ESPACE EN L\'AIR : DOUBLE SAUT'], pos: [-3.5, 2.8, -22], color: 'amber', width: 5.5 },
    { lines: ['CLIC GAUCHE : LAMES MANTIS', '1 / 2 : CHANGER D\'ARME'], pos: [4.5, 3.2, -14], color: 'magenta', width: 5 },
    { lines: ['C / CTRL : GLISSADE', 'GARDE TON ÉLAN !'], pos: [-3, 3.2, -43], color: 'orange', width: 5 },
    { lines: ['WALL-RUN ►', 'SAUTE VERS LE MUR', 'EN MAINTENANT AVANCER'], pos: [5, 3.6, -68], color: 'lime', width: 4.6 },
    { lines: ['CLIC DROIT : SANDEVISTAN', 'LE TEMPS RALENTIT'], pos: [-5, 3, -108], color: 'green', width: 5 },
    { lines: ['▲ TREMPLIN ▲'], pos: [0, 4.2, -128], color: 'green', width: 3.6 },
    { lines: ['SHIFT : DASH', 'MUR À GAUCHE ◄'], pos: [-3, 11.4, -178], color: 'yellow', width: 5 },
  ],
  lights: [
    { pos: [0, 6, -10], color: 'sodium', intensity: 22, distance: 30 },
    { pos: [0, 6, -60], color: 'pink', intensity: 22, distance: 30 },
    { pos: [0, 5, -87], color: 'lime', intensity: 16, distance: 28 },
    { pos: [0, 6, -124], color: 'teal', intensity: 22, distance: 30 },
    { pos: [0, 14, -165], color: 'sodium', intensity: 22, distance: 30 },
    { pos: [2, 10, -195], color: 'pink', intensity: 19, distance: 30 },
    { pos: [0, 10, -222], color: 'purple', intensity: 22, distance: 30 },
    { pos: [0, 15, -292], color: 'yellow', intensity: 25, distance: 32 },
  ],
  signs: [
    { text: 'HOTEL', scheme: 3, x: 5, y: -5, z: -38 },
    { text: 'RAMEN', scheme: 2, x: -6, y: -7, z: -38 },
    { text: '24H', scheme: 7, x: 6, y: -6, z: -104 },
    { text: 'KARAOKE', scheme: 4, x: -5, y: -9, z: -104 },
    { text: 'CLUB', scheme: 0, x: 5, y: 2, z: -146 },
    { text: 'BAR', scheme: 1, x: -5, y: 1, z: -146 },
    { text: 'CAFE', scheme: 5, x: 6, y: -3, z: -206 },
    { text: 'NOODLES', scheme: 8, x: -5, y: -2, z: -206 },
    { text: 'KALLIOPE', scheme: 6, x: -5, y: 4, z: -276 },
    { text: 'LIVE', scheme: 0, x: 7, y: 3, z: -276 },
  ],
  finish: [0, 9, -301],
  theme: { fog: 0x1a0f20, fogDensity: 0.0068, rain: 1, skyHorizon: 0x3a1838, skyGlow: 0xff3a8a, skyWarm: 0xff7a30, ambient: 0x4a3a7a, key: 0xff8a3c },
};

/** Niveau 2 : toits bas et marché de nuit, deux doubles wall-runs, glissades. */
const NIGHT_MARKET: LevelDef = {
  id: 'marche-de-nuit',
  name: 'MARCHÉ DE NUIT',
  subtitle: 'Enchaîne les murs sans jamais ralentir',
  difficulty: 2,
  spawn: [0, 0, 6],
  spawnYaw: 0,
  buildings: [
    roof(0, 10, -26, 0, 16, 'amber', 6, 'tar', 101),
    roof(0, -34, -66, 0, 18, 'pink', 1, 'concrete', 102),
    roof(0, -98, -126, -0.5, 18, 'teal', 4, 'green', 103),
    roof(0, -135, -165, -0.5, 16, 'red', 3, 'rust', 104),
    roof(0, -197, -225, -1, 18, 'lime', 5, 'concrete', 105),
    roof(0, -249, -281, -5, 20, 'warm', 0, 'tar', 106),
  ],
  walls: [...wallPair(-66, 0, 'ramen', 'cat'), ...wallPair(-165, -0.5, 'koi', 'arcade'), descentWall(-225, -1, 'cola')],
  barriers: [
    { x: 0, z: -46, roofWidth: 18, roofY: 0 },
    { x: 0, z: -147, roofWidth: 16, roofY: -0.5 },
  ],
  pads: [],
  guards: [
    [4, 0, -22, 0],
    [-5, 0, -58, 0.2],
    [5, 0, -62, -0.2],
    [-4, -0.5, -110, 0.2],
    [5, -0.5, -118, -0.3],
    [4, -0.5, -158, 0],
    [-5, -0.5, -161, 0.3],
    [-4, -1, -207, 0.2],
    [5, -1, -217, -0.2],
    [-6, -5, -260, 0.3],
    [6, -5, -266, -0.3],
    [0, -5, -272, 0],
  ],
  drones: [
    [0, 6, -52],
    [3, 6, -122],
    [-2, 7, -150],
    [0, 5, -212],
    [4, 1, -268],
  ],
  holos: [
    { lines: ['NIVEAU 2 : MARCHÉ DE NUIT', 'GARDE TA VITESSE'], pos: [0, 2.8, -4], color: 'amber', width: 5.5 },
    { lines: ['DEUX MURS, PUIS DEUX AUTRES', 'NE LÂCHE PAS L\'AVANCE'], pos: [-4, 2.8, -126 + 4], color: 'lime', width: 5 },
  ],
  finish: [0, -5, -276],
  theme: { fog: 0x24120a, fogDensity: 0.0072, rain: 0.55, skyHorizon: 0x4a2418, skyGlow: 0xff8a3c, skyWarm: 0xffa040, ambient: 0x6a4434, key: 0xffa040 },
};

/** Niveau 3 : tours de verre, tremplins pour monter, vide à franchir au dash. */
const GLASS_TOWERS: LevelDef = {
  id: 'tours-de-verre',
  name: 'TOURS DE VERRE',
  subtitle: 'Monte, saute, dashe au-dessus du vide',
  difficulty: 3,
  spawn: [0, 0, 6],
  spawnYaw: 0,
  buildings: [
    roof(0, 10, -24, 0, 16, 'cyan', 7, 'tar', 201),
    roof(0, -34, -64, 8, 16, 'teal', 7, 'concrete', 202),
    roof(0, -74, -102, 16, 16, 'purple', 2, 'tar', 203),
    roof(0, -114, -140, 15, 16, 'cyan', 7, 'green', 204),
    platform(3, -147, 13, 'lime', 5),
    platform(-3, -158, 11, 'amber', 4),
    platform(2, -169, 9, 'pink', 1),
    roof(0, -180, -212, 9, 18, 'yellow', 7, 'tar', 205),
    roof(0, -222, -252, 17, 20, 'warm', 7, 'concrete', 206),
  ],
  walls: [],
  barriers: [],
  pads: [padTo(-24, 0), padTo(-64, 8), padTo(-212, 9)],
  guards: [
    [4, 0, -16, 0],
    [-4, 8, -50, 0.2],
    [5, 16, -86, 0],
    [-5, 16, -94, 0.3],
    [4, 15, -134, -0.2],
    [-5, 9, -190, 0.2],
    [5, 9, -200, -0.2],
    [-6, 17, -232, 0.3],
    [6, 17, -238, -0.3],
    [0, 17, -244, 0],
  ],
  drones: [
    [4, 14, -44],
    [-4, 15, -56],
    [0, 21, -128],
    [-4, 15, -164],
    [4, 14, -196],
    [0, 23, -238],
  ],
  holos: [
    { lines: ['NIVEAU 3 : TOURS DE VERRE', 'MONTE TOUJOURS PLUS HAUT'], pos: [0, 2.8, -4], color: 'cyan', width: 5.5 },
    { lines: ['SAUTE, DOUBLE SAUT', 'PUIS DASH AU-DESSUS DU VIDE'], pos: [0, 19.5, -96], color: 'yellow', width: 5.5 },
  ],
  finish: [0, 17, -246],
  theme: { fog: 0x081620, fogDensity: 0.0085, rain: 0.8, skyHorizon: 0x123040, skyGlow: 0x2bd9c5, skyWarm: 0x3a8aff, ambient: 0x2c4c80, key: 0x5ac8ff },
};

/** Niveau 4 : descente vertigineuse sous l'orage, puis arène finale. */
const THE_FALL: LevelDef = {
  id: 'la-chute',
  name: 'LA CHUTE',
  subtitle: 'Descente sous l\'orage et arène finale',
  difficulty: 4,
  spawn: [0, 30, 6],
  spawnYaw: 0,
  buildings: [
    roof(0, 10, -22, 30, 16, 'red', 3, 'rust', 301),
    roof(0, -34, -62, 25, 16, 'pink', 6, 'tar', 302),
    roof(0, -86, -114, 21, 18, 'purple', 4, 'concrete', 303),
    roof(0, -128, -158, 15, 16, 'amber', 0, 'tar', 304),
    roof(0, -190, -236, 14.5, 24, 'red', 2, 'tar', 305),
  ],
  walls: [descentWall(-62, 25, 'vertigo'), ...wallPair(-158, 15, 'arcade', 'pharmacy')],
  barriers: [{ x: 0, z: -46, roofWidth: 16, roofY: 25 }],
  pads: [],
  guards: [
    [4, 30, -18, 0],
    [-4, 25, -56, 0.2],
    [5, 25, -58, -0.2],
    [-5, 21, -104, 0.2],
    [4, 15, -146, 0],
    [-4, 15, -152, 0.3],
    [-8, 14.5, -206, 0.4],
    [8, 14.5, -210, -0.4],
    [-4, 14.5, -218, 0.2],
    [4, 14.5, -222, -0.2],
    [-8, 14.5, -226, 0.3],
    [8, 14.5, -228, -0.3],
  ],
  drones: [
    [0, 27, -96],
    [4, 26, -108],
    [0, 21, -140],
    [-6, 21, -214],
    [6, 21, -220],
    [0, 22, -228],
  ],
  holos: [
    { lines: ['NIVEAU 4 : LA CHUTE', 'NE REGARDE PAS EN BAS'], pos: [0, 32.8, -4], color: 'red', width: 5.5 },
    { lines: ['ATTAQUE CHARGÉE :', 'MAINTIENS, RELÂCHE, FONCE'], pos: [-4, 18, -134], color: 'magenta', width: 5.5 },
  ],
  finish: [0, 14.5, -232],
  theme: { fog: 0x1e0612, fogDensity: 0.0075, rain: 1, skyHorizon: 0x4a0f24, skyGlow: 0xff2040, skyWarm: 0xff5a3c, ambient: 0x4a2a5a, key: 0xff4a3c, storm: true },
};

export const LEVELS: readonly LevelDef[] = [NEON_ROOFTOPS, NIGHT_MARKET, GLASS_TOWERS, THE_FALL];
