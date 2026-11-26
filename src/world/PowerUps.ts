import * as THREE from 'three';
import type { LevelBuilder } from './LevelBuilder';
import { pixelTexture } from './PixelTextures';
import { LIGHTING } from '../config';

/**
 * Bonus ramassables dans les niveaux :
 * - OVERDRIVE : vitesse +35 % et dashs illimités pendant 8 s ;
 * - BOUCLIER : absorbe le prochain tir ;
 * - SURCHARGE : attaques chargées instantanées, sans recharge, pendant 10 s ;
 * - CHRONO : Sandevistan plein et 3 s retirées au chrono.
 */
export type PowerKind = 'overdrive' | 'shield' | 'surge' | 'chrono';

export const POWER_INFO: Record<PowerKind, { name: string; color: number; css: string; duration: number }> = {
  overdrive: { name: 'OVERDRIVE', color: 0x00e5ff, css: '#00e5ff', duration: 8 },
  shield: { name: 'BOUCLIER', color: 0x2bffb0, css: '#2bffb0', duration: 0 },
  surge: { name: 'SURCHARGE', color: 0xff2bd6, css: '#ff2bd6', duration: 10 },
  chrono: { name: 'CHRONO', color: 0xffd23b, css: '#ffd23b', duration: 0 },
};

/** [type, x, y (toit), z, réapparition en s (0 = une fois par course)] */
export type PowerUpDef = [PowerKind, number, number, number, number?];

interface Pickup {
  kind: PowerKind;
  group: THREE.Group;
  core: THREE.Mesh;
  base: THREE.Vector3;
  respawn: number;
  /** Temps avant réapparition (< 0 : disponible). */
  cooldown: number;
}

const ICONS: Record<PowerKind, string[]> = {
  overdrive: ['...XX...', '..XX....', '.XX.....', 'XXXXXX..', '...XX...', '..XX....', '.XX.....', 'XX......'],
  shield: ['XXXXXXXX', 'X......X', 'X..XX..X', 'X.XXXX.X', 'X..XX..X', '.X....X.', '..X..X..', '...XX...'],
  surge: ['...XX...', '.X.XX.X.', '..XXXX..', 'XXXXXXXX', 'XXXXXXXX', '..XXXX..', '.X.XX.X.', '...XX...'],
  chrono: ['XXXXXXXX', '.X....X.', '..X..X..', '...XX...', '...XX...', '..X..X..', '.XXXXXX.', 'XXXXXXXX'],
};

function iconCanvas(kind: PowerKind): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 12;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(5, 5, 12, 0.85)';
  ctx.fillRect(1, 1, 10, 10);
  ctx.fillStyle = POWER_INFO[kind].css;
  ICONS[kind].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'X') ctx.fillRect(x + 2, y + 2, 1, 1);
  });
  return c;
}

export class PowerUpField {
  private readonly items: Pickup[] = [];
  private time = 0;

  /** Construit les bonus du niveau (appelé pendant LevelBuilder.loadLevel). */
  build(b: LevelBuilder, defs: readonly PowerUpDef[]): void {
    this.items.length = 0;
    for (const [kind, x, y, z, respawn] of defs) {
      const info = POWER_INFO[kind];
      const group = new THREE.Group();
      const shellMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(info.color).multiplyScalar(1.6 * LIGHTING.neon + 0.4),
        transparent: true,
        opacity: 0.5,
        wireframe: true,
        toneMapped: false,
      });
      const texture = pixelTexture(iconCanvas(kind), false);
      const iconMat = new THREE.SpriteMaterial({ map: texture, color: new THREE.Color(1, 1, 1).multiplyScalar(1.6 * LIGHTING.signs + 0.3), transparent: true });
      const haloMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(info.color).multiplyScalar(1.2),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      b.courseDisposables.push(shellMat, iconMat, texture, haloMat);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), shellMat);
      const icon = new THREE.Sprite(iconMat);
      icon.scale.set(0.62, 0.62, 1);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 24), haloMat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -1.15;
      group.add(core, icon, halo);
      group.position.set(x, y + 1.25, z);
      b.course.add(group);
      b.reserve(x, z, 1.6);
      this.items.push({ kind, group, core, base: new THREE.Vector3(x, y + 1.25, z), respawn: respawn ?? 0, cooldown: -1 });
    }
  }

  /** Nouvelle course : tous les bonus réapparaissent. */
  reset(): void {
    for (const it of this.items) {
      it.cooldown = -1;
      it.group.visible = true;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const it of this.items) {
      if (it.cooldown >= 0) {
        if (it.respawn <= 0) continue;
        it.cooldown -= dt;
        if (it.cooldown < 0) it.group.visible = true;
        continue;
      }
      it.group.position.y = it.base.y + Math.sin(this.time * 2.4 + it.base.x) * 0.12;
      it.core.rotation.y += dt * 1.8;
      it.core.rotation.x = Math.sin(this.time * 1.3) * 0.3;
    }
  }

  /** Bonus ramassé à cette frame par le joueur (centre de la capsule). */
  collect(center: THREE.Vector3): { kind: PowerKind; position: THREE.Vector3 } | null {
    for (const it of this.items) {
      if (it.cooldown >= 0) continue;
      if (it.group.position.distanceTo(center) < 1.6) {
        it.cooldown = it.respawn > 0 ? it.respawn : 0;
        it.group.visible = false;
        return { kind: it.kind, position: it.group.position.clone() };
      }
    }
    return null;
  }
}
