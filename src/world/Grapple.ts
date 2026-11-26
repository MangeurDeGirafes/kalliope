import * as THREE from 'three';
import type { LevelBuilder } from './LevelBuilder';
import type { Physics } from '../core/Physics';
import type { Enemy } from '../enemies/EnemyManager';
import { Beam } from '../effects/Beam';
import { GRAPPLE, LIGHTING } from '../config';
import { STATS } from '../progress/Progress';
import type { AnchorDef } from './levels';

/** Cible du grappin : une ancre magnétique ou un ennemi (point mobile). */
export interface GrappleTarget {
  point: THREE.Vector3;
  enemy: Enemy | null;
  anchor: number;
  /** Élan horizontal conservé à l'arrivée (m/s). */
  carry: number;
}

interface Anchor {
  group: THREE.Group;
  ringA: THREE.Mesh;
  ringB: THREE.Mesh;
  core: THREE.Mesh;
  position: THREE.Vector3;
  carry: number;
}

const CYAN = new THREE.Color(0x2bffd0);
const HOT = new THREE.Color(0xffd23b);

/**
 * Grappin : ancres flottantes (anneaux magnétiques posés dans le décor),
 * recherche de la cible la mieux centrée dans le viseur, et câble lumineux
 * tendu entre la main et le point d'accroche.
 */
export class GrappleSystem {
  private readonly anchors: Anchor[] = [];
  private readonly rope: Beam;
  private readonly ropeGlow: Beam;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private hotMat: THREE.MeshBasicMaterial | null = null;
  private time = 0;
  private highlighted = -1;
  /** Déploiement du câble (0 → 1) pour l'effet de lancer. */
  private extend = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpTo = new THREE.Vector3();
  private readonly candidates: { point: THREE.Vector3; enemy: Enemy | null; anchor: number; score: number; dist: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.rope = new Beam(0xbffff4, 3.5);
    this.ropeGlow = new Beam(0x2bffd0, 1.2);
    this.ropeGlow.setOpacity(0.35);
    scene.add(this.rope.mesh, this.ropeGlow.mesh);
  }

  get anchorCount(): number {
    return this.anchors.length;
  }

  /** Construit les ancres du niveau (appelé pendant LevelBuilder.loadLevel). */
  build(b: LevelBuilder, defs: readonly AnchorDef[]): void {
    this.anchors.length = 0;
    this.highlighted = -1;
    if (defs.length === 0) return;
    const ringMat = new THREE.MeshBasicMaterial({
      color: CYAN.clone().multiplyScalar(1.4 * LIGHTING.neon + 0.4),
      toneMapped: false,
    });
    const hotMat = new THREE.MeshBasicMaterial({ color: HOT.clone().multiplyScalar(2.2), toneMapped: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(1.8), toneMapped: false });
    const haloMat = new THREE.MeshBasicMaterial({
      color: CYAN.clone().multiplyScalar(0.9),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x1a1d28, metalness: 0.7, roughness: 0.4 });
    b.courseDisposables.push(ringMat, hotMat, coreMat, haloMat, pylonMat);
    this.ringMat = ringMat;
    this.hotMat = hotMat;
    for (const [x, y, z, carry] of defs) {
      const group = new THREE.Group();
      const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 6, 28), ringMat);
      const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.035, 4, 32), ringMat);
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), coreMat);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8), haloMat);
      // Petites griffes magnétiques autour du cœur
      for (let k = 0; k < 3; k++) {
        const claw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), pylonMat);
        const a = (k / 3) * Math.PI * 2;
        claw.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
        claw.rotation.z = a + Math.PI / 2;
        ringA.add(claw);
      }
      group.add(ringA, ringB, core, halo);
      group.position.set(x, y, z);
      b.course.add(group);
      this.anchors.push({ group, ringA, ringB, core, position: new THREE.Vector3(x, y, z), carry: carry ?? 17 });
    }
  }

  /**
   * Cible la mieux centrée dans le cône de visée, à portée et en vue directe.
   * `cone` : demi-angle en degrés.
   */
  findTarget(eye: THREE.Vector3, forward: THREE.Vector3, enemies: readonly Enemy[], physics: Physics, coneDeg: number): GrappleTarget | null {
    const cosCone = Math.cos(THREE.MathUtils.degToRad(coneDeg));
    const list = this.candidates;
    list.length = 0;
    const consider = (point: THREE.Vector3, range: number, enemy: Enemy | null, anchor: number) => {
      const to = this.tmp.subVectors(point, eye);
      const dist = to.length();
      if (dist < GRAPPLE.minDistance || dist > range) return;
      const c = to.dot(forward) / dist;
      if (c < cosCone) return;
      // Le mieux centré l'emporte ; à angle égal, le plus proche, et les ancres
      // passent légèrement devant les ennemis (un drone sur la trajectoire ne vole pas la cible)
      list.push({ point, enemy, anchor, score: c - dist * 0.0015 - (enemy ? 0.006 : 0), dist });
    };
    this.anchors.forEach((a, i) => consider(a.position, STATS.grappleRange, null, i));
    for (const e of enemies) if (e.alive) consider(e.center, STATS.grappleEnemyRange, e, -1);
    if (list.length === 0) return null;
    list.sort((a, b) => b.score - a.score);
    for (const c of list) {
      const dir = this.tmpTo.subVectors(c.point, eye).divideScalar(c.dist);
      const hit = physics.raycast(eye, dir, Math.max(0.1, c.dist - 0.8));
      if (hit) continue;
      return { point: c.point, enemy: c.enemy, anchor: c.anchor, carry: c.anchor >= 0 ? this.anchors[c.anchor].carry : 17 };
    }
    return null;
  }

  /**
   * Animation des ancres et du câble. `from`/`to` nuls : câble rentré.
   * `target` : ancre visée (surlignée).
   */
  update(dt: number, target: GrappleTarget | null, from: THREE.Vector3 | null, to: THREE.Vector3 | null): void {
    this.time += dt;
    const hot = target && target.anchor >= 0 ? target.anchor : -1;
    if (hot !== this.highlighted) {
      if (this.highlighted >= 0 && this.anchors[this.highlighted] && this.ringMat) {
        const a = this.anchors[this.highlighted];
        a.ringA.material = this.ringMat;
        a.ringB.material = this.ringMat;
      }
      if (hot >= 0 && this.hotMat) {
        const a = this.anchors[hot];
        a.ringA.material = this.hotMat;
        a.ringB.material = this.hotMat;
      }
      this.highlighted = hot;
    }
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      a.ringA.rotation.y = this.time * 1.2 + i;
      a.ringA.rotation.x = Math.sin(this.time * 0.7 + i) * 0.4;
      a.ringB.rotation.x = this.time * 0.9 + i * 2;
      a.ringB.rotation.z = Math.PI / 2;
      a.core.rotation.y = -this.time * 2;
      a.core.rotation.x = this.time * 1.3;
      const s = i === this.highlighted ? 1.15 + Math.sin(this.time * 14) * 0.06 : 1;
      a.group.scale.setScalar(s);
      a.group.position.y = a.position.y + Math.sin(this.time * 1.6 + i * 1.7) * 0.08;
    }

    if (!from || !to) {
      this.extend = 0;
      this.rope.mesh.visible = false;
      this.ropeGlow.mesh.visible = false;
      return;
    }
    this.extend = Math.min(1, this.extend + dt / 0.08);
    const end = this.tmp.copy(from).lerp(to, this.extend);
    this.rope.set(from, end, 0.018);
    this.ropeGlow.set(from, end, 0.07);
    this.rope.setIntensity(0.85 + Math.sin(this.time * 60) * 0.15);
  }
}
