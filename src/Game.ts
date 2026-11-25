import * as THREE from 'three';
import { Engine } from './core/Engine';
import { InputManager } from './core/InputManager';
import { AudioSynthesizer } from './core/AudioSynthesizer';
import { Physics } from './core/Physics';
import { ParticleSystem } from './effects/ParticleSystem';
import { PlayerController } from './player/PlayerController';
import { WeaponManager } from './weapons/WeaponManager';
import { EnemyManager } from './enemies/EnemyManager';
import { LevelBuilder } from './world/LevelBuilder';
import type { LevelData } from './world/LevelBuilder';
import { HUD } from './ui/HUD';
import { TouchControls } from './ui/TouchControls';
import { Tutorial } from './ui/Tutorial';
import { IS_TOUCH, vibrate } from './core/Device';
import { CHARGED, COMBAT, DASH, PLAYER, SANDEVISTAN, TOUCH } from './config';

type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'finished';

const BEST_TIME_KEY = 'neon-vertigo-best-time';
const TUTORIAL_KEY = 'neon-vertigo-tutorial-seen';

/** Orchestrateur : boucle principale, échelles de temps, règles de partie. */
export class Game {
  private readonly engine: Engine;
  private readonly input: InputManager;
  private readonly audio: AudioSynthesizer;
  private readonly physics: Physics;
  private readonly particles: ParticleSystem;
  private readonly level: LevelBuilder;
  private readonly levelData: LevelData;
  private readonly player: PlayerController;
  private readonly enemies: EnemyManager;
  private readonly weapons: WeaponManager;
  private readonly hud: HUD;
  private readonly touch: TouchControls | null;
  private readonly tutorial: Tutorial;

  private state: GameState = 'menu';
  private lastTime = 0;
  private elapsed = 0;
  private timerRunning = false;
  private kills = 0;
  private hitstop = 0;
  private deathTimer = 0;
  private deathShown = false;
  private menuTime = 0;
  private readonly tmp = new THREE.Vector3();

  static async create(container: HTMLElement): Promise<Game> {
    const physics = await Physics.create();
    return new Game(container, physics);
  }

  private constructor(container: HTMLElement, physics: Physics) {
    this.physics = physics;
    this.engine = new Engine(container);
    this.input = new InputManager(this.engine.canvas);
    this.audio = new AudioSynthesizer();
    this.particles = new ParticleSystem(this.engine.scene);

    this.level = new LevelBuilder(this.engine.scene, physics);
    this.levelData = this.level.build();
    physics.step();

    this.player = new PlayerController(physics, this.audio, this.engine.camera);
    this.enemies = new EnemyManager(this.engine.scene, physics, this.particles, this.audio);
    this.enemies.spawnAll(this.levelData.enemySpawns);
    this.weapons = new WeaponManager(this.engine, physics, this.enemies, this.particles, this.audio, this.player);
    this.hud = new HUD(document.body, DASH.maxCharges, PLAYER.maxHealth, IS_TOUCH);

    // Mode mobile : commandes tactiles, pas de pointer lock, visée assistée
    if (IS_TOUCH) {
      this.input.setTouchMode(true);
      this.weapons.touchMode = true;
      this.touch = new TouchControls(document.body, this.input);
      this.touch.onPause = () => this.pause();
    } else {
      this.touch = null;
    }

    this.tutorial = new Tutorial(document.body, IS_TOUCH);

    this.wireEvents();
    this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
    this.weapons.reset();
    this.hud.showStart(this.loadBestTime());
    this.hud.setVisible(false);
    // Premier lancement : le tutoriel s'ouvre tout seul
    if (!this.readFlag(TUTORIAL_KEY)) this.tutorial.open();
  }

  start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------------------
  // Événements
  // ---------------------------------------------------------------------------

  private wireEvents(): void {
    this.hud.onOverlayClick = () => {
      this.audio.init();
      if (this.touch) {
        this.enterFullscreen();
        if (this.state === 'paused') this.resume();
        else this.restart();
        return;
      }
      this.input.requestPointerLock();
      if (this.state !== 'paused') this.restart();
      else if (this.input.usesFreeMouse) this.resume();
    };
    this.tutorial.onInteract = () => {
      this.audio.init();
      this.audio.playUiBlip();
    };
    this.tutorial.onClose = (play) => {
      this.writeFlag(TUTORIAL_KEY);
      if (play && this.state === 'menu') this.startGame();
    };
    this.hud.onTutorialClick = () => {
      this.audio.init();
      this.tutorial.open();
    };

    this.hud.onRestartClick = () => {
      this.audio.init();
      if (!this.touch) this.input.requestPointerLock();
      this.restart();
    };

    // Application mise en arrière-plan / onglet masqué : pause automatique
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    if (this.touch) {
      // Empêche le zoom par pincement sur iOS
      document.addEventListener('gesturestart', (e) => e.preventDefault());
    }

    this.engine.canvas.addEventListener('click', () => {
      if (!this.touch && this.state === 'playing' && !this.input.isPointerLocked) this.input.requestPointerLock();
    });

    this.input.onPointerLockChange = (locked) => {
      if (this.touch) return;
      if (!locked && this.state === 'playing') this.pause();
      else if (locked && this.state === 'paused') this.resume();
    };
    // Page intégrée qui refuse le pointer lock : on joue en souris libre.
    this.input.onPointerLockUnavailable = () => {
      if (this.state === 'paused') this.resume();
      this.hud.flashMessage('SOURIS LIBRE · ÉCHAP : PAUSE', '#ffd23b', 2200);
    };
    this.input.onEscape = () => this.pause();

    this.weapons.onWeaponChange = (id) => this.hud.setWeapon(id);
    this.weapons.onChargedStrike = () => {
      this.hitstop = Math.max(this.hitstop, CHARGED.hitstop);
      this.player.addShake(0.5);
    };

    this.enemies.onKill = () => {
      this.kills++;
      this.hitstop = COMBAT.hitstopDuration;
      this.player.addShake(COMBAT.killShake);
      this.player.rewardKill();
      this.hud.hitMarker();
      this.audio.playKillConfirm();
      vibrate(TOUCH.vibrationKill);
      if (this.enemies.aliveCount === 0) this.hud.flashMessage('ZONE NETTOYÉE', '#2bffb0', 1800);
    };

    this.player.listener = {
      onDoubleJump: (feet) => {
        this.particles.burst(feet, {
          count: 26,
          color: 0x00e5ff,
          color2: 0xff2bd6,
          intensity: 3,
          speedMin: 3,
          speedMax: 6,
          lifeMin: 0.2,
          lifeMax: 0.4,
          sizeMin: 0.04,
          sizeMax: 0.08,
          gravity: 2,
          drag: 4,
          direction: new THREE.Vector3(0, -0.3, 0),
          spread: 1.4,
        });
      },
      onDash: (pos, dir) => {
        this.particles.burst(pos, {
          count: 34,
          color: 0x00e5ff,
          color2: 0xffffff,
          intensity: 3.5,
          speedMin: 6,
          speedMax: 14,
          lifeMin: 0.15,
          lifeMax: 0.35,
          sizeMin: 0.03,
          sizeMax: 0.06,
          gravity: 0,
          drag: 5,
          direction: dir.clone().negate(),
          spread: 0.5,
        });
      },
      onLand: (feet, intensity) => {
        if (intensity < 0.45) return;
        this.particles.burst(feet, {
          count: Math.round(20 * intensity),
          color: 0x8090ff,
          intensity: 1.5,
          speedMin: 2,
          speedMax: 5,
          lifeMin: 0.2,
          lifeMax: 0.45,
          sizeMin: 0.04,
          sizeMax: 0.08,
          gravity: 6,
          drag: 4,
          direction: new THREE.Vector3(0, 0.4, 0),
          spread: 1.6,
        });
      },
      onWallJump: (pos, normal) => {
        this.particles.sparks(this.tmp.copy(pos).addScaledVector(normal, -0.4), normal, 0x2bffb0, 20);
      },
      onSandevistan: (active) => {
        if (active) this.hud.flashMessage('SANDEVISTAN', '#2bffb0', 900);
      },
      onHurt: () => {
        vibrate(TOUCH.vibrationHurt);
        if (this.player.alive) this.hud.flashMessage('INTÉGRITÉ COMPROMISE', '#ff2040', 700);
      },
      onDeath: () => {
        if (this.state === 'playing') {
          this.state = 'dead';
          this.deathTimer = 0;
          this.deathShown = false;
          this.timerRunning = false;
          this.touch?.setVisible(false);
          vibrate(120);
        }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Boucle
  // ---------------------------------------------------------------------------

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const realDt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.update(realDt);
    this.input.endFrame();
  };

  private update(realDt: number): void {
    if (this.input.wasPressed('restart') && this.state !== 'menu') {
      this.audio.init();
      if (!this.touch && !this.input.isPointerLocked) this.input.requestPointerLock();
      this.restart();
    }

    if (this.state === 'menu') {
      this.updateMenu(realDt);
      return;
    }
    if (this.state === 'paused') {
      this.input.consumeMouseDelta();
      this.engine.render(realDt);
      return;
    }

    // --- Échelles de temps : hitstop + Sandevistan -----------------------------
    let hitstopScale = 1;
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      hitstopScale = COMBAT.hitstopTimeScale;
    }
    const sand = this.player.sandevistanBlend;
    const worldDt = realDt * hitstopScale * THREE.MathUtils.lerp(1, SANDEVISTAN.worldTimeScale, sand);
    const playerDt = realDt * hitstopScale * THREE.MathUtils.lerp(1, SANDEVISTAN.playerTimeScale, sand);

    const controlsEnabled = this.state === 'playing' && this.input.isActive;

    this.physics.step();
    this.player.update(playerDt, realDt, this.input, controlsEnabled);

    if (this.state === 'playing') {
      if (!this.timerRunning && (this.player.horizontalSpeed > 0.5 || this.player.velocity.y > 1)) {
        this.timerRunning = true;
      }
      if (this.timerRunning) this.elapsed += realDt;
      this.checkJumpPads();
      this.checkKillPlane();
      this.checkFinish();
    }

    this.weapons.update(playerDt, realDt, this.input, controlsEnabled);
    this.enemies.update(worldDt, this.player);
    this.particles.setViewport(this.engine.viewportHeight, this.engine.camera.fov);
    this.level.setViewport(this.engine.viewportHeight, this.engine.camera.fov);
    this.particles.update(worldDt);
    this.level.update(worldDt, this.engine.camera.position);

    if (this.state === 'dead') {
      this.deathTimer += realDt;
      if (!this.deathShown && this.deathTimer > 0.9) {
        this.deathShown = true;
        this.hud.showDeath(this.elapsed, this.kills, this.enemies.totalCount);
      }
    }

    this.hud.update({
      time: this.elapsed,
      kills: this.kills,
      totalEnemies: this.enemies.totalCount,
      sandevistan: this.player.sandevistanEnergy,
      sandevistanActive: this.player.sandevistanActive,
      dashCharges: this.player.dashCharges,
      dashMax: DASH.maxCharges,
      dashProgress: this.player.dashRechargeProgress,
      health: this.player.health,
      maxHealth: PLAYER.maxHealth,
      speed: this.player.horizontalSpeed,
    });
    this.hud.setCharge(this.weapons.chargeLevel, this.weapons.chargeVisible || this.weapons.isChargeStriking);
    this.touch?.update({
      weapon: this.weapons.current,
      sandevistanActive: this.player.sandevistanActive,
      sandevistan: this.player.sandevistanEnergy,
      dashCharges: this.player.dashCharges,
    });

    const speedFx = THREE.MathUtils.clamp((this.player.horizontalSpeed - 12) / 18, 0, 1);
    this.engine.setEffects({
      sandevistan: sand,
      damage: this.player.hurtFlash,
      death: this.player.deathBlend,
      speed: speedFx,
    });
    this.engine.render(realDt);
  }

  /** Écran titre : caméra qui balaie doucement la ligne d'horizon. */
  private updateMenu(realDt: number): void {
    this.menuTime += realDt;
    this.input.consumeMouseDelta();
    this.player.yaw = Math.sin(this.menuTime * 0.15) * 0.35;
    this.physics.step();
    this.player.update(realDt, realDt, this.input, false);
    this.player.pitch = 0.05 + Math.sin(this.menuTime * 0.21) * 0.04;
    this.weapons.update(realDt, realDt, this.input, false);
    this.particles.setViewport(this.engine.viewportHeight, this.engine.camera.fov);
    this.level.setViewport(this.engine.viewportHeight, this.engine.camera.fov);
    this.particles.update(realDt);
    this.level.update(realDt, this.engine.camera.position);
    this.engine.setEffects({ sandevistan: 0, damage: 0, death: 0, speed: 0 });
    this.engine.render(realDt);
  }

  // ---------------------------------------------------------------------------
  // Règles
  // ---------------------------------------------------------------------------

  private restart(): void {
    this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
    this.enemies.reset();
    this.particles.clear();
    this.weapons.reset();
    this.level.reset();
    this.kills = 0;
    this.elapsed = 0;
    this.timerRunning = false;
    this.hitstop = 0;
    this.deathTimer = 0;
    this.deathShown = false;
    this.state = 'playing';
    this.hud.hideOverlay();
    this.hud.setVisible(true);
    this.touch?.releaseAll();
    this.touch?.setVisible(true);
    this.hud.setWeapon(this.weapons.current);
    this.hud.flashMessage('NEURAL-LINK ACTIF', '#00e5ff', 1100);
    this.audio.playStart();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.stopLoops();
    this.input.releaseVirtual();
    this.touch?.setVisible(false);
    this.hud.showPause();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.hideOverlay();
    this.touch?.setVisible(true);
  }

  /** Plein écran + verrouillage paysage quand le navigateur le permet (Android). */
  private enterFullscreen(): void {
    if (document.fullscreenElement) return;
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (typeof el.requestFullscreen === 'function') {
        el.requestFullscreen({ navigationUI: 'hide' })
          .then(() => {
            const orientation = screen.orientation as unknown as { lock?: (o: string) => Promise<void> };
            orientation.lock?.('landscape').catch(() => {
              /* verrouillage refusé : le message « tourne ton appareil » prend le relais */
            });
          })
          .catch(() => {
            /* plein écran refusé : on joue dans la page */
          });
      } else {
        el.webkitRequestFullscreen?.();
      }
    } catch {
      /* API indisponible (iPhone) */
    }
  }

  private checkJumpPads(): void {
    const feetY = this.player.feetY;
    const pos = this.player.position;
    for (const pad of this.levelData.jumpPads) {
      if (pad.cooldown > 0) continue;
      const dx = pos.x - pad.position.x;
      const dz = pos.z - pad.position.z;
      if (dx * dx + dz * dz > pad.radius * pad.radius) continue;
      if (feetY < pad.position.y - 0.3 || feetY > pad.position.y + 0.9) continue;
      if (this.player.velocity.y > 2) continue;
      this.player.launch(pad.power, pad.boost);
      pad.cooldown = 0.6;
      pad.pulse = 1;
      this.audio.playJumpPad();
      this.particles.burst(this.tmp.set(pad.position.x, pad.position.y + 0.2, pad.position.z), {
        count: 60,
        color: 0x2bffb0,
        color2: 0xffffff,
        intensity: 4,
        speedMin: 4,
        speedMax: 12,
        lifeMin: 0.3,
        lifeMax: 0.7,
        sizeMin: 0.04,
        sizeMax: 0.1,
        gravity: 4,
        drag: 2,
        direction: new THREE.Vector3(0, 1, 0),
        spread: 0.6,
      });
    }
  }

  private checkKillPlane(): void {
    if (this.player.alive && this.player.feetY < this.levelData.killPlaneY) {
      this.player.die();
    }
  }

  private checkFinish(): void {
    if (!this.player.alive) return;
    const f = this.levelData.finish;
    const dx = this.player.position.x - f.position.x;
    const dz = this.player.position.z - f.position.z;
    const dy = this.player.feetY - f.position.y;
    if (dx * dx + dz * dz > f.radius * f.radius || Math.abs(dy) > 3) return;

    this.state = 'finished';
    this.timerRunning = false;
    this.touch?.setVisible(false);
    const best = this.loadBestTime();
    const isRecord = best === null || this.elapsed < best;
    if (isRecord) this.saveBestTime(this.elapsed);
    this.audio.stopLoops();
    this.audio.playFinish();
    this.hud.showFinish({
      time: this.elapsed,
      best: isRecord ? this.elapsed : best,
      isRecord,
      kills: this.kills,
      totalEnemies: this.enemies.totalCount,
    });
  }

  /** Lance la partie depuis l'écran titre (geste utilisateur requis). */
  private startGame(): void {
    this.audio.init();
    if (this.touch) this.enterFullscreen();
    else this.input.requestPointerLock();
    this.restart();
  }

  private readFlag(key: string): boolean {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  private writeFlag(key: string): void {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* stockage indisponible : le tutoriel se rouvrira au prochain lancement */
    }
  }

  private loadBestTime(): number | null {
    try {
      const v = window.localStorage.getItem(BEST_TIME_KEY);
      if (v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  private saveBestTime(time: number): void {
    try {
      window.localStorage.setItem(BEST_TIME_KEY, String(time));
    } catch {
      /* stockage indisponible : le record n'est simplement pas conservé */
    }
  }
}
