import * as THREE from 'three';
import type { LevelBuilder } from '../world/LevelBuilder';
import type { EnemyManager, ExternalTarget, KillCause } from './EnemyManager';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { AudioSynthesizer } from '../core/AudioSynthesizer';
import type { PlayerController } from '../player/PlayerController';
import { Beam } from '../effects/Beam';
import { LIGHTING } from '../config';

/**
 * La Sentinelle d'Aegis : boss du niveau 5. Elle tourne au-dessus de l'arène
 * et enchaîne trois attaques — barrage de tirs (renvoyables), laser rasant qui
 * balaie l'arène (à sauter), descente avec onde de choc — après laquelle ses
 * trois cœurs restent exposés quelques secondes. Les tirs renvoyés frappent
 * toujours ses cœurs, même protégés. Chaque cœur détruit l'accélère.
 */

type BossState = 'dormant' | 'intro' | 'barrage' | 'laser' | 'descent' | 'open' | 'rise' | 'dying' | 'dead';

const CORE_HP = 3;
/** Dégâts maximum par cœur et par fenêtre d'ouverture (hors tirs renvoyés). */
const WINDOW_CAP = 2;
const HOVER = 7.5;
const LOW = 3.4;
const RED = new THREE.Color(1, 0.08, 0.2);

export interface BossServices {
  enemies: EnemyManager;
  particles: ParticleSystem;
  audio: AudioSynthesizer;
}

class BossCore implements ExternalTarget {
  readonly center = new THREE.Vector3();
  readonly radius = 0.75;
  hp = CORE_HP;
  windowDamage = 0;
  flash = 0;
  readonly mesh: THREE.Mesh;
  readonly shield: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  private readonly boss: Boss;

  constructor(boss: Boss, mesh: THREE.Mesh, shield: THREE.Mesh, material: THREE.MeshBasicMaterial) {
    this.boss = boss;
    this.mesh = mesh;
    this.shield = shield;
    this.material = material;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  isActive(): boolean {
    return this.alive && this.boss.fighting;
  }

  hit(amount: number, dir: THREE.Vector3, cause: KillCause): void {
    this.boss.hitCore(this, amount, dir, cause);
  }
}

export class Boss {
  readonly cores: BossCore[] = [];
  /** Annonce à l'écran (« CŒURS EXPOSÉS ! »…). */
  onMessage: ((text: string, color: string) => void) | null = null;
  onCoreDestroyed: (() => void) | null = null;
  onDefeated: (() => void) | null = null;

  private readonly s: BossServices;
  private readonly root = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly laser: Beam;
  private readonly warning: THREE.Mesh;
  private readonly warningMat: THREE.MeshBasicMaterial;
  private readonly center: THREE.Vector3;
  private readonly floor: number;
  private readonly arenaRadius: number;
  private state: BossState = 'dormant';
  private timer = 0;
  private time = 0;
  private volleyTimer = 0;
  private laserAngle = 0;
  private laserDir = 1;
  private readonly from = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private dyingBlast = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(b: LevelBuilder, def: { center: [number, number, number]; floor: number; radius: number }, services: BossServices) {
    this.s = services;
    this.center = new THREE.Vector3(...def.center);
    this.floor = def.floor;
    this.arenaRadius = def.radius;

    const metal = new THREE.MeshStandardMaterial({ color: 0x1a1c26, metalness: 0.85, roughness: 0.3, emissive: 0x120408, emissiveIntensity: 1 });
    const plate = new THREE.MeshStandardMaterial({ color: 0x3a3f4e, metalness: 0.9, roughness: 0.25 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: RED.clone().multiplyScalar(4 * LIGHTING.enemyGlow), toneMapped: false });
    b.courseDisposables.push(metal, plate, this.eyeMat);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 1.4, 8), metal);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), plate);
    dome.position.y = 0.7;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.66, 2.66, 0.22, 32, 1, true), this.eyeMat);
    band.position.y = 0.15;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.22, 8, 48), plate);
    this.ring.rotation.x = Math.PI / 2;
    const under = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.6, 0.5, 8), metal);
    under.position.y = -0.9;
    this.root.add(body, dome, band, this.ring, under);
    // Antennes et ailerons
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 1.6), plate);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      fin.position.set(Math.cos(a) * 3.2, 0.2, Math.sin(a) * 3.2);
      fin.rotation.y = -a;
      this.root.add(fin);
    }

    // Trois cœurs sous la carcasse, chacun dans un bouclier
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({ color: RED.clone().multiplyScalar(3), toneMapped: false });
      const shieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40c8ff).multiplyScalar(1.4), transparent: true, opacity: 0.28, wireframe: true, toneMapped: false });
      b.courseDisposables.push(mat, shieldMat);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.25), metal);
      arm.position.set(Math.cos(a) * 2.1, -0.75, Math.sin(a) * 2.1);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), mat);
      core.position.set(Math.cos(a) * 2.2, -1.35, Math.sin(a) * 2.2);
      const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), shieldMat);
      shield.position.copy(core.position);
      this.root.add(arm, core, shield);
      this.cores.push(new BossCore(this, core, shield, mat));
    }
    b.course.add(this.root);

    this.laser = new Beam(0xff1030, 4 * LIGHTING.enemyGlow);
    b.course.add(this.laser.mesh);
    this.warningMat = new THREE.MeshBasicMaterial({ color: RED.clone().multiplyScalar(2), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    b.courseDisposables.push(this.warningMat);
    this.warning = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), this.warningMat);
    this.warning.rotation.x = -Math.PI / 2;
    b.course.add(this.warning);
    this.reset();
  }

  /** Combat en cours (barre affichée, musique à fond). */
  get fighting(): boolean {
    return this.state !== 'dormant' && this.state !== 'intro' && this.state !== 'dying' && this.state !== 'dead';
  }

  get engaged(): boolean {
    return this.state !== 'dormant' && this.state !== 'dead';
  }

  get defeated(): boolean {
    return this.state === 'dead';
  }

  /** Cœurs détruits (0 → 3) : la Sentinelle accélère. */
  private get broken(): number {
    return this.cores.filter((c) => !c.alive).length;
  }

  private get pace(): number {
    return [1, 0.82, 0.68, 0.68][this.broken];
  }

  status(): { name: string; cores: number[] } | null {
    if (!this.engaged) return null;
    return { name: 'SENTINELLE AEGIS', cores: this.cores.map((c) => c.hp / CORE_HP) };
  }

  reset(): void {
    this.state = 'dormant';
    this.timer = 0;
    this.root.visible = true;
    this.root.position.set(this.center.x, this.floor - 16, this.center.z);
    this.laser.mesh.visible = false;
    this.warningMat.opacity = 0;
    for (const c of this.cores) {
      c.hp = CORE_HP;
      c.windowDamage = 0;
      c.flash = 0;
      c.mesh.visible = true;
      c.shield.visible = true;
    }
    this.updateCores();
  }

  update(dt: number, player: PlayerController): void {
    this.time += dt;
    this.timer += dt;
    this.ring.rotation.z += dt * (this.state === 'dying' ? 6 : 1.4);
    this.root.rotation.y += dt * 0.35;
    const hoverY = this.floor + HOVER + Math.sin(this.time * 1.3) * 0.35;

    switch (this.state) {
      case 'dormant': {
        const dx = player.position.x - this.center.x;
        const dz = player.position.z - this.center.z;
        if (player.alive && dx * dx + dz * dz < (this.arenaRadius + 4) ** 2 && player.feetY > this.floor - 1) {
          this.go('intro');
          this.s.audio.playChargedStrike();
          this.s.audio.playThunder(0.1);
          this.onMessage?.('SENTINELLE AEGIS', '#ff3b3b');
        }
        break;
      }
      case 'intro': {
        const k = Math.min(1, this.timer / 2.5);
        this.root.position.set(this.center.x, THREE.MathUtils.lerp(this.floor - 16, hoverY, 1 - Math.pow(1 - k, 3)), this.center.z);
        if (k >= 1) this.go('barrage');
        break;
      }
      case 'barrage': {
        this.orbit(dt, hoverY);
        this.volleyTimer -= dt;
        if (this.volleyTimer <= 0 && player.alive) {
          this.volleyTimer = 0.55 * this.pace;
          this.volley(player);
        }
        if (this.timer > 3.2) this.go('laser');
        break;
      }
      case 'laser': {
        this.moveTo(this.tmp.set(this.center.x, hoverY, this.center.z), dt, 2.5);
        const sweep = 5.5 * this.pace;
        if (this.timer > 0.6) {
          this.laserAngle += dt * this.laserDir * (1.5 / this.pace);
          this.drawLaser(player);
        }
        if (this.timer > sweep) {
          this.laser.mesh.visible = false;
          this.go('descent');
          this.target.set(player.position.x, this.floor, player.position.z);
          const off = this.tmp.subVectors(this.target, this.center).setY(0);
          if (off.length() > this.arenaRadius - 4) off.setLength(this.arenaRadius - 4);
          this.target.set(this.center.x + off.x, this.floor, this.center.z + off.z);
          this.from.copy(this.root.position);
          this.warning.position.set(this.target.x, this.floor + 0.08, this.target.z);
          this.onMessage?.('SAUTE !', '#ff3b3b');
        }
        break;
      }
      case 'descent': {
        const d = 1.2 * this.pace;
        const k = Math.min(1, this.timer / d);
        const e = k * k;
        this.root.position.set(
          THREE.MathUtils.lerp(this.from.x, this.target.x, e),
          THREE.MathUtils.lerp(this.from.y, this.floor + LOW, e),
          THREE.MathUtils.lerp(this.from.z, this.target.z, e),
        );
        const r = 0.6 + k * 7;
        this.warning.scale.set(r, r, r);
        this.warningMat.opacity = 0.35 + Math.sin(this.time * 30) * 0.25;
        if (k >= 1) {
          this.slam(player);
          this.go('open');
        }
        break;
      }
      case 'open': {
        this.root.position.y = this.floor + LOW + Math.sin(this.time * 2) * 0.1;
        if (this.timer > 3.6) {
          this.go('rise');
          this.from.copy(this.root.position);
        }
        break;
      }
      case 'rise': {
        const k = Math.min(1, this.timer / 1);
        this.root.position.y = THREE.MathUtils.lerp(this.from.y, hoverY, 1 - Math.pow(1 - k, 2));
        if (k >= 1) this.go('barrage');
        break;
      }
      case 'dying': {
        this.root.position.y -= dt * 1.5;
        this.root.rotation.z = Math.sin(this.time * 20) * 0.08;
        this.dyingBlast -= dt;
        if (this.dyingBlast <= 0) {
          this.dyingBlast = 0.22;
          const p = this.tmp.copy(this.root.position).add(this.tmp2.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5));
          this.s.particles.explosion(p, Math.random() < 0.5 ? 0xff2040 : 0xffa040);
          this.s.audio.playExplosion();
        }
        if (this.timer > 2.4) {
          this.state = 'dead';
          this.root.visible = false;
          this.s.particles.explosion(this.root.position, 0xffd23b);
          this.s.particles.explosion(this.tmp.copy(this.root.position).setY(this.root.position.y + 1.5), 0xff2bd6);
          this.s.audio.playSlam();
          this.onDefeated?.();
        }
        break;
      }
      case 'dead':
        break;
    }
    if (this.state !== 'descent') this.warningMat.opacity = Math.max(0, this.warningMat.opacity - dt * 3);
    this.updateCores();
  }

  /** Touche sur un cœur : bouclier sauf pendant l'ouverture ; les tirs renvoyés passent toujours. */
  hitCore(core: BossCore, amount: number, dir: THREE.Vector3, cause: KillCause): void {
    if (!core.alive || !this.fighting) return;
    let dmg = 0;
    if (cause === 'deflect') {
      dmg = 2;
    } else if (this.state === 'open') {
      dmg = Math.min(amount, WINDOW_CAP - core.windowDamage);
      core.windowDamage += dmg;
    }
    if (dmg <= 0) {
      // Bouclier : la touche ricoche
      this.s.particles.sparks(core.center, this.tmp.copy(dir).negate(), 0x40c8ff, 12);
      return;
    }
    core.hp = Math.max(0, core.hp - dmg);
    core.flash = 1;
    this.s.particles.sparks(core.center, this.tmp.copy(dir).negate(), 0xffa040, 30);
    this.s.audio.playBladeHit();
    if (core.hp > 0) return;
    // Cœur détruit
    core.mesh.visible = false;
    core.shield.visible = false;
    this.s.particles.explosion(core.center, 0xff2040);
    this.s.audio.playExplosion();
    this.onCoreDestroyed?.();
    if (this.cores.every((c) => !c.alive)) {
      this.go('dying');
      this.laser.mesh.visible = false;
      this.onMessage?.('SENTINELLE EN PERDITION', '#ffd23b');
    } else {
      this.onMessage?.(`CŒUR DÉTRUIT · ${this.cores.filter((c) => c.alive).length} RESTANT${this.broken < 2 ? 'S' : ''}`, '#ffa040');
    }
  }

  private go(state: BossState): void {
    this.state = state;
    this.timer = 0;
    if (state === 'barrage') this.volleyTimer = 0.4;
    if (state === 'laser') {
      this.laserDir = Math.random() < 0.5 ? 1 : -1;
      this.s.audio.playEnemyAim(1);
    }
    if (state === 'open') {
      for (const c of this.cores) c.windowDamage = 0;
      this.onMessage?.('CŒURS EXPOSÉS !', '#2bffb0');
    }
  }

  private orbit(dt: number, hoverY: number): void {
    const a = this.time * 0.5;
    this.moveTo(this.tmp.set(this.center.x + Math.sin(a) * 6, hoverY, this.center.z + Math.cos(a) * 6), dt, 1.5);
  }

  private moveTo(p: THREE.Vector3, dt: number, rate: number): void {
    this.root.position.lerp(p, 1 - Math.exp(-rate * dt));
  }

  /** Éventail de projectiles vers le joueur (5 au départ, +2 par cœur perdu). */
  private volley(player: PlayerController): void {
    const origin = this.tmp.copy(this.root.position).setY(this.root.position.y - 1.2);
    const chest = this.tmp2.copy(player.position).setY(player.position.y + 0.3);
    const base = chest.sub(origin).normalize();
    const n = 5 + this.broken * 2;
    const spread = THREE.MathUtils.degToRad(7);
    const dir = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * spread;
      dir.set(base.x * Math.cos(a) - base.z * Math.sin(a), base.y, base.x * Math.sin(a) + base.z * Math.cos(a)).normalize();
      this.s.enemies.fireProjectile(origin, dir, 20, RED);
    }
    this.s.particles.flash(origin, RED, 0.3, 2, 0.15, 6);
    this.s.audio.playEnemyShot(1);
  }

  /** Laser rasant qui balaie l'arène depuis la Sentinelle : il faut sauter par-dessus. */
  private drawLaser(player: PlayerController): void {
    // Assez bas pour ne pas aveugler la caméra, assez haut pour qu'il faille sauter
    const y = this.floor + 0.7;
    const dir = this.tmp.set(Math.cos(this.laserAngle), 0, Math.sin(this.laserAngle));
    const len = this.arenaRadius + 6;
    const a = this.from.set(this.root.position.x, y, this.root.position.z);
    const b = this.tmp2.copy(a).addScaledVector(dir, len);
    this.laser.set(a, b, 0.07);
    this.laser.mesh.visible = true;
    this.laser.setIntensity(1.6 + Math.sin(this.time * 40) * 0.3);
    this.laser.setOpacity(0.95);
    if (!player.alive) return;
    const vx = player.position.x - a.x;
    const vz = player.position.z - a.z;
    const along = vx * dir.x + vz * dir.z;
    const perp = Math.abs(vx * dir.z - vz * dir.x);
    if (along > 0 && along < len && perp < 0.6 && player.feetY < this.floor + 0.9) {
      if (player.damage(1)) this.s.particles.sparks(player.position, null, 0xff3040, 30);
    }
  }

  /** Impact de la descente : onde de choc au sol (un saut l'évite). */
  private slam(player: PlayerController): void {
    this.s.audio.playSlam();
    const p = this.tmp.set(this.root.position.x, this.floor + 0.3, this.root.position.z);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      this.s.particles.sparks(this.tmp2.set(p.x + Math.cos(a) * 4, p.y, p.z + Math.sin(a) * 4), new THREE.Vector3(Math.cos(a), 0.5, Math.sin(a)), 0xff3b3b, 6);
    }
    const dx = player.position.x - p.x;
    const dz = player.position.z - p.z;
    if (player.grounded && dx * dx + dz * dz < 7.5 * 7.5) player.damage(1);
    player.addShake(0.6);
  }

  /** Position monde des cœurs, boucliers et éclat selon l'état. */
  private updateCores(): void {
    this.root.updateMatrixWorld(true);
    const open = this.state === 'open';
    for (const c of this.cores) {
      c.mesh.getWorldPosition(c.center);
      if (!c.alive) continue;
      c.shield.visible = !open;
      c.flash = Math.max(0, c.flash - 0.08);
      const pulse = open ? 3 + Math.sin(this.time * 12) * 1.2 : 1.6;
      c.material.color.copy(RED).lerp(new THREE.Color(1, 1, 1), open ? 0.35 : 0).multiplyScalar(pulse + c.flash * 4);
    }
    this.eyeMat.color.copy(RED).multiplyScalar((this.state === 'laser' || this.state === 'barrage' ? 5 : 3) * LIGHTING.enemyGlow);
  }
}
