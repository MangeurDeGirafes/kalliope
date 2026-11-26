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
import { LEVELS } from './world/levels';
import { CAT_COUNT, Plaza, plazaDef } from './world/Plaza';
import type { Interactable } from './world/Plaza';
import { HUD } from './ui/HUD';
import type { LevelCard } from './ui/HUD';
import { TouchControls } from './ui/TouchControls';
import { Tutorial } from './ui/Tutorial';
import { Shop } from './ui/Shop';
import type { ShopItem, ShopVendor } from './ui/Shop';
import { Progress, STATS, UPGRADES } from './progress/Progress';
import type { VendorId } from './progress/Progress';
import { IS_TOUCH, vibrate } from './core/Device';
import { CHARGED, COMBAT, SANDEVISTAN, TOUCH } from './config';

type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'finished' | 'shop';

const VENDORS: Record<VendorId, ShopVendor & { thanks: string[]; soldOut: string }> = {
  clinic: {
    name: 'DOC SATO',
    title: 'CLINIQUE D\'IMPLANTS',
    line: 'Assieds-toi, runner. Ça ne pique qu\'une fois… à peu près.',
    color: '#2bd9c5',
    thanks: ['Installé. Tu ne sentiras rien… demain.', 'Branché, calibré, garanti trois jours.', 'Joli travail, si je puis dire. Et je le dis.'],
    soldOut: 'Tu as déjà tout ce que ma clinique sait poser. Reviens me voir entier, si possible.',
  },
  atelier: {
    name: 'MÉMÉ RIVET',
    title: 'ATELIER MÉCANIQUE',
    line: 'Tes lames grincent comme ma hanche. Laisse mémé arranger ça.',
    color: '#ff8a2b',
    thanks: ['Et voilà, comme neuf. Mieux que neuf, même.', 'Un coup de clé, un coup de cœur. Suivant !', 'Fais-en bon usage, et pas sur mes clients.'],
    soldOut: 'Plus rien à bricoler sur toi, mon grand. File courir.',
  },
};

const RAMEN_PRICE = 6;
const CAT_REWARD = 30;

/** Ancien record (avant les niveaux multiples) : celui du premier parcours. */
const LEGACY_BEST_TIME_KEY = 'neon-vertigo-best-time';
const BEST_TIME_PREFIX = 'neon-vertigo-best-';
const LAST_LEVEL_KEY = 'neon-vertigo-level';
const TUTORIAL_KEY = 'neon-vertigo-tutorial-seen';

/** Orchestrateur : boucle principale, échelles de temps, règles de partie. */
export class Game {
  private readonly engine: Engine;
  private readonly input: InputManager;
  private readonly audio: AudioSynthesizer;
  private readonly physics: Physics;
  private readonly particles: ParticleSystem;
  private readonly level: LevelBuilder;
  private levelData!: LevelData;
  private currentLevel = 0;
  private readonly player: PlayerController;
  private readonly enemies: EnemyManager;
  private readonly weapons: WeaponManager;
  private readonly hud: HUD;
  private readonly touch: TouchControls | null;
  private readonly tutorial: Tutorial;
  private readonly shop: Shop;
  private readonly progress = new Progress();
  /** Niveau chronométré ou Plaza (exploration libre entre deux niveaux). */
  private mode: 'level' | 'plaza' = 'level';
  private plaza: Plaza | null = null;
  /** Niveau vers lequel mène la sortie de la Plaza. */
  private plazaNext = 0;
  private shopVendor: VendorId = 'clinic';
  private interactCooldown = 0;
  private readonly lastLine = new Map<string, number>();

  private state: GameState = 'menu';
  private lastTime = 0;
  private elapsed = 0;
  private timerRunning = false;
  private kills = 0;
  private hitstop = 0;
  private deathTimer = 0;
  private deathShown = false;
  private menuTime = 0;
  /** Temps passé en jeu sans contrôle actif (souris non verrouillée). */
  private inactiveTime = 0;
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
    this.level.buildEnvironment();

    this.player = new PlayerController(physics, this.audio, this.engine.camera);
    this.enemies = new EnemyManager(this.engine.scene, physics, this.particles, this.audio);
    this.weapons = new WeaponManager(this.engine, physics, this.enemies, this.particles, this.audio, this.player);
    this.hud = new HUD(document.body, STATS.dashMax, STATS.maxHealth, IS_TOUCH);
    this.shop = new Shop(document.body);
    this.loadLevel(this.readLastLevel());

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
    this.weapons.reset();
    this.showMenu();
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
      if (play && this.state === 'menu') this.startGame(this.currentLevel);
    };
    this.hud.onTutorialClick = () => {
      this.audio.init();
      this.tutorial.open();
    };

    this.hud.onLevelSelect = (index) => this.startGame(index);
    this.hud.onNextClick = () => this.goToPlaza((this.currentLevel + 1) % LEVELS.length);
    this.hud.onMenuClick = () => this.showMenu();
    this.hud.onPlazaClick = () => this.goToPlaza(this.currentLevel);

    this.shop.onBuy = (id) => this.buyUpgrade(id);
    this.shop.onClose = () => {
      if (this.state !== 'shop') return;
      this.state = 'playing';
      this.interactCooldown = 0.4;
      this.touch?.setVisible(true);
      if (!this.touch) this.input.requestPointerLock();
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

    this.engine.onLightning = (delay) => this.audio.playThunder(delay);
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
    if (this.state === 'paused' || this.state === 'shop') {
      this.input.consumeMouseDelta();
      this.plaza?.update(realDt, this.player.position);
      this.level.update(realDt, this.engine.camera.position);
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
    // Souris non verrouillée en pleine partie (verrouillage refusé juste après
    // Échap, focus perdu…) : plutôt qu'un joueur figé, on affiche la pause.
    if (this.state === 'playing' && !this.touch && !this.input.isActive) {
      this.inactiveTime += realDt;
      if (this.inactiveTime > 0.35) {
        this.inactiveTime = 0;
        this.pause();
        return;
      }
    } else {
      this.inactiveTime = 0;
    }

    this.physics.step();
    this.player.update(playerDt, realDt, this.input, controlsEnabled);

    if (this.state === 'playing' && this.mode === 'level') {
      if (!this.timerRunning && (this.player.horizontalSpeed > 0.5 || this.player.velocity.y > 1)) {
        this.timerRunning = true;
      }
      if (this.timerRunning) this.elapsed += realDt;
      this.checkJumpPads();
      this.checkKillPlane();
      this.checkFinish();
    } else if (this.state === 'playing' && this.mode === 'plaza') {
      this.checkJumpPads();
      this.updatePlaza(realDt);
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
        // Libère la souris pour rendre les boutons cliquables (R relance et reverrouille)
        this.input.exitPointerLock();
      }
    }

    this.hud.setCredits(this.progress.credits);
    this.hud.update({
      time: this.elapsed,
      targetsText:
        this.mode === 'plaza'
          ? `CHATS NÉON ${this.progress.countEggs('cat-')}/${CAT_COUNT}`
          : `CIBLES ${this.kills}/${this.enemies.totalCount}`,
      sandevistan: this.player.sandevistanEnergy,
      sandevistanActive: this.player.sandevistanActive,
      dashCharges: this.player.dashCharges,
      dashMax: STATS.dashMax,
      dashProgress: this.player.dashRechargeProgress,
      health: this.player.health,
      maxHealth: STATS.maxHealth,
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
    if (this.mode === 'plaza') this.hud.flashMessage('LA PLAZA', '#ff7ad9', 1600);
    else this.hud.flashMessage(LEVELS[this.currentLevel].name, '#00e5ff', 1400);
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
    const best = this.loadBestTime(this.currentLevel);
    const isRecord = best === null || this.elapsed < best;
    if (isRecord) this.saveBestTime(this.currentLevel, this.elapsed);
    const reward = this.progress.levelReward(LEVELS[this.currentLevel].difficulty, this.kills, best === null, isRecord && best !== null);
    this.progress.addCredits(reward.total);
    this.audio.stopLoops();
    this.audio.playFinish();
    this.hud.showFinish(
      {
        time: this.elapsed,
        best: isRecord ? this.elapsed : best,
        isRecord,
        kills: this.kills,
        totalEnemies: this.enemies.totalCount,
      },
      'CONTINUER VERS LA PLAZA ▶',
      reward,
    );
    this.input.exitPointerLock();
  }

  // ---------------------------------------------------------------------------
  // La Plaza
  // ---------------------------------------------------------------------------

  /** Va à la Plaza ; sa sortie mène au niveau `next`. */
  private goToPlaza(next: number): void {
    this.audio.init();
    if (this.touch) this.enterFullscreen();
    else this.input.requestPointerLock();
    this.loadPlaza(next);
    this.restart();
  }

  private loadPlaza(next: number): void {
    this.mode = 'plaza';
    this.plazaNext = ((next % LEVELS.length) + LEVELS.length) % LEVELS.length;
    const exit = LEVELS[this.plazaNext];
    const def = plazaDef(`NIVEAU ${this.plazaNext + 1} : ${exit.name}`);
    const plaza = new Plaza();
    this.enemies.clearAll();
    this.particles.clear();
    this.levelData = this.level.loadLevel(def, (b) => plaza.build(b, (id) => this.progress.hasEgg(id)));
    this.plaza = plaza;
    this.engine.setTheme(def.theme);
    this.audio.setRainLevel(def.theme.rain);
    this.physics.step();
    this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
    this.hud.setLevelName('LA PLAZA');
    this.hud.setMode('plaza');
  }

  private updatePlaza(dt: number): void {
    const plaza = this.plaza;
    if (!plaza) return;
    plaza.update(dt, this.player.position);
    this.interactCooldown = Math.max(0, this.interactCooldown - dt);

    // Chute hors de la dalle : retour à l'entrée, sans pénalité
    if (this.player.feetY < -18) {
      this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
      this.hud.flashMessage('RETOUR À LA PLAZA', '#ff7ad9', 1200);
    }

    const cat = plaza.collectCat(this.player.position);
    if (cat && this.progress.findEgg(cat.id)) {
      const n = this.progress.countEggs('cat-');
      this.progress.addCredits(CAT_REWARD);
      this.audio.playMeow();
      this.audio.playCoin();
      vibrate(30);
      this.particles.burst(cat.sprite.position, {
        count: 40,
        color: 0xff7ad9,
        color2: 0xffd23b,
        intensity: 3,
        speedMin: 2,
        speedMax: 6,
        lifeMin: 0.3,
        lifeMax: 0.7,
        sizeMin: 0.04,
        sizeMax: 0.09,
        gravity: 3,
        drag: 3,
        direction: new THREE.Vector3(0, 1, 0),
        spread: 1.4,
      });
      if (n >= CAT_COUNT) this.hud.flashMessage('TOUS LES CHATS ! VA VOIR MAMIE CHAT', '#ff7ad9', 2600);
      else this.hud.flashMessage(`CHAT NÉON ${n}/${CAT_COUNT} · +${CAT_REWARD} ¢`, '#ff7ad9', 1800);
    }

    // Sortie : la balise dorée lance le niveau suivant
    const f = this.levelData.finish;
    const dx = this.player.position.x - f.position.x;
    const dz = this.player.position.z - f.position.z;
    if (dx * dx + dz * dz < f.radius * f.radius && Math.abs(this.player.feetY - f.position.y) < 3) {
      this.loadLevel(this.plazaNext);
      this.restart();
      return;
    }

    const it = this.player.alive ? plaza.findInteractable(this.player.position, this.player.feetY) : null;
    this.hud.setPrompt(it ? `${this.touch ? '' : 'E : '}${it.verb} ${it.name}` : null);
    this.touch?.setInteract(it ? Game.interactLabel(it) : null);
    if (it && this.interactCooldown <= 0 && this.input.wasPressed('interact')) {
      this.interactCooldown = 0.35;
      this.interactWith(it);
    }
  }

  private static interactLabel(it: Interactable): string {
    switch (it.kind) {
      case 'clinic':
      case 'atelier':
        return 'BOUTIQUE';
      case 'ramen':
        return 'RAMEN';
      case 'arcade':
        return 'JOUER';
      case 'oracle':
        return 'ORACLE';
      case 'fountain':
        return 'VŒU';
      case 'statue':
        return 'VOIR';
      default:
        return 'PARLER';
    }
  }

  /** Réplique au hasard, jamais deux fois la même d'affilée. */
  private pickLine(id: string, lines: readonly string[]): string {
    let i = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && i === this.lastLine.get(id)) i = (i + 1) % lines.length;
    this.lastLine.set(id, i);
    return lines[i];
  }

  private reward(amount: number): void {
    this.progress.addCredits(amount);
    this.audio.playCoin();
  }

  private interactWith(it: Interactable): void {
    this.audio.playUiBlip();
    const say = (text: string) => this.hud.showDialogue(it.name, text, it.color);
    switch (it.kind) {
      case 'clinic':
      case 'atelier':
        this.openShop(it.kind);
        return;
      case 'ramen': {
        if (!this.progress.spend(RAMEN_PRICE)) {
          this.audio.playDenied();
          say(`Un bol, c'est ${RAMEN_PRICE} ¢. Reviens avec de quoi payer, mon chou.`);
          return;
        }
        this.player.sandevistanEnergy = 1;
        const first = this.progress.findEgg('ramen');
        say(
          first
            ? 'Premier bol de la maison ? Non. Mais il te remplit le Sandevistan à ras bord.'
            : this.pickLine(it.id, [
                'Bouillon de 48 heures, nouilles de synthèse, amour véritable. Sandevistan rechargé.',
                'Mange. Les toits seront encore là après.',
                'Le secret ? Une pincée de néon râpé.',
                'Paraît qu\'un chat dort derrière ma cuisine. Il adore l\'odeur du miso.',
              ]),
        );
        return;
      }
      case 'arcade':
        this.audio.playArcade();
        if (this.progress.findEgg('arcade')) {
          this.reward(20);
          say('NOUVEAU RECORD ! Tu bats le score de démonstration. +20 ¢');
        } else {
          say(
            this.pickLine(it.id, [
              'GAME OVER. MEILLEUR SCORE : K.A.L.L.I.O.P.E — 999 999.',
              'Tu bats le record de… personne. La borne est en mode démo.',
              'INSERT COIN. Ah non, c\'est gratuit aujourd\'hui.',
              'Niveau 99 atteint. La borne te regarde avec respect.',
            ]),
          );
        }
        return;
      case 'oracle':
        say(this.pickLine(it.id, it.lines ?? ['…']));
        return;
      case 'fountain': {
        if (!this.progress.spend(1)) {
          this.audio.playDenied();
          say('Il te faut au moins 1 ¢ pour faire un vœu.');
          return;
        }
        this.progress.coins++;
        this.progress.save();
        this.audio.playSplash();
        this.particles.burst(this.tmp.set(0, 0.6, -14), {
          count: 30,
          color: 0x7fd8ff,
          color2: 0xffffff,
          intensity: 2.5,
          speedMin: 2,
          speedMax: 5,
          lifeMin: 0.3,
          lifeMax: 0.6,
          sizeMin: 0.04,
          sizeMax: 0.08,
          gravity: 9,
          drag: 1,
          direction: new THREE.Vector3(0, 1, 0),
          spread: 0.8,
        });
        if (this.progress.coins >= 7 && this.progress.findEgg('fountain')) {
          this.reward(77);
          say('JACKPOT ! Sept vœux, sept vies : la fontaine te recrache 77 ¢.');
        } else {
          say(
            this.pickLine(it.id, [
              'Plouf. Ton vœu a été enregistré dans le cloud.',
              'Plouf. Vœu en file d\'attente : position 4 096.',
              'Plouf. La fontaine fait semblant de ne pas avoir entendu.',
              'Plouf. Quelque part, un serveur exauce peut-être ton vœu.',
            ]),
          );
        }
        return;
      }
      case 'statue':
        if (this.progress.findEgg('statue')) {
          this.reward(80);
          say('Tu as trouvé la muse KALLIOPE. Elle t\'offre 80 ¢ et un peu d\'inspiration.');
        } else {
          say('La muse veille sur la Plaza. Elle t\'a à l\'œil.');
        }
        return;
      case 'mamie': {
        const n = this.progress.countEggs('cat-');
        if (n >= CAT_COUNT) {
          if (this.progress.findEgg('cats-reward')) {
            this.reward(100);
            say('Mes bébés, tous rentrés ! Tiens, prends ça : 100 ¢. Tu es un amour.');
          } else {
            say('Ils ronronnent depuis que tu es passé. Reviens quand tu veux.');
          }
        } else if (n === 0) {
          say('Mes cinq chats néon se sont encore sauvés dans la Plaza… Tu me les ramènes ? Ils aiment les endroits en hauteur.');
        } else {
          say(`Tu en as retrouvé ${n} sur ${CAT_COUNT}. Les autres se cachent : en hauteur, ou près de quelque chose qui sent bon.`);
        }
        return;
      }
      default:
        say(this.pickLine(it.id, it.lines ?? ['…']));
    }
  }

  private shopItems(vendor: VendorId): ShopItem[] {
    return UPGRADES.filter((u) => u.vendor === vendor).map((u) => ({ id: u.id, name: u.name, desc: u.desc, price: u.price, owned: this.progress.has(u.id) }));
  }

  private openShop(vendor: VendorId): void {
    this.shopVendor = vendor;
    this.state = 'shop';
    this.audio.stopLoops();
    this.input.releaseVirtual();
    this.touch?.setVisible(false);
    this.hud.setPrompt(null);
    this.hud.hideDialogue();
    const v = VENDORS[vendor];
    const items = this.shopItems(vendor);
    this.shop.open(v, items, this.progress.credits);
    if (items.every((i) => i.owned)) this.shop.refresh(items, this.progress.credits, v.soldOut);
    this.input.exitPointerLock();
  }

  private buyUpgrade(id: string): void {
    const v = VENDORS[this.shopVendor];
    if (this.progress.buy(id)) {
      this.audio.playCoin();
      // Effet immédiat des améliorations
      this.player.health = STATS.maxHealth;
      this.player.dashCharges = STATS.dashMax;
      this.shop.refresh(this.shopItems(this.shopVendor), this.progress.credits, this.pickLine(`shop-${this.shopVendor}`, v.thanks));
    } else {
      this.audio.playDenied();
      this.shop.refresh(this.shopItems(this.shopVendor), this.progress.credits, 'Pas assez de crédits, runner. Termine un niveau et reviens.');
    }
  }

  /** Lance un niveau (geste utilisateur requis pour le plein écran / pointer lock). */
  private startGame(index: number): void {
    this.audio.init();
    if (this.touch) this.enterFullscreen();
    else this.input.requestPointerLock();
    if (index !== this.currentLevel || this.mode !== 'level') this.loadLevel(index);
    this.restart();
  }

  /** Construit le parcours d'un niveau, ses ennemis et son ambiance. */
  private loadLevel(index: number): void {
    this.currentLevel = THREE.MathUtils.clamp(index, 0, LEVELS.length - 1);
    const def = LEVELS[this.currentLevel];
    this.mode = 'level';
    this.plaza = null;
    this.hud.setMode('level');
    this.touch?.setInteract(null);
    this.enemies.clearAll();
    this.particles.clear();
    this.levelData = this.level.loadLevel(def);
    this.enemies.spawnAll(this.levelData.enemySpawns);
    this.engine.setTheme(def.theme);
    this.audio.setRainLevel(def.theme.rain);
    // Met à jour la structure d'accélération avant les premiers lancers de rayons
    this.physics.step();
    this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
    this.hud.setLevelName(`${String(this.currentLevel + 1).padStart(2, '0')} · ${def.name}`);
    this.writeValue(LAST_LEVEL_KEY, def.id);
  }

  /** Écran titre avec la sélection des niveaux. */
  private showMenu(): void {
    if (this.mode !== 'level') this.loadLevel(this.currentLevel);
    this.state = 'menu';
    this.timerRunning = false;
    this.audio.stopLoops();
    this.input.releaseVirtual();
    this.input.exitPointerLock();
    this.touch?.releaseAll();
    this.touch?.setVisible(false);
    this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
    this.enemies.reset();
    this.weapons.reset();
    this.hud.setVisible(false);
    const cards: LevelCard[] = LEVELS.map((l, i) => ({
      name: l.name,
      subtitle: l.subtitle,
      difficulty: l.difficulty,
      best: this.loadBestTime(i),
      accent: l.theme.skyGlow,
    }));
    this.hud.showStart(cards, this.currentLevel, this.progress.credits);
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

  private readValue(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeValue(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* stockage indisponible : la valeur n'est simplement pas conservée */
    }
  }

  /** Dernier niveau joué (par identifiant, pour survivre à un réordonnancement). */
  private readLastLevel(): number {
    const id = this.readValue(LAST_LEVEL_KEY);
    const i = LEVELS.findIndex((l) => l.id === id);
    return i >= 0 ? i : 0;
  }

  private loadBestTime(index: number): number | null {
    let v = this.readValue(BEST_TIME_PREFIX + LEVELS[index].id);
    if (v === null && index === 0) v = this.readValue(LEGACY_BEST_TIME_KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private saveBestTime(index: number, time: number): void {
    this.writeValue(BEST_TIME_PREFIX + LEVELS[index].id, String(time));
  }
}
