import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';
import type { InputManager } from '../core/InputManager';
import { MouseButton } from '../core/InputManager';
import type { AudioSynthesizer } from '../core/AudioSynthesizer';
import { CAMERA, DASH, LEDGE, MOVEMENT, PISTOL, PLAYER, SANDEVISTAN, SLIDE, WALLRUN } from '../config';

const DOWN = new THREE.Vector3(0, -1, 0);

/** Événements de gameplay émis par le joueur (particules, HUD…). */
export interface PlayerListener {
  onDoubleJump?(feet: THREE.Vector3): void;
  onDash?(position: THREE.Vector3, dir: THREE.Vector3): void;
  onLand?(feet: THREE.Vector3, intensity: number): void;
  onWallJump?(position: THREE.Vector3, normal: THREE.Vector3): void;
  onSandevistan?(active: boolean): void;
  onHurt?(): void;
  onDeath?(): void;
}

/**
 * Contrôleur FPS de parkour : course, saut, double saut, glissade, wall-run,
 * franchissement de rebords, dash aérien et Sandevistan.
 * Basé sur le KinematicCharacterController de Rapier (capsule sans corps rigide).
 */
export class PlayerController {
  readonly camera: THREE.PerspectiveCamera;
  listener: PlayerListener | null = null;

  /** Centre de la capsule. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  grounded = false;
  crouched = false;
  sliding = false;
  wallRunning = false;
  dashing = false;
  alive = true;

  health: number = PLAYER.maxHealth;
  dashCharges: number = DASH.maxCharges;
  sandevistanActive = false;
  sandevistanEnergy = 1;
  /** 0 → 1, transition douce de l'effet Sandevistan. */
  sandevistanBlend = 0;
  /** 1 juste après un impact puis décroît (effet écran). */
  hurtFlash = 0;
  /** 0 → 1 pendant l'animation de mort. */
  deathBlend = 0;

  private readonly physics: Physics;
  private readonly audio: AudioSynthesizer;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  private halfHeight: number = PLAYER.standHalfHeight;
  private coyoteTimer = 0;
  private jumpBuffer = 0;
  private justJumpedTimer = 0;
  private airJumps: number = MOVEMENT.maxAirJumps;
  private slideTimer = 0;
  private slideCooldown = 0;
  private slideHeld = false;
  private wallRunTimer = 0;
  private wallSide = 0;
  private wallCooldown = 0;
  private readonly wallNormal = new THREE.Vector3();
  private readonly lastWallNormal = new THREE.Vector3();
  private dashTimer = 0;
  private dashRecharge = 0;
  private readonly dashDir = new THREE.Vector3();
  private mantleCooldown = 0;
  private lungeTimer = 0;
  private readonly lungeVelocity = new THREE.Vector3();
  private invulnerable = 0;
  private regenTimer = 0;

  // Caméra
  private roll = 0;
  private eyeHeight: number = PLAYER.eyeHeightStand;
  private bobPhase = 0;
  private bobWeight = 0;
  private landingDip = 0;
  private landingDipVel = 0;
  private recoil = 0;
  private trauma = 0;
  private fovKick = 0;

  // Temporaires
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();

  constructor(physics: Physics, audio: AudioSynthesizer, camera: THREE.PerspectiveCamera) {
    this.physics = physics;
    this.audio = audio;
    this.camera = camera;
    this.collider = physics.createCapsule(new THREE.Vector3(0, 5, 0), PLAYER.standHalfHeight, PLAYER.radius);
    physics.setIgnoredCollider(this.collider);

    this.controller = physics.createCharacterController(PLAYER.controllerOffset);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(PLAYER.autostepHeight, PLAYER.autostepMinWidth, false);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(PLAYER.maxSlopeDeg));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(PLAYER.maxSlopeDeg - 10));
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  // ---------------------------------------------------------------------------
  // Accesseurs
  // ---------------------------------------------------------------------------

  get feetY(): number {
    return this.position.y - (this.halfHeight + PLAYER.radius);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Progression (0 → 1) de la recharge de la prochaine charge de dash. */
  get dashRechargeProgress(): number {
    return this.dashCharges >= DASH.maxCharges ? 1 : this.dashRecharge / DASH.rechargeTime;
  }

  /** Segment interne de la capsule (pour les collisions avec les projectiles). */
  getCapsuleSegment(a: THREE.Vector3, b: THREE.Vector3): number {
    a.set(this.position.x, this.position.y - this.halfHeight, this.position.z);
    b.set(this.position.x, this.position.y + this.halfHeight, this.position.z);
    return PLAYER.radius;
  }

  /** Point visé par les ennemis (poitrine). */
  getChestPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.feetY + (this.crouched ? 0.6 : 1.3), this.position.z);
  }

  getLookDirection(out: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  // ---------------------------------------------------------------------------
  // Commandes externes
  // ---------------------------------------------------------------------------

  reset(feet: THREE.Vector3, yaw: number): void {
    if (this.crouched) this.setCrouched(false);
    this.halfHeight = PLAYER.standHalfHeight;
    this.collider.setHalfHeight(this.halfHeight);
    this.position.set(feet.x, feet.y + this.halfHeight + PLAYER.radius + 0.05, feet.z);
    this.collider.setTranslation(this.position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = false;
    this.sliding = false;
    this.wallRunning = false;
    this.dashing = false;
    this.alive = true;
    this.health = PLAYER.maxHealth;
    this.dashCharges = DASH.maxCharges;
    this.dashRecharge = 0;
    this.airJumps = MOVEMENT.maxAirJumps;
    this.sandevistanActive = false;
    this.sandevistanEnergy = 1;
    this.sandevistanBlend = 0;
    this.hurtFlash = 0;
    this.deathBlend = 0;
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.justJumpedTimer = 0;
    this.wallCooldown = 0;
    this.lastWallNormal.set(0, 0, 0);
    this.mantleCooldown = 0;
    this.lungeTimer = 0;
    this.invulnerable = 0;
    this.regenTimer = 0;
    this.roll = 0;
    this.eyeHeight = PLAYER.eyeHeightStand;
    this.landingDip = 0;
    this.landingDipVel = 0;
    this.recoil = 0;
    this.trauma = 0;
    this.fovKick = 0;
    this.audio.setSlowMotion(false);
    this.audio.stopLoops();
    this.updateCamera(0, 0, 0);
  }

  /** Propulsion (tremplins). */
  launch(verticalSpeed: number, horizontalBoost: THREE.Vector3): void {
    if (!this.alive) return;
    if (this.dashing) this.endDash();
    if (this.wallRunning) this.endWallRun(false);
    this.lungeTimer = 0;
    this.sliding = false;
    if (this.crouched && this.canStand()) this.setCrouched(false);
    this.velocity.y = verticalSpeed;
    this.velocity.x += horizontalBoost.x;
    this.velocity.z += horizontalBoost.z;
    this.grounded = false;
    this.coyoteTimer = 0;
    this.justJumpedTimer = 0.25;
    this.airJumps = MOVEMENT.maxAirJumps;
    this.dashCharges = DASH.maxCharges;
    this.fovKick = Math.max(this.fovKick, 8);
  }

  /** Petite impulsion horizontale vers l'avant (coup de lame). */
  pushForward(speed: number): void {
    this.getLookDirection(this.tmp);
    this.tmp.y = 0;
    if (this.tmp.lengthSq() < 1e-4) return;
    this.tmp.normalize();
    const along = this.velocity.x * this.tmp.x + this.velocity.z * this.tmp.z;
    const add = Math.max(0, Math.min(speed, MOVEMENT.runSpeed + speed - along));
    this.velocity.x += this.tmp.x * add;
    this.velocity.z += this.tmp.z * add;
  }

  /** Bond vers une cible (attaque à la lame à distance) : vitesse maintenue jusqu'au contact. */
  lungeTo(target: THREE.Vector3, speed: number): void {
    const eye = this.camera.position;
    this.tmp.subVectors(target, eye);
    const dist = this.tmp.length();
    if (dist < 0.01) return;
    this.tmp.divideScalar(dist);
    if (this.dashing) this.endDash();
    if (this.wallRunning) this.endWallRun(false);
    this.sliding = false;
    this.lungeTimer = THREE.MathUtils.clamp((dist - 1.6) / speed, 0.06, 0.35);
    this.lungeVelocity.set(this.tmp.x * speed, THREE.MathUtils.clamp(this.tmp.y * speed, -8, 8), this.tmp.z * speed);
    this.velocity.copy(this.lungeVelocity);
    if (this.lungeVelocity.y > 0.5) {
      this.grounded = false;
      this.justJumpedTimer = this.lungeTimer;
    }
    this.fovKick = Math.max(this.fovKick, 10);
  }

  addRecoil(amount: number): void {
    this.recoil += amount;
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Rend 20 % (ou plus) de jauge Sandevistan et une charge de dash (récompense d'élimination). */
  rewardKill(): void {
    this.sandevistanEnergy = Math.min(1, this.sandevistanEnergy + SANDEVISTAN.killRefill);
    this.dashCharges = Math.min(DASH.maxCharges, this.dashCharges + 1);
  }

  /** Inflige des dégâts. Renvoie true si le coup a été encaissé. */
  damage(amount: number): boolean {
    if (!this.alive || this.invulnerable > 0) return false;
    this.health -= amount;
    this.invulnerable = PLAYER.hurtInvulnerability;
    this.regenTimer = 0;
    this.hurtFlash = 1;
    this.addShake(0.55);
    this.audio.playHurt();
    this.listener?.onHurt?.();
    if (this.health <= 0) this.die();
    return true;
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.slideHeld = false;
    this.lungeTimer = 0;
    this.dashing = false;
    if (this.wallRunning) this.endWallRun(false);
    this.sliding = false;
    if (this.sandevistanActive) this.setSandevistan(false);
    this.audio.stopLoops();
    this.audio.playDeath();
    this.listener?.onDeath?.();
  }

  // ---------------------------------------------------------------------------
  // Mise à jour principale
  // ---------------------------------------------------------------------------

  /**
   * @param dt     pas de temps du joueur (réduit pendant le hitstop)
   * @param realDt temps réel (jauges, caméra)
   */
  update(dt: number, realDt: number, input: InputManager, controlsEnabled: boolean): void {
    this.updateTimers(dt, realDt);

    const mouse = input.consumeMouseDelta();
    if (!this.alive) {
      this.updateDeath(dt, realDt);
      return;
    }

    if (controlsEnabled) {
      this.yaw -= mouse.x * CAMERA.sensitivity;
      this.pitch -= mouse.y * CAMERA.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -CAMERA.pitchLimit, CAMERA.pitchLimit);
    }

    this.updateSandevistan(realDt, controlsEnabled && input.wasMousePressed(MouseButton.Right));

    let fwdIn = 0;
    let strafeIn = 0;
    if (controlsEnabled) {
      fwdIn = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      strafeIn = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    }
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.wish.set(0, 0, 0).addScaledVector(this.forward, fwdIn).addScaledVector(this.right, strafeIn);
    const hasWish = this.wish.lengthSq() > 0;
    if (hasWish) this.wish.normalize();

    const jumpPressed = controlsEnabled && input.wasPressed('jump');
    const dashPressed = controlsEnabled && input.wasPressed('dash');
    this.slideHeld = controlsEnabled && input.isDown('slide');

    if (dashPressed) this.tryDash(hasWish);

    if (this.lungeTimer > 0) {
      this.lungeTimer -= dt;
      this.velocity.copy(this.lungeVelocity);
      if (this.lungeTimer <= 0) {
        this.velocity.x *= 0.45;
        this.velocity.z *= 0.45;
        this.velocity.y = Math.min(this.velocity.y, 2);
      }
    } else if (this.dashing) {
      this.dashTimer -= dt;
      this.velocity.copy(this.dashDir).multiplyScalar(DASH.speed);
      if (this.dashTimer <= 0) this.endDash();
    } else if (this.wallRunning) {
      this.updateWallRun(dt, fwdIn);
    } else if (this.grounded) {
      this.updateGround(dt, hasWish);
    } else {
      this.updateAir(dt, hasWish);
    }

    this.updateCrouch();

    if (jumpPressed) this.handleJumpPress(hasWish);
    if (this.jumpBuffer > 0 && this.grounded && !this.dashing) this.groundJump();

    if (!this.grounded && !this.wallRunning && !this.dashing) {
      if (fwdIn > 0) this.tryStartWallRun();
      if (fwdIn > 0 && !this.wallRunning) this.tryMantle();
    }

    // Gravité
    if (!this.dashing && this.lungeTimer <= 0 && !this.grounded) {
      let g: number = MOVEMENT.gravity;
      if (this.wallRunning) {
        const k = Math.min(1, this.wallRunTimer / WALLRUN.maxDuration);
        g = THREE.MathUtils.lerp(WALLRUN.gravityStart, WALLRUN.gravityEnd, k * k);
      }
      this.velocity.y = Math.max(this.velocity.y - g * dt, -MOVEMENT.maxFallSpeed);
    }

    this.move(dt);
    this.updateCamera(dt, realDt, strafeIn);
  }

  // ---------------------------------------------------------------------------
  // États de déplacement
  // ---------------------------------------------------------------------------

  private updateTimers(dt: number, realDt: number): void {
    this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.justJumpedTimer = Math.max(0, this.justJumpedTimer - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - realDt);
    this.hurtFlash = Math.max(0, this.hurtFlash - realDt * 2.2);

    if (this.dashCharges < DASH.maxCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= DASH.rechargeTime) {
        this.dashCharges++;
        this.dashRecharge = 0;
      }
    } else {
      this.dashRecharge = 0;
    }

    if (this.alive && this.health < PLAYER.maxHealth) {
      this.regenTimer += realDt;
      if (this.regenTimer >= PLAYER.healthRegenDelay) {
        this.health++;
        this.regenTimer = PLAYER.healthRegenDelay - PLAYER.healthRegenInterval;
      }
    }
  }

  private updateGround(dt: number, hasWish: boolean): void {
    this.coyoteTimer = MOVEMENT.coyoteTime;
    this.velocity.y = -1.5; // maintient le contact avec le sol

    if (this.sliding) {
      this.slideTimer += dt;
      const friction = this.slideTimer < SLIDE.duration ? SLIDE.friction : SLIDE.endFriction;
      const f = Math.exp(-friction * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
      if (hasWish) this.steerHorizontal(this.wish, SLIDE.steerRate * dt);
      if (this.horizontalSpeed < SLIDE.endSpeed) {
        this.sliding = false;
        this.slideCooldown = SLIDE.cooldown;
        this.audio.setSliding(false);
      }
      return;
    }

    const maxSpeed = this.crouched ? SLIDE.crouchSpeed : MOVEMENT.runSpeed;
    const rate = hasWish ? MOVEMENT.groundAccel : MOVEMENT.groundFriction;
    const k = 1 - Math.exp(-rate * dt);
    const tx = this.wish.x * maxSpeed;
    const tz = this.wish.z * maxSpeed;
    this.velocity.x += (tx - this.velocity.x) * k;
    this.velocity.z += (tz - this.velocity.z) * k;
  }

  private updateAir(dt: number, hasWish: boolean): void {
    if (hasWish) {
      // Contrôle aérien façon Quake : on n'ajoute de la vitesse que si elle est
      // inférieure à la vitesse cible dans la direction voulue (conservation de l'élan).
      const current = this.velocity.x * this.wish.x + this.velocity.z * this.wish.z;
      const add = MOVEMENT.airSpeed - current;
      if (add > 0) {
        const accel = Math.min(MOVEMENT.airAccel * MOVEMENT.airSpeed * dt, add);
        this.velocity.x += this.wish.x * accel;
        this.velocity.z += this.wish.z * accel;
      }
    }
    const drag = Math.exp(-MOVEMENT.airDrag * dt);
    this.velocity.x *= drag;
    this.velocity.z *= drag;
  }

  /** Fait pivoter la vitesse horizontale vers `target` d'au plus `maxAngle` radians. */
  private steerHorizontal(target: THREE.Vector3, maxAngle: number): void {
    const vx = this.velocity.x;
    const vz = this.velocity.z;
    const speed = Math.hypot(vx, vz);
    if (speed < 0.01) return;
    const cross = vz * target.x - vx * target.z;
    const dot = vx * target.x + vz * target.z;
    const angle = THREE.MathUtils.clamp(Math.atan2(cross, dot), -maxAngle, maxAngle);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.velocity.x = vx * c + vz * s;
    this.velocity.z = -vx * s + vz * c;
  }

  // --- Glissade / accroupi -------------------------------------------------

  private updateCrouch(): void {
    if (this.grounded && this.slideHeld && !this.crouched) {
      this.setCrouched(true);
      if (this.horizontalSpeed >= SLIDE.minSpeed && this.slideCooldown <= 0) this.startSlide();
    }
    if (this.crouched && !this.slideHeld && this.canStand()) {
      this.setCrouched(false);
      if (this.sliding) {
        this.sliding = false;
        this.slideCooldown = SLIDE.cooldown;
      }
    }
    if (this.sliding && !this.grounded) {
      this.sliding = false;
    }
    this.audio.setSliding(this.sliding && this.grounded);
  }

  private startSlide(): void {
    const speed = this.horizontalSpeed;
    let dirX = this.velocity.x / speed;
    let dirZ = this.velocity.z / speed;
    if (!Number.isFinite(dirX)) {
      dirX = this.forward.x;
      dirZ = this.forward.z;
    }
    const newSpeed = Math.max(speed, Math.min(speed + SLIDE.boost, SLIDE.maxSpeed));
    this.velocity.x = dirX * newSpeed;
    this.velocity.z = dirZ * newSpeed;
    this.sliding = true;
    this.slideTimer = 0;
    this.fovKick = Math.max(this.fovKick, 5);
    this.audio.playSlideStart();
  }

  private setCrouched(crouch: boolean): void {
    const newHalf = crouch ? PLAYER.slideHalfHeight : PLAYER.standHalfHeight;
    // On garde les pieds au même endroit : le centre se déplace de la différence.
    this.position.y += newHalf - this.halfHeight;
    this.halfHeight = newHalf;
    this.collider.setHalfHeight(newHalf);
    this.collider.setTranslation(this.position);
    this.crouched = crouch;
  }

  private canStand(): boolean {
    if (!this.crouched) return true;
    const delta = PLAYER.standHalfHeight - this.halfHeight;
    this.tmp.set(this.position.x, this.position.y + delta + 0.03, this.position.z);
    return this.physics.isCapsuleFree(this.tmp, PLAYER.standHalfHeight, PLAYER.radius * 0.92);
  }

  // --- Sauts ----------------------------------------------------------------

  private handleJumpPress(hasWish: boolean): void {
    if (this.dashing) this.endDash();
    if (this.wallRunning) {
      this.wallJump();
      return;
    }
    if (this.grounded || this.coyoteTimer > 0) {
      this.groundJump();
      return;
    }
    if (this.airJumps > 0) {
      this.doubleJump(hasWish);
      return;
    }
    this.jumpBuffer = MOVEMENT.jumpBufferTime;
  }

  private groundJump(): void {
    if (this.crouched && this.canStand()) this.setCrouched(false);
    if (this.sliding) {
      // Saut depuis une glissade : l'élan horizontal est conservé intégralement.
      this.sliding = false;
      this.slideCooldown = SLIDE.cooldown;
    }
    this.velocity.y = MOVEMENT.jumpVelocity;
    this.grounded = false;
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.justJumpedTimer = 0.12;
    this.audio.playJump();
  }

  private doubleJump(hasWish: boolean): void {
    this.airJumps--;
    this.velocity.y = MOVEMENT.doubleJumpVelocity;
    if (hasWish) {
      // Le double saut permet de réorienter l'élan sans le perdre.
      const speed = Math.max(this.horizontalSpeed, MOVEMENT.runSpeed * 0.9);
      this.velocity.x = this.wish.x * speed;
      this.velocity.z = this.wish.z * speed;
    }
    this.justJumpedTimer = 0.1;
    this.audio.playDoubleJump();
    this.tmp.set(this.position.x, this.feetY, this.position.z);
    this.listener?.onDoubleJump?.(this.tmp);
  }

  // --- Dash -----------------------------------------------------------------

  private tryDash(hasWish: boolean): void {
    if (this.dashing || this.lungeTimer > 0) return;
    if (DASH.airOnly && this.grounded) return;
    if (this.dashCharges <= 0) {
      this.audio.playDenied();
      return;
    }
    if (hasWish) this.dashDir.copy(this.wish);
    else this.dashDir.copy(this.forward);
    this.dashing = true;
    this.dashTimer = DASH.duration;
    this.dashCharges--;
    if (this.wallRunning) this.endWallRun(false);
    this.sliding = false;
    this.fovKick = DASH.fovKick;
    this.addShake(0.12);
    this.audio.playDash();
    this.listener?.onDash?.(this.position, this.dashDir);
  }

  private endDash(): void {
    this.dashing = false;
    const exit = Math.max(DASH.exitSpeed, MOVEMENT.runSpeed);
    this.velocity.set(this.dashDir.x * exit, 0, this.dashDir.z * exit);
  }

  // --- Wall-run -------------------------------------------------------------

  private tryStartWallRun(): void {
    if (this.horizontalSpeed < WALLRUN.minSpeed) return;
    if (this.velocity.y > 9) return;

    // Il faut être assez haut au-dessus du sol.
    const groundProbe = this.halfHeight + PLAYER.radius + WALLRUN.minHeightAboveGround;
    if (this.physics.raycast(this.position, DOWN, groundProbe)) return;

    const probeLength = PLAYER.radius + WALLRUN.detectDistance;
    let bestDist = Infinity;
    let found = false;
    const dirs = [
      this.tmp.copy(this.right),
      this.tmp2.copy(this.right).negate(),
      new THREE.Vector3().copy(this.right).add(this.forward).normalize(),
      new THREE.Vector3().copy(this.right).negate().add(this.forward).normalize(),
    ];
    for (const d of dirs) {
      const hit = this.physics.raycast(this.position, d, probeLength);
      if (!hit || Math.abs(hit.normal.y) > 0.3) continue;
      if (hit.distance < bestDist) {
        bestDist = hit.distance;
        this.tmpN.set(hit.normal.x, 0, hit.normal.z).normalize();
        found = true;
      }
    }
    if (!found) return;
    if (this.wallCooldown > 0 && this.tmpN.dot(this.lastWallNormal) > 0.8) return;

    const along = this.tmp.set(this.tmpN.z, 0, -this.tmpN.x);
    let alongSpeed = this.velocity.x * along.x + this.velocity.z * along.z;
    if (alongSpeed < 0) {
      along.negate();
      alongSpeed = -alongSpeed;
    }
    if (alongSpeed < WALLRUN.minSpeed * 0.6) return;

    this.wallRunning = true;
    this.wallRunTimer = 0;
    this.wallNormal.copy(this.tmpN);
    this.wallSide = -this.tmpN.dot(this.right) > 0 ? 1 : -1;
    this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, 1, WALLRUN.maxVerticalOnStart);
    this.airJumps = MOVEMENT.maxAirJumps;
    this.dashCharges = DASH.maxCharges;
    this.audio.playWallRunStart();
    this.audio.setWallRunning(true);
  }

  private updateWallRun(dt: number, fwdIn: number): void {
    this.wallRunTimer += dt;
    this.tmp2.copy(this.wallNormal).negate();
    const hit = this.physics.raycast(this.position, this.tmp2, PLAYER.radius + WALLRUN.detectDistance + 0.35);
    if (!hit || Math.abs(hit.normal.y) > 0.3) {
      this.endWallRun(true);
      return;
    }
    this.wallNormal.set(hit.normal.x, 0, hit.normal.z).normalize();

    const along = this.tmp.set(this.wallNormal.z, 0, -this.wallNormal.x);
    let alongSpeed = this.velocity.x * along.x + this.velocity.z * along.z;
    if (alongSpeed < 0) {
      along.negate();
      alongSpeed = -alongSpeed;
    }
    if (alongSpeed < WALLRUN.speed) alongSpeed = Math.min(WALLRUN.speed, alongSpeed + WALLRUN.acceleration * dt);

    this.velocity.x = along.x * alongSpeed - this.wallNormal.x * WALLRUN.stickVelocity;
    this.velocity.z = along.z * alongSpeed - this.wallNormal.z * WALLRUN.stickVelocity;

    if (this.wallRunTimer > WALLRUN.maxDuration || fwdIn <= 0 || alongSpeed < WALLRUN.minSpeed * 0.5) {
      this.endWallRun(true);
    }
  }

  private wallJump(): void {
    const along = this.tmp.set(this.wallNormal.z, 0, -this.wallNormal.x);
    let alongSpeed = this.velocity.x * along.x + this.velocity.z * along.z;
    if (alongSpeed < 0) {
      along.negate();
      alongSpeed = -alongSpeed;
    }
    alongSpeed = Math.max(alongSpeed, WALLRUN.speed * 0.9);
    this.velocity.x =
      along.x * alongSpeed + this.wallNormal.x * WALLRUN.jumpSide + this.forward.x * WALLRUN.jumpLookBoost;
    this.velocity.z =
      along.z * alongSpeed + this.wallNormal.z * WALLRUN.jumpSide + this.forward.z * WALLRUN.jumpLookBoost;
    this.velocity.y = WALLRUN.jumpUp;
    this.listener?.onWallJump?.(this.position, this.wallNormal);
    this.endWallRun(false);
    this.airJumps = MOVEMENT.maxAirJumps;
    this.justJumpedTimer = 0.12;
    this.audio.playDoubleJump();
  }

  private endWallRun(pushAway: boolean): void {
    if (!this.wallRunning) return;
    this.wallRunning = false;
    this.lastWallNormal.copy(this.wallNormal);
    this.wallCooldown = WALLRUN.sameWallCooldown;
    if (pushAway) {
      this.velocity.x += this.wallNormal.x * 1.5;
      this.velocity.z += this.wallNormal.z * 1.5;
    }
    this.audio.setWallRunning(false);
  }

  // --- Franchissement de rebord ---------------------------------------------

  private tryMantle(): void {
    if (this.mantleCooldown > 0 || this.velocity.y > 3) return;
    const feet = this.feetY;
    const origin = this.tmp.set(this.position.x, feet + 0.5, this.position.z);
    const wallHit = this.physics.raycast(origin, this.forward, PLAYER.radius + LEDGE.probeDistance);
    if (!wallHit || Math.abs(wallHit.normal.y) > 0.3) return;

    const probe = this.tmp2
      .copy(wallHit.point)
      .addScaledVector(this.forward, 0.35);
    probe.y = feet + LEDGE.maxHeight + 0.3;
    const topHit = this.physics.raycast(probe, DOWN, LEDGE.maxHeight + 0.3 - LEDGE.minHeight);
    if (!topHit || topHit.normal.y < 0.7 || topHit.distance < 0.01) return;
    const height = topHit.point.y - feet;
    if (height < LEDGE.minHeight || height > LEDGE.maxHeight) return;

    const clearance = this.tmpN.set(
      topHit.point.x,
      topHit.point.y + PLAYER.standHalfHeight + PLAYER.radius + 0.05,
      topHit.point.z,
    );
    if (!this.physics.isCapsuleFree(clearance, PLAYER.standHalfHeight, PLAYER.radius * 0.9)) return;

    this.velocity.y = Math.sqrt(2 * MOVEMENT.gravity * (height + 0.3));
    const along = this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
    const speed = Math.max(along, 4.5);
    this.velocity.x = this.forward.x * speed;
    this.velocity.z = this.forward.z * speed;
    this.mantleCooldown = LEDGE.cooldown;
    this.justJumpedTimer = 0.1;
    this.audio.playVault();
  }

  // --- Sandevistan ------------------------------------------------------------

  private updateSandevistan(realDt: number, togglePressed: boolean): void {
    if (togglePressed) {
      if (this.sandevistanActive) this.setSandevistan(false);
      else if (this.sandevistanEnergy >= SANDEVISTAN.minToActivate) this.setSandevistan(true);
      else this.audio.playDenied();
    }
    if (this.sandevistanActive) {
      this.sandevistanEnergy -= SANDEVISTAN.drainPerSecond * realDt;
      if (this.sandevistanEnergy <= 0) {
        this.sandevistanEnergy = 0;
        this.setSandevistan(false);
      }
    } else {
      this.sandevistanEnergy = Math.min(1, this.sandevistanEnergy + SANDEVISTAN.rechargePerSecond * realDt);
    }
    const target = this.sandevistanActive ? 1 : 0;
    this.sandevistanBlend += (target - this.sandevistanBlend) * (1 - Math.exp(-SANDEVISTAN.transitionSpeed * realDt));
  }

  private setSandevistan(active: boolean): void {
    if (this.sandevistanActive === active) return;
    this.sandevistanActive = active;
    this.audio.setSlowMotion(active);
    this.audio.playSandevistan(active);
    this.listener?.onSandevistan?.(active);
  }

  // --- Déplacement physique --------------------------------------------------

  private move(dt: number): void {
    if (dt <= 0) return;
    const desired = this.tmp.copy(this.velocity).multiplyScalar(dt);
    const preVy = this.velocity.y;

    if (this.grounded && this.velocity.y <= 0 && !this.dashing) {
      this.controller.enableSnapToGround(PLAYER.snapToGround);
    } else {
      this.controller.disableSnapToGround();
    }

    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = this.controller.computedMovement();

    // On retire de la vitesse la composante qui s'enfonce dans les obstacles.
    const n = this.tmpN;
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      n.set(c.normal1.x, c.normal1.y, c.normal1.z);
      if (n.dot(desired) > 0) n.negate();
      const vn = this.velocity.dot(n);
      if (vn < 0) this.velocity.addScaledVector(n, -vn);
    }

    this.position.x += mv.x;
    this.position.y += mv.y;
    this.position.z += mv.z;
    this.collider.setTranslation(this.position);

    const groundedNow = this.controller.computedGrounded() && this.justJumpedTimer <= 0 && this.velocity.y <= 0.5;
    if (groundedNow && !this.grounded) this.onLand(-preVy);
    this.grounded = groundedNow;
  }

  private onLand(fallSpeed: number): void {
    this.airJumps = MOVEMENT.maxAirJumps;
    this.dashCharges = DASH.maxCharges;
    this.lastWallNormal.set(0, 0, 0);
    this.wallCooldown = 0;
    if (this.wallRunning) this.endWallRun(false);
    if (fallSpeed > 4) {
      const intensity = Math.min(1, fallSpeed / 22);
      this.landingDipVel -= intensity * 5;
      this.audio.playLand(intensity);
      this.tmp2.set(this.position.x, this.feetY, this.position.z);
      this.listener?.onLand?.(this.tmp2, intensity);
    }
    if (this.slideHeld && this.horizontalSpeed >= SLIDE.minSpeed) {
      // Atterrissage en glissade : l'élan aérien est conservé.
      if (!this.crouched) this.setCrouched(true);
      this.startSlide();
    }
  }

  // --- Mort -------------------------------------------------------------------

  private updateDeath(dt: number, realDt: number): void {
    this.deathBlend = Math.min(1, this.deathBlend + realDt * 1.2);
    if (!this.grounded) this.velocity.y = Math.max(this.velocity.y - MOVEMENT.gravity * dt, -MOVEMENT.maxFallSpeed);
    const f = Math.exp(-4 * dt);
    this.velocity.x *= f;
    this.velocity.z *= f;
    this.move(dt);
    this.updateCamera(dt, realDt, 0);
  }

  // --- Caméra -------------------------------------------------------------------

  private updateCamera(dt: number, realDt: number, strafeIn: number): void {
    const cam = this.camera;
    const smooth = (rate: number, delta: number) => 1 - Math.exp(-rate * delta);

    // Hauteur des yeux (glissade / mort)
    let targetEye: number = this.crouched ? PLAYER.eyeHeightSlide : PLAYER.eyeHeightStand;
    if (!this.alive) targetEye = 0.35;
    this.eyeHeight += (targetEye - this.eyeHeight) * smooth(PLAYER.eyeHeightLerp, dt);

    // Balancement de tête + bruits de pas
    const hSpeed = this.horizontalSpeed;
    const bobbing = this.alive && this.grounded && !this.sliding && hSpeed > 1;
    this.bobWeight += ((bobbing ? 1 : 0) - this.bobWeight) * smooth(10, dt);
    if (bobbing) {
      const before = Math.floor(this.bobPhase / Math.PI);
      this.bobPhase += (hSpeed * dt * Math.PI) / MOVEMENT.footstepDistance * CAMERA.headBobFrequency * 0.75;
      if (Math.floor(this.bobPhase / Math.PI) !== before) this.audio.playFootstep();
    }
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * CAMERA.headBobAmount * this.bobWeight;
    const bobX = Math.cos(this.bobPhase) * CAMERA.headBobAmount * 0.6 * this.bobWeight;

    // Ressort d'atterrissage
    this.landingDipVel += (-this.landingDip * 160 - this.landingDipVel * 16) * dt;
    this.landingDip += this.landingDipVel * dt;
    this.landingDip = THREE.MathUtils.clamp(this.landingDip, -CAMERA.landingDipMax, 0.1);

    // Inclinaison (wall-run, strafe, glissade, mort)
    let targetRoll = -strafeIn * CAMERA.strafeLean;
    if (this.wallRunning) targetRoll = this.wallSide * WALLRUN.cameraTilt;
    else if (this.sliding) targetRoll += 0.06;
    if (!this.alive) targetRoll = 0.55;
    this.roll += (targetRoll - this.roll) * smooth(WALLRUN.tiltSpeed, realDt);

    // Recul et tremblement
    this.recoil *= Math.exp(-PISTOL.recoilRecovery * realDt);
    this.trauma = Math.max(0, this.trauma - realDt * 1.6);
    const shake = this.trauma * this.trauma;
    const shakePitch = (Math.random() * 2 - 1) * shake * 0.035;
    const shakeYaw = (Math.random() * 2 - 1) * shake * 0.035;
    const shakeRoll = (Math.random() * 2 - 1) * shake * 0.05;

    // Champ de vision dynamique
    this.fovKick *= Math.exp(-5 * realDt);
    const speedK = THREE.MathUtils.clamp((hSpeed - MOVEMENT.runSpeed * 0.8) / (DASH.speed - MOVEMENT.runSpeed * 0.8), 0, 1);
    const targetFov = CAMERA.fov + speedK * CAMERA.speedFovBoost + this.fovKick - this.sandevistanBlend * 6;
    if (realDt > 0) {
      cam.fov += (targetFov - cam.fov) * smooth(8, realDt);
    } else {
      cam.fov = targetFov;
    }
    cam.updateProjectionMatrix();

    const feet = this.feetY;
    cam.position.set(
      this.position.x + this.right.x * bobX,
      feet + this.eyeHeight + bobY + this.landingDip,
      this.position.z + this.right.z * bobX,
    );
    cam.rotation.set(this.pitch + this.recoil + shakePitch, this.yaw + shakeYaw, this.roll + shakeRoll, 'YXZ');
    cam.updateMatrixWorld();
  }
}
