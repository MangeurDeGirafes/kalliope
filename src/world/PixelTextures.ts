import * as THREE from 'three';
import { createRng } from './Textures';

/**
 * Générateurs de textures en pixel art (rendu sans lissage) : façades habitées,
 * toits, enseignes en police pixel 3×5 et affiches illustrées.
 * Tout est procédural : aucun fichier image.
 */

type Rng = () => number;
type Ctx = CanvasRenderingContext2D;

// -----------------------------------------------------------------------------
// Utilitaires couleur / canvas
// -----------------------------------------------------------------------------

function rgbOf(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Couleur CSS, éventuellement éclaircie / assombrie par `f`. */
export function css(hex: number, f = 1): string {
  const [r, g, b] = rgbOf(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

function mixHex(a: number, b: number, t: number): number {
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (m(ar, br) << 16) | (m(ag, bg) << 8) | m(ab, bb);
}

function jitter(hex: number, rng: Rng, amount: number): number {
  const f = 1 + (rng() * 2 - 1) * amount;
  const [r, g, b] = rgbOf(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Bruit par pixel (variation de luminosité) appliqué en une passe. */
function addNoise(ctx: Ctx, w: number, h: number, rng: Rng, amount: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() * 2 - 1) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Texture « pixel » : agrandissement sans lissage, réduction filtrée (pas de scintillement). */
export function pixelTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

// -----------------------------------------------------------------------------
// Police pixel 3×5
// -----------------------------------------------------------------------------

const FONT: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '0': '111101101101111', '1': '010110010010111',
  '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
  '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  ' ': '000000000000000', '/': '001001010100100', '-': '000000111000000', '+': '000010111010000',
  '.': '000000000000010', '!': '010010010000010', ':': '000010000010000', '>': '100010001010100',
  '<': '001010100010001', '*': '000101010101000', "'": '010010000000000', '&': '010101010101011',
};

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

export function pixelTextWidth(text: string, scale = 1): number {
  const n = normalize(text).length;
  return n > 0 ? (n * 4 - 1) * scale : 0;
}

/** Écrit un texte en police pixel 3×5 ; renvoie la largeur dessinée. */
export function drawPixelText(ctx: Ctx, text: string, x: number, y: number, color: string, scale = 1): number {
  const t = normalize(text);
  ctx.fillStyle = color;
  for (let i = 0; i < t.length; i++) {
    const glyph = FONT[t[i]];
    const gx = x + i * 4 * scale;
    if (!glyph) {
      // Caractère hors police (kanji…) : rendu système minuscule, effet pixel garanti.
      ctx.font = `${6 * scale}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(t[i], gx - scale, y - scale);
      continue;
    }
    for (let p = 0; p < 15; p++) {
      if (glyph[p] === '1') ctx.fillRect(gx + (p % 3) * scale, y + Math.floor(p / 3) * scale, scale, scale);
    }
  }
  return pixelTextWidth(t, scale);
}

// -----------------------------------------------------------------------------
// Façades
// -----------------------------------------------------------------------------

export type FacadeStyle = 'brick' | 'concrete' | 'glass' | 'tile' | 'metal' | 'pastel';

/** Nombre de modules (fenêtres) par côté de texture de façade. */
export const FACADE_CELLS = 8;
const CELL = 32;
const FACADE_SIZE = CELL * FACADE_CELLS;

interface FacadeSpec {
  walls: number[];
  trim: number;
  /** Fenêtre dans le module : x, y, largeur, hauteur (px). */
  win: [number, number, number, number];
  lit: number;
  balcony: number;
  ac: number;
  plants: number;
  laundry: number;
  shops: number;
  office: boolean;
}

const SPECS: Record<FacadeStyle, FacadeSpec> = {
  brick: { walls: [0x7a3b2a, 0x8a4630, 0x6e3424, 0x93502f], trim: 0x3a2a24, win: [8, 6, 16, 18], lit: 0.45, balcony: 0.08, ac: 0.3, plants: 0.25, laundry: 0.15, shops: 0.04, office: false },
  concrete: { walls: [0x7d786e, 0x8a857a, 0x6f6a62, 0x938d80], trim: 0x4c4842, win: [5, 7, 22, 16], lit: 0.4, balcony: 0.05, ac: 0.35, plants: 0.15, laundry: 0.05, shops: 0.05, office: false },
  glass: { walls: [0x17343f, 0x1b3b49, 0x132b36], trim: 0x0a1a22, win: [2, 3, 28, 26], lit: 0.5, balcony: 0, ac: 0, plants: 0.08, laundry: 0, shops: 0.02, office: true },
  tile: { walls: [0xc9c2a8, 0xbdb59a, 0xd2cbb2], trim: 0x8f8873, win: [7, 5, 18, 16], lit: 0.5, balcony: 0.7, ac: 0.3, plants: 0.35, laundry: 0.4, shops: 0.04, office: false },
  metal: { walls: [0x7a4a2b, 0x8c5634, 0x2f5f5a, 0x6a3f26], trim: 0x2a1c14, win: [9, 8, 14, 12], lit: 0.38, balcony: 0.05, ac: 0.4, plants: 0.1, laundry: 0.1, shops: 0.12, office: false },
  pastel: { walls: [0xb8737e, 0x6fa595, 0xc9a34f, 0x8a7fb8, 0xc98f6a], trim: 0xe8e0d0, win: [7, 6, 18, 16], lit: 0.5, balcony: 0.6, ac: 0.35, plants: 0.3, laundry: 0.45, shops: 0.04, office: false },
};

const HOME_LIGHTS = [0xffd08a, 0xffb866, 0xffe2a8, 0xffc27a, 0xfff0d0, 0xbfe8ff, 0xff9f6b, 0xc8ffb0, 0xffa8c8, 0x9fd0ff, 0xffe066];
const OFFICE_LIGHTS = [0xeaf6ff, 0xd8f0ff, 0xfff6e0, 0xbfe0ff, 0xe0ffe8];
const CURTAINS = [0xb02a2a, 0x2a7a3a, 0x6a3aa0, 0xd87a20, 0x1f7f8f, 0xe8dcc0, 0xd84a8a, 0x2a4ab0];
const CLOTHES = [0xf2f2f2, 0xd83a3a, 0x3a6ad8, 0xf2c83a, 0x4ab84a, 0xf28a3a, 0xf27ab8, 0x8a5ad8, 0x2ac8c8];
const LEAVES = [0x3f8f3f, 0x5faf4f, 0x2f6f4f, 0x7fbf3f];
const FLOWERS = [0xff5a7a, 0xffd23b, 0xff8a2b, 0xf2f2f2, 0xb86af2];
export const SIGN_SCHEMES: readonly { bg: number; fg: number; border: number }[] = [
  { bg: 0x1a0505, fg: 0xff3b3b, border: 0xffb030 },
  { bg: 0x061408, fg: 0x9dff5c, border: 0xe8ffd0 },
  { bg: 0x1a1205, fg: 0xffc857, border: 0xff6a2b },
  { bg: 0x05101a, fg: 0x7fd8ff, border: 0xffffff },
  { bg: 0x16051a, fg: 0xff7ad9, border: 0xffd23b },
  { bg: 0xf0e6d0, fg: 0xc81e1e, border: 0x2a1a10 },
  { bg: 0x0d2a6b, fg: 0xffffff, border: 0xffd23b },
  { bg: 0x1b5e20, fg: 0xffffff, border: 0x9dff5c },
  { bg: 0xd84a1a, fg: 0xfff1d6, border: 0x2a1205 },
];

/** Peint la même zone sur l'albédo (m) et sur la carte d'émission (e). */
function paint(m: Ctx, e: Ctx, x: number, y: number, w: number, h: number, mc: string, ec: string): void {
  rect(m, x, y, w, h, mc);
  rect(e, x, y, w, h, ec);
}

function drawWallPattern(m: Ctx, style: FacadeStyle, spec: FacadeSpec, base: number, rng: Rng): void {
  const S = FACADE_SIZE;
  switch (style) {
    case 'brick': {
      rect(m, 0, 0, S, S, css(spec.trim, 1.2));
      for (let y = 0; y < S; y += 4) {
        const off = (y / 4) % 2 ? 4 : 0;
        for (let x = -off; x < S; x += 8) rect(m, x, y, 7, 3, css(jitter(pick(rng, spec.walls), rng, 0.12)));
      }
      break;
    }
    case 'concrete': {
      for (let cy = 0; cy < FACADE_CELLS; cy++) {
        for (let cx = 0; cx < FACADE_CELLS; cx++) {
          rect(m, cx * CELL, cy * CELL, CELL, CELL, css(jitter(pick(rng, spec.walls), rng, 0.05)));
          rect(m, cx * CELL, cy * CELL, CELL, 1, css(spec.trim));
          rect(m, cx * CELL, cy * CELL, 1, CELL, css(spec.trim, 1.1));
        }
      }
      // Coulures de pluie
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(rng() * S);
        const y = Math.floor(rng() * S);
        m.globalAlpha = 0.25;
        rect(m, x, y, 1, 8 + rng() * 40, css(0x2a2620));
        m.globalAlpha = 1;
      }
      break;
    }
    case 'glass': {
      rect(m, 0, 0, S, S, css(base));
      // Reflet diagonal du ciel
      m.globalAlpha = 0.35;
      for (let i = -S; i < S; i += 3) {
        for (let k = 0; k < S; k += 1) {
          if ((k + i) % 97 < 6) rect(m, k, k + i, 1, 1, css(0x4a7a9a));
        }
      }
      m.globalAlpha = 1;
      break;
    }
    case 'tile': {
      rect(m, 0, 0, S, S, css(base));
      for (let y = 0; y < S; y += 3) for (let x = 0; x < S; x += 3) {
        if (rng() < 0.85) rect(m, x, y, 2, 2, css(jitter(base, rng, 0.06)));
      }
      break;
    }
    case 'metal': {
      for (let cx = 0; cx < FACADE_CELLS; cx++) {
        const panel = pick(rng, spec.walls);
        for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
          const f = x % 3 === 0 ? 0.7 : x % 3 === 1 ? 1.15 : 1;
          rect(m, x, 0, 1, S, css(panel, f));
        }
      }
      // Plaques de rouille
      for (let i = 0; i < 30; i++) {
        const x = rng() * S;
        const y = rng() * S;
        const r = 2 + rng() * 6;
        for (let k = 0; k < r * r; k++) {
          rect(m, x + (rng() - 0.5) * r * 2, y + (rng() - 0.5) * r * 2, 1, 1, css(pick(rng, [0x9a4a1a, 0xb05a20, 0x6a3010])));
        }
      }
      break;
    }
    case 'pastel': {
      rect(m, 0, 0, S, S, css(base));
      for (let i = 0; i < 25; i++) {
        m.globalAlpha = 0.2;
        rect(m, rng() * S, rng() * S, 1, 10 + rng() * 30, css(0x3a2a2a));
        m.globalAlpha = 1;
      }
      break;
    }
  }
}

/** Intérieur éclairé : lumière chaude ou froide, lampes, rideaux, plantes, silhouettes, télé. */
function drawInterior(m: Ctx, e: Ctx, x: number, y: number, w: number, h: number, rng: Rng, office: boolean): void {
  const light = pick(rng, office ? OFFICE_LIGHTS : HOME_LIGHTS);
  for (let r = 0; r < h; r++) {
    const f = 1 - (r / h) * 0.45;
    paint(m, e, x, y + r, w, 1, css(light, f), css(light, f * 0.95));
  }
  if (office) {
    // Néons de plafond, bureaux, écrans
    paint(m, e, x, y + 1, w, 1, css(0xffffff), css(0xffffff, 1.1));
    for (let dx = 1; dx < w - 3; dx += 6) {
      paint(m, e, x + dx, y + h - 5, 4, 1, css(light, 0.35), css(light, 0.2));
      if (rng() < 0.6) paint(m, e, x + dx + 1, y + h - 7, 2, 2, css(0x7fd0ff), css(0x7fd0ff, 1.2));
      if (rng() < 0.3) paint(m, e, x + dx, y + h - 10, 2, 5, css(0x1a1820), 'rgb(0,0,0)');
    }
    return;
  }
  // Lampe
  const lx = x + 2 + Math.floor(rng() * (w - 5));
  paint(m, e, lx, y + 2, 2, 1, css(0xfff8e0), css(0xfff8e0, 1.2));
  // Meubles (silhouettes sombres)
  const fw = 3 + Math.floor(rng() * (w / 2));
  paint(m, e, x + Math.floor(rng() * (w - fw)), y + h - 3, fw, 3, css(light, 0.25), css(light, 0.12));
  // Habitant
  if (rng() < 0.28) {
    const px = x + 2 + Math.floor(rng() * (w - 6));
    const sil = css(0x1a1410);
    paint(m, e, px + 1, y + h - 10, 2, 2, sil, 'rgb(0,0,0)');
    paint(m, e, px, y + h - 8, 4, 6, sil, 'rgb(0,0,0)');
  }
  // Plante d'intérieur
  if (rng() < 0.3) {
    const px = rng() < 0.5 ? x + 1 : x + w - 4;
    for (let k = 0; k < 7; k++) {
      const leaf = pick(rng, LEAVES);
      paint(m, e, px + Math.floor(rng() * 3), y + h - 7 + Math.floor(rng() * 4), 1, 1, css(leaf), css(leaf, 0.3));
    }
    paint(m, e, px, y + h - 2, 3, 2, css(0xa0522d), css(0xa0522d, 0.25));
  }
  // Télévision
  if (rng() < 0.14) {
    const tx = x + 2 + Math.floor(rng() * (w - 7));
    const tv = pick(rng, [0x7fb8ff, 0xb8ffd8, 0xffb8e0]);
    paint(m, e, tx, y + h - 7, 5, 4, css(tv), css(tv, 1.3));
  }
  // Rideaux
  if (rng() < 0.42) {
    const c = pick(rng, CURTAINS);
    const cw = 2 + Math.floor(rng() * 3);
    for (let r = 0; r < h; r++) {
      const f = r % 2 ? 0.85 : 1;
      paint(m, e, x, y + r, cw, 1, css(c, f), css(c, 0.55 * f));
      if (rng() < 0.7) paint(m, e, x + w - cw, y + r, cw, 1, css(c, f), css(c, 0.55 * f));
    }
  } else if (rng() < 0.3) {
    // Stores
    for (let r = 1; r < h; r += 2) paint(m, e, x, y + r, w, 1, css(light, 0.55), css(light, 0.4));
  }
}

function drawDarkWindow(m: Ctx, e: Ctx, x: number, y: number, w: number, h: number, rng: Rng): void {
  paint(m, e, x, y, w, h, css(0x0c1018), 'rgb(2,3,8)');
  // Reflet du ciel
  for (let i = 0; i < Math.min(w, h); i++) {
    if (i + 3 < w) rect(m, x + i + 3, y + i, 2, 1, css(0x26304a));
  }
  if (rng() < 0.08) {
    // Lueur de télé dans une pièce sombre
    paint(m, e, x + 2, y + h - 6, 4, 3, css(0x203060), css(0x3050a0, 0.8));
  } else if (rng() < 0.06) {
    const c = pick(rng, [0xff4fa3, 0x2bd9c5, 0xffc857]);
    paint(m, e, x + Math.floor(rng() * w), y + Math.floor(rng() * h), 1, 1, css(c), css(c, 0.6));
  }
}

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/**
 * Façade habitée en pixel art : 8 × 8 modules de 32 px. Albédo (`map`) + carte
 * d'émission (`emissive`) où seuls les intérieurs allumés, enseignes et voyants
 * brillent ; les murs y sont recopiés très atténués pour rester lisibles la nuit.
 */
export function createFacade(style: FacadeStyle, seed: number): FacadeTextures {
  const rng = createRng(seed);
  const spec = SPECS[style];
  const S = FACADE_SIZE;
  const [mc, m] = makeCanvas(S, S);
  const [ec, e] = makeCanvas(S, S);
  const base = pick(rng, spec.walls);

  drawWallPattern(m, style, spec, base, rng);
  addNoise(m, S, S, rng, style === 'glass' ? 6 : 14);
  // Murs très légèrement auto-éclairés (lumière de la ville)
  rect(e, 0, 0, S, S, 'rgb(0,0,0)');
  e.globalAlpha = 0.13;
  e.drawImage(mc, 0, 0);
  e.globalAlpha = 1;

  const floorLit = Array.from({ length: FACADE_CELLS }, () => 0.5 + rng());
  const [wx, wy, ww, wh] = spec.win;
  for (let cy = 0; cy < FACADE_CELLS; cy++) {
    for (let cx = 0; cx < FACADE_CELLS; cx++) {
      const x = cx * CELL;
      const y = cy * CELL;
      // Dalle d'étage
      rect(m, x, y + CELL - 2, CELL, style === 'glass' ? 1 : 2, css(spec.trim));
      if (style === 'glass') {
        rect(m, x, y, 1, CELL, css(0x6a8a9a));
        rect(m, x + 16, y, 1, CELL, css(0x3a5a6a));
      }
      // Encadrement + fenêtre
      paint(m, e, x + wx - 1, y + wy - 1, ww + 2, wh + 2, css(spec.trim, style === 'tile' || style === 'pastel' ? 1.15 : 0.8), 'rgb(0,0,0)');
      if (rng() < spec.lit * floorLit[cy]) drawInterior(m, e, x + wx, y + wy, ww, wh, rng, spec.office);
      else drawDarkWindow(m, e, x + wx, y + wy, ww, wh, rng);
      // Appui de fenêtre
      rect(m, x + wx - 1, y + wy + wh + 1, ww + 2, 1, css(spec.trim, 1.3));

      const below = y + wy + wh + 2;
      if (rng() < spec.balcony) {
        // Balcon : garde-corps, linge, plantes
        const rail = css(pick(rng, [0xd8d8d0, 0x8a8a90, 0x4a4a50, 0xb0b8c0]));
        rect(m, x + 2, y + wy + wh - 5, CELL - 4, 1, rail);
        for (let bx = x + 2; bx < x + CELL - 2; bx += 2) rect(m, bx, y + wy + wh - 4, 1, 5, rail);
        if (rng() < spec.laundry) {
          rect(m, x + wx, y + wy + 2, ww, 1, css(0x2a2a2a));
          for (let lx = x + wx + 1; lx < x + wx + ww - 3; lx += 3 + Math.floor(rng() * 2)) {
            if (rng() < 0.75) rect(m, lx, y + wy + 3, 2 + Math.floor(rng() * 2), 3 + Math.floor(rng() * 3), css(pick(rng, CLOTHES)));
          }
        }
        if (rng() < spec.plants) {
          for (let k = 0; k < 6; k++) rect(m, x + 3 + Math.floor(rng() * (CELL - 6)), y + wy + wh - 7 + Math.floor(rng() * 2), 1, 2, css(pick(rng, LEAVES)));
        }
      } else {
        if (rng() < spec.ac && below + 5 < y + CELL - 2) {
          // Climatiseur sous la fenêtre (+ voyant)
          const ax = x + wx + ww - 8;
          rect(m, ax, below, 7, 5, css(pick(rng, [0xd8d2c0, 0xb8bcc4, 0x9aa0a8])));
          for (let gx = ax + 1; gx < ax + 6; gx += 2) rect(m, gx, below + 1, 1, 3, css(0x3a3a3a));
          const led = pick(rng, [0x2bff6a, 0xff3b3b, 0x3b8bff]);
          paint(m, e, ax + 6, below + 1, 1, 1, css(led), css(led, 1.4));
        }
        if (rng() < spec.plants) {
          // Jardinière fleurie
          rect(m, x + wx, y + wy + wh, ww, 1, css(0x6a3a1a));
          for (let k = 0; k < ww; k++) {
            if (rng() < 0.6) rect(m, x + wx + k, y + wy + wh - 1 - Math.floor(rng() * 2), 1, 1, css(rng() < 0.7 ? pick(rng, LEAVES) : pick(rng, FLOWERS)));
          }
        }
      }
      // Petite enseigne de boutique
      if (rng() < spec.shops) {
        const sc = pick(rng, SIGN_SCHEMES);
        const sx = x + 4;
        const sy = y + 1;
        paint(m, e, sx, sy, 24, 5, css(sc.bg), css(sc.bg, 0.8));
        for (let k = 0; k < 5; k++) paint(m, e, sx + 2 + k * 4, sy + 1, 2, 3, css(sc.fg), css(sc.fg, 1.3));
      }
    }
  }

  // Enseignes néon verticales le long de la façade
  const signs = style === 'glass' ? 0 : 1 + Math.floor(rng() * 2);
  for (let i = 0; i < signs; i++) {
    const sc = pick(rng, SIGN_SCHEMES);
    const sx = Math.floor(rng() * FACADE_CELLS) * CELL + 26;
    const sy = Math.floor(rng() * (FACADE_CELLS - 3)) * CELL + 4;
    const sh = 60 + Math.floor(rng() * 30);
    paint(m, e, sx, sy, 7, sh, css(sc.border), css(sc.border, 1.2));
    paint(m, e, sx + 1, sy + 1, 5, sh - 2, css(sc.bg), css(sc.bg, 0.6));
    for (let gy = sy + 3; gy < sy + sh - 6; gy += 7) {
      for (let k = 0; k < 9; k++) if (rng() < 0.6) paint(m, e, sx + 2 + (k % 3), gy + Math.floor(k / 3), 1, 1, css(sc.fg), css(sc.fg, 1.4));
    }
  }

  return { map: pixelTexture(mc), emissive: pixelTexture(ec) };
}

// -----------------------------------------------------------------------------
// Toits
// -----------------------------------------------------------------------------

export type RoofStyle = 'tar' | 'concrete' | 'green' | 'rust';

const ROOF_BASE: Record<RoofStyle, number> = {
  tar: 0x4a4952,
  concrete: 0x8f897d,
  green: 0x4f7a5a,
  rust: 0x7e4a30,
};

/** Toit en pixel art : dalles, fissures, flaques qui reflètent les néons, marquages, mousse. */
export function createPixelRoof(style: RoofStyle, seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const base = ROOF_BASE[style];
  rect(ctx, 0, 0, S, S, css(base));
  addNoise(ctx, S, S, rng, 16);
  // Joints de dalles
  for (let i = 0; i <= S; i += 32) {
    rect(ctx, i, 0, 1, S, css(base, 0.65));
    rect(ctx, 0, i, S, 1, css(base, 0.65));
  }
  // Plaques de goudron / rouille
  for (let i = 0; i < 6; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 4 + rng() * 10;
    const col = style === 'rust' ? pick(rng, [0x8a4a1a, 0x4a2412]) : jitter(base, rng, 0.3);
    for (let k = 0; k < r * r * 1.5; k++) rect(ctx, x + (rng() - 0.5) * r * 2, y + (rng() - 0.5) * r, 1, 1, css(col, 0.75));
  }
  // Fissures
  for (let i = 0; i < 6; i++) {
    let x = rng() * S;
    let y = rng() * S;
    for (let k = 0; k < 30; k++) {
      rect(ctx, x, y, 1, 1, css(base, 0.45));
      x += Math.round(rng() * 2 - 1);
      y += rng() < 0.7 ? 1 : 0;
    }
  }
  // Gravillons
  for (let i = 0; i < 260; i++) rect(ctx, rng() * S, rng() * S, 1, 1, css(base, 1.35));
  // Mousse
  if (style !== 'rust') {
    for (let i = 0; i < 8; i++) {
      const x = rng() * S;
      const y = rng() * S;
      for (let k = 0; k < 14; k++) rect(ctx, x + rng() * 6, y + rng() * 4, 1, 1, css(pick(rng, [0x3f6f2f, 0x5a8a3a, 0x2f5a2a])));
    }
  }
  // Flaques avec reflets de néons
  for (let i = 0; i < 4; i++) {
    const px = 8 + rng() * (S - 16);
    const py = 8 + rng() * (S - 16);
    const rx = 4 + rng() * 8;
    const ry = 3 + rng() * 5;
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) rect(ctx, px + x, py + y, 1, 1, css(0x0d1220));
      }
    }
    for (let k = 0; k < 5; k++) {
      const col = pick(rng, [0xff4fa3, 0xffc857, 0x2bd9c5, 0x9dff5c, 0xff9a3c, 0xa36bff]);
      rect(ctx, px + (rng() - 0.5) * rx, py + (rng() - 0.5) * ry, 2, 1, css(col));
    }
  }
  // Marquages peints
  if (style === 'tar' || style === 'concrete') {
    const y = 60 + Math.floor(rng() * 8);
    const col = rng() < 0.5 ? 0xd8b02a : 0xd8d8d0;
    for (let x = 2; x < S; x += 12) rect(ctx, x, y, 7, 2, css(col));
    // Grille d'évacuation
    const gx = 10 + Math.floor(rng() * 100);
    const gy = 10 + Math.floor(rng() * 100);
    rect(ctx, gx, gy, 6, 6, css(0x1a1a1e));
    for (let k = 1; k < 6; k += 2) rect(ctx, gx + k, gy + 1, 1, 4, css(0x5a5a60));
  }
  // Tag de graffiti
  if (rng() < 0.7) {
    const col = pick(rng, [0xff4fa3, 0x9dff5c, 0xff9a3c, 0x2bd9c5, 0xffd23b]);
    let x = rng() * (S - 30);
    let y = rng() * (S - 10);
    for (let k = 0; k < 40; k++) {
      rect(ctx, x, y, 1, 1, css(col));
      x += 1;
      y += Math.round(Math.sin(k * 0.9) * 1.4);
    }
  }
  return pixelTexture(c);
}

// -----------------------------------------------------------------------------
// Enseignes et affiches
// -----------------------------------------------------------------------------

/** Enseigne lumineuse en police pixel (horizontale ou verticale). */
export function createPixelSign(text: string, scheme: { bg: number; fg: number; border: number }, vertical: boolean): { texture: THREE.CanvasTexture; aspect: number } {
  const t = normalize(text);
  let w: number;
  let h: number;
  if (vertical) {
    w = 9;
    h = t.length * 7 + 4;
  } else {
    w = pixelTextWidth(t) + 8;
    h = 11;
  }
  const [c, ctx] = makeCanvas(w, h);
  rect(ctx, 0, 0, w, h, css(scheme.border));
  rect(ctx, 1, 1, w - 2, h - 2, css(scheme.bg));
  if (vertical) {
    for (let i = 0; i < t.length; i++) drawPixelText(ctx, t[i], 3, 3 + i * 7, css(scheme.fg));
  } else {
    drawPixelText(ctx, t, 4, 3, css(scheme.fg));
    rect(ctx, 2, 2, 1, 1, css(scheme.border));
    rect(ctx, w - 3, h - 3, 1, 1, css(scheme.border));
  }
  return { texture: pixelTexture(c, false), aspect: w / h };
}

export type BillboardKind = 'ramen' | 'cola' | 'cat' | 'koi' | 'pharmacy' | 'arcade' | 'kalliope' | 'vertigo' | 'glide';

function gradientRows(ctx: Ctx, w: number, h: number, colors: number[]): void {
  for (let y = 0; y < h; y++) {
    const t = (y / (h - 1)) * (colors.length - 1);
    const i = Math.min(colors.length - 2, Math.floor(t));
    rect(ctx, 0, y, w, 1, css(mixHex(colors[i], colors[i + 1], t - i)));
  }
}

/**
 * Affiche publicitaire en pixel art. Les illustrations sont dessinées dans un cadre
 * de 64 × 32 centré ; une largeur supérieure prolonge le fond.
 */
export function createPixelBillboard(kind: BillboardKind, width = 64, seed = 1): THREE.CanvasTexture {
  const rng = createRng(seed);
  const W = width;
  const H = 32;
  const [c, ctx] = makeCanvas(W, H);
  const ox = Math.floor((W - 64) / 2);
  const center = (text: string, y: number, color: string, scale = 1) => drawPixelText(ctx, text, Math.floor((W - pixelTextWidth(text, scale)) / 2), y, color, scale);

  switch (kind) {
    case 'ramen': {
      gradientRows(ctx, W, H, [0x5a0a0a, 0xa02a12, 0xd8701f]);
      // Vapeur
      for (let k = 0; k < 3; k++) for (let y = 4; y < 14; y++) rect(ctx, ox + 40 + k * 5 + Math.round(Math.sin(y * 0.8 + k) * 1.5), y, 1, 1, 'rgba(255,255,255,0.7)');
      // Bol
      for (let y = 0; y < 9; y++) {
        const half = Math.round(13 - y * y * 0.12);
        rect(ctx, ox + 46 - half, 17 + y, half * 2, 1, css(y === 2 ? 0xd82a2a : 0xf2ead8));
      }
      for (let x = -11; x < 11; x += 2) rect(ctx, ox + 46 + x, 16 + Math.round(Math.sin(x) * 0.6), 2, 1, css(0xffd23b));
      rect(ctx, ox + 52, 8, 1, 9, css(0x8a5a2a));
      rect(ctx, ox + 55, 9, 1, 8, css(0x8a5a2a));
      drawPixelText(ctx, 'RAMEN', ox + 4, 6, css(0xffd23b), 2);
      drawPixelText(ctx, 'OUVERT 24H', ox + 4, 22, css(0xfff1d6));
      break;
    }
    case 'cola': {
      rect(ctx, 0, 0, W, H, css(0xc81e1e));
      for (let x = 0; x < W; x++) rect(ctx, x, 20 + Math.round(Math.sin(x * 0.15) * 2), 1, 3, css(0xfff1d6));
      // Bouteille
      rect(ctx, ox + 48, 4, 4, 4, css(0x3a1a10));
      rect(ctx, ox + 46, 8, 8, 20, css(0x3a1a10));
      rect(ctx, ox + 46, 14, 8, 5, css(0xfff1d6));
      rect(ctx, ox + 47, 9, 1, 4, 'rgba(255,255,255,0.5)');
      drawPixelText(ctx, 'NEO', ox + 4, 4, css(0xfff1d6), 2);
      drawPixelText(ctx, 'COLA', ox + 4, 14, css(0xfff1d6), 1);
      drawPixelText(ctx, 'ICE COLD', ox + 4, 26, css(0x3a1a10));
      break;
    }
    case 'cat': {
      rect(ctx, 0, 0, W, H, css(0x1f7f8f));
      for (let k = 0; k < 20; k++) rect(ctx, rng() * W, rng() * H, 1, 1, css(0x9fe8f0));
      const cx = ox + 44;
      // Oreilles + tête
      for (let i = 0; i < 4; i++) {
        rect(ctx, cx - 9, 5 + i, i + 1, 1, css(0xf28a3a));
        rect(ctx, cx + 9 - (i + 1), 5 + i, i + 1, 1, css(0xf28a3a));
      }
      rect(ctx, cx - 9, 9, 18, 13, css(0xf28a3a));
      rect(ctx, cx - 6, 12, 3, 3, css(0x9dff5c));
      rect(ctx, cx + 3, 12, 3, 3, css(0x9dff5c));
      rect(ctx, cx - 5, 13, 1, 2, css(0x101010));
      rect(ctx, cx + 4, 13, 1, 2, css(0x101010));
      rect(ctx, cx - 1, 16, 2, 1, css(0xff7ab8));
      for (const s of [-1, 1]) {
        rect(ctx, cx + s * 10 - (s < 0 ? 4 : 0), 16, 5, 1, css(0xfff1d6));
        rect(ctx, cx + s * 10 - (s < 0 ? 4 : 0), 18, 5, 1, css(0xfff1d6));
      }
      rect(ctx, cx - 9, 22, 18, 6, css(0xd8701f));
      drawPixelText(ctx, 'NEKO', ox + 4, 6, css(0xfff1d6), 2);
      drawPixelText(ctx, 'CAFE', ox + 6, 20, css(0xffd23b));
      break;
    }
    case 'koi': {
      gradientRows(ctx, W, H, [0x0a1a4a, 0x0d3a7a, 0x0a1a4a]);
      for (let y = 4; y < H; y += 6) for (let x = 0; x < W; x++) if ((x + y) % 9 < 3) rect(ctx, x, y + Math.round(Math.sin(x * 0.3) * 1), 1, 1, css(0x4a8ad8));
      // Carpe koï
      for (let x = 0; x < 20; x++) {
        const hh = Math.round(4 * Math.sin((x / 20) * Math.PI)) + 1;
        rect(ctx, ox + 32 + x, 16 - hh, 1, hh * 2, css(x % 7 < 3 ? 0xf28a3a : 0xf2f2f2));
      }
      for (let i = 0; i < 5; i++) rect(ctx, ox + 28 + i, 13 + i, 4 - Math.floor(i / 2), 1, css(0xf2f2f2));
      for (let i = 0; i < 5; i++) rect(ctx, ox + 28 + i, 19 - i, 4 - Math.floor(i / 2), 1, css(0xf2f2f2));
      rect(ctx, ox + 49, 14, 1, 1, css(0x101010));
      drawPixelText(ctx, 'KOI', ox + 4, 5, css(0xf28a3a), 2);
      drawPixelText(ctx, 'SUSHI BAR', ox + 4, 24, css(0xfff1d6));
      break;
    }
    case 'pharmacy': {
      rect(ctx, 0, 0, W, H, css(0x0a1a10));
      rect(ctx, ox + 44, 6, 6, 20, css(0x2bff6a));
      rect(ctx, ox + 37, 13, 20, 6, css(0x2bff6a));
      rect(ctx, ox + 45, 7, 4, 18, css(0x9dffb8));
      drawPixelText(ctx, 'PHARMA', ox + 4, 8, css(0xe8ffe8));
      drawPixelText(ctx, '24/7', ox + 4, 18, css(0x2bff6a), 2);
      break;
    }
    case 'arcade': {
      gradientRows(ctx, W, H, [0x1a0a3a, 0x4a1a7a]);
      for (let k = 0; k < 30; k++) rect(ctx, rng() * W, rng() * H, 1, 1, css(pick(rng, [0xffd23b, 0xff4fa3, 0x7fd8ff])));
      // Joystick + pièce
      rect(ctx, ox + 40, 22, 14, 5, css(0x101018));
      rect(ctx, ox + 46, 12, 2, 10, css(0xb8b8c0));
      rect(ctx, ox + 44, 8, 6, 5, css(0xff3b3b));
      rect(ctx, ox + 45, 9, 2, 1, css(0xffb8b8));
      rect(ctx, ox + 56, 12, 5, 5, css(0xffd23b));
      rect(ctx, ox + 58, 13, 1, 3, css(0xb88a10));
      drawPixelText(ctx, 'ARCADE', ox + 4, 6, css(0xff4fa3), 1);
      drawPixelText(ctx, 'PLAY', ox + 4, 14, css(0xffd23b), 2);
      break;
    }
    case 'kalliope': {
      gradientRows(ctx, W, H, [0x3a1a7a, 0x1f7f8f]);
      // Micro
      rect(ctx, ox + 46, 5, 8, 12, css(0xd8d8e0));
      for (let y = 6; y < 16; y += 2) rect(ctx, ox + 47, y, 6, 1, css(0x8a8a9a));
      rect(ctx, ox + 44, 15, 1, 5, css(0xd8d8e0));
      rect(ctx, ox + 55, 15, 1, 5, css(0xd8d8e0));
      rect(ctx, ox + 44, 20, 12, 1, css(0xd8d8e0));
      rect(ctx, ox + 49, 21, 2, 5, css(0xd8d8e0));
      rect(ctx, ox + 45, 26, 10, 1, css(0xd8d8e0));
      drawPixelText(ctx, 'KALLIOPE', ox + 4, 8, css(0xfff1d6));
      drawPixelText(ctx, 'TA VOIX', ox + 4, 18, css(0x9dff5c));
      break;
    }
    case 'vertigo': {
      gradientRows(ctx, W, H, [0xffd23b, 0xff8a2b, 0xff4fa3, 0x4a1a7a]);
      rect(ctx, ox + 26, 6, 12, 12, css(0xfff1d6));
      for (let y = 8; y < 18; y += 3) rect(ctx, ox + 24, y, 16, 1, css(0xff8a2b));
      let x = 0;
      while (x < W) {
        const bw = 3 + Math.floor(rng() * 6);
        const bh = 6 + Math.floor(rng() * 14);
        rect(ctx, x, H - bh, bw, bh, css(0x1a0a2a));
        for (let k = 0; k < bh / 3; k++) if (rng() < 0.4) rect(ctx, x + 1 + Math.floor(rng() * (bw - 1)), H - bh + 2 + k * 3, 1, 1, css(0xffd23b));
        x += bw + 1;
      }
      center('NEON VERTIGO', 2, css(0x1a0a2a));
      break;
    }
    case 'glide': {
      rect(ctx, 0, 0, W, H, css(0x1a1205));
      for (let x = -H; x < W; x += 8) for (let y = 0; y < 5; y++) {
        rect(ctx, x + y, y, 4, 1, css(0xffb030));
        rect(ctx, x + y, H - 1 - y, 4, 1, css(0xffb030));
      }
      center('GLISSE', 9, css(0xffd23b), 2);
      for (let i = 0; i < 4; i++) {
        const ax = Math.floor(W * (0.12 + i * 0.25));
        for (let k = 0; k < 4; k++) rect(ctx, ax - 3 + k, 21 + k, 7 - k * 2, 1, css(0xff6a2b));
      }
      break;
    }
  }
  return pixelTexture(c, false);
}
