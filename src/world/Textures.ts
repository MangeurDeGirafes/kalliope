import * as THREE from 'three';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  return tex;
}

/** Panneaux métalliques sombres (murs de wall-run, structures). */
export function createPanelTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const size = 256;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#22232c';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 64) {
    for (let x = 0; x < size; x += 128) {
      const s = 30 + rng() * 14;
      ctx.fillStyle = `rgb(${s},${s},${s + 8})`;
      ctx.fillRect(x + 2, y + 2, 124, 60);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + 6, y + 6, 4, 4);
      ctx.fillRect(x + 118, y + 6, 4, 4);
    }
  }
  return finish(c);
}

/** Texte holographique sur fond transparent (panneaux tutoriels). */
export function createHoloTexture(lines: string[], color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const w = 1024;
  const lineH = 84;
  const h = 40 + lines.length * lineH;
  const [c, ctx] = canvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(5, 10, 25, 0.35)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 58px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  lines.forEach((line, i) => {
    const y = 20 + lineH * (i + 0.5);
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = color;
    ctx.fillText(line, w / 2, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(line, w / 2, y);
  });
  // Lignes de balayage
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  return { texture: finish(c, false), aspect: w / h };
}

/** Rues lumineuses vues de très haut (plan au fond du gouffre urbain). */
export function createStreetTexture(): THREE.CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#030206';
  ctx.fillRect(0, 0, size, size);
  const rng = createRng(77);
  for (let i = 0; i < 8; i++) {
    const p = (i + 0.5) * (size / 8);
    ctx.fillStyle = i % 2 ? 'rgba(255,170,80,0.55)' : 'rgba(255,60,200,0.4)';
    ctx.fillRect(p - 6, 0, 12, size);
    ctx.fillStyle = i % 2 ? 'rgba(80,200,255,0.4)' : 'rgba(255,200,120,0.5)';
    ctx.fillRect(0, p - 6, size, 12);
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.6)' : 'rgba(255,40,60,0.6)';
    const horizontal = rng() < 0.5;
    const lane = (Math.floor(rng() * 8) + 0.5) * (size / 8);
    const t = rng() * size;
    if (horizontal) ctx.fillRect(t, lane - 3, 4, 2);
    else ctx.fillRect(lane - 3, t, 2, 4);
  }
  return finish(c);
}

/**
 * Remet à l'échelle les UV d'une BoxGeometry pour qu'une texture répétée garde
 * une taille constante en mètres, quelle que soit la taille de la boîte.
 */
export function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, tileU: number, tileV: number, offsetU = 0, offsetV = 0): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // Ordre des faces de BoxGeometry : +x, -x, +y, -y, +z, -z (4 sommets chacune)
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    const [du, dv] = dims[face];
    uv.setXY(i, uv.getX(i) * (du / tileU) + offsetU, uv.getY(i) * (dv / tileV) + offsetV);
  }
  uv.needsUpdate = true;
}
