import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import type { AudioSynthesizer } from '../core/AudioSynthesizer';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { PlayerController } from '../player/PlayerController';
import { Beam } from '../effects/Beam';
import { Debris } from '../effects/Debris';
import { bakeGroup } from '../core/GeometryUtils';
import { ENEMIES, LIGHTING } from '../config';

export type EnemyType = 'guard' | 'drone' | 'shield' | 'sniper' | 'kamikaze';

/** Ennemis au sol à corps humanoïde : gardes, gardes à bouclier, tireurs d'élite. */
export function isHumanoid(type: EnemyType): boolean {
  return type === 'guard' || type === 'shield' || type === 'sniper';
}

export interface EnemySpawn {
  type: EnemyType;
  position: THREE.Vector3;
  yaw?: number;
}

/** `aiming` sert aussi d'armement au drone kamikaze, `rush` à sa charge. */
type EnemyState = 'idle' | 'aiming' | 'cooldown' | 'rush';

export interface Enemy {
  readonly type: EnemyType;
  readonly spawn: EnemySpawn;
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly muzzle: THREE.Object3D;
  readonly visorMaterial: THREE.MeshBasicMaterial;
  readonly laser: Beam;
  readonly rotors: THREE.Object3D[];
  readonly aimPoint: THREE.Vector3;
  /** Centre de la zone de touche (mis à jour chaque frame). */
  readonly center: THREE.Vector3;
  alive: boolean;
  state: EnemyState;
  timer: number;
  losTimer: number;
  hasLineOfSight: boolean;
  lostTime: number;
  yaw: number;
  phase: number;
  time: number;
  /** Points de vie restants. */
  hp: number;
  /** Réaction de touche (secousse + visière blanche). */
  hurtTimer: number;
  /** Vitesse (drone kamikaze en charge). */
  readonly velocity: THREE.Vector3;
  /** Bouclier holographique (garde à bouclier). */
  readonly shieldMat: THREE.MeshBasicMaterial | null;
  shieldFlash: number;
  /** Prochain bip du kamikaze. */
  beepTimer: number;
}

interface Projectile {
  readonly group: THREE.Group;
  readonly coreMaterial: THREE.MeshBasicMaterial;
  readonly glowMaterial: THREE.MeshBasicMaterial;
  readonly velocity: THREE.Vector3;
  owner: Enemy | null;
  /** Cible poursuivie par un projectile renvoyé. */
  homing: Enemy | null;
  /** Cible extérieure (cœur du boss) poursuivie par un projectile renvoyé. */
  homingTarget: ExternalTarget | null;
  active: boolean;
  friendly: boolean;
  life: number;
  /** Dégâts infligés au joueur. */
  damage: number;
}

/** Origine d'une élimination (points de style). */
export type KillCause = 'melee' | 'shot' | 'deflect' | 'charged' | 'wire' | 'slam' | 'grapple' | 'blast';

/**
 * Cible extérieure touchable par toutes les armes (cœurs du boss) : tirs,
 * frappes au corps à corps et projectiles renvoyés.
 */
export interface ExternalTarget {
  readonly center: THREE.Vector3;
  readonly radius: number;
  isActive(): boolean;
  hit(amount: number, dir: THREE.Vector3, cause: KillCause): void;
}

export interface EnemyRayHit {
  enemy: Enemy | null;
  target: ExternalTarget | null;
  distance: number;
  point: THREE.Vector3;
}

const GUARD_RED = new THREE.Color(1, 0.05, 0.12);
const DRONE_MAGENTA = new THREE.Color(1, 0.1, 0.75);
const SNIPER_AMBER = new THREE.Color(1, 0.62, 0.08);
const SHIELD_BLUE = new THREE.Color(0.25, 0.78, 1);
const FRIENDLY_CYAN = new THREE.Color(0.1, 0.9, 1);

/**
 * Gardes cybernétiques et drones : détection, laser de visée (télégraphe), tir de
 * projectiles, mort en un coup avec explosion. Gère aussi les projectiles et leur
 * renvoi par les lames.
 */
export class EnemyManager {
  /** Appelé à chaque élimination. */
  onKill: ((enemy: Enemy, position: THREE.Vector3, cause: KillCause) => void) | null = null;
  /** Coup arrêté par un bouclier. */
  onBlocked: ((enemy: Enemy, position: THREE.Vector3) => void) | null = null;
  /** Explosion d'un drone kamikaze (secousse, flash). */
  onBlast: ((position: THREE.Vector3, hurtPlayer: boolean) => void) | null = null;
  /** Cibles extérieures (boss) enregistrées pour le niveau en cours. */
  readonly targets: ExternalTarget[] = [];

  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly particles: ParticleSystem;
  private readonly audio: AudioSynthesizer;
  private readonly enemies: Enemy[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly debris: Debris;

  private readonly armorMat = new THREE.MeshStandardMaterial({ color: 0x1b1d26, metalness: 0.75, roughness: 0.32 });
  private readonly clothMat = new THREE.MeshStandardMaterial({ color: 0x0b0c12, metalness: 0.1, roughness: 0.85 });
  private readonly accentRedMat = new THREE.MeshStandardMaterial({
    color: 0x220004,
    emissive: 0xff1030,
    emissiveIntensity: 2.2 * LIGHTING.enemyGlow,
    metalness: 0.4,
    roughness: 0.4,
  });
  private readonly accentAmberMat = new THREE.MeshStandardMaterial({
    color: 0x201000,
    emissive: 0xffa020,
    emissiveIntensity: 2.2 * LIGHTING.enemyGlow,
    metalness: 0.4,
    roughness: 0.4,
  });
  private readonly accentBlueMat = new THREE.MeshBasicMaterial({ color: SHIELD_BLUE.clone().multiplyScalar(2.6 * LIGHTING.enemyGlow), toneMapped: false });
  private readonly accentMagentaMat = new THREE.MeshStandardMaterial({
    color: 0x200018,
    emissive: 0xff20c0,
    emissiveIntensity: 2.4 * LIGHTING.enemyGlow,
    metalness: 0.4,
    roughness: 0.4,
  });
  private readonly rotorMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.4, 0.8, 1).multiplyScalar(0.8),
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // Temporaires
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly segA = new THREE.Vector3();
  private readonly segB = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly sphere = new THREE.Sphere();

  constructor(scene: THREE.Scene, physics: Physics, particles: ParticleSystem, audio: AudioSynthesizer) {
    this.scene = scene;
    this.physics = physics;
    this.particles = particles;
    this.audio = audio;
    for (let i = 0; i < 72; i++) this.projectiles.push(this.createProjectile());
    this.debris = new Debris(scene, physics);
  }

  get totalCount(): number {
    return this.enemies.length;
  }

  /** Au moins un ennemi en alerte (visée ou recharge) : sert à l'intensité de la musique. */
  get alert(): boolean {
    for (const e of this.enemies) if (e.alive && e.state !== 'idle') return true;
    return false;
  }

  /** Tous les ennemis du niveau (vivants ou non). */
  get list(): readonly Enemy[] {
    return this.enemies;
  }

  get aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  spawnAll(spawns: EnemySpawn[]): void {
    for (const s of spawns) {
      const enemy = isHumanoid(s.type) ? this.createGuard(s) : this.createDrone(s);
      this.enemies.push(enemy);
      this.scene.add(enemy.root);
      this.scene.add(enemy.laser.mesh);
    }
    this.reset();
  }

  /** Retire tous les ennemis (changement de niveau) et libère leurs ressources. */
  clearAll(): void {
    const shared = new Set<THREE.Material>([this.armorMat, this.clothMat, this.accentRedMat, this.accentMagentaMat, this.accentAmberMat, this.accentBlueMat, this.rotorMat]);
    for (const e of this.enemies) {
      this.scene.remove(e.root);
      this.scene.remove(e.laser.mesh);
      e.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (!shared.has(m)) m.dispose();
      });
      e.laser.material.dispose();
    }
    this.enemies.length = 0;
    for (const p of this.projectiles) this.deactivate(p);
    this.debris.clear();
  }

  reset(): void {
    for (const e of this.enemies) {
      e.alive = true;
      e.hp = e.type === 'kamikaze' ? 1 : ENEMIES.health;
      e.hurtTimer = 0;
      e.root.visible = true;
      e.state = 'idle';
      e.timer = 0;
      e.losTimer = Math.random() * ENEMIES.losCheckInterval;
      e.hasLineOfSight = false;
      e.lostTime = 0;
      e.yaw = e.spawn.yaw ?? 0;
      e.time = 0;
      e.laser.mesh.visible = false;
      e.velocity.set(0, 0, 0);
      e.shieldFlash = 0;
      e.beepTimer = 0;
      if (e.shieldMat) e.shieldMat.opacity = 0.22;
      e.root.position.copy(e.spawn.position);
      e.root.rotation.set(0, e.yaw, 0);
      e.root.updateMatrixWorld(true);
      this.updateCenter(e);
    }
    for (const p of this.projectiles) this.deactivate(p);
    this.debris.clear();
  }

  // ---------------------------------------------------------------------------
  // Requêtes de combat
  // ---------------------------------------------------------------------------

  /**
   * Frappe les ennemis à portée dans le cône de visée (dégâts infinis = mort
   * immédiate). Renvoie le nombre de victimes ; `hits` compte aussi les blessés.
   */
  meleeSweep(
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    range: number,
    cosAngle: number,
    damage = Infinity,
    hits?: { count: number },
    cause: KillCause = 'melee',
  ): number {
    let kills = 0;
    for (const t of this.targets) {
      if (!t.isActive()) continue;
      const toT = this.tmp.subVectors(t.center, origin);
      const dist = toT.length();
      if (dist - t.radius > range) continue;
      const facing = dist < 1e-3 ? 1 : toT.dot(forward) / dist;
      if (facing >= cosAngle || dist < t.radius + 0.9) {
        if (hits) hits.count++;
        t.hit(damage === Infinity ? 1 : damage, forward, cause);
      }
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const radius = this.closestPointOnEnemy(e, origin, this.tmp);
      const toEnemy = this.tmp.sub(origin);
      const dist = toEnemy.length();
      if (dist - radius > range) continue;
      const facing = dist < 1e-3 ? 1 : toEnemy.dot(forward) / dist;
      if (facing >= cosAngle || dist < radius + 0.9) {
        if (hits) hits.count++;
        if (this.damage(e, damage, forward, cause)) kills++;
      }
    }
    return kills;
  }

  /** Cible la plus proche dans un cône étroit (pour l'attaque bondissante). */
  findLungeTarget(origin: THREE.Vector3, forward: THREE.Vector3, range: number, cosAngle: number): THREE.Vector3 | null {
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      this.tmp.subVectors(e.center, origin);
      const dist = this.tmp.length();
      if (dist > range || dist < 0.5) continue;
      if (this.tmp.dot(forward) / dist < cosAngle) continue;
      // Ligne de vue
      const hit = this.physics.raycast(origin, this.tmp.divideScalar(dist), dist);
      if (hit && hit.distance < dist - 0.6) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    return best ? best.center.clone() : null;
  }

  /** Ennemi vivant le plus proche, en ligne de vue, dans la portée donnée. */
  findNearestEnemy(origin: THREE.Vector3, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.center.distanceTo(origin);
      if (dist >= bestDist || dist < 0.01) continue;
      this.tmp.subVectors(e.center, origin).divideScalar(dist);
      const hit = this.physics.raycast(origin, this.tmp, dist);
      if (hit && hit.distance < dist - 0.8) continue;
      best = e;
      bestDist = dist;
    }
    return best;
  }

  /** Raycast contre les zones de touche des ennemis. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number, assistRadius = 0): EnemyRayHit | null {
    this.ray.set(origin, dir);
    let best: EnemyRayHit | null = null;
    for (const t of this.targets) {
      if (!t.isActive()) continue;
      this.sphere.center.copy(t.center);
      this.sphere.radius = t.radius + assistRadius * 0.5;
      const p = this.ray.intersectSphere(this.sphere, this.tmp3);
      if (!p) continue;
      const d = p.distanceTo(origin);
      if (d <= maxDistance && (!best || d < best.distance)) best = { enemy: null, target: t, distance: d, point: p.clone() };
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      for (const s of this.hitSpheres(e)) {
        this.sphere.center.copy(s.center);
        this.sphere.radius = s.radius + assistRadius;
        const p = this.ray.intersectSphere(this.sphere, this.tmp3);
        if (!p) continue;
        const d = p.distanceTo(origin);
        if (d <= maxDistance && (!best || d < best.distance)) {
          best = { enemy: e, target: null, distance: d, point: p.clone() };
        }
      }
    }
    return best;
  }

  /** Renvoie les projectiles proches vers la direction visée. */
  deflectProjectiles(origin: THREE.Vector3, forward: THREE.Vector3, range: number, cosAngle: number): number {
    let count = 0;
    for (const p of this.projectiles) {
      if (!p.active || p.friendly) continue;
      this.tmp.subVectors(p.group.position, origin);
      const dist = this.tmp.length();
      if (dist > range) continue;
      if (dist > 0.6 && this.tmp.dot(forward) / dist < cosAngle) continue;
      const speed = p.velocity.length() * 1.4;
      // Renvoi assisté : si le tireur est à peu près dans l'axe de visée, on le vise.
      const dir = this.tmp2.copy(forward);
      p.homing = null;
      p.homingTarget = null;
      // Projectile du boss : renvoyé vers un cœur visé à peu près
      for (const t of this.targets) {
        if (!t.isActive()) continue;
        const toT = this.tmp3.subVectors(t.center, p.group.position).normalize();
        if (toT.dot(forward) > Math.cos(THREE.MathUtils.degToRad(40))) {
          dir.copy(toT);
          p.homingTarget = t;
          break;
        }
      }
      if (!p.homingTarget && p.owner && p.owner.alive) {
        const toOwner = this.tmp3.subVectors(p.owner.center, p.group.position).normalize();
        if (toOwner.dot(forward) > Math.cos(THREE.MathUtils.degToRad(35))) {
          dir.copy(toOwner);
          p.homing = p.owner;
        }
      }
      p.velocity.copy(dir).multiplyScalar(speed);
      p.friendly = true;
      p.life = ENEMIES.projectileLifetime;
      p.coreMaterial.color.copy(FRIENDLY_CYAN).multiplyScalar(6 * LIGHTING.enemyGlow);
      p.glowMaterial.color.copy(FRIENDLY_CYAN).multiplyScalar(2.5 * LIGHTING.enemyGlow);
      this.particles.sparks(p.group.position, forward, 0x40e0ff, 26);
      count++;
    }
    if (count > 0) this.audio.playDeflect();
    return count;
  }

  /** Inflige des dégâts ; renvoie vrai si l'ennemi meurt. Une touche non mortelle interrompt sa visée. */
  damage(e: Enemy, amount: number, hitDir: THREE.Vector3, cause: KillCause = 'melee'): boolean {
    if (!e.alive) return false;
    if (this.blocks(e, hitDir, cause)) return false;
    e.hp -= amount;
    if (e.hp <= 0) {
      this.kill(e, hitDir, cause);
      return true;
    }
    e.state = 'cooldown';
    e.timer = 0.9;
    e.laser.mesh.visible = false;
    e.hurtTimer = 0.3;
    this.particles.sparks(e.center, this.tmp.copy(hitDir).negate(), 0xff8a2b, 26);
    this.audio.playBladeHit();
    return false;
  }

  /**
   * Bouclier : arrête les coups simples (lames, poings, balles) portés de face.
   * Passent : attaques chargées, séismes, fouet, renvois, grappin, explosions,
   * coups plongeants et tout ce qui vient de côté ou de dos.
   */
  private blocks(e: Enemy, hitDir: THREE.Vector3, cause: KillCause): boolean {
    if (e.type !== 'shield' || (cause !== 'melee' && cause !== 'shot')) return false;
    if (hitDir.y < -0.6) return false;
    const h = Math.hypot(hitDir.x, hitDir.z);
    if (h < 1e-3) return false;
    const facing = -(Math.sin(e.yaw) * hitDir.x + Math.cos(e.yaw) * hitDir.z) / h;
    if (facing < Math.cos(THREE.MathUtils.degToRad(ENEMIES.shield.blockDeg))) return false;
    e.shieldFlash = 0.35;
    const point = this.tmp2.copy(e.root.position).add(this.tmp3.set(Math.sin(e.yaw) * 0.6, 1.15, Math.cos(e.yaw) * 0.6));
    this.particles.sparks(point, this.tmp3.set(Math.sin(e.yaw), 0.2, Math.cos(e.yaw)), 0x40c8ff, 30);
    this.particles.flash(point, SHIELD_BLUE, 0.3, 1.6, 0.12, 3);
    this.audio.playShieldHit();
    this.onBlocked?.(e, point.clone());
    return true;
  }

  kill(e: Enemy, hitDir: THREE.Vector3, cause: KillCause = 'melee'): void {
    if (!e.alive) return;
    e.alive = false;
    e.root.visible = false;
    e.laser.mesh.visible = false;
    const pos = e.center.clone();
    this.particles.explosion(pos, this.colorOf(e));
    this.debris.spawn(pos, hitDir, this.colorOf(e), isHumanoid(e.type) ? 12 : 7);
    this.particles.burst(pos, {
      count: 30,
      color: 0x00e5ff,
      color2: 0xffffff,
      intensity: 5,
      speedMin: 6,
      speedMax: 18,
      lifeMin: 0.2,
      lifeMax: 0.5,
      sizeMin: 0.04,
      sizeMax: 0.08,
      gravity: 8,
      drag: 2,
      direction: hitDir,
      spread: 0.6,
    });
    this.audio.playExplosion();
    this.onKill?.(e, pos, cause);
    // Un kamikaze abattu explose quand même… sur ses alliés
    if (e.type === 'kamikaze') this.blast(pos, null);
  }

  /** Explosion de kamikaze : détruit les ennemis proches, blesse le joueur s'il est fourni. */
  private blast(pos: THREE.Vector3, player: PlayerController | null): void {
    const cfg = ENEMIES.kamikaze;
    this.particles.explosion(pos, 0xff7a20);
    this.particles.flash(pos, 0xffa040, 0.5, cfg.blastRadius * 1.3, 0.25, 4);
    this.particles.burst(pos, {
      count: 46,
      color: 0xffa040,
      color2: 0xff3020,
      intensity: 5,
      speedMin: 8,
      speedMax: 20,
      lifeMin: 0.25,
      lifeMax: 0.6,
      sizeMin: 0.05,
      sizeMax: 0.12,
      gravity: 6,
      drag: 2.5,
      spread: 1,
    });
    this.audio.playExplosion();
    for (const o of this.enemies) {
      if (!o.alive) continue;
      const d = o.center.distanceTo(pos);
      if (d < cfg.blastRadius) this.kill(o, this.tmp2.subVectors(o.center, pos).normalize(), 'blast');
    }
    let hurt = false;
    if (player && player.alive && this.chest.distanceTo(pos) < cfg.blastRadius) {
      player.damage(cfg.damage);
      hurt = true;
    }
    this.onBlast?.(pos, hurt);
  }

  private colorOf(e: Enemy): number {
    switch (e.type) {
      case 'drone':
        return 0xff30d0;
      case 'sniper':
        return 0xffa020;
      case 'shield':
        return 0x40c8ff;
      case 'kamikaze':
        return 0xff7a20;
      default:
        return 0xff2040;
    }
  }

  // ---------------------------------------------------------------------------
  // Mise à jour
  // ---------------------------------------------------------------------------

  update(dt: number, player: PlayerController): void {
    player.getChestPosition(this.chest);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.time += dt;
      this.animate(e, dt, player);
      this.think(e, dt, player);
    }
    this.updateProjectiles(dt, player);
    this.debris.update(dt);
  }

  private animate(e: Enemy, dt: number, player: PlayerController): void {
    if (e.type === 'kamikaze') {
      this.animateKamikaze(e, dt, player);
      return;
    }
    const engaged = e.state !== 'idle';
    let targetYaw = e.yaw;
    if (engaged && player.alive) {
      targetYaw = Math.atan2(this.chest.x - e.root.position.x, this.chest.z - e.root.position.z);
    } else if (isHumanoid(e.type)) {
      targetYaw = (e.spawn.yaw ?? 0) + Math.sin(e.time * 0.5 + e.phase) * (e.type === 'sniper' ? 0.35 : 0.7);
    } else {
      targetYaw = e.yaw + dt * 0.6;
    }
    let diff = targetYaw - e.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = (e.type === 'guard' ? ENEMIES.guard.turnSpeed : e.type === 'shield' ? ENEMIES.shield.turnSpeed : e.type === 'sniper' ? ENEMIES.sniper.turnSpeed : 6) * dt;
    e.yaw += THREE.MathUtils.clamp(diff, -turn, turn);

    if (isHumanoid(e.type)) {
      e.root.position.copy(e.spawn.position);
      e.root.rotation.set(0, e.yaw, 0);
      e.body.position.y = Math.sin(e.time * 2 + e.phase) * 0.015;
    } else {
      const cfg = ENEMIES.drone;
      const a = e.time * cfg.orbitSpeed + e.phase;
      e.root.position.set(
        e.spawn.position.x + Math.cos(a) * cfg.orbitRadius,
        e.spawn.position.y + Math.sin(e.time * 1.7 + e.phase) * cfg.hoverAmplitude,
        e.spawn.position.z + Math.sin(a) * cfg.orbitRadius,
      );
      e.root.rotation.set(0, e.yaw, 0);
      e.body.rotation.x = 0.12 + Math.sin(e.time * 1.3) * 0.05;
      e.body.rotation.z = Math.sin(e.time * 0.9 + e.phase) * 0.08;
      for (const r of e.rotors) r.rotation.y += dt * 40;
    }
    // Réaction de touche : secousse et visière qui vire au blanc
    if (e.hurtTimer > 0) {
      e.hurtTimer = Math.max(0, e.hurtTimer - dt);
      const k = e.hurtTimer / 0.3;
      e.body.position.x = Math.sin(e.time * 90) * 0.06 * k;
      e.visorMaterial.color.setRGB(4 + k * 6, 0.15 + k * 5, 0.25 + k * 5).multiplyScalar(LIGHTING.enemyGlow);
      if (e.hurtTimer === 0) this.setVisor(e, 4);
    }
    // Bouclier : éclat bref à chaque coup bloqué
    if (e.shieldMat) {
      e.shieldFlash = Math.max(0, e.shieldFlash - dt);
      e.shieldMat.opacity = 0.22 + e.shieldFlash * 2 + Math.sin(e.time * 7 + e.phase) * 0.03;
    }
    e.root.updateMatrixWorld(true);
    this.updateCenter(e);
  }

  /** Kamikaze : flotte au repos, tremble en s'armant, puis fonce et explose au contact. */
  private animateKamikaze(e: Enemy, dt: number, player: PlayerController): void {
    const cfg = ENEMIES.kamikaze;
    if (e.state === 'rush') {
      const speed = e.velocity.length();
      if (speed > 0.01) {
        const dir = this.tmp2.copy(e.velocity).divideScalar(speed);
        const step = speed * dt;
        const hit = this.physics.raycast(e.root.position, dir, step + 0.35);
        if (hit) {
          e.root.position.copy(hit.point).addScaledVector(hit.normal, 0.3);
          this.detonate(e, player);
          return;
        }
        e.root.position.addScaledVector(dir, step);
        e.yaw = Math.atan2(dir.x, dir.z);
      }
      e.body.rotation.z += dt * 14;
    } else {
      e.root.position.set(
        e.spawn.position.x,
        e.spawn.position.y + Math.sin(e.time * 2.1 + e.phase) * 0.3,
        e.spawn.position.z,
      );
      if (e.state === 'aiming') {
        // Armement : tremblement de plus en plus fort
        const k = 1 - e.timer / cfg.armTime;
        e.root.position.x += Math.sin(e.time * 80) * 0.05 * k;
        e.root.position.y += Math.cos(e.time * 70) * 0.05 * k;
        e.yaw = Math.atan2(this.chest.x - e.root.position.x, this.chest.z - e.root.position.z);
      } else {
        e.yaw += dt * 0.8;
      }
      e.body.rotation.z = Math.sin(e.time * 1.4 + e.phase) * 0.15;
    }
    for (const r of e.rotors) r.rotation.y += dt * 50;
    e.root.rotation.set(0, e.yaw, 0);
    // Cœur clignotant, d'autant plus vite que la charge est engagée
    const rate = e.state === 'rush' ? 22 : e.state === 'aiming' ? 14 : 3;
    this.setVisor(e, Math.sin(e.time * rate) > 0 ? 9 : 2.5);
    e.root.updateMatrixWorld(true);
    this.updateCenter(e);
  }

  private detonate(e: Enemy, player: PlayerController): void {
    if (!e.alive) return;
    e.alive = false;
    e.root.visible = false;
    e.laser.mesh.visible = false;
    this.blast(e.root.position.clone(), player);
  }

  private thinkKamikaze(e: Enemy, dt: number, player: PlayerController): void {
    const cfg = ENEMIES.kamikaze;
    const toPlayer = this.tmp.subVectors(this.chest, e.center);
    const dist = toPlayer.length();
    if (e.state === 'rush') {
      e.timer -= dt;
      e.beepTimer -= dt;
      if (e.beepTimer <= 0) {
        e.beepTimer = THREE.MathUtils.clamp(dist / 40, 0.07, 0.3);
        this.audio.playKamikazeBeep(1.3, THREE.MathUtils.clamp(1.4 - dist / 30, 0.2, 1));
      }
      if ((player.alive && dist < cfg.triggerRadius) || e.timer <= 0) {
        this.detonate(e, player);
        return;
      }
      // Pilotage : accélère et s'oriente vers le joueur
      const speed = Math.min(cfg.speed, e.velocity.length() + cfg.accel * dt);
      if (player.alive && dist > 0.01) {
        const desired = toPlayer.divideScalar(dist);
        const cur = this.tmp3.copy(e.velocity).normalize();
        if (cur.lengthSq() < 0.5) cur.copy(desired);
        cur.lerp(desired, 1 - Math.exp(-cfg.turnRate * dt)).normalize();
        e.velocity.copy(cur).multiplyScalar(speed);
      } else {
        e.velocity.setLength(speed);
      }
      return;
    }
    if (dist > ENEMIES.activeDistance || !player.alive) {
      e.state = 'idle';
      return;
    }
    e.losTimer -= dt;
    if (e.losTimer <= 0) {
      e.losTimer = ENEMIES.losCheckInterval;
      e.hasLineOfSight = false;
      if (dist < cfg.detectionRange) {
        const hit = this.physics.raycast(e.center, this.tmp2.copy(toPlayer).divideScalar(dist), dist);
        e.hasLineOfSight = !hit || hit.distance > dist - 0.4;
      }
    }
    if (e.state === 'idle') {
      if (e.hasLineOfSight) {
        e.state = 'aiming';
        e.timer = cfg.armTime;
        e.beepTimer = 0;
      }
    } else if (e.state === 'aiming') {
      e.timer -= dt;
      e.beepTimer -= dt;
      if (e.beepTimer <= 0) {
        e.beepTimer = 0.12;
        this.audio.playKamikazeBeep(1, THREE.MathUtils.clamp(1.4 - dist / 30, 0.2, 1));
      }
      if (e.timer <= 0) {
        e.state = 'rush';
        e.timer = cfg.fuse;
        e.velocity.copy(toPlayer).normalize().multiplyScalar(5);
      }
    }
  }

  private cfg(e: Enemy): { detectionRange: number; aimDuration: number; cooldown: number; projectileSpeed: number } {
    switch (e.type) {
      case 'guard':
        return ENEMIES.guard;
      case 'shield':
        return ENEMIES.shield;
      case 'sniper':
        return ENEMIES.sniper;
      default:
        return ENEMIES.drone;
    }
  }

  private think(e: Enemy, dt: number, player: PlayerController): void {
    if (e.type === 'kamikaze') {
      this.thinkKamikaze(e, dt, player);
      return;
    }
    const cfg = this.cfg(e);
    const muzzle = e.muzzle.getWorldPosition(this.tmp2);
    const toPlayer = this.tmp.subVectors(this.chest, muzzle);
    const dist = toPlayer.length();

    if (dist > ENEMIES.activeDistance || !player.alive) {
      e.state = 'idle';
      e.laser.mesh.visible = false;
      return;
    }

    e.losTimer -= dt;
    if (e.losTimer <= 0) {
      e.losTimer = ENEMIES.losCheckInterval;
      e.hasLineOfSight = false;
      if (dist < cfg.detectionRange) {
        toPlayer.divideScalar(dist);
        const hit = this.physics.raycast(muzzle, toPlayer, dist);
        e.hasLineOfSight = !hit || hit.distance > dist - 0.4;
      }
    }

    const volume = THREE.MathUtils.clamp(1.4 - dist / cfg.detectionRange, 0.15, 1);

    switch (e.state) {
      case 'idle':
        e.laser.mesh.visible = false;
        if (e.hasLineOfSight) this.beginAim(e, cfg.aimDuration, volume);
        break;
      case 'rush':
        break;
      case 'aiming': {
        e.lostTime = e.hasLineOfSight ? 0 : e.lostTime + dt;
        if (e.lostTime > ENEMIES.loseTargetTime) {
          e.state = 'cooldown';
          e.timer = 0.6;
          e.laser.mesh.visible = false;
          this.setVisor(e, 4);
          break;
        }
        e.timer -= dt;
        if (e.timer > ENEMIES.aimLockTime) {
          // Le point visé suit le joueur avec un léger retard + anticipation.
          const lead = e.type === 'sniper' ? 0.3 : isHumanoid(e.type) ? 0.45 : 0.6;
          const travel = dist / cfg.projectileSpeed;
          this.tmp3.copy(this.chest).addScaledVector(player.velocity, travel * lead);
          e.aimPoint.lerp(this.tmp3, 1 - Math.exp(-ENEMIES.aimLagRate * dt));
        }
        this.drawLaser(e, muzzle, 1 - e.timer / cfg.aimDuration);
        if (e.timer <= 0) {
          this.fire(e, muzzle, cfg.projectileSpeed);
          e.state = 'cooldown';
          e.timer = cfg.cooldown * (0.85 + Math.random() * 0.3);
          e.laser.mesh.visible = false;
          if (e.type === 'sniper') this.audio.playSniperShot(Math.max(0.5, volume));
          else this.audio.playEnemyShot(volume);
        }
        break;
      }
      case 'cooldown':
        e.laser.mesh.visible = false;
        e.timer -= dt;
        if (e.timer <= 0) {
          if (e.hasLineOfSight) this.beginAim(e, cfg.aimDuration, volume);
          else e.state = 'idle';
        }
        break;
    }
  }

  private beginAim(e: Enemy, duration: number, volume: number): void {
    e.state = 'aiming';
    e.timer = duration;
    e.lostTime = 0;
    // Le laser part d'un point décalé puis converge vers le joueur.
    e.aimPoint
      .copy(this.chest)
      .add(this.tmp3.set(Math.random() - 0.5, Math.random() * 0.5 + 0.8, Math.random() - 0.5).multiplyScalar(2.5));
    if (e.type === 'sniper') this.audio.playSniperAim(Math.max(0.45, volume));
    else this.audio.playEnemyAim(volume);
  }

  private drawLaser(e: Enemy, muzzle: THREE.Vector3, progress: number): void {
    const dir = this.tmp3.subVectors(e.aimPoint, muzzle);
    const len = dir.length();
    if (len < 0.01) return;
    dir.divideScalar(len);
    // Le laser s'arrête juste avant le point visé (pour ne pas éblouir le joueur) ou sur le décor.
    const reach = Math.max(0.5, len - 1.2);
    const hit = this.physics.raycast(muzzle, dir, reach);
    const end = hit ? hit.point : this.tmp.copy(muzzle).addScaledVector(dir, reach);
    const locked = e.timer <= ENEMIES.aimLockTime;
    const blink = locked ? (Math.sin(e.time * 60) > 0 ? 1.6 : 0.6) : 1;
    const width = e.type === 'sniper' ? 0.012 + progress * 0.03 : 0.006 + progress * 0.016;
    e.laser.set(muzzle, end, width);
    e.laser.setIntensity((0.7 + progress * 1.3) * blink);
    e.laser.setOpacity(0.3 + progress * 0.6);
    this.setVisor(e, 4 + progress * 6);
  }

  /** Projectile hostile tiré par une source extérieure (boss), renvoyable aux lames. */
  fireProjectile(from: THREE.Vector3, dir: THREE.Vector3, speed: number, color: THREE.Color): void {
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return;
    p.active = true;
    p.friendly = false;
    p.owner = null;
    p.homing = null;
    p.homingTarget = null;
    p.damage = ENEMIES.projectileDamage;
    p.life = ENEMIES.projectileLifetime;
    p.velocity.copy(dir).normalize().multiplyScalar(speed);
    p.group.position.copy(from);
    p.group.visible = true;
    p.coreMaterial.color.copy(color).multiplyScalar(6 * LIGHTING.enemyGlow);
    p.glowMaterial.color.copy(color).multiplyScalar(2.2 * LIGHTING.enemyGlow);
  }

  private fire(e: Enemy, muzzle: THREE.Vector3, speed: number): void {
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return;
    const dir = this.tmp3.subVectors(e.aimPoint, muzzle).normalize();
    p.active = true;
    p.friendly = false;
    p.owner = e;
    p.homing = null;
    p.homingTarget = null;
    p.damage = e.type === 'sniper' ? ENEMIES.sniper.damage : ENEMIES.projectileDamage;
    p.life = ENEMIES.projectileLifetime;
    p.velocity.copy(dir).multiplyScalar(speed);
    p.group.position.copy(muzzle);
    p.group.visible = true;
    const color = e.type === 'sniper' ? SNIPER_AMBER : e.type === 'drone' ? DRONE_MAGENTA : GUARD_RED;
    p.coreMaterial.color.copy(color).multiplyScalar(6 * LIGHTING.enemyGlow);
    p.glowMaterial.color.copy(color).multiplyScalar(2.2 * LIGHTING.enemyGlow);
    this.particles.flash(muzzle, color, 0.2, 1.2, 0.12, 4);
    this.setVisor(e, 4);
  }

  private updateProjectiles(dt: number, player: PlayerController): void {
    const radius = player.getCapsuleSegment(this.segA, this.segB) + ENEMIES.projectileRadius;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.deactivate(p);
        continue;
      }
      const speed = p.velocity.length();
      const homeOn = p.friendly ? (p.homing && p.homing.alive ? p.homing.center : p.homingTarget && p.homingTarget.isActive() ? p.homingTarget.center : null) : null;
      if (homeOn) {
        // Légère correction de trajectoire vers la cible (projectile renvoyé)
        const desired = this.tmp3.subVectors(homeOn, p.group.position).normalize().multiplyScalar(speed);
        p.velocity.lerp(desired, 1 - Math.exp(-8 * dt)).setLength(speed);
      }
      const step = speed * dt;
      if (step <= 0) continue;
      const dir = this.tmp.copy(p.velocity).normalize();
      const hit = this.physics.raycast(p.group.position, dir, step);
      const start = this.tmp2.copy(p.group.position);
      if (hit) {
        p.group.position.copy(hit.point);
      } else {
        p.group.position.addScaledVector(dir, step);
      }
      // Orientation de la traînée lumineuse
      this.tmp3.copy(p.group.position).add(dir);
      p.group.lookAt(this.tmp3);

      if (p.friendly) {
        // Projectile renvoyé : il détruit les ennemis qu'il touche.
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (segmentPointDistance(start, p.group.position, e.center) < (isHumanoid(e.type) ? 0.8 : 0.7)) {
            this.kill(e, dir, 'deflect');
            this.deactivate(p);
            break;
          }
        }
        if (p.active) {
          for (const t of this.targets) {
            if (!t.isActive()) continue;
            if (segmentPointDistance(start, p.group.position, t.center) < t.radius + 0.3) {
              t.hit(2, dir, 'deflect');
              this.particles.sparks(p.group.position, null, 0x40e0ff, 30);
              this.deactivate(p);
              break;
            }
          }
        }
        if (!p.active) continue;
      } else if (player.alive) {
        const d = segmentSegmentDistance(start, p.group.position, this.segA, this.segB);
        if (d < radius) {
          player.damage(p.damage);
          this.particles.sparks(p.group.position, null, 0xff3040, 30);
          this.deactivate(p);
          continue;
        }
      }

      if (hit) {
        this.particles.sparks(hit.point, hit.normal, p.friendly ? 0x40e0ff : 0xff3040, 16);
        this.deactivate(p);
      }
    }
  }

  private deactivate(p: Projectile): void {
    p.active = false;
    p.group.visible = false;
  }

  // ---------------------------------------------------------------------------
  // Géométrie de touche
  // ---------------------------------------------------------------------------

  private updateCenter(e: Enemy): void {
    if (isHumanoid(e.type)) e.center.copy(e.root.position).add(this.tmp3.set(0, 1.15, 0));
    else e.center.copy(e.root.position);
  }

  private hitSpheres(e: Enemy): { center: THREE.Vector3; radius: number }[] {
    if (e.type === 'drone') return [{ center: e.center, radius: 0.6 }];
    if (e.type === 'kamikaze') return [{ center: e.center, radius: 0.5 }];
    const base = e.root.position;
    return [
      { center: new THREE.Vector3(base.x, base.y + 0.55, base.z), radius: 0.42 },
      { center: new THREE.Vector3(base.x, base.y + 1.15, base.z), radius: 0.48 },
      { center: new THREE.Vector3(base.x, base.y + 1.75, base.z), radius: 0.32 },
    ];
  }

  /** Écrit dans `out` le point de l'ennemi le plus proche de `p` et renvoie le rayon de la zone. */
  private closestPointOnEnemy(e: Enemy, p: THREE.Vector3, out: THREE.Vector3): number {
    if (!isHumanoid(e.type)) {
      out.copy(e.center);
      return e.type === 'kamikaze' ? 0.5 : 0.6;
    }
    const base = e.root.position;
    out.set(base.x, THREE.MathUtils.clamp(p.y, base.y + 0.4, base.y + 1.75), base.z);
    return 0.45;
  }

  // ---------------------------------------------------------------------------
  // Construction des modèles
  // ---------------------------------------------------------------------------

  /** Visière rouge : `level` ≈ 4 au repos, jusqu'à 10 juste avant le tir. */
  private setVisor(e: Enemy, level: number): void {
    if (e.type === 'sniper') e.visorMaterial.color.setRGB(level, level * 0.55, 0.1);
    else if (e.type === 'kamikaze') e.visorMaterial.color.setRGB(level, level * 0.3, 0.05);
    else e.visorMaterial.color.setRGB(level, 0.15, 0.25);
    e.visorMaterial.color.multiplyScalar(LIGHTING.enemyGlow);
  }

  private createVisorMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.15, 0.25).multiplyScalar(LIGHTING.enemyGlow), toneMapped: false });
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  private createGuard(spawn: EnemySpawn): Enemy {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const visor = this.createVisorMaterial();
    const sniper = spawn.type === 'sniper';
    const shielded = spawn.type === 'shield';
    const accent = sniper ? this.accentAmberMat : this.accentRedMat;

    // Jambes et bassin
    body.add(this.box(0.2, 0.9, 0.22, this.clothMat, -0.14, 0.45, 0));
    body.add(this.box(0.2, 0.9, 0.22, this.clothMat, 0.14, 0.45, 0));
    body.add(this.box(0.22, 0.28, 0.26, this.armorMat, -0.14, 0.42, 0.03));
    body.add(this.box(0.22, 0.28, 0.26, this.armorMat, 0.14, 0.42, 0.03));
    body.add(this.box(0.48, 0.2, 0.28, this.armorMat, 0, 0.98, 0));
    // Torse (plus massif pour le garde à bouclier)
    const bulk = shielded ? 1.15 : 1;
    body.add(this.box(0.58 * bulk, 0.62, 0.34 * bulk, this.armorMat, 0, 1.36, 0));
    body.add(this.box(0.42, 0.04, 0.02, accent, 0, 1.44, 0.18 * bulk));
    body.add(this.box(0.04, 0.3, 0.02, accent, 0, 1.24, 0.18 * bulk));
    body.add(this.box(0.36, 0.42, 0.18, this.clothMat, 0, 1.36, -0.25));
    body.add(this.box(0.06, 0.06, 0.02, accent, 0.1, 1.5, -0.35));
    // Épaules
    body.add(this.box(0.22 * bulk, 0.17 * bulk, 0.32, this.armorMat, -0.39 * bulk, 1.6, 0));
    body.add(this.box(0.22 * bulk, 0.17 * bulk, 0.32, this.armorMat, 0.39 * bulk, 1.6, 0));
    // Tête + visière
    body.add(this.box(0.27, 0.3, 0.29, this.armorMat, 0, 1.84, 0));
    const visorMesh = this.box(sniper ? 0.12 : 0.29, 0.075, 0.05, visor, sniper ? 0.06 : 0, 1.87, 0.14);
    body.add(visorMesh);
    body.add(this.box(0.02, 0.22, 0.02, this.armorMat, 0.11, 2.05, -0.06));
    body.add(this.box(0.03, 0.03, 0.03, accent, 0.11, 2.17, -0.06));
    if (sniper) {
      // Capuche / cape du tireur d'élite
      body.add(this.box(0.36, 0.16, 0.36, this.clothMat, 0, 2.0, -0.02));
      body.add(this.box(0.5, 0.9, 0.06, this.clothMat, 0, 1.3, -0.32));
    }

    // Bras tendus vers l'avant qui tiennent l'arme
    const armGeo = new THREE.BoxGeometry(0.12, 0.5, 0.13);
    armGeo.translate(0, -0.25, 0);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.armorMat);
      arm.position.set(side * 0.38 * bulk, 1.55, 0.02);
      arm.rotation.set(-1.15, 0, side * -0.35);
      body.add(arm);
    }

    const muzzle = new THREE.Object3D();
    let shieldMat: THREE.MeshBasicMaterial | null = null;
    if (shielded) {
      // Pistolet dans la main droite
      const gun = new THREE.Group();
      gun.position.set(0.34, 1.32, 0.46);
      gun.add(this.box(0.07, 0.11, 0.34, this.armorMat, 0, 0, 0));
      gun.add(this.box(0.075, 0.02, 0.26, accent, 0, 0.06, 0.02));
      muzzle.position.set(0, 0.02, 0.2);
      gun.add(muzzle);
      body.add(gun);
      // Bouclier holographique (bras gauche) : panneau translucide + cadre lumineux
      shieldMat = new THREE.MeshBasicMaterial({
        color: SHIELD_BLUE.clone().multiplyScalar(1.6),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const shield = new THREE.Group();
      shield.position.set(-0.12, 1.12, 0.62);
      shield.rotation.y = 0.12;
      shield.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.45, 0.03), shieldMat));
      shield.add(this.box(0.99, 0.05, 0.05, this.accentBlueMat, 0, 0.72, 0));
      shield.add(this.box(0.99, 0.05, 0.05, this.accentBlueMat, 0, -0.72, 0));
      shield.add(this.box(0.05, 1.45, 0.05, this.accentBlueMat, -0.48, 0, 0));
      shield.add(this.box(0.05, 1.45, 0.05, this.accentBlueMat, 0.48, 0, 0));
      shield.add(this.box(0.7, 0.03, 0.04, this.accentBlueMat, 0, 0.25, 0));
      shield.add(this.box(0.03, 0.4, 0.04, this.accentBlueMat, 0, -0.05, 0));
      shield.add(this.box(0.12, 0.3, 0.12, this.armorMat, 0.1, 0, -0.08));
      body.add(shield);
    } else {
      // Fusil (long canon et lunette pour le tireur d'élite)
      const len = sniper ? 1.25 : 0.72;
      const rifle = new THREE.Group();
      rifle.position.set(0.06, 1.3, 0.42 + (sniper ? 0.2 : 0));
      rifle.add(this.box(0.08, 0.13, len, this.armorMat, 0, 0, 0));
      rifle.add(this.box(0.05, 0.16, 0.08, this.clothMat, 0, -0.12, -0.12));
      rifle.add(this.box(0.085, 0.025, len * 0.7, accent, 0, 0.07, 0.02));
      const barrelLen = sniper ? 0.6 : 0.25;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, barrelLen, 8), this.armorMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, len / 2 + barrelLen / 2 - 0.02);
      rifle.add(barrel);
      if (sniper) {
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.36, 10), this.armorMat);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.14, 0.05);
        rifle.add(scope);
        rifle.add(this.box(0.06, 0.06, 0.02, accent, 0, 0.14, 0.24));
        // Bipied replié
        rifle.add(this.box(0.02, 0.24, 0.02, this.armorMat, -0.05, -0.12, len / 2 - 0.1));
        rifle.add(this.box(0.02, 0.24, 0.02, this.armorMat, 0.05, -0.12, len / 2 - 0.1));
      }
      muzzle.position.set(0, 0.02, len / 2 + barrelLen - 0.02);
      rifle.add(muzzle);
      body.add(rifle);
    }
    bakeGroup(body, [muzzle]);

    const laser = new Beam(sniper ? 0xffa020 : 0xff1030, (sniper ? 3.6 : 3) * LIGHTING.enemyGlow);
    return this.enemyRecord(spawn, root, body, muzzle, visor, laser, [], shieldMat);
  }

  private enemyRecord(
    spawn: EnemySpawn,
    root: THREE.Group,
    body: THREE.Group,
    muzzle: THREE.Object3D,
    visorMaterial: THREE.MeshBasicMaterial,
    laser: Beam,
    rotors: THREE.Object3D[],
    shieldMat: THREE.MeshBasicMaterial | null,
  ): Enemy {
    return {
      type: spawn.type,
      spawn,
      root,
      body,
      muzzle,
      visorMaterial,
      laser,
      rotors,
      aimPoint: new THREE.Vector3(),
      center: new THREE.Vector3(),
      alive: true,
      hp: spawn.type === 'kamikaze' ? 1 : ENEMIES.health,
      hurtTimer: 0,
      state: 'idle',
      timer: 0,
      losTimer: 0,
      hasLineOfSight: false,
      lostTime: 0,
      yaw: spawn.yaw ?? 0,
      phase: Math.random() * Math.PI * 2,
      time: 0,
      velocity: new THREE.Vector3(),
      shieldMat,
      shieldFlash: 0,
      beepTimer: 0,
    };
  }

  private createDrone(spawn: EnemySpawn): Enemy {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const visor = this.createVisorMaterial();
    const kamikaze = spawn.type === 'kamikaze';
    const accent = kamikaze ? this.accentAmberMat : this.accentMagentaMat;

    const hull = new THREE.Mesh(new THREE.SphereGeometry(kamikaze ? 0.3 : 0.38, 18, 12), this.armorMat);
    hull.scale.set(1, kamikaze ? 0.8 : 0.5, kamikaze ? 1 : 1.15);
    body.add(hull);
    if (kamikaze) {
      // Charge explosive : cœur lumineux et pointes
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), visor);
      core.position.set(0, 0, 0.22);
      body.add(core);
      const spikeGeo = new THREE.ConeGeometry(0.06, 0.26, 6);
      const dirs: [number, number, number][] = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0.7, 0.7, -0.3],
        [-0.7, 0.7, -0.3],
        [0.7, -0.7, -0.3],
        [-0.7, -0.7, -0.3],
      ];
      for (const [x, y, z] of dirs) {
        const spike = new THREE.Mesh(spikeGeo, accent);
        const d = new THREE.Vector3(x, y, z).normalize();
        spike.position.copy(d).multiplyScalar(0.33);
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        body.add(spike);
      }
      body.add(this.box(0.5, 0.05, 0.05, accent, 0, 0, -0.1));
    } else {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), visor);
      eye.position.set(0, 0.02, 0.4);
      body.add(eye);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 6, 32), accent);
      ring.rotation.x = Math.PI / 2;
      body.add(ring);
      body.add(this.box(0.12, 0.12, 0.3, this.armorMat, 0, -0.18, 0.15));
    }

    const rotors: THREE.Object3D[] = [];
    const reach = kamikaze ? 0.46 : 0.62;
    const rotorGeo = new THREE.CylinderGeometry(kamikaze ? 0.15 : 0.2, kamikaze ? 0.15 : 0.2, 0.012, 16);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const arm = this.box(0.05, 0.04, reach * 0.68, this.armorMat, Math.sin(a) * reach * 0.64, 0.04, Math.cos(a) * reach * 0.64);
      arm.rotation.y = a;
      body.add(arm);
      const rotor = new THREE.Mesh(rotorGeo, this.rotorMat);
      rotor.position.set(Math.sin(a) * reach, 0.08, Math.cos(a) * reach);
      body.add(rotor);
      rotors.push(rotor);
      const light = this.box(0.04, 0.04, 0.04, accent, Math.sin(a) * reach, 0.0, Math.cos(a) * reach);
      body.add(light);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.18, 0.34);
    body.add(muzzle);
    bakeGroup(body, [muzzle, ...rotors]);

    const laser = new Beam(0xff20b0, 3 * LIGHTING.enemyGlow);
    return this.enemyRecord(spawn, root, body, muzzle, visor, laser, rotors, null);
  }

  private createProjectile(): Projectile {
    const group = new THREE.Group();
    const coreMaterial = new THREE.MeshBasicMaterial({ color: GUARD_RED.clone().multiplyScalar(6 * LIGHTING.enemyGlow), toneMapped: false });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: GUARD_RED.clone().multiplyScalar(2 * LIGHTING.enemyGlow),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), coreMaterial);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glowMaterial);
    glow.scale.set(1, 1, 4);
    glow.position.z = -0.45;
    group.add(core, glow);
    group.visible = false;
    this.scene.add(group);
    return {
      group,
      coreMaterial,
      glowMaterial,
      velocity: new THREE.Vector3(),
      owner: null,
      homing: null,
      homingTarget: null,
      active: false,
      friendly: false,
      life: 0,
      damage: 1,
    };
  }
}

// -----------------------------------------------------------------------------
// Utilitaires géométriques
// -----------------------------------------------------------------------------

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _closest = new THREE.Vector3();

function segmentPointDistance(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  _ab.subVectors(b, a);
  const lenSq = _ab.lengthSq();
  const t = lenSq > 0 ? THREE.MathUtils.clamp(_ap.subVectors(p, a).dot(_ab) / lenSq, 0, 1) : 0;
  _closest.copy(a).addScaledVector(_ab, t);
  return _closest.distanceTo(p);
}

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/** Distance minimale entre deux segments [p1,q1] et [p2,q2]. */
function segmentSegmentDistance(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s = 0;
  let t = 0;
  if (a <= 1e-8 && e <= 1e-8) return p1.distanceTo(p2);
  if (a <= 1e-8) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= 1e-8) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  return _c1.distanceTo(_c2);
}
