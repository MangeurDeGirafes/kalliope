import * as THREE from 'three';
import type { LevelBuilder } from './LevelBuilder';

/**
 * Grands repères visibles de loin, posés par les niveaux (mât d'antenne…).
 * Tout passe par les lots du LevelBuilder (fusionnés, nettoyés au changement de niveau).
 */

const STEEL = 0x2a2f3c;
const STEEL_DARK = 0x1a1d26;

/**
 * Mât d'antenne en treillis : quatre montants, croisillons, paraboles, feux
 * d'obstacle rouges et la balise du signal tout en haut. `x, y, z` = pied du mât.
 */
export function buildAntenna(b: LevelBuilder, x: number, y: number, z: number, height: number): void {
  const half = 1.8;
  const step = 4;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    b.prop(0.4, height, 0.4, x + sx * half, y + height / 2, z + sz * half, STEEL);
  }
  // Croisillons alternés sur les quatre faces
  const diag = Math.hypot(half * 2, step);
  const tilt = Math.atan2(half * 2, step);
  for (let h = 0; h + step <= height; h += step) {
    const cy = y + h + step / 2;
    const flip = (h / step) % 2 === 0 ? 1 : -1;
    b.propGeo(new THREE.BoxGeometry(0.16, diag, 0.16), b.matrix(x, cy, z + half, 0, 0, tilt * flip), STEEL_DARK);
    b.propGeo(new THREE.BoxGeometry(0.16, diag, 0.16), b.matrix(x, cy, z - half, 0, 0, -tilt * flip), STEEL_DARK);
    b.propGeo(new THREE.BoxGeometry(0.16, diag, 0.16), b.matrix(x + half, cy, z, Math.PI / 2, 0, tilt * flip), STEEL_DARK);
    b.propGeo(new THREE.BoxGeometry(0.16, diag, 0.16), b.matrix(x - half, cy, z, Math.PI / 2, 0, -tilt * flip), STEEL_DARK);
    b.prop(half * 2 + 0.2, 0.12, 0.12, x, y + h + step, z + half, STEEL);
    b.prop(half * 2 + 0.2, 0.12, 0.12, x, y + h + step, z - half, STEEL);
  }
  // Feux d'obstacle tous les 8 m
  for (let h = 8; h < height; h += 8) {
    for (const s of [-1, 1]) b.glow(0.5, 0.5, 0.5, x + s * (half + 0.3), y + h, z + half + 0.3, 0xff2030, 4);
  }
  // Paraboles
  const dish = new THREE.CylinderGeometry(1.4, 0.3, 0.5, 14, 1, true);
  b.propGeo(dish, b.matrix(x, y + height * 0.55, z + half + 0.8, 0, Math.PI / 2 - 0.3), 0x8a93a8);
  b.propGeo(new THREE.CylinderGeometry(1, 0.2, 0.4, 12, 1, true), b.matrix(x - half - 0.7, y + height * 0.72, z, -Math.PI / 2, Math.PI / 2 - 0.2), 0x8a93a8);
  // Pointe et balise du signal
  b.prop(0.5, 8, 0.5, x, y + height + 4, z, STEEL);
  b.glow(1.4, 1.4, 1.4, x, y + height + 8.6, z, 0xffd23b, 5);
  // Bandeau lumineux le long du mât
  b.glow(0.12, height, 0.12, x, y + height / 2, z + half + 0.25, 0x2bffd0, 2.2);
  b.glow(2.6, 0.12, 0.12, x, y + height + 1, z, 0x2bffd0, 3);
  b.glow(0.12, 0.12, 2.6, x, y + height + 1, z, 0x2bffd0, 3);
  b.addNeonLight(new THREE.Vector3(x, y + height + 8, z), 0xffd23b, 30, 40);
  b.addCollider(new THREE.Vector3(x, y + height / 2, z), new THREE.Vector3(half + 0.1, height / 2, half + 0.1));
}
