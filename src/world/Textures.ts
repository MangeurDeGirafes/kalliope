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

/** Fenêtres d'immeubles (utilisée comme emissiveMap). 16 colonnes × 32 étages. */
export function createWindowTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const cols = 16;
  const rows = 32;
  const cell = 32;
  const [c, ctx] = canvas(cols * cell, rows * cell);
  ctx.fillStyle = '#020204';
  ctx.fillRect(0, 0, c.width, c.height);
  const palette = ['#ffcf8a', '#ffd9a8', '#a8dcff', '#5ff3ff', '#ff6be8', '#fff4e0', '#b48cff'];
  for (let r = 0; r < rows; r++) {
    const floorLit = rng() < 0.75;
    const floorColor = palette[Math.floor(rng() * palette.length)];
    for (let col = 0; col < cols; col++) {
      const x = col * cell;
      const y = r * cell;
      // Cadre de fenêtre sombre
      ctx.fillStyle = '#07080d';
      ctx.fillRect(x + 4, y + 6, cell - 8, cell - 10);
      if (floorLit && rng() < 0.34) {
        ctx.globalAlpha = 0.35 + rng() * 0.65;
        ctx.fillStyle = rng() < 0.7 ? floorColor : palette[Math.floor(rng() * palette.length)];
        ctx.fillRect(x + 5, y + 7, cell - 10, cell - 12);
        // Store / silhouette
        if (rng() < 0.3) {
          ctx.fillStyle = '#000';
          ctx.globalAlpha = 0.5;
          ctx.fillRect(x + 5, y + 7, cell - 10, (cell - 12) * rng());
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  // Quelques bandes néon verticales
  for (let i = 0; i < 3; i++) {
    if (rng() < 0.5) continue;
    const x = Math.floor(rng() * cols) * cell + cell / 2;
    ctx.fillStyle = rng() < 0.5 ? '#ff2bd6' : '#00e5ff';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - 2, 0, 4, c.height);
    ctx.globalAlpha = 1;
  }
  return finish(c);
}

/** Béton mouillé du toit (map). */
export function createRoofTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const size = 512;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#4a4a55';
  ctx.fillRect(0, 0, size, size);
  // Bruit
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * 40;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n + 4;
  }
  ctx.putImageData(img, 0, 0);
  // Flaques sombres
  for (let i = 0; i < 14; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 20 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(10,10,20,0.75)');
    g.addColorStop(1, 'rgba(10,10,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Joints de dalles
  ctx.strokeStyle = 'rgba(15,15,22,0.8)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i * size) / 4);
    ctx.lineTo(size, (i * size) / 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo((i * size) / 4, 0);
    ctx.lineTo((i * size) / 4, size);
    ctx.stroke();
  }
  return finish(c);
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

/** Affiche publicitaire lumineuse. */
export function createAdTexture(title: string, subtitle: string, colorA: string, colorB: string, seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const [c, ctx] = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 1024, 512);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);
  ctx.fillStyle = '#050208';
  ctx.fillRect(0, 0, 1024, 512);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  ctx.globalAlpha = 1;
  // Motif de lignes
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let y = 0; y < 512; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }
  // Formes géométriques
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = rng() < 0.5 ? 'rgba(0,229,255,0.5)' : 'rgba(255,43,214,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(rng() * 1024, rng() * 512, 30 + rng() * 120, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 25;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 150px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(title, 512, 220);
  ctx.shadowBlur = 12;
  ctx.font = '600 54px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(subtitle, 512, 360);
  return finish(c, false);
}

/** Enseigne néon (texte lumineux sur fond sombre). */
export function createSignTexture(text: string, color: string, vertical: boolean): THREE.CanvasTexture {
  const w = vertical ? 128 : 512;
  const h = vertical ? 512 : 128;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#06030a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 72px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  if (vertical) {
    const chars = [...text];
    const step = (h - 60) / Math.max(1, chars.length);
    chars.forEach((ch, i) => {
      ctx.shadowBlur = 20;
      ctx.fillStyle = color;
      ctx.fillText(ch, w / 2, 30 + step * (i + 0.5));
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(ch, w / 2, 30 + step * (i + 0.5));
    });
  } else {
    ctx.shadowBlur = 20;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 4);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }
  return finish(c, false);
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
