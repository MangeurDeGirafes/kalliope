/**
 * Toutes les constantes de gameplay et de rendu.
 * Les unités sont en mètres, secondes et radians.
 */

export const PLAYER = {
  radius: 0.35,
  /** Demi-hauteur du segment de la capsule debout (hauteur totale = 2 * (halfHeight + radius)). */
  standHalfHeight: 0.55,
  /** Demi-hauteur pendant la glissade (hauteur totale ≈ 1.0 m). */
  slideHalfHeight: 0.15,
  eyeHeightStand: 1.62,
  eyeHeightSlide: 0.82,
  eyeHeightLerp: 14,
  maxHealth: 3,
  healthRegenDelay: 4.5,
  healthRegenInterval: 1.5,
  /** Invulnérabilité après un impact. */
  hurtInvulnerability: 0.6,
  controllerOffset: 0.02,
  autostepHeight: 0.45,
  autostepMinWidth: 0.2,
  snapToGround: 0.35,
  maxSlopeDeg: 50,
} as const;

export const MOVEMENT = {
  runSpeed: 11,
  groundAccel: 14,
  groundFriction: 11,
  airSpeed: 11,
  airAccel: 3.2,
  airDrag: 0.05,
  gravity: 26,
  maxFallSpeed: 55,
  jumpVelocity: 8.8,
  doubleJumpVelocity: 8.4,
  maxAirJumps: 1,
  coyoteTime: 0.12,
  jumpBufferTime: 0.14,
  footstepDistance: 2.4,
  /** Entrée « avancer » minimale (0..1) pour déclencher wall-run et franchissement. */
  forwardInputThreshold: 0.25,
} as const;

export const SLIDE = {
  minSpeed: 5,
  boost: 5,
  maxSpeed: 21,
  friction: 0.9,
  duration: 0.95,
  endFriction: 5,
  endSpeed: 3.5,
  crouchSpeed: 4,
  steerRate: 1.6,
  cooldown: 0.2,
} as const;

export const WALLRUN = {
  minSpeed: 5.5,
  speed: 13,
  acceleration: 18,
  maxDuration: 1.7,
  gravityStart: 1.2,
  gravityEnd: 16,
  detectDistance: 0.75,
  minHeightAboveGround: 0.9,
  cameraTilt: 0.27,
  tiltSpeed: 9,
  jumpUp: 8.2,
  jumpSide: 7.5,
  jumpLookBoost: 3,
  sameWallCooldown: 0.7,
  stickVelocity: 2,
  maxVerticalOnStart: 4,
} as const;

export const LEDGE = {
  maxHeight: 2.1,
  minHeight: 0.35,
  probeDistance: 0.6,
  cooldown: 0.45,
} as const;

export const DASH = {
  speed: 30,
  duration: 0.17,
  exitSpeed: 15,
  maxCharges: 2,
  rechargeTime: 1.4,
  /** false : le dash fonctionne aussi au sol. */
  airOnly: false,
  fovKick: 14,
} as const;

export const SANDEVISTAN = {
  /** Échelle de temps du monde (ennemis, projectiles, particules, pluie). */
  worldTimeScale: 0.18,
  /** Échelle de temps appliquée au joueur pendant le Sandevistan. */
  playerTimeScale: 0.85,
  /** Fraction de jauge consommée par seconde réelle. */
  drainPerSecond: 0.2,
  rechargePerSecond: 0.07,
  minToActivate: 0.15,
  transitionSpeed: 7,
  killRefill: 0.12,
} as const;

export const CAMERA = {
  fov: 84,
  speedFovBoost: 12,
  sensitivity: 0.0022,
  pitchLimit: 1.53,
  headBobAmount: 0.04,
  headBobFrequency: 1.35,
  landingDipMax: 0.32,
  strafeLean: 0.025,
  near: 0.03,
  far: 1600,
} as const;

export const BLADES = {
  range: 3.4,
  coneAngleDeg: 55,
  slashDuration: 0.3,
  /** Fraction de l'animation pendant laquelle la lame touche. */
  activeStart: 0.14,
  activeEnd: 0.62,
  /** Délai minimal entre deux coups (s). */
  cooldown: 0.22,
  forwardPush: 5,
  lungeRange: 7.5,
  lungeConeDeg: 22,
  lungeSpeed: 17,
  deflectRange: 3.6,
  trailLife: 0.16,
} as const;

/** Attaque chargée des lames : maintenir l'attaque puis relâcher. */
export const CHARGED = {
  /** Durée de maintien pour charger complètement (s, temps réel). */
  holdTime: 0.3,
  /** La jauge apparaît après ce délai : un simple clic reste un coup normal. */
  showAfter: 0.1,
  /** Portée de recherche de l'ennemi le plus proche (m). */
  range: 32,
  /** Vitesse du dash chargé (m/s). */
  speed: 42,
  maxDuration: 1.1,
  /** Distance à laquelle la cible est tranchée. */
  arriveDistance: 2.2,
  /** Sans cible à portée : dash vers l'avant sur cette distance (m). */
  noTargetDistance: 12,
  /** Rayon de la frappe circulaire à l'arrivée. */
  sweepRange: 4.5,
  hitstop: 0.14,
  /** Délai avant de pouvoir recharger une attaque chargée (s, temps réel). */
  cooldown: 3,
} as const;

/** Tir chargé du pistolet : maintenir puis relâcher = décharge de chevrotine. */
export const SHOTGUN = {
  holdTime: 0.5,
  showAfter: 0.15,
  /** Temps de recharge après une décharge (s, temps réel). */
  cooldown: 1.4,
  /** Écart angulaire entre deux projectiles (degrés). */
  spreadDeg: 4.5,
  range: 60,
  aimAssist: 0.55,
  recoil: 0.11,
} as const;

/** Bras gorille : coups de poing (renvoient les tirs), séisme au sol ou frappe météore. */
export const GORILLA = {
  range: 2.9,
  coneDeg: 50,
  cooldown: 0.3,
  punchDuration: 0.28,
  activeStart: 0.3,
  activeEnd: 0.6,
  pushForward: 5,
  chargeHold: 0.5,
  chargeShowAfter: 0.12,
  /** Rayon du séisme au sol (m) et vitesse du super-saut qu'il déclenche. */
  slamRadius: 7,
  slamLaunch: 11.5,
  /** Frappe météore (relâchée en l'air) : piqué puis onde plus large à l'impact. */
  diveSpeed: 38,
  meteorRadius: 9,
  chargeCooldown: 3.5,
} as const;

/** Monowire : fouet monofilament, portée supérieure aux lames, deux touches pour tuer. */
export const MONOWIRE = {
  range: 10,
  coneDeg: 30,
  /** Intervalle entre deux coups de fouet (s). */
  interval: 0.5,
  duration: 0.44,
  activeStart: 0.4,
  activeEnd: 0.62,
  damage: 1,
  /** Attaque chargée : maintenir puis relâcher = double balayage circulaire autour du joueur. */
  chargeHold: 0.45,
  chargeShowAfter: 0.12,
  /** Rayon de la zone balayée (m). */
  chargeRadius: 12,
  /** Durée totale des deux balayages (s). */
  chargeDuration: 0.85,
  /** Recharge de l'attaque chargée (s, temps réel). */
  chargeCooldown: 4,
} as const;

export const PISTOL = {
  fireInterval: 0.15,
  range: 220,
  recoilPitch: 0.03,
  recoilRecovery: 10,
  beamDuration: 0.1,
  aimAssistRadius: 0.35,
} as const;

export const ENEMIES = {
  guard: {
    detectionRange: 46,
    aimDuration: 1.15,
    cooldown: 2.1,
    projectileSpeed: 30,
    turnSpeed: 4,
  },
  drone: {
    detectionRange: 55,
    aimDuration: 0.85,
    cooldown: 1.7,
    projectileSpeed: 25,
    orbitRadius: 2.2,
    orbitSpeed: 0.7,
    hoverAmplitude: 0.35,
  },
  /** Garde à bouclier : bloque les coups simples portés de face (±blockDeg). */
  shield: {
    detectionRange: 40,
    aimDuration: 1.3,
    cooldown: 2.6,
    projectileSpeed: 28,
    turnSpeed: 2.6,
    blockDeg: 70,
  },
  /** Tireur d'élite : long télégraphe, tir rapide et lourd (renvoyable). */
  sniper: {
    detectionRange: 95,
    aimDuration: 2.3,
    cooldown: 3.4,
    projectileSpeed: 68,
    turnSpeed: 2.2,
    damage: 2,
  },
  /** Drone kamikaze : s'arme, fonce sur le joueur et explose. */
  kamikaze: {
    detectionRange: 34,
    armTime: 0.6,
    speed: 19,
    accel: 26,
    turnRate: 3.4,
    fuse: 5,
    triggerRadius: 1.9,
    blastRadius: 4.2,
    damage: 1,
  },
  aimLagRate: 5,
  aimLockTime: 0.22,
  losCheckInterval: 0.15,
  loseTargetTime: 0.6,
  projectileRadius: 0.18,
  projectileLifetime: 4,
  projectileDamage: 1,
  /** Points de vie (lames, pistolet et projectiles renvoyés en retirent 2, le monowire 1). */
  health: 2,
  activeDistance: 140,
} as const;

export const COMBAT = {
  hitstopDuration: 0.08,
  hitstopTimeScale: 0.03,
  killShake: 0.35,
  hurtShake: 0.55,
} as const;

export const WORLD = {
  killPlaneY: -28,
  rainAreaSize: 52,
  rainAreaHeight: 34,
  rainSpeed: 27,
  rainWind: 3.5,
  rainLength: 0.7,
  fogColor: 0x1a0f20,
  fogDensity: 0.0068,
} as const;

/**
 * Intensité des lumières, néons et halos. Les multiplicateurs valent 1 pour
 * l'intensité d'origine : baisse-les pour adoucir l'image, monte-les pour l'inverse.
 */
export const LIGHTING = {
  /** Halo lumineux (bloom) autour des zones claires. */
  bloomStrength: 0.42,
  bloomRadius: 0.35,
  /** Luminosité à partir de laquelle un pixel « bave » (plus haut = moins de halo). */
  bloomThreshold: 0.95,
  /** Exposition globale de l'image. */
  exposure: 0.82,
  /** Liserés néon des toits, bandes des murs, tremplins, balise d'arrivée, feux. */
  neon: 0.55,
  /** Fenêtres éclairées des immeubles. */
  windows: 0.6,
  /** Enseignes, affiches publicitaires et panneaux holographiques. */
  signs: 0.65,
  /** Lumières ponctuelles colorées du décor. */
  pointLights: 0.5,
  /** Néons des armes, traînée des lames, tirs du pistolet. */
  weaponGlow: 0.6,
  /** Visières, lasers de visée et projectiles ennemis. */
  enemyGlow: 0.65,
  /** Particules, flashs et lumières d'explosion. */
  effects: 0.6,
  /** Reflets colorés de l'environnement sur les surfaces métalliques. */
  environment: 0.6,
} as const;

export const GRAPHICS = {
  /** Résolution dynamique : temps de frame visé et seuils d'ajustement (s). */
  targetFrameTime: 1 / 58,
  slowFrameTime: 1 / 45,
  resolutionCheckInterval: 1.5,
} as const;

export interface QualityPreset {
  /** Rapport de pixels initial / maximal / minimal (résolution dynamique). */
  initialPixelRatio: number;
  maxPixelRatio: number;
  minPixelRatio: number;
  maxParticles: number;
  rainCount: number;
  trafficCount: number;
  /** Lumières ponctuelles décoratives le long du parcours (coûteuses sur mobile). */
  neonLights: boolean;
  /** Nombre de projecteurs d'Aegis qui balaient le ciel. */
  searchlights: number;
}

export const QUALITY_PRESETS: { desktop: QualityPreset; mobile: QualityPreset } = {
  desktop: {
    initialPixelRatio: 1.5,
    maxPixelRatio: 1.5,
    minPixelRatio: 0.75,
    maxParticles: 3500,
    rainCount: 3800,
    trafficCount: 34,
    neonLights: true,
    searchlights: 9,
  },
  mobile: {
    initialPixelRatio: 1.0,
    maxPixelRatio: 1.5,
    minPixelRatio: 0.6,
    maxParticles: 1600,
    rainCount: 1600,
    trafficCount: 16,
    neonLights: false,
    searchlights: 5,
  },
};

/** Commandes tactiles (mobile). */
export const TOUCH = {
  /** Radians par pixel glissé pour la visée. */
  lookSensitivityX: 0.0048,
  lookSensitivityY: 0.0038,
  /** Facteur de visée quand le doigt glisse depuis un bouton (attaque / saut). */
  buttonLookFactor: 0.8,
  joystickRadius: 58,
  deadzone: 0.12,
  /** Déflexion du joystick à partir de laquelle on court à pleine vitesse. */
  fullSpeedAt: 0.7,
  pistolAimAssist: 0.8,
  lungeConeDeg: 32,
  vibrationKill: 18,
  vibrationHurt: 45,
} as const;

/** Grappin magnétique : ancres flottantes et drones / gardes ciblables. */
export const GRAPPLE = {
  /** Portée vers une ancre (m). */
  range: 34,
  /** Portée vers un ennemi (m). */
  enemyRange: 26,
  /** Distance minimale (trop près : inutile). */
  minDistance: 3.5,
  /** Demi-angle du cône de visée (souris / tactile). */
  coneDeg: 22,
  touchConeDeg: 30,
  /** Durée maximale de la traction. */
  pullTime: 1.4,
  /** Vitesse de traction (m/s). */
  pullSpeed: 30,
  /** Délai entre deux lancers, compté à la fin de la traction. */
  cooldown: 0.6,
  /** Lancers disponibles avant de retoucher le sol (ou un mur). */
  charges: 2,
  /** Rebond après une élimination au grappin. */
  killBounce: 10,
} as const;
