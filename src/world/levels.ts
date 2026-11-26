import type { BillboardKind, RoofStyle } from './PixelTextures';
import type { PowerUpDef } from './PowerUps';

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
/** Ancre de grappin : [x, y, z, élan horizontal conservé à l'arrivée (m/s, 17 par défaut)]. */
export type AnchorDef = [number, number, number, number?];

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
  /** Toit secondaire hors du parcours (secrets) : ignoré par l'enchaînement. */
  side?: boolean;
}

export type SecretKind = 'vinyl' | 'tag' | 'beacon24' | 'payphone' | 'garden' | 'crane' | 'watertower' | 'radio';

/** Easter egg caché dans un niveau : trouvé en s'approchant ou en tirant dessus. */
export interface SecretDef {
  id: string;
  kind: SecretKind;
  /** Pied de l'objet. */
  pos: Vec3;
  /** Orientation (radians) : direction de la face principale. */
  yaw?: number;
  /** Rayon de découverte par proximité (m) ; 0 = seulement en tirant dessus. */
  radius: number;
  /** Peut être découvert d'un tir de pistolet. */
  shootable?: boolean;
  /** Centre de la zone de touche, relatif à `pos`. */
  hit?: Vec3;
  name: string;
  text: string;
  /** Indice vendu par l'Indic à la Plaza. */
  hint: string;
  /** Point d'appel sur le toit principal (x, z) gardé libre d'accessoires. */
  approach?: [number, number];
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
  /** Gardes à bouclier [x, y, z, lacet] : à contourner ou à briser (attaque chargée, séisme, fouet…). */
  shields?: [number, number, number, number][];
  /** Tireurs d'élite [x, y, z, lacet], souvent sur des toits voisins. */
  snipers?: [number, number, number, number][];
  /** Drones kamikazes. */
  kamikazes?: Vec3[];
  holos: HoloDef[];
  /** Lumières décoratives ; absentes = une par grand toit, à sa couleur. */
  lights?: LightDef[];
  /** Enseignes de façade ; absentes = générées automatiquement. */
  signs?: SignDef[];
  finish: Vec3;
  theme: ThemeDef;
  /** Easter eggs du niveau. */
  secrets?: SecretDef[];
  /** Bonus ramassables. */
  powerups?: PowerUpDef[];
  /** Ancres magnétiques du grappin (points flottants). */
  anchors?: AnchorDef[];
  /** Niveau verrouillé tant que le grappin n'est pas débloqué (fin de La Purge). */
  requiresGrapple?: boolean;
  /** Grands repères (mât d'antenne…) : pied du mât et hauteur. */
  landmarks?: { kind: 'antenna'; pos: Vec3; height: number }[];
  /** Temps des médailles or / argent / bronze (s). */
  par: [number, number, number];
  /** Thème musical (voir core/Music.ts). */
  music: string;
  /** Combat de boss : arène et position de la Sentinelle (la balise n'apparaît qu'après sa chute). */
  boss?: { center: Vec3; floor: number; radius: number };
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
  par: [34, 45, 60],
  music: 'toits-de-neon',
  powerups: [
    ['overdrive', 0, 0, -22],
    ['shield', -3, 0, -112],
    ['surge', 3, 8, -172],
    ['chrono', 4, 6, -255],
  ],
  name: 'TOITS DE NÉON',
  anchors: [
    [0, 8.5, -97],
    [0, 16.5, -139],
    [0, 12.5, -199],
    [0, 17.5, -269],
  ],
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
    { x: 14.5, z: -20, w: 7, d: 8, top: 1.5, trim: 'amber', facade: 6, roof: 'tar', side: true },
  ],
  secrets: [
    {
      id: 'vinyl',
      approach: [7.2, -20],
      kind: 'vinyl',
      pos: [14, 1.5, -21],
      yaw: -Math.PI / 2,
      radius: 2.6,
      name: 'LA PLATINE',
      text: 'Un vieux vinyle tourne encore, lueur chaude sous la pluie. Sacha disait que la musique tient chaud quand la ville est froide.',
      hint: 'Juste après le départ, un petit toit se cache sur la droite. Saute de côté.',
    },
    {
      id: 'tag',
      approach: [-6.5, -168],
      kind: 'tag',
      pos: [-5.5, 8, -170],
      yaw: -Math.PI / 2,
      radius: 2.4,
      hit: [-1.4, 1.4, 0],
      name: 'TAG DE RUNNER',
      text: 'Une flèche vers le ciel et une signature : S. « Toujours en haut. » La devise que Sacha peignait sur chaque toit conquis.',
      hint: 'Sur le toit rouge après le tremplin, fais le tour du bloc technique, côté vide.',
    },
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
  par: [32, 42, 56],
  music: 'marche-de-nuit',
  powerups: [
    ['overdrive', 0, 0, -18],
    ['chrono', -17, -2.5, -48],
    ['shield', 0, -0.5, -110],
    ['surge', 0, -1, -210],
  ],
  name: 'MARCHÉ DE NUIT',
  anchors: [
    [0, 8, -91],
    [0, 7.5, -190],
    [0, 3.5, -242],
  ],
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
    { x: -19, z: -112, w: 6, d: 6, top: 9, trim: 'yellow', facade: 2, roof: 'concrete', side: true },
    { x: -15.5, z: -52, w: 11, d: 14, top: -2.5, trim: 'teal', facade: 3, roof: 'tar', side: true },
  ],
  secrets: [
    {
      id: 'beacon24',
      kind: 'beacon24',
      pos: [-19, 9, -112],
      radius: 0,
      shootable: true,
      hit: [0, 2.6, 0],
      name: 'BALISE 24',
      text: 'Une balise bonus marquée 24 s\'allume sous ton tir. 24, comme les étages de votre ancien immeuble.',
      hint: 'Au-dessus du marché, une tour isolée clignote sur la gauche. Vise-la au pistolet.',
    },
    {
      id: 'payphone',
      approach: [-8.2, -52],
      kind: 'payphone',
      pos: [-17, -2.5, -56],
      yaw: Math.PI / 2,
      radius: 2.4,
      name: 'CABINE FANTÔME',
      text: 'Le téléphone sonne. Tu décroches. Une voix enregistrée : « Toujours en hauteur. Jamais dans la rue. » Puis plus rien.',
      hint: 'Sur le deuxième toit, un toit plus bas se cache à gauche. Laisse-toi tomber, puis remonte.',
    },
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
  shields: [[-3, -0.5, -157, 0]],
  kamikazes: [[0, 4, -131]],
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
  par: [30, 40, 54],
  music: 'tours-de-verre',
  powerups: [
    ['shield', 0, 8, -50],
    ['overdrive', 0, 16, -96],
    ['chrono', 14.5, 18, -87],
    ['surge', 0, 9, -195],
  ],
  name: 'TOURS DE VERRE',
  anchors: [
    [0, 16.5, -27],
    [0, 24.5, -67],
    [0, 23.5, -107],
    [0, 25.5, -215],
  ],
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
    { x: 14.5, z: -90, w: 7, d: 10, top: 18, trim: 'green', facade: 5, roof: 'green', side: true },
  ],
  secrets: [
    {
      id: 'garden',
      approach: [7.2, -90],
      kind: 'garden',
      pos: [14.5, 18, -90],
      radius: 3.4,
      name: 'JARDIN SUSPENDU',
      text: 'Un bonsaï, un filet d\'eau, des lucioles. Ici, la pluie fait un bruit doux. Loin d\'Aegis, l\'espace d\'un souffle.',
      hint: 'Sur la plus haute tour, regarde à droite : un îlot vert flotte un peu plus haut.',
    },
    {
      id: 'crane',
      kind: 'crane',
      pos: [-7, 9, -203],
      radius: 1.8,
      shootable: true,
      hit: [0, 7.4, 0],
      name: 'GRUE DE PAPIER',
      text: 'Une grue en origami descend en planant, pliée dans un rapport d\'Aegis. Sacha en pliait une à chaque nuit blanche.',
      hint: 'Avant le dernier tremplin, une antenne à gauche porte un petit oiseau blanc. Tire dessus.',
    },
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
  snipers: [[6, 9, -209, 0]],
  kamikazes: [[0, 15, -160]],
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
  par: [30, 40, 54],
  music: 'la-chute',
  powerups: [
    ['overdrive', 0, 30, -12],
    ['shield', 0, 25, -40],
    ['chrono', 0, 15, -142],
    ['surge', 0, 14.5, -196],
  ],
  name: 'LA CHUTE',
  anchors: [
    [0, 29.5, -79],
    [0, 23.5, -121],
    [0, 23, -183],
  ],
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
    { x: -14, z: -8, w: 7, d: 8, top: 28, trim: 'purple', facade: 4, roof: 'rust', side: true },
  ],
  secrets: [
    {
      id: 'watertower',
      approach: [-7.2, -8],
      kind: 'watertower',
      pos: [-14, 28, -8],
      yaw: Math.PI / 2,
      radius: 3.6,
      hit: [0, 2.4, 0],
      name: 'LE CHÂTEAU D\'EAU',
      text: 'Un prénom gravé dans le métal, SACHA, suivi de « et toi ». Et une longue rangée de traits : les drones que vous comptiez ensemble, la nuit.',
      hint: 'Dès le départ de La Chute, regarde à gauche : un château d\'eau sur un toit plus bas.',
    },
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
  shields: [[0, 14.5, -200, 0]],
  snipers: [[-6, 21, -112, 0]],
  kamikazes: [[0, 25, -122], [-6, 19, -200]],
  holos: [
    { lines: ['NIVEAU 4 : LA CHUTE', 'NE REGARDE PAS EN BAS'], pos: [0, 32.8, -4], color: 'red', width: 5.5 },
    { lines: ['ATTAQUE CHARGÉE :', 'MAINTIENS, RELÂCHE, FONCE'], pos: [-4, 18, -134], color: 'magenta', width: 5.5 },
  ],
  finish: [0, 14.5, -232],
  theme: { fog: 0x1e0612, fogDensity: 0.0075, rain: 1, skyHorizon: 0x4a0f24, skyGlow: 0xff2040, skyWarm: 0xff5a3c, ambient: 0x4a2a5a, key: 0xff4a3c, storm: true },
};

/** Niveau 5 : la Purge. Courte approche puis arène au sommet de la tour d'Aegis et combat contre la Sentinelle. */
const THE_PURGE: LevelDef = {
  id: 'la-purge',
  name: 'LA PURGE',
  anchors: [
    [0, 36.5, -61],
    [0, 36, -117],
    // Ancres de l'arène, au-dessus des piliers : esquiver le laser, puis retomber sur place
    [-9, 37.5, -136, 2],
    [9, 37.5, -136, 2],
    [-9, 37.5, -160, 2],
    [9, 37.5, -160, 2],
  ],
  subtitle: 'Abats la Sentinelle d\'Aegis',
  difficulty: 4,
  par: [75, 100, 140],
  music: 'la-purge',
  spawn: [0, 20, 6],
  spawnYaw: 0,
  buildings: [
    roof(0, 10, -22, 20, 16, 'red', 3, 'rust', 401),
    roof(0, -30, -58, 20, 16, 'purple', 4, 'tar', 402),
    roof(0, -68, -92, 28, 16, 'cyan', 7, 'concrete', 403),
    roof(0, -124, -172, 27.5, 40, 'red', 7, 'tar'),
    // Piliers de l'arène (couverture contre les tirs)
    { x: -9, z: -136, w: 2, d: 2, top: 31.5, trim: 'red', facade: 7, roof: 'tar', side: true },
    { x: 9, z: -136, w: 2, d: 2, top: 31.5, trim: 'red', facade: 7, roof: 'tar', side: true },
    { x: -9, z: -160, w: 2, d: 2, top: 31.5, trim: 'red', facade: 7, roof: 'tar', side: true },
    { x: 9, z: -160, w: 2, d: 2, top: 31.5, trim: 'red', facade: 7, roof: 'tar', side: true },
  ],
  walls: wallPair(-92, 28, 'vertigo', 'kalliope'),
  barriers: [{ x: 0, z: -40, roofWidth: 16, roofY: 20 }],
  pads: [
    padTo(-58, 20),
    // Tremplins de l'arène : propulsent vers la Sentinelle
    { pos: [-14, 27.5, -148], power: 17, boost: [7, 0, 0] },
    { pos: [14, 27.5, -148], power: 17, boost: [-7, 0, 0] },
  ],
  guards: [
    [4, 20, -16, 0],
    [-5, 20, -48, 0.2],
    [5, 20, -52, -0.2],
    [-4, 28, -80, 0.2],
    [4, 28, -86, -0.2],
  ],
  drones: [
    [0, 26, -44],
    [-8, 33, -140],
    [8, 33, -156],
  ],
  shields: [[3, 28, -76, 0]],
  holos: [
    { lines: ['NIVEAU 5 : LA PURGE', 'LA SENTINELLE T\'ATTEND'], pos: [0, 22.8, -4], color: 'red', width: 5.5 },
    { lines: ['RENVOIE SES TIRS', 'FRAPPE SES CŒURS QUAND ELLE DESCEND'], pos: [0, 31, -118], color: 'yellow', width: 6 },
  ],
  lights: [
    { pos: [0, 26, -10], color: 'red', intensity: 22, distance: 30 },
    { pos: [0, 34, -80], color: 'cyan', intensity: 22, distance: 30 },
    { pos: [-12, 33, -148], color: 'purple', intensity: 26, distance: 32 },
    { pos: [12, 33, -148], color: 'red', intensity: 26, distance: 32 },
  ],
  finish: [0, 27.5, -148],
  boss: { center: [0, 27.5, -148], floor: 27.5, radius: 18 },
  powerups: [
    ['overdrive', 0, 20, -12],
    ['shield', -15, 27.5, -130, 20],
    ['surge', 15, 27.5, -130, 25],
    ['chrono', -15, 27.5, -166, 25],
    ['shield', 15, 27.5, -166, 20],
  ],
  theme: { fog: 0x200814, fogDensity: 0.0078, rain: 0.8, skyHorizon: 0x4a0a2a, skyGlow: 0xff3b6a, skyWarm: 0xff6a3c, ambient: 0x5a2050, key: 0xff3b3b, storm: true },
};


/**
 * Niveau 6 : l'Antenne. Des toits isolés au-dessus du vide, reliés seulement
 * par les ancres du grappin, jusqu'au mât d'où part un signal en direct.
 */
const THE_ANTENNA: LevelDef = {
  id: 'l-antenne',
  requiresGrapple: true,
  name: 'L\'ANTENNE',
  subtitle: 'Grappin au-dessus du vide, jusqu\'au signal',
  difficulty: 4,
  par: [32, 44, 60],
  music: 'l-antenne',
  spawn: [0, 40, 6],
  spawnYaw: 0,
  buildings: [
    roof(0, 10, -24, 40, 16, 'cyan', 7, 'tar', 501),
    roof(0, -52, -80, 40, 16, 'purple', 4, 'concrete', 502),
    roof(0, -112, -140, 46, 14, 'teal', 2, 'green', 503),
    { x: 0, z: -169, w: 12, d: 14, top: 44, trim: 'lime', facade: 5, roof: 'tar' },
    roof(0, -196, -214, 48, 12, 'pink', 1, 'tar', 504),
    roof(0, -270, -306, 52, 22, 'warm', 7, 'concrete', 505),
    // Perchoirs des tireurs d'élite
    { x: 28, z: -120, w: 12, d: 12, top: 52, trim: 'yellow', facade: 6, roof: 'tar', side: true },
    { x: -27, z: -232, w: 12, d: 12, top: 58, trim: 'red', facade: 3, roof: 'rust', side: true },
    // Socle du mât
    { x: 19, z: -296, w: 10, d: 10, top: 52, trim: 'red', facade: 7, roof: 'concrete', side: true },
  ],
  anchors: [
    [0, 48.5, -45],
    [0, 54.5, -105],
    [0, 52.5, -157, 8],
    [0, 56.5, -189],
    // Chaîne au-dessus du grand vide : on regrappine en plein vol
    [0, 58, -232],
    [0, 60, -258],
    // Ancres latérales : mènent aux perchoirs des tireurs d'élite (freinées à l'arrivée)
    [24, 60, -120, 2],
    [-23, 66, -230, 2],
  ],
  landmarks: [{ kind: 'antenna', pos: [19, 52, -296], height: 38 }],
  secrets: [
    {
      id: 'radio',
      kind: 'radio',
      pos: [16, 52, -292.5],
      yaw: -Math.PI / 2,
      radius: 3,
      hit: [0, 0.9, 0],
      name: 'LA RADIO DE SACHA',
      text: 'Une radio de poche scotchée au pied du mât, réglée sur une fréquence morte. Sur le ruban adhésif, au feutre : « pour quand tu monteras ici ». Le voyant clignote trois fois, puis s\'arrête.',
      hint: 'Tout en haut, au pied du mât, quelque chose capte encore. Saute sur son socle.',
      approach: [8, -292],
    },
  ],
  walls: [],
  barriers: [{ x: 0, z: -282, roofWidth: 22, roofY: 52 }],
  pads: [],
  guards: [
    [4, 40, -16, 0],
    [-5, 40, -72, 0.2],
    [4, 46, -124, -0.2],
    [5, 48, -210, 0],
    [0, 52, -298, 0],
    [-7, 52, -292, 0.3],
  ],
  shields: [
    [0, 40, -66, 0],
    [-3, 46, -132, 0.2],
    [0, 48, -206, 0],
    [-5, 52, -290, 0],
    [5, 52, -290, 0],
  ],
  snipers: [
    [30, 52, -121, -0.9],
    [-29, 58, -234, 0.7],
  ],
  drones: [
    [3, 45, -60],
    [6, 60, -246],
    [0, 57, -284],
  ],
  kamikazes: [
    [6, 48, -92],
    [4, 49, -176],
    [-3, 56, -276],
  ],
  holos: [
    { lines: ['NIVEAU 6 : L\'ANTENNE', 'LE VIDE N\'EST QU\'UN DÉTOUR'], pos: [0, 42.8, -4], color: 'cyan', width: 5.5 },
    { lines: ['◆ VISE L\'ANCRE', 'F : GRAPPIN'], pos: [-4, 43, -20], color: 'green', width: 4.6 },
    { lines: ['ENCHAÎNE LES ANCRES', 'REGRAPPINE EN PLEIN VOL'], pos: [4, 51, -210], color: 'yellow', width: 5.2 },
  ],
  lights: [
    { pos: [0, 46, -10], color: 'teal', intensity: 22, distance: 30 },
    { pos: [0, 46, -66], color: 'purple', intensity: 22, distance: 30 },
    { pos: [0, 52, -126], color: 'teal', intensity: 22, distance: 30 },
    { pos: [0, 50, -169], color: 'lime', intensity: 18, distance: 26 },
    { pos: [0, 54, -205], color: 'pink', intensity: 22, distance: 30 },
    { pos: [0, 58, -288], color: 'sodium', intensity: 26, distance: 34 },
  ],
  powerups: [
    ['overdrive', 0, 40, -10],
    ['shield', 0, 40, -58],
    ['surge', 0, 46, -118],
    ['chrono', 0, 48, -200],
  ],
  finish: [0, 52, -300],
  theme: { fog: 0x0c0a24, fogDensity: 0.006, rain: 0.6, skyHorizon: 0x1a1450, skyGlow: 0x7a5cff, skyWarm: 0x2bd9ff, ambient: 0x3a3a8a, key: 0x8a7aff },
};

export const LEVELS: readonly LevelDef[] = [NEON_ROOFTOPS, NIGHT_MARKET, GLASS_TOWERS, THE_FALL, THE_PURGE, THE_ANTENNA];
