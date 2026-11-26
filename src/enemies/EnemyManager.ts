import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import type { AudioSynthesizer } from '../core/AudioSynthesizer';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { PlayerController } from '../player/PlayerController';
import { Beam } from '../effects/Beam';
import { bakeGroup } from '../core/GeometryUtils';
import { ENEMIES, LIGHTING } from '../config';

export type EnemyType = 'guard' | 'drone';

export interface EnemySpawn {
  type: EnemyType;
  position: THREE.Vector3;
  yaw?: number;
}

type EnemyState = 'idle' | 'aiming' | 'cooldown';

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
}

interface Projectile {
  readonly group: THREE.Group;
  readonly coreMaterial: THREE.MeshBasicMaterial;
  readonly glowMaterial: THREE.MeshBasicMaterial;
  readonly velocity: THREE.Vector3;
  owner: Enemy | null;
  /** Cible poursuivie par un projectile renvoyé. */
  homing: Enemy | null;
  active: boolean;
  friendly: boolean;
  life: number;
}

export interface EnemyRayHit {
  enemy: Enemy;
  distance: number;
  point: THREE.Vector3;
}

const GUARD_RED = new THREE.Color(1, 0.05, 0.12);
const DRONE_MAGENTA = new THREE.Color(1, 0.1, 0.75);
const FRIENDLY_CYAN = new THREE.Color(0.1, 0.9, 1);

/**
 * Gardes cybernétiques et drones : détection, laser de visée (télégraphe), tir de
 * projectiles, mort en un coup avec explosion. Gère aussi les projectiles et leur
 * renvoi par les lames.
 */
export class EnemyManager {
  /** Appelé à chaque élimination. */
  onKill: ((enemy: Enemy, position: THREE.Vector3) => void) | null = null;

  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly particles: ParticleSystem;
  private readonly audio: AudioSynthesizer;
  private readonly enemies: Enemy[] = [];
  private readonly projectiles: Projectile[] = [];

  private readonly armorMat = new THREE.MeshStandardMaterial({ color: 0x1b1d26, metalness: 0.75, roughness: 0.32 });
  private readonly clothMat = new THREE.MeshStandardMaterial({ color: 0x0b0c12, metalness: 0.1, roughness: 0.85 });
  private readonly accentRedMat = new THREE.MeshStandardMaterial({
    color: 0x220004,
    emissive: 0xff1030,
    emissiveIntensity: 2.2 * LIGHTING.enemyGlow,
    metalness: 0.4,
    roughness: 0.4,
  });
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
    for (let i = 0; i < 48; i++) this.projectiles.push(this.createProjectile());
  }

  get totalCount(): number {
    return this.enemies.length;
  }

  get aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  spawnAll(spawns: EnemySpawn[]): void {
    for (const s of spawns) {
      const enemy = s.type === 'guard' ? this.createGuard(s) : this.createDrone(s);
      this.enemies.push(enemy);
      this.scene.add(enemy.root);
      this.scene.add(enemy.laser.mesh);
    }
    this.reset();
  }

  /** Retire tous les ennemis (changement de niveau) et libère leurs ressources. */
  clearAll(): void {
    const shared = new Set<THREE.Material>([this.armorMat, this.clothMat, this.accentRedMat, this.accentMagentaMat, this.rotorMat]);
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
  }

  reset(): void {
    for (const e of this.enemies) {
      e.alive = true;
      e.root.visible = true;
      e.state = 'idle';
      e.timer = 0;
      e.losTimer = Math.random() * ENEMIES.losCheckInterval;
      e.hasLineOfSight = false;
      e.lostTime = 0;
      e.yaw = e.spawn.yaw ?? 0;
      e.time = 0;
      e.laser.mesh.visible = false;
      e.root.position.copy(e.spawn.position);
      e.root.rotation.set(0, e.yaw, 0);
      e.root.updateMatrixWorld(true);
      this.updateCenter(e);
    }
    for (const p of this.projectiles) this.deactivate(p);
  }

  // ---------------------------------------------------------------------------
  // Requêtes de combat
  // ---------------------------------------------------------------------------

  /** Élimine les ennemis à portée de lame dans le cône de visée. Renvoie le nombre de victimes. */
  meleeSweep(origin: THREE.Vector3, forward: THREE.Vector3, range: number, cosAngle: number): number {
    let kills = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const radius = this.closestPointOnEnemy(e, origin, this.tmp);
      const toEnemy = this.tmp.sub(origin);
      const dist = toEnemy.length();
      if (dist - radius > range) continue;
      const facing = dist < 1e-3 ? 1 : toEnemy.dot(forward) / dist;
      if (facing >= cosAngle || dist < radius + 0.9) {
        this.kill(e, forward);
        kills++;
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
    for (const e of this.enemies) {
      if (!e.alive) continue;
      for (const s of this.hitSpheres(e)) {
        this.sphere.center.copy(s.center);
        this.sphere.radius = s.radius + assistRadius;
        const p = this.ray.intersectSphere(this.sphere, this.tmp3);
        if (!p) continue;
        const d = p.distanceTo(origin);
        if (d <= maxDistance && (!best || d < best.distance)) {
          best = { enemy: e, distance: d, point: p.clone() };
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
      if (p.owner && p.owner.alive) {
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

  kill(e: Enemy, hitDir: THREE.Vector3): void {
    if (!e.alive) return;
    e.alive = false;
    e.root.visible = false;
    e.laser.mesh.visible = false;
    const pos = e.center.clone();
    this.particles.explosion(pos, e.type === 'guard' ? 0xff2040 : 0xff30d0);
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
    this.onKill?.(e, pos);
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
  }

  private animate(e: Enemy, dt: number, player: PlayerController): void {
    const engaged = e.state !== 'idle';
    let targetYaw = e.yaw;
    if (engaged && player.alive) {
      targetYaw = Math.atan2(this.chest.x - e.root.position.x, this.chest.z - e.root.position.z);
    } else if (e.type === 'guard') {
      targetYaw = (e.spawn.yaw ?? 0) + Math.sin(e.time * 0.5 + e.phase) * 0.7;
    } else {
      targetYaw = e.yaw + dt * 0.6;
    }
    let diff = targetYaw - e.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = (e.type === 'guard' ? ENEMIES.guard.turnSpeed : 6) * dt;
    e.yaw += THREE.MathUtils.clamp(diff, -turn, turn);

    if (e.type === 'guard') {
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
    e.root.updateMatrixWorld(true);
    this.updateCenter(e);
  }

  private think(e: Enemy, dt: number, player: PlayerController): void {
    const cfg = e.type === 'guard' ? ENEMIES.guard : ENEMIES.drone;
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
          const lead = e.type === 'guard' ? 0.45 : 0.6;
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
          this.audio.playEnemyShot(volume);
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
    this.audio.playEnemyAim(volume);
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
    e.laser.set(muzzle, end, 0.006 + progress * 0.016);
    e.laser.setIntensity((0.7 + progress * 1.3) * blink);
    e.laser.setOpacity(0.3 + progress * 0.6);
    this.setVisor(e, 4 + progress * 6);
  }

  private fire(e: Enemy, muzzle: THREE.Vector3, speed: number): void {
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return;
    const dir = this.tmp3.subVectors(e.aimPoint, muzzle).normalize();
    p.active = true;
    p.friendly = false;
    p.owner = e;
    p.homing = null;
    p.life = ENEMIES.projectileLifetime;
    p.velocity.copy(dir).multiplyScalar(speed);
    p.group.position.copy(muzzle);
    p.group.visible = true;
    const color = e.type === 'guard' ? GUARD_RED : DRONE_MAGENTA;
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
      if (p.friendly && p.homing && p.homing.alive) {
        // Légère correction de trajectoire vers la cible (projectile renvoyé)
        const desired = this.tmp3.subVectors(p.homing.center, p.group.position).normalize().multiplyScalar(speed);
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
          if (segmentPointDistance(start, p.group.position, e.center) < (e.type === 'guard' ? 0.8 : 0.7)) {
            this.kill(e, dir);
            this.deactivate(p);
            break;
          }
        }
        if (!p.active) continue;
      } else if (player.alive) {
        const d = segmentSegmentDistance(start, p.group.position, this.segA, this.segB);
        if (d < radius) {
          player.damage(ENEMIES.projectileDamage);
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
    if (e.type === 'guard') e.center.copy(e.root.position).add(this.tmp3.set(0, 1.15, 0));
    else e.center.copy(e.root.position);
  }

  private hitSpheres(e: Enemy): { center: THREE.Vector3; radius: number }[] {
    if (e.type === 'drone') return [{ center: e.center, radius: 0.6 }];
    const base = e.root.position;
    return [
      { center: new THREE.Vector3(base.x, base.y + 0.55, base.z), radius: 0.42 },
      { center: new THREE.Vector3(base.x, base.y + 1.15, base.z), radius: 0.48 },
      { center: new THREE.Vector3(base.x, base.y + 1.75, base.z), radius: 0.32 },
    ];
  }

  /** Écrit dans `out` le point de l'ennemi le plus proche de `p` et renvoie le rayon de la zone. */
  private closestPointOnEnemy(e: Enemy, p: THREE.Vector3, out: THREE.Vector3): number {
    if (e.type === 'drone') {
      out.copy(e.center);
      return 0.6;
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
    e.visorMaterial.color.setRGB(level, 0.15, 0.25).multiplyScalar(LIGHTING.enemyGlow);
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

    // Jambes et bassin
    body.add(this.box(0.2, 0.9, 0.22, this.clothMat, -0.14, 0.45, 0));
    body.add(this.box(0.2, 0.9, 0.22, this.clothMat, 0.14, 0.45, 0));
    body.add(this.box(0.22, 0.28, 0.26, this.armorMat, -0.14, 0.42, 0.03));
    body.add(this.box(0.22, 0.28, 0.26, this.armorMat, 0.14, 0.42, 0.03));
    body.add(this.box(0.48, 0.2, 0.28, this.armorMat, 0, 0.98, 0));
    // Torse
    body.add(this.box(0.58, 0.62, 0.34, this.armorMat, 0, 1.36, 0));
    body.add(this.box(0.42, 0.04, 0.02, this.accentRedMat, 0, 1.44, 0.18));
    body.add(this.box(0.04, 0.3, 0.02, this.accentRedMat, 0, 1.24, 0.18));
    body.add(this.box(0.36, 0.42, 0.18, this.clothMat, 0, 1.36, -0.25));
    body.add(this.box(0.06, 0.06, 0.02, this.accentRedMat, 0.1, 1.5, -0.35));
    // Épaules
    body.add(this.box(0.22, 0.17, 0.32, this.armorMat, -0.39, 1.6, 0));
    body.add(this.box(0.22, 0.17, 0.32, this.armorMat, 0.39, 1.6, 0));
    // Tête + visière rouge
    body.add(this.box(0.27, 0.3, 0.29, this.armorMat, 0, 1.84, 0));
    const visorMesh = this.box(0.29, 0.075, 0.05, visor, 0, 1.87, 0.14);
    body.add(visorMesh);
    body.add(this.box(0.02, 0.22, 0.02, this.armorMat, 0.11, 2.05, -0.06));
    body.add(this.box(0.03, 0.03, 0.03, this.accentRedMat, 0.11, 2.17, -0.06));

    // Bras tendus vers l'avant qui tiennent le fusil
    const armGeo = new THREE.BoxGeometry(0.12, 0.5, 0.13);
    armGeo.translate(0, -0.25, 0);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.armorMat);
      arm.position.set(side * 0.38, 1.55, 0.02);
      arm.rotation.set(-1.15, 0, side * -0.35);
      body.add(arm);
    }

    // Fusil
    const rifle = new THREE.Group();
    rifle.position.set(0.06, 1.3, 0.42);
    rifle.add(this.box(0.08, 0.13, 0.72, this.armorMat, 0, 0, 0));
    rifle.add(this.box(0.05, 0.16, 0.08, this.clothMat, 0, -0.12, -0.12));
    rifle.add(this.box(0.085, 0.025, 0.5, this.accentRedMat, 0, 0.07, 0.02));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 8), this.armorMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.46);
    rifle.add(barrel);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, 0.6);
    rifle.add(muzzle);
    body.add(rifle);
    bakeGroup(body, [muzzle]);

    const laser = new Beam(0xff1030, 3 * LIGHTING.enemyGlow);

    return {
      type: 'guard',
      spawn,
      root,
      body,
      muzzle,
      visorMaterial: visor,
      laser,
      rotors: [],
      aimPoint: new THREE.Vector3(),
      center: new THREE.Vector3(),
      alive: true,
      state: 'idle',
      timer: 0,
      losTimer: 0,
      hasLineOfSight: false,
      lostTime: 0,
      yaw: spawn.yaw ?? 0,
      phase: Math.random() * Math.PI * 2,
      time: 0,
    };
  }

  private createDrone(spawn: EnemySpawn): Enemy {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const visor = this.createVisorMaterial();

    const hull = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 12), this.armorMat);
    hull.scale.set(1, 0.5, 1.15);
    body.add(hull);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), visor);
    eye.position.set(0, 0.02, 0.4);
    body.add(eye);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 6, 32), this.accentMagentaMat);
    ring.rotation.x = Math.PI / 2;
    body.add(ring);
    body.add(this.box(0.12, 0.12, 0.3, this.armorMat, 0, -0.18, 0.15));

    const rotors: THREE.Object3D[] = [];
    const rotorGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.012, 16);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const arm = this.box(0.05, 0.04, 0.42, this.armorMat, Math.sin(a) * 0.4, 0.04, Math.cos(a) * 0.4);
      arm.rotation.y = a;
      body.add(arm);
      const rotor = new THREE.Mesh(rotorGeo, this.rotorMat);
      rotor.position.set(Math.sin(a) * 0.62, 0.08, Math.cos(a) * 0.62);
      body.add(rotor);
      rotors.push(rotor);
      const light = this.box(0.04, 0.04, 0.04, this.accentMagentaMat, Math.sin(a) * 0.62, 0.0, Math.cos(a) * 0.62);
      body.add(light);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.18, 0.34);
    body.add(muzzle);
    bakeGroup(body, [muzzle, ...rotors]);

    const laser = new Beam(0xff20b0, 3 * LIGHTING.enemyGlow);

    return {
      type: 'drone',
      spawn,
      root,
      body,
      muzzle,
      visorMaterial: visor,
      laser,
      rotors,
      aimPoint: new THREE.Vector3(),
      center: new THREE.Vector3(),
      alive: true,
      state: 'idle',
      timer: 0,
      losTimer: 0,
      hasLineOfSight: false,
      lostTime: 0,
      yaw: spawn.yaw ?? 0,
      phase: Math.random() * Math.PI * 2,
      time: 0,
    };
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
      active: false,
      friendly: false,
      life: 0,
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
