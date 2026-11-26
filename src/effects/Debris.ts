import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import { LIGHTING } from '../config';

interface Piece {
  readonly mesh: THREE.InstancedMesh;
  readonly index: number;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly spin: THREE.Vector3;
  readonly size: THREE.Vector3;
  floor: number;
  life: number;
  maxLife: number;
}

const ARMOR_COUNT = 140;
const GLOW_COUNT = 50;
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Débris d'armure : à chaque élimination, des éclats métalliques (et quelques
 * éclats lumineux à la couleur de l'ennemi) giclent, rebondissent sur le toit
 * puis rétrécissent. Deux InstancedMesh, deux appels de rendu en tout.
 */
export class Debris {
  private readonly armor: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly pieces: Piece[] = [];
  private readonly free: { armor: number[]; glow: number[] } = { armor: [], glow: [] };
  private readonly physics: Physics;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene, physics: Physics) {
    this.physics = physics;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.armor = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.8, roughness: 0.35 }), ARMOR_COUNT);
    this.glow = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), GLOW_COUNT);
    for (const mesh of [this.armor, this.glow]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.zero);
      scene.add(mesh);
    }
    for (let i = 0; i < GLOW_COUNT; i++) this.glow.setColorAt(i, this.color.set(0xffffff));
    for (let i = ARMOR_COUNT - 1; i >= 0; i--) this.free.armor.push(i);
    for (let i = GLOW_COUNT - 1; i >= 0; i--) this.free.glow.push(i);
  }

  /** Éclats autour de `pos`, projetés surtout dans le sens du coup `dir`. */
  spawn(pos: THREE.Vector3, dir: THREE.Vector3 | null, accent: number, count = 10): void {
    const hit = this.physics.raycast(pos, DOWN, 30);
    const floor = hit ? hit.point.y : pos.y - 60;
    const glowCount = Math.max(2, Math.round(count * 0.35));
    for (let k = 0; k < count + glowCount; k++) {
      const isGlow = k >= count;
      const pool = isGlow ? this.free.glow : this.free.armor;
      // Pool plein : on recycle le plus ancien éclat de ce type
      let index = pool.pop();
      if (index === undefined) {
        const oldest = this.pieces.findIndex((p) => p.mesh === (isGlow ? this.glow : this.armor));
        if (oldest < 0) continue;
        index = this.pieces[oldest].index;
        this.pieces.splice(oldest, 1);
      }
      const mesh = isGlow ? this.glow : this.armor;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize();
      if (dir) v.addScaledVector(dir, 0.9).normalize();
      v.multiplyScalar(4 + Math.random() * 7);
      const sz = isGlow ? 0.05 + Math.random() * 0.06 : 0.08 + Math.random() * 0.16;
      const life = 1.8 + Math.random() * 1.4;
      this.pieces.push({
        mesh,
        index,
        position: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.5)),
        velocity: v,
        rotation: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
        size: new THREE.Vector3(sz * (0.6 + Math.random()), sz * (0.4 + Math.random() * 0.6), sz * (0.6 + Math.random())),
        floor,
        life,
        maxLife: life,
      });
      if (isGlow) {
        this.glow.setColorAt(index, this.color.set(accent).multiplyScalar(3 * LIGHTING.enemyGlow));
        if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
      }
    }
  }

  update(dt: number): void {
    if (this.pieces.length === 0) return;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.setMatrixAt(p.index, this.zero);
        (p.mesh === this.glow ? this.free.glow : this.free.armor).push(p.index);
        this.pieces.splice(i, 1);
        continue;
      }
      p.velocity.y -= 22 * dt;
      p.position.addScaledVector(p.velocity, dt);
      const bottom = p.floor + p.size.y * 0.5;
      if (p.position.y < bottom) {
        p.position.y = bottom;
        if (p.velocity.y < -1.5) {
          p.velocity.y *= -0.32;
          p.velocity.x *= 0.6;
          p.velocity.z *= 0.6;
          p.spin.multiplyScalar(0.5);
        } else {
          p.velocity.set(p.velocity.x * 0.9, 0, p.velocity.z * 0.9);
          p.spin.multiplyScalar(0.9);
        }
      }
      p.rotation.x += p.spin.x * dt;
      p.rotation.y += p.spin.y * dt;
      p.rotation.z += p.spin.z * dt;
      const shrink = Math.min(1, p.life / 0.45);
      this.q.setFromEuler(p.rotation);
      this.s.copy(p.size).multiplyScalar(shrink);
      this.m.compose(p.position, this.q, this.s);
      p.mesh.setMatrixAt(p.index, this.m);
    }
    this.armor.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.pieces) {
      p.mesh.setMatrixAt(p.index, this.zero);
      (p.mesh === this.glow ? this.free.glow : this.free.armor).push(p.index);
    }
    this.pieces.length = 0;
    this.armor.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
  }
}
