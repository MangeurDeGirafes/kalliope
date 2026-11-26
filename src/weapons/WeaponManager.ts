import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Physics } from '../core/Physics';
import type { InputManager } from '../core/InputManager';
import { MouseButton } from '../core/InputManager';
import type { AudioSynthesizer } from '../core/AudioSynthesizer';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { Enemy, EnemyManager } from '../enemies/EnemyManager';
import type { PlayerController } from '../player/PlayerController';
import { Beam } from '../effects/Beam';
import { BladeTrail } from '../effects/BladeTrail';
import { createRadialTexture } from '../effects/ParticleSystem';
import { MantisArm, armPose, createArmPose, lerpArmPose, mirrorArmPose } from './MantisBladeModel';
import type { ArmPose } from './MantisBladeModel';
import { BLADES, CHARGED, LIGHTING, PISTOL, TOUCH } from '../config';
import { STATS } from '../progress/Progress';
import { vibrate } from '../core/Device';

export type WeaponId = 'blades' | 'pistol';

interface BladeArm {
  model: MantisArm;
  side: 1 | -1;
  /** Lame repliée contre l'avant-bras (début du déploiement). */
  folded: ArmPose;
  rest: ArmPose;
  /** Armé : patte repliée et levée, prête à frapper. */
  windup: ArmPose;
  /** Fin de frappe : genou déplié, lame tendue. */
  strike: ArmPose;
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

const DEPLOY_TIME = 0.45;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Léger dépassement (déploiement mécanique « qui claque »). */
function easeOutBack(t: number): number {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Armes en vue FPS : Mantis Blades (corps à corps, traînée lumineuse, propulsion,
 * renvoi de projectiles) et pistolet cybernétique (tir laser hitscan avec recul).
 * Les modèles vivent dans `engine.weaponScene`, synchronisée sur la caméra.
 */
export class WeaponManager {
  current: WeaponId = 'blades';
  onWeaponChange: ((id: WeaponId) => void) | null = null;
  /** Mode tactile : assistance de visée renforcée. */
  touchMode = false;
  /** Appelé quand l'attaque chargée frappe (hitstop, tremblement…). */
  onChargedStrike: (() => void) | null = null;

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
  private readonly armPose = createArmPose();

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
  /** Progression du déploiement des lames (0 = repliées, 1 = sorties). */
  private deploy = 1;
  /** Coup demandé pendant le temps de récupération (mémorisé brièvement). */
  private slashBuffer = 0;
  /** Durée de maintien de l'attaque (s) ; -1 = pas de maintien en cours. */
  private chargeHold = -1;
  private chargeReadyPlayed = false;
  private chargeStriking = false;
  private chargeTarget: Enemy | null = null;
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
      color: new THREE.Color(1, 0.5, 1).multiplyScalar(4 * LIGHTING.effects),
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
      const outer = new Beam(MAGENTA, 3 * LIGHTING.weaponGlow);
      const core = new Beam(0xffffff, 5 * LIGHTING.weaponGlow);
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
    this.deploy = 0;
    this.slashBuffer = 0;
    this.chargeHold = -1;
    this.chargeStriking = false;
    this.chargeTarget = null;
    this.audio.setCharge(0);
    for (const arm of this.arms) arm.model.apply(arm.folded);
    if (this.current === 'blades') this.audio.playBladeDeploy();
  }

  /** Niveau de charge de l'attaque (0 → 1). */
  get chargeLevel(): number {
    return this.chargeHold < 0 ? 0 : Math.min(1, this.chargeHold / CHARGED.holdTime);
  }

  /** La jauge de charge est affichée (maintien au-delà d'un simple clic). */
  get chargeVisible(): boolean {
    return this.chargeHold >= CHARGED.showAfter && this.current === 'blades';
  }

  get isChargeStriking(): boolean {
    return this.chargeStriking;
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
        if (this.current === 'blades') this.updateBladeInput(input, realDt);
        else if (input.isMouseDown(MouseButton.Left) && this.fireCooldown <= 0) this.fire();
      }
    } else {
      input.consumeWheel();
      this.cancelCharge();
    }
    if (this.current !== 'blades' || this.switchTimer > 0) this.cancelCharge();
    this.audio.setCharge(this.chargeVisible ? this.chargeLevel : 0);
    this.updateChargedStrike();

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
    if (this.chargeStriking) return;
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
      if (this.current === 'blades') {
        this.deploy = 0;
        this.audio.playBladeDeploy();
      }
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

  // ---------------------------------------------------------------------------
  // Attaque : clic = coup immédiat, maintien (CHARGED.holdTime) puis relâche = attaque chargée
  // ---------------------------------------------------------------------------

  private updateBladeInput(input: InputManager, realDt: number): void {
    this.slashBuffer = Math.max(0, this.slashBuffer - realDt);
    if (input.wasMousePressed(MouseButton.Left)) {
      this.slashBuffer = 0.2;
      this.chargeHold = 0;
      this.chargeReadyPlayed = false;
    }
    if (this.slashBuffer > 0 && this.slashCooldown <= 0 && !this.chargeStriking) {
      this.slashBuffer = 0;
      this.startSlash();
    }
    if (this.chargeHold < 0) return;
    if (input.isMouseDown(MouseButton.Left)) {
      // Temps réel : la durée de charge est la même pendant le Sandevistan
      this.chargeHold += realDt;
      if (this.chargeHold >= CHARGED.holdTime && !this.chargeReadyPlayed) {
        this.chargeReadyPlayed = true;
        this.audio.playChargeReady();
        vibrate(30);
      }
    } else {
      const ready = this.chargeHold >= CHARGED.holdTime;
      this.chargeHold = -1;
      if (ready && !this.chargeStriking) this.releaseChargedAttack();
    }
  }

  private cancelCharge(): void {
    this.chargeHold = -1;
    this.slashBuffer = 0;
  }

  /** Relâchement d'une charge complète : dash gratuit vers l'ennemi le plus proche. */
  private releaseChargedAttack(): void {
    const eye = this.engine.camera.position;
    this.chargeTarget = this.enemies.findNearestEnemy(eye, CHARGED.range);
    this.player.startChargeDash(this.chargeTarget ? this.chargeTarget.center : null, CHARGED.speed, CHARGED.maxDuration, CHARGED.noTargetDistance);
    this.chargeStriking = true;
    this.audio.playChargedStrike();
    vibrate(40);
  }

  private updateChargedStrike(): void {
    if (!this.chargeStriking) return;
    const target = this.chargeTarget;
    if (target && target.alive) this.player.setChargeDashTarget(target.center);
    // Traînée d'énergie derrière le joueur
    this.particles.burst(this.player.position, {
      count: 6,
      color: 0xff2bd6,
      color2: 0x00e5ff,
      intensity: 3,
      speedMin: 0.5,
      speedMax: 2,
      lifeMin: 0.2,
      lifeMax: 0.45,
      sizeMin: 0.05,
      sizeMax: 0.12,
      gravity: 0,
      drag: 3,
    });
    const eye = this.engine.camera.position;
    const reached = target !== null && target.alive && eye.distanceTo(target.center) < CHARGED.arriveDistance;
    if (reached || !this.player.isChargeDashing) this.finishChargedAttack();
  }

  private finishChargedAttack(): void {
    this.chargeStriking = false;
    this.player.endChargeDash();
    const eye = this.engine.camera.position;
    const forward = this.player.getLookDirection(this.tmp2);
    const target = this.chargeTarget;
    this.chargeTarget = null;
    if (target && target.alive && eye.distanceTo(target.center) < CHARGED.arriveDistance + 2) this.enemies.kill(target, forward);
    // Frappe circulaire : tout ce qui est autour est tranché, les projectiles renvoyés
    this.enemies.meleeSweep(eye, forward, CHARGED.sweepRange, -1);
    this.enemies.deflectProjectiles(eye, forward, CHARGED.sweepRange, -1);
    this.beginSlashAnimation();
    this.particles.burst(eye.clone().addScaledVector(forward, 1.2), {
      count: 70,
      color: 0xff2bd6,
      color2: 0x00e5ff,
      intensity: 4,
      speedMin: 6,
      speedMax: 16,
      lifeMin: 0.25,
      lifeMax: 0.55,
      sizeMin: 0.04,
      sizeMax: 0.1,
      gravity: 2,
      drag: 3,
    });
    this.audio.playBladeHit();
    vibrate(60);
    this.onChargedStrike?.();
  }

  /** Lance l'animation de coup (bras alterné, traînée, son). */
  private beginSlashAnimation(): void {
    this.slashArm = 1 - this.slashArm;
    this.slashTime = 0;
    this.lastSlashT = 0;
    this.slashCooldown = BLADES.cooldown;
    const arm = this.arms[this.slashArm];
    this.trail.setColor(arm.side === 1 ? CYAN : MAGENTA);
    this.audio.playSlash();
  }

  private startSlash(): void {
    this.beginSlashAnimation();

    // Propulsion : bond vers une cible proche, sinon légère poussée vers l'avant.
    const eye = this.engine.camera.position;
    const forward = this.player.getLookDirection(this.tmp);
    const cone = this.touchMode ? TOUCH.lungeConeDeg : BLADES.lungeConeDeg;
    const lungeTarget = this.enemies.findLungeTarget(eye, forward, STATS.lungeRange, Math.cos(THREE.MathUtils.degToRad(cone)));
    if (lungeTarget && lungeTarget.distanceTo(eye) > STATS.bladeRange * 0.8) {
      this.player.lungeTo(lungeTarget, BLADES.lungeSpeed);
    } else {
      this.player.pushForward(BLADES.forwardPush);
    }
  }

  /** Animation de frappe : armement (patte repliée) → détente du genou → retour. */
  private slashPose(arm: BladeArm, t: number, out: ArmPose): ArmPose {
    const w = 0.18;
    const s = 0.5;
    if (t < w) return lerpArmPose(arm.rest, arm.windup, easeOutCubic(t / w), out);
    if (t < s) return lerpArmPose(arm.windup, arm.strike, easeInOutCubic((t - w) / (s - w)), out);
    return lerpArmPose(arm.strike, arm.rest, easeInOutCubic((t - s) / (1 - s)), out);
  }

  private idlePose(arm: BladeArm, index: number, out: ArmPose): ArmPose {
    const k = this.deploy >= 1 ? 1 : easeOutBack(this.deploy);
    lerpArmPose(arm.folded, arm.rest, k, out);
    // Charge : la patte se replie, prête à frapper ; elle tremble une fois chargée
    const charge = this.chargeStriking ? 1 : this.chargeVisible ? this.chargeLevel : 0;
    if (charge > 0) {
      lerpArmPose(out, arm.windup, charge * 0.75, out);
      if (charge >= 1) {
        out.p.x += (Math.random() - 0.5) * 0.006;
        out.p.y += (Math.random() - 0.5) * 0.006;
      }
    }
    // Respiration + micro-mouvements mécaniques de la patte
    out.p.y += Math.sin(this.time * 2 + index) * 0.006;
    out.femur += Math.sin(this.time * 0.9 + index * 2) * 0.015;
    out.knee += Math.sin(this.time * 1.4 + index) * 0.035;
    return out;
  }

  private updateBlades(dt: number): void {
    this.deploy = Math.min(1, this.deploy + dt / DEPLOY_TIME);
    const charge = this.chargeStriking ? 1 : this.chargeVisible ? this.chargeLevel : 0;
    const pulse = 0.5 + Math.sin(this.time * (6 + charge * 18)) * 0.5 + charge * 2.2;
    for (const arm of this.arms) arm.model.setPulse(pulse);

    for (let i = 0; i < this.arms.length; i++) {
      if (this.slashTime >= 0 && i === this.slashArm) continue;
      const arm = this.arms[i];
      arm.model.apply(this.idlePose(arm, i, this.armPose));
    }

    if (this.slashTime >= 0 && this.current === 'blades') {
      const arm = this.arms[this.slashArm];
      const prevT = this.lastSlashT;
      this.slashTime += dt;
      const t = Math.min(1, this.slashTime / BLADES.slashDuration);

      // Sous-échantillonnage de l'animation pour une traînée lisse
      const sub = 4;
      for (let i = 1; i <= sub; i++) {
        const ti = prevT + ((t - prevT) * i) / sub;
        arm.model.apply(this.slashPose(arm, ti, this.armPose));
        if (ti > 0.12 && ti < 0.72) {
          arm.model.group.updateMatrixWorld(true);
          const tip = arm.model.tip.getWorldPosition(this.tmp);
          const mid = arm.model.edgeMid.getWorldPosition(this.tmp2);
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
        const kills = this.enemies.meleeSweep(eye, forward, STATS.bladeRange, cos);
        if (kills > 0) this.audio.playBladeHit();
        this.enemies.deflectProjectiles(eye, forward, BLADES.deflectRange, Math.cos(THREE.MathUtils.degToRad(70)));
      }

      this.lastSlashT = t;
      if (t >= 1) this.slashTime = -1;
    }
    this.trail.update(dt, BLADES.trailLife);
  }

  private buildBlades(): void {
    const make = (side: 1 | -1, color: THREE.Color): BladeArm => {
      const model = new MantisArm(side, color);
      // Poses du bras droit (le gauche est symétrique)
      // Garde de mante : avant-bras levés et tournés vers l'intérieur, griffes repliées devant.
      const folded = armPose(0.27, -0.44, -0.2, 0.3, 0.3, -0.15, -0.02, -2.75);
      const rest = armPose(0.25, -0.33, -0.27, 0.42, 0.36, -0.18, 0.28, -1.55);
      const windup = armPose(0.36, -0.14, -0.2, 0.75, -0.1, -0.85, 0.6, -2.4);
      const strike = armPose(-0.1, -0.26, -0.48, 0.04, 0.95, 0.5, 0.1, -0.16);
      const arm: BladeArm = {
        model,
        side,
        folded: side === 1 ? folded : mirrorArmPose(folded),
        rest: side === 1 ? rest : mirrorArmPose(rest),
        windup: side === 1 ? windup : mirrorArmPose(windup),
        strike: side === 1 ? strike : mirrorArmPose(strike),
      };
      model.apply(arm.rest);
      this.bladesGroup.add(model.group);
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
    const assist = this.touchMode ? TOUCH.pistolAimAssist : PISTOL.aimAssistRadius;
    const enemyHit = this.enemies.raycast(origin, dir, maxDist, assist);

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
    this.muzzleLight.intensity = 6 * LIGHTING.effects;
    this.worldMuzzleLight.position.copy(muzzleWorld);
    this.worldMuzzleLight.intensity = 25 * LIGHTING.effects;
    this.player.addRecoil(PISTOL.recoilPitch);
    this.player.addShake(0.05);
    this.audio.playShot();
  }

  private updatePistol(dt: number): void {
    this.kick *= Math.exp(-14 * dt);
    this.pistolModel.position.set(0, this.kick * 0.012, this.kick * 0.09);
    this.pistolModel.rotation.set(this.kick * 0.28, 0, -this.kick * 0.04);
    this.pistolCoreMat.emissiveIntensity = (2 + this.kick * 6 + Math.sin(this.time * 4) * 0.3) * LIGHTING.weaponGlow;

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
    const accentMat = new THREE.MeshBasicMaterial({ color: MAGENTA.clone().multiplyScalar(3.2 * LIGHTING.weaponGlow), toneMapped: false });
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
    const cyan = new THREE.PointLight(0x00e5ff, 1.3 * LIGHTING.weaponGlow, 2.5, 2);
    cyan.position.set(0.5, 0.1, -0.3);
    this.root.add(cyan);
    const magenta = new THREE.PointLight(0xff2bd6, 1.3 * LIGHTING.weaponGlow, 2.5, 2);
    magenta.position.set(-0.5, 0.1, -0.3);
    this.root.add(magenta);
  }

  private meshAt(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    return mesh;
  }
}
