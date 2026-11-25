import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Physics } from '../core/Physics';
import type { InputManager } from '../core/InputManager';
import { MouseButton } from '../core/InputManager';
import type { AudioSynthesizer } from '../core/AudioSynthesizer';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { PlayerController } from '../player/PlayerController';
import { Beam } from '../effects/Beam';
import { BladeTrail } from '../effects/BladeTrail';
import { createRadialTexture } from '../effects/ParticleSystem';
import { BLADES, PISTOL } from '../config';

export type WeaponId = 'blades' | 'pistol';

interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

interface BladeArm {
  group: THREE.Group;
  blade: THREE.Mesh;
  side: 1 | -1;
  rest: Pose;
  windup: Pose;
  strike: Pose;
}

interface LaserShot {
  outer: Beam;
  core: Beam;
  from: THREE.Vector3;
  to: THREE.Vector3;
  life: number;
}

const CYAN = new THREE.Color(0x00e5ff);
const MAGENTA = new THREE.Color(0xff2bd6);
const SWITCH_TIME = 0.32;

function pose(x: number, y: number, z: number, rx: number, ry: number, rz: number): Pose {
  return {
    p: new THREE.Vector3(x, y, z),
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
  };
}

function mirrorPose(src: Pose): Pose {
  const e = new THREE.Euler().setFromQuaternion(src.q, 'YXZ');
  return pose(-src.p.x, src.p.y, src.p.z, e.x, -e.y, -e.z);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Armes en vue FPS : Mantis Blades (corps à corps, traînée lumineuse, propulsion,
 * renvoi de projectiles) et pistolet cybernétique (tir laser hitscan avec recul).
 * Les modèles vivent dans `engine.weaponScene`, synchronisée sur la caméra.
 */
export class WeaponManager {
  current: WeaponId = 'blades';
  onWeaponChange: ((id: WeaponId) => void) | null = null;

  private readonly engine: Engine;
  private readonly physics: Physics;
  private readonly enemies: EnemyManager;
  private readonly particles: ParticleSystem;
  private readonly audio: AudioSynthesizer;
  private readonly player: PlayerController;

  private readonly root = new THREE.Group();
  private readonly sway = new THREE.Group();
  private readonly bladesGroup = new THREE.Group();
  private readonly pistolGroup = new THREE.Group();
  private readonly pistolModel = new THREE.Group();
  private readonly arms: BladeArm[] = [];
  private readonly trail: BladeTrail;
  private readonly bladeTip = new THREE.Vector3(0.02, 0.95, 0);
  private readonly bladeMid = new THREE.Vector3(0.05, 0.35, 0);
  private readonly bladeMaterials: THREE.MeshStandardMaterial[] = [];

  private readonly muzzle = new THREE.Object3D();
  private readonly muzzleFlash: THREE.Mesh;
  private readonly muzzleLight: THREE.PointLight;
  private readonly worldMuzzleLight: THREE.PointLight;
  private readonly shots: LaserShot[] = [];
  private readonly pistolCoreMat: THREE.MeshStandardMaterial;

  // État
  private switchTimer = 0;
  private pendingWeapon: WeaponId | null = null;
  private slashTime = -1;
  private slashArm = 0;
  private slashCooldown = 0;
  private lastSlashT = 0;
  private fireCooldown = 0;
  private kick = 0;
  private flashTimer = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private time = 0;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    engine: Engine,
    physics: Physics,
    enemies: EnemyManager,
    particles: ParticleSystem,
    audio: AudioSynthesizer,
    player: PlayerController,
  ) {
    this.engine = engine;
    this.physics = physics;
    this.enemies = enemies;
    this.particles = particles;
    this.audio = audio;
    this.player = player;

    engine.weaponScene.add(this.root);
    this.root.add(this.sway);
    this.sway.add(this.bladesGroup, this.pistolGroup);
    this.setupLights();

    this.trail = new BladeTrail(CYAN);
    this.root.add(this.trail.mesh);

    this.buildBlades();
    this.pistolCoreMat = this.buildPistol();

    // Flash de bouche
    const flashMat = new THREE.MeshBasicMaterial({
      map: createRadialTexture(),
      color: new THREE.Color(1, 0.5, 1).multiplyScalar(4),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), flashMat);
    this.muzzleFlash.visible = false;
    this.muzzle.add(this.muzzleFlash);
    this.muzzleLight = new THREE.PointLight(0xff40e0, 0, 3, 2);
    this.muzzle.add(this.muzzleLight);
    this.worldMuzzleLight = new THREE.PointLight(0xff40e0, 0, 14, 2);
    engine.scene.add(this.worldMuzzleLight);

    for (let i = 0; i < 8; i++) {
      const outer = new Beam(MAGENTA, 3);
      const core = new Beam(0xffffff, 5);
      engine.scene.add(outer.mesh, core.mesh);
      this.shots.push({ outer, core, from: new THREE.Vector3(), to: new THREE.Vector3(), life: 0 });
    }

    this.applyVisibility();
  }

  reset(): void {
    this.slashTime = -1;
    this.slashCooldown = 0;
    this.fireCooldown = 0;
    this.kick = 0;
    this.switchTimer = 0;
    this.pendingWeapon = null;
    this.trail.clear();
    for (const s of this.shots) {
      s.life = 0;
      s.outer.mesh.visible = false;
      s.core.mesh.visible = false;
    }
    this.lastYaw = this.player.yaw;
    this.lastPitch = this.player.pitch;
    for (const arm of this.arms) {
      arm.group.position.copy(arm.rest.p);
      arm.group.quaternion.copy(arm.rest.q);
    }
  }

  get isSwitching(): boolean {
    return this.switchTimer > 0;
  }

  update(dt: number, realDt: number, input: InputManager, controlsEnabled: boolean): void {
    this.time += dt;
    this.slashCooldown = Math.max(0, this.slashCooldown - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (controlsEnabled && this.player.alive) {
      if (input.wasPressed('weapon1')) this.requestSwitch('blades');
      if (input.wasPressed('weapon2')) this.requestSwitch('pistol');
      const wheel = input.consumeWheel();
      if (wheel !== 0) this.requestSwitch(this.current === 'blades' ? 'pistol' : 'blades');

      if (this.switchTimer <= 0) {
        if (this.current === 'blades') {
          if ((input.wasMousePressed(MouseButton.Left) || input.isMouseDown(MouseButton.Left)) && this.slashCooldown <= 0) {
            this.startSlash();
          }
        } else if (input.isMouseDown(MouseButton.Left) && this.fireCooldown <= 0) {
          this.fire();
        }
      }
    } else {
      input.consumeWheel();
    }

    this.updateSwitch(dt);
    this.updateSway(dt, realDt);
    this.syncToCamera();
    this.updateBlades(dt);
    this.updatePistol(dt);
    this.updateShots(realDt);
  }

  // ---------------------------------------------------------------------------
  // Changement d'arme
  // ---------------------------------------------------------------------------

  private requestSwitch(id: WeaponId): void {
    if (id === this.current && this.switchTimer <= 0) return;
    if (this.pendingWeapon === id) return;
    this.pendingWeapon = id;
    this.switchTimer = SWITCH_TIME;
    this.slashTime = -1;
    this.audio.playWeaponSwitch();
  }

  private updateSwitch(dt: number): void {
    if (this.switchTimer <= 0) return;
    const before = this.switchTimer;
    this.switchTimer = Math.max(0, this.switchTimer - dt);
    const half = SWITCH_TIME / 2;
    if (before > half && this.switchTimer <= half && this.pendingWeapon) {
      this.current = this.pendingWeapon;
      this.pendingWeapon = null;
      this.applyVisibility();
      this.onWeaponChange?.(this.current);
    }
  }

  private applyVisibility(): void {
    this.bladesGroup.visible = this.current === 'blades';
    this.pistolGroup.visible = this.current === 'pistol';
  }

  // ---------------------------------------------------------------------------
  // Balancement / synchronisation
  // ---------------------------------------------------------------------------

  private updateSway(dt: number, realDt: number): void {
    const p = this.player;
    let dYaw = p.yaw - this.lastYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const dPitch = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;

    const k = 1 - Math.exp(-10 * realDt);
    this.swayX += (THREE.MathUtils.clamp(dYaw * 1.6, -0.06, 0.06) - this.swayX) * k;
    this.swayY += (THREE.MathUtils.clamp(-dPitch * 1.6, -0.06, 0.06) - this.swayY) * k;

    const speed = p.horizontalSpeed;
    const bobbing = p.grounded && !p.sliding && speed > 1;
    this.bobWeight += ((bobbing ? 1 : 0) - this.bobWeight) * (1 - Math.exp(-8 * dt));
    this.bobPhase += speed * dt * 1.25;
    const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobWeight;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.014 * this.bobWeight;

    // Abaissement pendant le changement d'arme
    let switchOffset = 0;
    if (this.switchTimer > 0) {
      const t = 1 - this.switchTimer / SWITCH_TIME; // 0 → 1
      switchOffset = t < 0.5 ? easeOutCubic(t * 2) : 1 - easeOutCubic((t - 0.5) * 2);
    }

    const airLift = p.grounded ? 0 : THREE.MathUtils.clamp(-p.velocity.y * 0.003, -0.03, 0.03);
    this.sway.position.set(this.swayX + bobX, this.swayY - bobY - switchOffset * 0.45 + airLift, 0);
    let roll = this.swayX * 1.5;
    if (p.sliding) roll += 0.18;
    if (p.wallRunning) roll -= 0.1;
    this.sway.rotation.set(-switchOffset * 0.6, 0, roll);
  }

  private syncToCamera(): void {
    const cam = this.engine.camera;
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    this.root.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------------------
  // Mantis Blades
  // ---------------------------------------------------------------------------

  private startSlash(): void {
    this.slashArm = 1 - this.slashArm;
    this.slashTime = 0;
    this.lastSlashT = 0;
    this.slashCooldown = BLADES.cooldown;
    const arm = this.arms[this.slashArm];
    this.trail.setColor(arm.side === 1 ? CYAN : MAGENTA);
    this.audio.playSlash();

    // Propulsion : bond vers une cible proche, sinon légère poussée vers l'avant.
    const eye = this.engine.camera.position;
    const forward = this.player.getLookDirection(this.tmp);
    const lungeTarget = this.enemies.findLungeTarget(
      eye,
      forward,
      BLADES.lungeRange,
      Math.cos(THREE.MathUtils.degToRad(BLADES.lungeConeDeg)),
    );
    if (lungeTarget && lungeTarget.distanceTo(eye) > BLADES.range * 0.8) {
      this.player.lungeTo(lungeTarget, BLADES.lungeSpeed);
    } else {
      this.player.pushForward(BLADES.forwardPush);
    }
  }

  private slashPose(arm: BladeArm, t: number, out: Pose): void {
    const w = 0.18;
    const s = 0.5;
    if (t < w) {
      const k = easeOutCubic(t / w);
      out.p.lerpVectors(arm.rest.p, arm.windup.p, k);
      out.q.slerpQuaternions(arm.rest.q, arm.windup.q, k);
    } else if (t < s) {
      const k = easeInOutCubic((t - w) / (s - w));
      out.p.lerpVectors(arm.windup.p, arm.strike.p, k);
      out.q.slerpQuaternions(arm.windup.q, arm.strike.q, k);
    } else {
      const k = easeInOutCubic((t - s) / (1 - s));
      out.p.lerpVectors(arm.strike.p, arm.rest.p, k);
      out.q.slerpQuaternions(arm.strike.q, arm.rest.q, k);
    }
  }

  private updateBlades(dt: number): void {
    // Pulsation des lames
    const pulse = 0.5 + Math.sin(this.time * 6) * 0.12;
    for (const m of this.bladeMaterials) m.emissiveIntensity = pulse;

    // Bras au repos : légère respiration
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i];
      if (this.slashTime >= 0 && i === this.slashArm) continue;
      const breathe = Math.sin(this.time * 2 + i) * 0.006;
      arm.group.position.copy(arm.rest.p);
      arm.group.position.y += breathe;
      arm.group.quaternion.copy(arm.rest.q);
    }

    if (this.slashTime >= 0 && this.current === 'blades') {
      const arm = this.arms[this.slashArm];
      const prevT = this.lastSlashT;
      this.slashTime += dt;
      const t = Math.min(1, this.slashTime / BLADES.slashDuration);

      // Sous-échantillonnage de l'animation pour une traînée lisse
      const sub = 4;
      const tmpPose: Pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      for (let i = 1; i <= sub; i++) {
        const ti = prevT + ((t - prevT) * i) / sub;
        this.slashPose(arm, ti, tmpPose);
        arm.group.position.copy(tmpPose.p);
        arm.group.quaternion.copy(tmpPose.q);
        if (ti > 0.1 && ti < 0.72) {
          arm.group.updateMatrixWorld(true);
          const tip = arm.blade.localToWorld(this.tmp.copy(this.bladeTip));
          const mid = arm.blade.localToWorld(this.tmp2.copy(this.bladeMid));
          this.root.worldToLocal(tip);
          this.root.worldToLocal(mid);
          this.trail.addSample(tip, mid);
        }
      }

      // Fenêtre active : touche les ennemis et renvoie les projectiles
      if (t >= BLADES.activeStart && prevT <= BLADES.activeEnd) {
        const eye = this.engine.camera.position;
        const forward = this.player.getLookDirection(this.tmp);
        const cos = Math.cos(THREE.MathUtils.degToRad(BLADES.coneAngleDeg));
        const kills = this.enemies.meleeSweep(eye, forward, BLADES.range, cos);
        if (kills > 0) this.audio.playBladeHit();
        this.enemies.deflectProjectiles(eye, forward, BLADES.deflectRange, Math.cos(THREE.MathUtils.degToRad(70)));
      }

      this.lastSlashT = t;
      if (t >= 1) this.slashTime = -1;
    }
    this.trail.update(dt, BLADES.trailLife);
  }

  private buildBlades(): void {
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x20232e, metalness: 0.85, roughness: 0.28 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x0d0e14, metalness: 0.2, roughness: 0.7 });

    // Profil incurvé de la lame (plan XY, longueur selon +Y)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.17, 0.45, 0.02, 0.95);
    shape.quadraticCurveTo(0.065, 0.45, -0.07, 0.03);
    shape.lineTo(0, 0);
    const bladeGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.012,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 1,
      curveSegments: 20,
    });
    bladeGeo.translate(0, 0, -0.006);

    // Tranchant lumineux
    const edgeCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.07, 0.03, 0),
      new THREE.Vector3(0.065, 0.45, 0),
      new THREE.Vector3(0.02, 0.95, 0),
    );
    const edgeGeo = new THREE.TubeGeometry(edgeCurve, 24, 0.0055, 5, false);

    const make = (side: 1 | -1, color: THREE.Color): BladeArm => {
      const group = new THREE.Group();
      const inner = new THREE.Group();
      inner.scale.x = side;
      group.add(inner);

      inner.add(this.meshAt(new THREE.BoxGeometry(0.09, 0.09, 0.46), armorMat, 0, 0, 0.06));
      inner.add(this.meshAt(new THREE.BoxGeometry(0.1, 0.06, 0.2), armorMat, 0.01, 0.045, 0.12));
      inner.add(this.meshAt(new THREE.BoxGeometry(0.115, 0.1, 0.12), armorMat, 0, 0, -0.17));
      inner.add(this.meshAt(new THREE.BoxGeometry(0.09, 0.1, 0.1), gloveMat, -0.005, -0.012, -0.26));

      const stripMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false });
      inner.add(this.meshAt(new THREE.BoxGeometry(0.012, 0.012, 0.36), stripMat, 0.046, 0.03, 0.04));
      inner.add(this.meshAt(new THREE.BoxGeometry(0.03, 0.012, 0.012), stripMat, 0.03, 0.052, -0.17));

      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x0a1418,
        metalness: 0.95,
        roughness: 0.18,
        emissive: color,
        emissiveIntensity: 0.5,
        side: THREE.DoubleSide,
      });
      this.bladeMaterials.push(bladeMat);
      const edgeMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(4), toneMapped: false });

      // Orientation de la lame à partir d'une base : longueur L (vers l'avant et le haut),
      // dos de la lame B (vers le haut / l'extérieur), épaisseur N = B × L.
      const L = new THREE.Vector3(0.06, 0.5, -1).normalize();
      const B = new THREE.Vector3(0.55, 1, 0);
      B.addScaledVector(L, -B.dot(L)).normalize();
      const N = new THREE.Vector3().crossVectors(B, L).normalize();
      const bladePivot = new THREE.Group();
      bladePivot.position.set(0.04, 0.035, -0.1);
      bladePivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(B, L, N));
      inner.add(bladePivot);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.scale.setScalar(0.62);
      bladePivot.add(blade);
      const edge = new THREE.Mesh(edgeGeo, edgeMat);
      blade.add(edge);

      const rest = pose(0.27, -0.3, -0.26, 0.08, -0.05, -0.12);
      const windup = pose(0.42, -0.06, -0.2, 0.55, -0.3, -1.05);
      const strike = pose(-0.14, -0.4, -0.44, -0.38, 0.9, 0.95);
      const arm: BladeArm = {
        group,
        blade,
        side,
        rest: side === 1 ? rest : mirrorPose(rest),
        windup: side === 1 ? windup : mirrorPose(windup),
        strike: side === 1 ? strike : mirrorPose(strike),
      };
      group.position.copy(arm.rest.p);
      group.quaternion.copy(arm.rest.q);
      this.bladesGroup.add(group);
      return arm;
    };

    this.arms.push(make(1, CYAN.clone()), make(-1, MAGENTA.clone()));
  }

  // ---------------------------------------------------------------------------
  // Pistolet
  // ---------------------------------------------------------------------------

  private fire(): void {
    this.fireCooldown = PISTOL.fireInterval;
    const cam = this.engine.camera;
    const origin = cam.position.clone();
    const dir = cam.getWorldDirection(new THREE.Vector3());

    const worldHit = this.physics.raycast(origin, dir, PISTOL.range);
    const maxDist = worldHit ? worldHit.distance : PISTOL.range;
    const enemyHit = this.enemies.raycast(origin, dir, maxDist, PISTOL.aimAssistRadius);

    let end: THREE.Vector3;
    if (enemyHit) {
      end = enemyHit.point;
      this.enemies.kill(enemyHit.enemy, dir);
    } else if (worldHit) {
      end = worldHit.point;
      this.particles.sparks(worldHit.point, worldHit.normal, 0xff40e0, 14);
    } else {
      end = origin.clone().addScaledVector(dir, PISTOL.range);
    }

    const muzzleWorld = this.muzzle.getWorldPosition(new THREE.Vector3());
    const shot = this.shots.find((s) => s.life <= 0) ?? this.shots[0];
    shot.from.copy(muzzleWorld);
    shot.to.copy(end);
    shot.life = PISTOL.beamDuration;
    shot.outer.set(shot.from, shot.to, 0.045);
    shot.core.set(shot.from, shot.to, 0.012);

    this.kick = 1;
    this.flashTimer = 0.05;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.muzzleLight.intensity = 6;
    this.worldMuzzleLight.position.copy(muzzleWorld);
    this.worldMuzzleLight.intensity = 25;
    this.player.addRecoil(PISTOL.recoilPitch);
    this.player.addShake(0.05);
    this.audio.playShot();
  }

  private updatePistol(dt: number): void {
    this.kick *= Math.exp(-14 * dt);
    this.pistolModel.position.set(0, this.kick * 0.012, this.kick * 0.09);
    this.pistolModel.rotation.set(this.kick * 0.28, 0, -this.kick * 0.04);
    this.pistolCoreMat.emissiveIntensity = 2 + this.kick * 6 + Math.sin(this.time * 4) * 0.3;

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.muzzleFlash.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }
    this.worldMuzzleLight.intensity *= Math.exp(-30 * dt);
  }

  private updateShots(realDt: number): void {
    for (const s of this.shots) {
      if (s.life <= 0) continue;
      s.life -= realDt;
      if (s.life <= 0) {
        s.outer.mesh.visible = false;
        s.core.mesh.visible = false;
        continue;
      }
      const k = s.life / PISTOL.beamDuration;
      s.outer.set(s.from, s.to, 0.045 * k);
      s.core.set(s.from, s.to, 0.014 * k);
      s.outer.setOpacity(k);
      s.core.setOpacity(k);
    }
  }

  private buildPistol(): THREE.MeshStandardMaterial {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x101218, metalness: 0.85, roughness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x06070a, metalness: 0.3, roughness: 0.6 });
    const armMat = new THREE.MeshStandardMaterial({ color: 0x161922, metalness: 0.8, roughness: 0.35 });
    const accentMat = new THREE.MeshBasicMaterial({ color: MAGENTA.clone().multiplyScalar(3.2), toneMapped: false });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x041014,
      emissive: CYAN,
      emissiveIntensity: 2,
      metalness: 0.5,
      roughness: 0.3,
    });

    const m = this.pistolModel;
    // Glissière, rail supérieur et carcasse
    m.add(this.meshAt(new THREE.BoxGeometry(0.052, 0.062, 0.3), bodyMat, 0, 0.035, -0.07));
    m.add(this.meshAt(new THREE.BoxGeometry(0.036, 0.014, 0.24), darkMat, 0, 0.072, -0.07));
    for (let i = 0; i < 4; i++) {
      m.add(this.meshAt(new THREE.BoxGeometry(0.038, 0.004, 0.012), accentMat, 0, 0.08, -0.14 + i * 0.03));
    }
    m.add(this.meshAt(new THREE.BoxGeometry(0.046, 0.034, 0.2), armMat, 0, -0.008, -0.05));
    // Lignes néon latérales
    for (const side of [-1, 1]) {
      m.add(this.meshAt(new THREE.BoxGeometry(0.002, 0.008, 0.25), accentMat, side * 0.027, 0.045, -0.08));
    }
    // Canon et bobines d'énergie
    const barrel = this.meshAt(new THREE.CylinderGeometry(0.017, 0.02, 0.13, 12), bodyMat, 0, 0.04, -0.27);
    barrel.rotation.x = Math.PI / 2;
    m.add(barrel);
    for (let i = 0; i < 3; i++) {
      const coil = this.meshAt(new THREE.TorusGeometry(0.026, 0.006, 6, 18), coreMat, 0, 0.04, -0.235 - i * 0.032);
      m.add(coil);
    }
    // Cellule d'énergie latérale
    const cell = this.meshAt(new THREE.CylinderGeometry(0.013, 0.013, 0.09, 10), coreMat, -0.034, 0.02, -0.02);
    cell.rotation.x = Math.PI / 2;
    m.add(cell);
    // Poignée inclinée + pontet
    const grip = this.meshAt(new THREE.BoxGeometry(0.044, 0.13, 0.062), darkMat, 0, -0.07, 0.04);
    grip.rotation.x = 0.32;
    m.add(grip);
    const gripLine = this.meshAt(new THREE.BoxGeometry(0.046, 0.09, 0.004), accentMat, 0, -0.07, 0.074);
    gripLine.rotation.x = 0.32;
    m.add(gripLine);
    m.add(this.meshAt(new THREE.BoxGeometry(0.012, 0.01, 0.07), bodyMat, 0, -0.04, -0.045));
    // Main gantée et avant-bras cybernétique
    const hand = this.meshAt(new THREE.BoxGeometry(0.075, 0.085, 0.09), darkMat, 0.006, -0.065, 0.055);
    hand.rotation.x = 0.32;
    m.add(hand);
    m.add(this.meshAt(new THREE.BoxGeometry(0.022, 0.022, 0.06), darkMat, -0.038, 0.006, -0.0));
    const forearm = this.meshAt(new THREE.BoxGeometry(0.08, 0.08, 0.36), armMat, 0.025, -0.13, 0.28);
    forearm.rotation.x = 0.45;
    m.add(forearm);
    const fStrip = this.meshAt(new THREE.BoxGeometry(0.006, 0.006, 0.28), accentMat, 0.066, -0.1, 0.27);
    fStrip.rotation.x = 0.45;
    m.add(fStrip);

    this.muzzle.position.set(0, 0.04, -0.35);
    m.add(this.muzzle);

    this.pistolGroup.add(m);
    this.pistolGroup.position.set(0.18, -0.18, -0.38);
    this.pistolGroup.rotation.set(0.03, 0.06, 0);
    return coreMat;
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  private setupLights(): void {
    this.root.add(new THREE.AmbientLight(0x404060, 0.8));
    const key = new THREE.DirectionalLight(0xbfd8ff, 1.2);
    key.position.set(0.5, 1, 0.6);
    this.root.add(key);
    this.root.add(key.target);
    const cyan = new THREE.PointLight(0x00e5ff, 1.3, 2.5, 2);
    cyan.position.set(0.5, 0.1, -0.3);
    this.root.add(cyan);
    const magenta = new THREE.PointLight(0xff2bd6, 1.3, 2.5, 2);
    magenta.position.set(-0.5, 0.1, -0.3);
    this.root.add(magenta);
  }

  private meshAt(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    return mesh;
  }
}
