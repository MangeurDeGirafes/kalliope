import { drawPixelText, pixelTextWidth } from '../world/PixelTextures';
import { CHARGED } from '../config';

/**
 * Petites scènes animées en pixel art (160 × 90) qui illustrent chaque
 * mécanique dans le tutoriel. Chaque scène est une fonction pure du temps :
 * elle tourne en boucle sans état.
 */

export const SCENE_W = 160;
export const SCENE_H = 90;

type Ctx = CanvasRenderingContext2D;
export type Scene = (ctx: Ctx, t: number) => void;

const C = {
  roof: '#2a2633',
  facade: '#1c1726',
  body: '#d0d4e0',
  dark: '#3a3f4e',
  cyan: '#00e5ff',
  magenta: '#ff2bd6',
  lime: '#9dff5c',
  amber: '#ffb030',
  red: '#ff3b3b',
  yellow: '#ffd23b',
  white: '#fff1d6',
  green: '#2bffb0',
  armor: '#5a5f70',
};
const WINDOWS = ['#ffc27a', '#ffe2a8', '#9fd0ff', '#ffa8c8', '#c8ffb0', '#ffb866'];

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function text(ctx: Ctx, str: string, x: number, y: number, color: string): void {
  drawPixelText(ctx, str, Math.round(x), Math.round(y), color);
}

function centered(ctx: Ctx, str: string, y: number, color: string, scale = 1): void {
  drawPixelText(ctx, str, Math.round((SCENE_W - pixelTextWidth(str, scale)) / 2), y, color, scale);
}

// -----------------------------------------------------------------------------
// Décor
// -----------------------------------------------------------------------------

function sky(ctx: Ctx): void {
  const g = ctx.createLinearGradient(0, 0, 0, SCENE_H);
  g.addColorStop(0, '#07050f');
  g.addColorStop(0.65, '#2a1030');
  g.addColorStop(1, '#5a2a30');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  for (let i = 0; i < 18; i++) px(ctx, hash(i) * SCENE_W, hash(i + 50) * 30, 1, 1, 'rgba(255,255,255,0.5)');
}

const SKYLINE_LEN = 240;
const SKYLINE = Array.from({ length: 22 }, (_, i) => ({
  x: (i * SKYLINE_LEN) / 22 + hash(i) * 4,
  w: 7 + Math.floor(hash(i + 7) * 9),
  h: 22 + Math.floor(hash(i + 13) * 40),
}));

function skyline(ctx: Ctx, scroll: number): void {
  for (const b of SKYLINE) {
    let x = (b.x - scroll) % SKYLINE_LEN;
    if (x < -b.w) x += SKYLINE_LEN;
    for (const ox of [0, SKYLINE_LEN]) {
      const bx = x + ox;
      if (bx > SCENE_W) continue;
      const top = SCENE_H - b.h;
      px(ctx, bx, top, b.w, b.h, '#150f22');
      for (let wy = top + 3; wy < SCENE_H - 2; wy += 4) {
        for (let wx = bx + 1; wx < bx + b.w - 1; wx += 3) {
          const k = hash(Math.round(wx * 13 + wy * 7 + b.x));
          if (k < 0.32) px(ctx, wx, wy, 1, 1, WINDOWS[Math.floor(k * 100) % WINDOWS.length]);
        }
      }
    }
  }
}

function rain(ctx: Ctx, time: number, speed = 1): void {
  ctx.fillStyle = 'rgba(160,190,255,0.35)';
  for (let i = 0; i < 55; i++) {
    const x = (hash(i) * SCENE_W + time * 8) % SCENE_W;
    const y = (hash(i + 99) * SCENE_H + time * 90 * speed) % SCENE_H;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 3);
  }
}

/** Toit vu de profil : façade avec fenêtres + liseré néon. */
function roof(ctx: Ctx, x: number, y: number, w: number, trim = C.amber): void {
  px(ctx, x, y, w, SCENE_H - y, C.facade);
  for (let wy = y + 4; wy < SCENE_H; wy += 5) {
    for (let wx = x + 2; wx < x + w - 2; wx += 4) {
      const k = hash(Math.round(wx * 3.1 + wy * 17.3));
      if (k < 0.45) px(ctx, wx, wy, 2, 2, WINDOWS[Math.floor(k * 50) % WINDOWS.length]);
    }
  }
  px(ctx, x, y, w, 2, C.roof);
  px(ctx, x, y, w, 1, trim);
}

// -----------------------------------------------------------------------------
// Personnages et effets
// -----------------------------------------------------------------------------

type Pose = 'run' | 'jump' | 'slide' | 'stand' | 'charge' | 'dash' | 'fall' | 'slash';

/** Le coureur (pieds en x, y), tourné vers la droite. */
function runner(ctx: Ctx, x: number, y: number, pose: Pose, t: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  const b = C.body;
  const d = C.dark;
  switch (pose) {
    case 'slide':
      px(ctx, x - 6, y - 6, 3, 3, b);
      px(ctx, x - 4, y - 5, 1, 1, C.cyan);
      px(ctx, x - 4, y - 4, 6, 2, b);
      px(ctx, x + 2, y - 2, 5, 1, d);
      px(ctx, x + 1, y - 5, 3, 1, C.magenta);
      break;
    case 'dash':
      px(ctx, x + 1, y - 11, 3, 3, b);
      px(ctx, x + 3, y - 10, 1, 1, C.cyan);
      px(ctx, x - 2, y - 9, 5, 3, b);
      px(ctx, x - 6, y - 7, 4, 1, d);
      px(ctx, x + 3, y - 8, 4, 1, C.magenta);
      break;
    case 'fall':
      px(ctx, x - 1, y - 13, 3, 3, b);
      px(ctx, x - 1, y - 10, 3, 5, b);
      px(ctx, x - 4, y - 11, 3, 1, d);
      px(ctx, x + 2, y - 11, 3, 1, d);
      px(ctx, x - 2, y - 5, 1, 4, d);
      px(ctx, x + 2, y - 5, 1, 4, d);
      break;
    default: {
      // Tête + visière
      const crouch = pose === 'charge' ? 2 : 0;
      px(ctx, x - 1, y - 13 + crouch, 3, 3, b);
      px(ctx, x + 1, y - 12 + crouch, 2, 1, C.cyan);
      px(ctx, x - 1, y - 10 + crouch, 3, 5 - crouch, b);
      if (pose === 'jump') {
        px(ctx, x - 2, y - 5, 2, 2, d);
        px(ctx, x + 1, y - 6, 2, 2, d);
      } else if (pose === 'run') {
        const f = Math.floor(t * 10) % 2;
        if (f === 0) {
          px(ctx, x - 2, y - 5, 1, 3, d);
          px(ctx, x - 3, y - 2, 1, 2, d);
          px(ctx, x + 1, y - 5, 1, 2, d);
          px(ctx, x + 2, y - 3, 1, 3, d);
        } else {
          px(ctx, x - 1, y - 5, 1, 5, d);
          px(ctx, x + 1, y - 5, 1, 4, d);
        }
      } else {
        px(ctx, x - 1, y - 5, 1, 5, d);
        px(ctx, x + 1, y - 5, 1, 5, d);
      }
      // Bras + lames Mantis
      if (pose === 'charge') {
        px(ctx, x - 3, y - 9, 2, 1, d);
        px(ctx, x + 2, y - 9, 2, 1, d);
        px(ctx, x - 4, y - 12, 1, 3, C.magenta);
        px(ctx, x + 4, y - 12, 1, 3, C.cyan);
      } else if (pose === 'slash') {
        px(ctx, x + 2, y - 9, 3, 1, d);
        px(ctx, x + 5, y - 11, 1, 1, C.magenta);
        px(ctx, x + 6, y - 10, 1, 3, C.magenta);
        px(ctx, x + 5, y - 7, 1, 1, C.magenta);
      } else {
        px(ctx, x + 2, y - 9, 2, 1, d);
        px(ctx, x + 4, y - 10, 1, 1, C.magenta);
        px(ctx, x + 5, y - 11, 1, 1, C.magenta);
      }
    }
  }
  ctx.globalAlpha = 1;
}

/** Garde cybernétique (pieds en x, y), tourné vers la gauche. */
function guard(ctx: Ctx, x: number, y: number, t: number): void {
  px(ctx, x - 1, y - 14, 3, 3, C.armor);
  px(ctx, x - 2, y - 13, 2, 1, Math.sin(t * 8) > -0.5 ? C.red : '#a01020');
  px(ctx, x - 2, y - 11, 4, 6, C.armor);
  px(ctx, x - 1, y - 5, 1, 5, '#2a2d36');
  px(ctx, x + 1, y - 5, 1, 5, '#2a2d36');
  px(ctx, x - 6, y - 9, 5, 1, '#2a2a30');
  px(ctx, x - 6, y - 9, 1, 1, C.red);
}

function drone(ctx: Ctx, x: number, y: number, t: number): void {
  const yy = y + Math.round(Math.sin(t * 3) * 1.5);
  px(ctx, x - 3, yy, 7, 2, C.armor);
  px(ctx, x - 1, yy + 1, 2, 1, C.red);
  const blade = Math.floor(t * 20) % 2 ? 'rgba(200,230,255,0.6)' : 'rgba(200,230,255,0.25)';
  px(ctx, x - 5, yy - 1, 3, 1, blade);
  px(ctx, x + 3, yy - 1, 3, 1, blade);
}

function beacon(ctx: Ctx, x: number, bottom: number, t: number): void {
  const a = 0.45 + Math.sin(t * 4) * 0.2;
  ctx.fillStyle = `rgba(255,210,59,${a * 0.35})`;
  ctx.fillRect(x - 3, 0, 7, bottom);
  ctx.fillStyle = `rgba(255,230,120,${a})`;
  ctx.fillRect(x - 1, 0, 3, bottom);
  px(ctx, x - 4, bottom - 1, 9, 1, C.yellow);
}

/** Éclatement de pixels (k : 0 → 1). */
function burst(ctx: Ctx, x: number, y: number, k: number, colors: string[]): void {
  if (k <= 0 || k >= 1) return;
  ctx.globalAlpha = 1 - k;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + hash(i) * 0.4;
    const r = k * (8 + hash(i + 3) * 10);
    px(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, 1, 1, colors[i % colors.length]);
  }
  ctx.globalAlpha = 1;
}

/** Ligne en pixels (Bresenham). */
function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (let i = 0; i < 400; i++) {
    ctx.fillRect(ax, ay, 1, 1);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

function pips(ctx: Ctx, x: number, y: number, total: number, full: number, color: string): void {
  for (let i = 0; i < total; i++) px(ctx, x + i * 6, y, 5, 2, i < full ? color : 'rgba(255,255,255,0.15)');
}

/** Arc de parabole entre deux toits (u : 0 → 1). */
function arc(u: number, y0: number, y1: number, peak: number): number {
  return y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * peak;
}

// -----------------------------------------------------------------------------
// Scènes
// -----------------------------------------------------------------------------

/** Ambiance : la ville défile, le coureur saute de toit en toit. */
export const sceneIntro: Scene = (ctx, t) => {
  sky(ctx);
  skyline(ctx, t * 12);
  const s = t * 60;
  const base = Math.floor(s / 100);
  for (let k = base - 1; k < base + 3; k++) roof(ctx, k * 100 - s, 70, 72, k % 2 ? C.cyan : C.amber);
  const rel = (s + 48) % 100;
  const j = (rel - 62 + 100) % 100;
  const h = j < 48 ? Math.sin((j / 48) * Math.PI) * 16 : 0;
  runner(ctx, 48, 70 - h, h > 0 ? 'jump' : 'run', t);
  rain(ctx, t);
};

/** Ambiance lente pour les pages de lore. */
export const sceneLore: Scene = (ctx, t) => {
  sky(ctx);
  skyline(ctx, t * 4);
  roof(ctx, -10, 74, 180, C.magenta);
  runner(ctx, 120, 74, 'stand', t);
  rain(ctx, t, 0.8);
};

/** Objectif : traverser les toits jusqu'à la balise dorée. */
export const sceneObjective: Scene = (ctx, t) => {
  const period = 6;
  const tt = t % period;
  sky(ctx);
  skyline(ctx, 20);
  roof(ctx, 0, 70, 50);
  roof(ctx, 62, 64, 43, C.magenta);
  roof(ctx, 116, 58, 44, C.lime);
  beacon(ctx, 146, 58, t);
  text(ctx, 'EXTRACTION', 112, 44, C.yellow);
  const p = clamp01(tt / 4.5);
  const x = 8 + p * 132;
  let y = 70;
  let pose: Pose = 'run';
  if (x >= 50 && x < 62) {
    y = arc((x - 50) / 12, 70, 64, 8);
    pose = 'jump';
  } else if (x >= 62 && x < 105) y = 64;
  else if (x >= 105 && x < 116) {
    y = arc((x - 105) / 11, 64, 58, 8);
    pose = 'jump';
  } else if (x >= 116) y = 58;
  if (p >= 1) pose = 'stand';
  runner(ctx, x, y, pose, t);
  if (p >= 1) burst(ctx, 146, 50, (tt - 4.5) / 1.2, [C.yellow, C.white, C.amber]);
  const secs = Math.min(tt, 4.5) * 2.7;
  text(ctx, `TEMPS 00:${secs.toFixed(2).padStart(5, '0')}`, 4, 4, C.white);
  rain(ctx, t);
};

/** Saut + double saut au-dessus d'un gouffre. */
export const sceneJump: Scene = (ctx, t) => {
  const tt = t % 4;
  sky(ctx);
  skyline(ctx, 40);
  roof(ctx, 0, 70, 58);
  roof(ctx, 104, 70, 56, C.cyan);
  const p = clamp01(tt / 3);
  const x = 10 + p * 130;
  let y = 70;
  let pose: Pose = p >= 1 ? 'stand' : 'run';
  if (x > 56 && x < 104) {
    const u = (x - 56) / 48;
    let h: number;
    if (u < 0.45) h = 14 * Math.sin((u / 0.45) * (Math.PI / 2));
    else {
      const v = (u - 0.45) / 0.55;
      h = 14 + 12 * Math.sin(v * Math.PI) - 14 * v;
    }
    y = 70 - h;
    pose = 'jump';
    if (u < 0.45) text(ctx, 'SAUT', x - 6, y - 22, C.white);
    else text(ctx, 'DOUBLE SAUT', x - 20, y - 22, C.cyan);
    burst(ctx, 56 + 0.45 * 48, 70 - 14 - 4, (u - 0.45) * 4, [C.cyan, C.magenta, C.white]);
  }
  runner(ctx, x, y, pose, t);
  rain(ctx, t);
};

/** Glissade sous un panneau suspendu. */
export const sceneSlide: Scene = (ctx, t) => {
  const tt = t % 4;
  sky(ctx);
  skyline(ctx, 60);
  roof(ctx, 0, 70, 160, C.magenta);
  // Panneau suspendu (bord inférieur trop bas pour passer debout)
  px(ctx, 70, 26, 34, 36, '#1a1205');
  for (let i = 0; i < 34; i += 4) {
    px(ctx, 70 + i, 26, 2, 2, C.amber);
    px(ctx, 70 + i, 60, 2, 2, C.amber);
  }
  text(ctx, 'GLISSE', 76, 40, C.yellow);
  px(ctx, 70, 62, 34, 1, '#ff6a2b');
  const p = clamp01(tt / 3.2);
  const x = 6 + p * 150;
  const sliding = x > 52 && x < 112;
  if (sliding) {
    for (let i = 0; i < 4; i++) px(ctx, x - 14 - i * 5, 66 - i, 4, 1, 'rgba(255,255,255,0.5)');
  }
  runner(ctx, x, 70, sliding ? 'slide' : p >= 1 ? 'stand' : 'run', t);
  rain(ctx, t);
};

/** Wall-run vu de dessus : mur 1 → saut mural → mur 2 → toit. */
export const sceneWallrun: Scene = (ctx, t) => {
  const tt = t % 5;
  ctx.fillStyle = '#0a0a16';
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  // Rues tout en bas
  for (let x = 6; x < SCENE_W; x += 22) px(ctx, x, 0, 1, SCENE_H, 'rgba(255,170,80,0.25)');
  for (let y = 8; y < SCENE_H; y += 18) px(ctx, 0, y, SCENE_W, 1, 'rgba(255,60,200,0.18)');
  px(ctx, 0, 0, 28, SCENE_H, C.roof);
  px(ctx, 27, 0, 1, SCENE_H, C.amber);
  px(ctx, 132, 0, 28, SCENE_H, C.roof);
  px(ctx, 132, 0, 1, SCENE_H, C.cyan);
  px(ctx, 34, 22, 58, 2, C.lime);
  px(ctx, 68, 66, 58, 2, C.lime);
  const pts: [number, number, number][] = [
    [0, 14, 45],
    [0.15, 38, 26],
    [0.45, 88, 26],
    [0.6, 96, 64],
    [0.8, 122, 64],
    [1, 146, 45],
  ];
  const posAt = (p: number): [number, number] => {
    for (let i = 1; i < pts.length; i++) {
      if (p <= pts[i][0]) {
        const k = (p - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return [pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k, pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * k];
      }
    }
    return [pts[pts.length - 1][1], pts[pts.length - 1][2]];
  };
  const p = clamp01(tt / 3.6);
  for (let i = 1; i <= 16; i++) {
    const [tx, ty] = posAt(Math.max(0, p - i * 0.012));
    ctx.globalAlpha = (1 - i / 16) * 0.7;
    px(ctx, tx, ty, 1, 1, C.cyan);
  }
  ctx.globalAlpha = 1;
  const [x, y] = posAt(p);
  px(ctx, x - 1, y - 1, 3, 3, C.body);
  px(ctx, x, y, 1, 1, C.magenta);
  if ((p > 0.15 && p < 0.45) || (p > 0.6 && p < 0.8)) text(ctx, 'WALL-RUN', 52, 40, C.lime);
  else if (p >= 0.45 && p <= 0.6) text(ctx, 'SAUT MURAL', 48, 40, C.white);
  text(ctx, 'VUE DE DESSUS', 4, 83, 'rgba(255,255,255,0.4)');
};

/** Dash aérien avec images rémanentes. */
export const sceneDash: Scene = (ctx, t) => {
  const tt = t % 4;
  sky(ctx);
  skyline(ctx, 80);
  roof(ctx, 0, 70, 66);
  roof(ctx, 112, 70, 48, C.lime);
  const p = clamp01(tt / 3);
  let x: number;
  let y = 70;
  let pose: Pose = 'run';
  let dashing = false;
  let charges = 2;
  if (p < 0.35) x = 10 + (p / 0.35) * 52;
  else if (p < 0.5) {
    const u = (p - 0.35) / 0.15;
    x = 62 + u * 12;
    y = 70 - Math.sin(u * (Math.PI / 2)) * 14;
    pose = 'jump';
  } else if (p < 0.62) {
    const u = (p - 0.5) / 0.12;
    x = 74 + u * 42;
    y = 56;
    pose = 'dash';
    dashing = true;
    charges = 1;
  } else if (p < 0.72) {
    const u = (p - 0.62) / 0.1;
    x = 116 + u * 8;
    y = 56 + u * 14;
    pose = 'jump';
    charges = 1;
  } else {
    x = 124 + ((p - 0.72) / 0.28) * 24;
    charges = 1;
    if (p >= 1) pose = 'stand';
  }
  if (dashing) {
    for (let i = 1; i <= 3; i++) runner(ctx, x - i * 7, y, 'dash', t, 0.5 - i * 0.12);
    px(ctx, x - 30, y - 8, 26, 1, 'rgba(0,229,255,0.7)');
    text(ctx, 'DASH', x - 10, y - 22, C.cyan);
  }
  runner(ctx, x, y, pose, t);
  text(ctx, 'DASH', 4, 4, C.white);
  pips(ctx, 24, 5, 2, charges, C.magenta);
  rain(ctx, t);
};

/** Combat : laser de visée, renvoi du projectile, élimination. */
export const sceneCombat: Scene = (ctx, t) => {
  const tt = t % 5.5;
  sky(ctx);
  skyline(ctx, 100);
  roof(ctx, 0, 70, 70, C.magenta);
  roof(ctx, 100, 66, 60, C.red);
  const rx = 40;
  const gx = 132;
  const gunX = gx - 6;
  const gunY = 66 - 9;
  const chestX = rx + 1;
  const chestY = 62;
  const dead = tt > 3.1;
  if (!dead) guard(ctx, gx, 66, t);
  let pose: Pose = 'stand';
  if (tt < 1.5) {
    if (Math.floor(tt * (4 + tt * 10)) % 2 === 0) line(ctx, gunX, gunY, chestX + 4, chestY, 'rgba(255,59,59,0.9)');
    centered(ctx, 'LASER ROUGE = TIR IMMINENT', 6, C.red);
  } else if (tt < 2.25) {
    const k = (tt - 1.5) / 0.75;
    const bx = gunX + (chestX + 6 - gunX) * k;
    const by = gunY + (chestY - gunY) * k;
    px(ctx, bx - 1, by - 1, 3, 2, C.red);
    if (tt > 2.05) pose = 'slash';
    centered(ctx, 'TRANCHE LE PROJECTILE', 6, C.white);
  } else if (tt < 3.1) {
    const k = (tt - 2.25) / 0.85;
    const bx = chestX + 6 + (gx - chestX - 6) * k;
    const by = chestY + (60 - chestY) * k;
    px(ctx, bx - 1, by - 1, 3, 2, C.cyan);
    pose = tt < 2.5 ? 'slash' : 'stand';
    centered(ctx, 'RENVOYE A SON TIREUR', 6, C.cyan);
  } else {
    burst(ctx, gx, 58, (tt - 3.1) / 0.9, [C.red, C.amber, C.white, C.cyan]);
    centered(ctx, 'UN COUP = UNE ELIMINATION', 6, C.yellow);
  }
  if (pose === 'slash' && tt < 2.5) {
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + i * 0.4;
      px(ctx, rx + 4 + Math.cos(a) * 7, 62 + Math.sin(a) * 7, 1, 1, C.magenta);
    }
  }
  runner(ctx, rx, 70, pose, t);
  rain(ctx, t);
};

/** Attaque chargée : maintenir, relâcher, foncer sur l'ennemi le plus proche. */
export const sceneCharged: Scene = (ctx, t) => {
  const tt = t % 4;
  sky(ctx);
  skyline(ctx, 120);
  roof(ctx, 0, 70, 160, C.cyan);
  const startX = 28;
  const gx = 134;
  // Chronologie : temps de lecture, charge (durée réelle du jeu), prêt, dash, impact
  const lead = 0.6;
  const readyEnd = lead + CHARGED.holdTime + 0.7;
  const dashEnd = readyEnd + 0.35;
  let x = startX;
  let pose: Pose = tt < lead ? 'stand' : 'charge';
  const level = clamp01((tt - lead) / CHARGED.holdTime);
  const holdLabel = `MAINTIENS L ATTAQUE ${String(CHARGED.holdTime).replace('.', ',')} S`;
  if (tt < readyEnd) {
    // Anneau de charge autour du coureur
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const on = i / n < level;
      px(ctx, startX + Math.cos(a) * 10, 63 + Math.sin(a) * 10, 1, 1, on ? (level >= 1 ? C.cyan : C.magenta) : 'rgba(255,255,255,0.15)');
    }
    px(ctx, 50, 80, 60, 3, 'rgba(255,255,255,0.15)');
    px(ctx, 50, 80, 60 * level, 3, level >= 1 ? C.cyan : C.magenta);
    if (level < 1) centered(ctx, holdLabel, 6, C.white);
    else if (Math.floor(tt * 8) % 2 === 0) centered(ctx, 'RELACHE !', 6, C.cyan, 2);
  } else if (tt < dashEnd) {
    const k = (tt - readyEnd) / (dashEnd - readyEnd);
    x = startX + (gx - 8 - startX) * k;
    pose = 'dash';
    for (let i = 1; i <= 4; i++) runner(ctx, x - i * 9, 70, 'dash', t, 0.5 - i * 0.1);
    px(ctx, startX, 62, x - startX, 1, 'rgba(255,43,214,0.8)');
    centered(ctx, 'DASH GRATUIT ET INVULNERABLE', 6, C.magenta);
  } else {
    x = gx - 8;
    pose = tt < dashEnd + 0.35 ? 'slash' : 'stand';
    burst(ctx, gx, 60, (tt - dashEnd) / 0.9, [C.magenta, C.cyan, C.white, C.amber]);
    centered(ctx, 'CIBLE LA PLUS PROCHE', 6, C.white);
  }
  if (tt < dashEnd) guard(ctx, gx, 70, t);
  runner(ctx, x, 70, pose, t);
  rain(ctx, t);
};

/** Sandevistan : le monde ralentit, pas le coureur. */
export const sceneSandevistan: Scene = (ctx, t) => {
  const period = 6;
  const tt = t % period;
  const slowStart = 1.5;
  const slowEnd = 4.5;
  const slow = tt > slowStart && tt < slowEnd;
  // Temps du monde : 18 % de la vitesse pendant le ralenti
  const world = Math.min(tt, slowStart) + Math.max(0, Math.min(tt, slowEnd) - slowStart) * 0.18 + Math.max(0, tt - slowEnd);
  sky(ctx);
  skyline(ctx, 140);
  roof(ctx, 0, 70, 160, C.green);
  drone(ctx, 140, 30, world);
  // Projectile lent qui traverse l'écran
  const bx = 136 - world * 30;
  const by = 32 + world * 9;
  if (bx > 0 && by < 70) px(ctx, bx - 1, by - 1, 3, 2, C.red);
  // Le coureur se déplace à vitesse normale et esquive
  const rx = 30 + Math.sin(tt * 1.4) * 22;
  runner(ctx, rx, 70, 'run', tt);
  rain(ctx, world, 1);
  if (slow) {
    ctx.fillStyle = 'rgba(43,255,176,0.12)';
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    for (let y = 0; y < SCENE_H; y += 3) px(ctx, 0, y, SCENE_W, 1, 'rgba(0,0,0,0.12)');
    if (Math.floor(tt * 4) % 2 === 0) centered(ctx, 'SANDEVISTAN', 14, C.green, 2);
  }
  const energy = slow ? 1 - (tt - slowStart) / (slowEnd - slowStart) * 0.75 : tt < slowStart ? 1 : 0.25 + (tt - slowEnd) * 0.1;
  text(ctx, 'ENERGIE', 4, 4, C.white);
  px(ctx, 34, 5, 40, 3, 'rgba(255,255,255,0.15)');
  px(ctx, 34, 5, 40 * energy, 3, slow ? C.green : C.cyan);
};

/** Survie : intégrité, régénération, chute = flatline. */
export const sceneSurvival: Scene = (ctx, t) => {
  const tt = t % 7.5;
  sky(ctx);
  skyline(ctx, 160);
  roof(ctx, 0, 70, 96, C.amber);
  let hp = 3;
  let x = 40;
  let y = 70;
  let pose: Pose = 'stand';
  if (tt < 1) {
    const bx = 160 - tt * 120;
    px(ctx, bx, 61, 3, 2, C.red);
  } else if (tt < 3.2) {
    hp = 2;
    if (tt < 1.3) {
      ctx.fillStyle = 'rgba(255,32,64,0.3)';
      ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    }
    centered(ctx, 'REGENERATION...', 30, C.yellow);
  } else if (tt < 4.2) {
    x = 40 + (tt - 3.2) * 50;
    pose = 'run';
  } else {
    const k = tt - 4.2;
    x = 90 + k * 20;
    y = 70 + k * k * 30;
    pose = 'fall';
  }
  if (tt > 5.2) {
    centered(ctx, 'FLATLINE', 30, C.red, 2);
    if (tt > 6) centered(ctx, 'RECOMMENCE AU QUART DE TOUR', 48, C.white);
  }
  if (y < SCENE_H + 14) runner(ctx, x, y, pose, t);
  text(ctx, 'INTEGRITE', 4, 4, C.white);
  pips(ctx, 42, 5, 3, hp, C.yellow);
  rain(ctx, t);
};
