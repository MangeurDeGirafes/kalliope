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
import { buildSecret, raySphere } from './world/Secrets';
import { Boss } from './enemies/Boss';
import type { SecretRuntime } from './world/Secrets';
import { PlazaDirector, SECRET_TOTAL } from './plaza/PlazaDirector';
import { Journal } from './ui/Journal';
import type { JournalData } from './ui/Journal';
import { STORY_LOGS, logFlag, logForLevel, lorePages, siblingWords } from './story/Story';
import { HUD } from './ui/HUD';
import type { FinishLog, LevelCard, PowerChip } from './ui/HUD';
import { TouchControls } from './ui/TouchControls';
import { Tutorial } from './ui/Tutorial';
import { Shop } from './ui/Shop';
import type { ShopItem, ShopVendor } from './ui/Shop';
import { Progress, STATS, UPGRADES } from './progress/Progress';
import type { VendorId } from './progress/Progress';
import { IS_TOUCH, vibrate } from './core/Device';
import { StyleMeter, medalFor, rankBonus, scoreRun, RANK_ORDER } from './game/Style';
import type { Rank } from './game/Style';
import { POWER_INFO, PowerUpField } from './world/PowerUps';
import type { PowerKind } from './world/PowerUps';
import { CHARGED, COMBAT, GRAPPLE, SANDEVISTAN, TOUCH } from './config';
import { GrappleSystem } from './world/Grapple';
import { buildAntenna } from './world/Landmarks';
import type { GrappleTarget } from './world/Grapple';
import type { Enemy } from './enemies/EnemyManager';

type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'finished' | 'shop';

const VENDORS: Record<VendorId | 'indic', ShopVendor & { thanks: string[]; soldOut: string }> = {
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
  armory: {
    name: 'KOVA',
    title: 'ARMURERIE KOVA',
    line: 'Tu veux du tranchant ou du bruit ? J\'ai les deux. Et du fil, pour les gourmets.',
    color: '#ff3b3b',
    thanks: ['Vendu. Pas de remboursement, pas de questions.', 'Prends soin de cette merveille. Elle, elle ne prendra pas soin de toi.', 'Bonne chasse, runner.'],
    soldOut: 'Mon stock est vide, et c\'est toi qui l\'as vidé. Respect.',
  },
  ink: {
    name: 'PIXEL',
    title: 'NEON INK',
    line: 'Une nouvelle couleur pour tes lames ? Ça change une silhouette sur un toit, crois-moi.',
    color: '#ff7ad9',
    thanks: ['Encre posée. Elle brille comme il faut.', 'Magnifique. Les drones vont te trouver très stylé.', 'Ça te va mieux que l\'uniforme d\'Aegis.'],
    soldOut: 'Tu as toute ma palette. Reviens quand j\'aurai de nouvelles couleurs.',
  },
  indic: {
    name: 'L\'INDIC',
    title: 'L\'INDIC · TUYAUX',
    line: 'Des secrets dorment dans les niveaux. Moi, je sais où. Toi, tu paies.',
    color: '#2bffb0',
    thanks: ['Noté. Tu ne tiens pas ça de moi.', 'Un bon tuyau, frais du jour.', 'Va voir par toi-même. Discrètement.'],
    soldOut: 'Tu as tout trouvé. Je n\'ai plus rien à vendre… et ça m\'inquiète.',
  },
};

const HINT_PRICE = 15;
const RANK_PREFIX = 'neon-vertigo-rank-';
const MUSIC_KEY = 'neon-vertigo-music';
const SECRET_REWARD = 25;

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
  private shopVendor: VendorId | 'indic' = 'clinic';
  private readonly director: PlazaDirector;
  private readonly journal: Journal;
  /** Easter eggs du niveau en cours. */
  private secrets: SecretRuntime[] = [];
  private secretTime = 0;
  private readonly style = new StyleMeter();
  /** Boss du niveau en cours (niveau 5). */
  private boss: Boss | null = null;
  private readonly powerups = new PowerUpField();
  /** Bonus actifs : temps restant (s). */
  private readonly powers = new Map<PowerKind, number>();

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
  private readonly grapple: GrappleSystem;
  private killFlash = 0;
  private grappleTarget: GrappleTarget | null = null;
  private grappleEnemy: Enemy | null = null;
  private grappleCooldown = 0;
  private readonly eye = new THREE.Vector3();
  private readonly aimDir = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly screen = new THREE.Vector3();

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
    this.grapple = new GrappleSystem(this.engine.scene);
    this.weapons = new WeaponManager(this.engine, physics, this.enemies, this.particles, this.audio, this.player);
    this.hud = new HUD(document.body, STATS.dashMax, STATS.maxHealth, IS_TOUCH);
    this.shop = new Shop(document.body);
    this.journal = new Journal(document.body);

    // Mode mobile : commandes tactiles, pas de pointer lock, visée assistée
    if (IS_TOUCH) {
      this.input.setTouchMode(true);
      this.weapons.touchMode = true;
      this.touch = new TouchControls(document.body, this.input);
      this.touch.onPause = () => this.pause();
    } else {
      this.touch = null;
    }

    this.tutorial = new Tutorial(document.body, IS_TOUCH, () => lorePages(this.progress.sibling));
    this.director = new PlazaDirector({
      hud: this.hud,
      audio: this.audio,
      input: this.input,
      progress: this.progress,
      player: this.player,
      particles: this.particles,
      touch: this.touch,
      openShop: (vendor) => this.openShop(vendor),
      teleport: (pos, yaw) => this.teleport(pos, yaw),
      fragments: () => this.fragments(),
    });
    this.applyLoadout();
    this.audio.setMusicEnabled(this.readValue(MUSIC_KEY) !== '0');
    this.loadLevel(this.readLastLevel());

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
    this.hud.onPlazaClick = () => this.goToPlaza(this.nextLevelToPlay());

    this.shop.onBuy = (id) => this.buyUpgrade(id);
    this.shop.onClose = () => {
      if (this.state !== 'shop') return;
      this.state = 'playing';
      this.director.holdInteract(0.4);
      this.touch?.setVisible(true);
      if (!this.touch) this.input.requestPointerLock();
    };
    this.hud.onJournalClick = () => this.openJournal();
    this.hud.onMusicClick = () => {
      this.audio.init();
      this.toggleMusic();
    };
    this.hud.onSiblingClick = () => this.toggleSibling();
    this.journal.onToggleSibling = () => this.toggleSibling();
    this.weapons.onShot = (origin, dir, distance) => this.checkSecretShot(origin, dir, distance);

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

    this.enemies.onKill = (_e, _pos, cause) => {
      this.kills++;
      if (this.mode === 'level' && this.state === 'playing') {
        const r = this.style.kill(cause, { air: !this.player.grounded, wall: this.player.wallRunning, slow: this.player.sandevistanActive });
        this.hud.stylePop(`+${r.gain}${r.labels.length ? ` ${r.labels.join(' · ')}` : ''}`);
      }
      this.hitstop = COMBAT.hitstopDuration;
      this.killFlash = 1;
      this.player.addShake(COMBAT.killShake);
      this.player.rewardKill();
      this.hud.hitMarker();
      this.audio.playKillConfirm();
      vibrate(TOUCH.vibrationKill);
      if (this.enemies.aliveCount === 0) this.hud.flashMessage('ZONE NETTOYÉE', '#2bffb0', 1800);
    };

    let blockHint = 0;
    this.enemies.onBlocked = () => {
      this.player.addShake(0.2);
      this.hitstop = Math.max(this.hitstop, 0.04);
      const now = performance.now();
      if (now - blockHint > 4000) {
        blockHint = now;
        this.hud.flashMessage('BLOQUÉ · PRENDS-LE DE DOS OU CHARGE', '#40c8ff', 1300);
      }
    };
    this.enemies.onBlast = (pos, hurt) => {
      const d = pos.distanceTo(this.player.position);
      this.player.addShake(hurt ? 1 : THREE.MathUtils.clamp(1.2 - d / 20, 0.15, 0.8));
      vibrate(hurt ? 60 : 20);
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
      onShield: () => {
        this.audio.playShieldHit();
        this.particles.burst(this.player.position, {
          count: 40,
          color: 0x2bffb0,
          color2: 0xffffff,
          intensity: 3,
          speedMin: 3,
          speedMax: 7,
          lifeMin: 0.2,
          lifeMax: 0.4,
          sizeMin: 0.04,
          sizeMax: 0.08,
          gravity: 0,
          drag: 4,
        });
        this.hud.flashMessage('BOUCLIER BRISÉ', '#2bffb0', 900);
      },
      onHurt: () => {
        this.style.hurt();
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
    this.updateMusic();
    this.input.endFrame();
  };

  /** Intensité de la musique selon l'action (calme au menu, à fond en combat). */
  private updateMusic(): void {
    let k = 0.2;
    if (this.state === 'menu') k = 0.15;
    else if (this.mode === 'plaza') k = this.director.racing ? 0.75 : 0.3;
    else if (this.state === 'playing') {
      const speed = THREE.MathUtils.clamp(this.player.horizontalSpeed / 16, 0, 1);
      k = 0.5 + speed * 0.15 + (this.enemies.alert || this.style.combo > 0 ? 0.3 : 0);
      if (this.bossActive) k = 1;
    } else if (this.state === 'dead') k = 0.2;
    else if (this.state === 'finished') k = 0.4;
    this.audio.setMusicIntensity(k);
    this.audio.setMusicPaused(this.state === 'paused' || this.state === 'shop' || this.journal.isOpen);
  }

  /** Vrai pendant le combat contre le boss (niveau 5). */
  private get bossActive(): boolean {
    return this.boss?.engaged ?? false;
  }

  /** Branche la Sentinelle : cœurs ciblables, annonces, récompenses, balise finale. */
  private setupBoss(boss: Boss): void {
    this.enemies.targets.push(...boss.cores);
    this.level.setFinishVisible(false);
    boss.onMessage = (text, color) => this.hud.flashMessage(text, color, 1500);
    boss.onCoreDestroyed = () => {
      const gain = this.style.bonus(400);
      this.hud.stylePop(`+${gain} CŒUR`);
      this.hitstop = Math.max(this.hitstop, 0.25);
      this.player.addShake(0.6);
      vibrate(80);
    };
    boss.onDefeated = () => {
      this.level.setFinishVisible(true);
      const gain = this.style.bonus(1500);
      this.hud.stylePop(`+${gain} SENTINELLE`);
      this.hitstop = Math.max(this.hitstop, 0.5);
      this.player.addShake(1);
      vibrate(150);
      this.hud.flashMessage('PURGE ANNULÉE · REJOINS LA BALISE', '#ffd23b', 3000);
    };
  }

  private toggleMusic(): void {
    const on = !this.audio.musicEnabled;
    this.audio.setMusicEnabled(on);
    this.writeValue(MUSIC_KEY, on ? '1' : '0');
    this.hud.flashMessage(on ? '♪ MUSIQUE ACTIVÉE' : '♪ MUSIQUE COUPÉE', '#9fd8ff', 1000);
    if (this.state === 'paused') this.hud.showPause(on);
  }

  // ---------------------------------------------------------------------------
  // Bonus
  // ---------------------------------------------------------------------------

  private updatePowerUps(realDt: number): void {
    const got = this.powerups.collect(this.player.position);
    if (got) this.applyPower(got.kind, got.position);
    for (const [kind, left] of this.powers) {
      const t = left - realDt;
      if (t <= 0) this.powers.delete(kind);
      else this.powers.set(kind, t);
    }
    const overdrive = this.powers.has('overdrive');
    this.player.speedBoost = overdrive ? 1.35 : 1;
    this.player.freeDash = overdrive;
    this.weapons.surge = this.powers.has('surge');
  }

  private applyPower(kind: PowerKind, at: THREE.Vector3): void {
    const info = POWER_INFO[kind];
    this.audio.playPowerUp();
    vibrate(35);
    this.particles.burst(at, {
      count: 50,
      color: info.color,
      color2: 0xffffff,
      intensity: 3.5,
      speedMin: 2,
      speedMax: 7,
      lifeMin: 0.25,
      lifeMax: 0.6,
      sizeMin: 0.04,
      sizeMax: 0.1,
      gravity: 1,
      drag: 3,
    });
    switch (kind) {
      case 'overdrive':
        this.powers.set('overdrive', info.duration);
        this.player.dashCharges = STATS.dashMax;
        break;
      case 'surge':
        this.powers.set('surge', info.duration);
        break;
      case 'shield':
        this.player.shield = 1;
        break;
      case 'chrono':
        this.player.sandevistanEnergy = 1;
        this.elapsed = Math.max(0, this.elapsed - 3);
        break;
    }
    this.hud.flashMessage(kind === 'chrono' ? 'CHRONO · −3 S' : info.name, info.css, 1200);
  }

  private powerChips(): PowerChip[] {
    const chips: PowerChip[] = [];
    for (const [kind, left] of this.powers) chips.push({ name: POWER_INFO[kind].name, color: POWER_INFO[kind].css, frac: left / POWER_INFO[kind].duration });
    if (this.player.shield > 0) chips.push({ name: POWER_INFO.shield.name, color: POWER_INFO.shield.css, frac: -1 });
    return chips;
  }

  private update(realDt: number): void {
    if (this.input.wasPressed('music')) this.toggleMusic();
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
      this.checkSecretsNearby();
      this.updatePowerUps(realDt);
      this.checkFinish();
    } else if (this.state === 'playing' && this.mode === 'plaza') {
      this.checkJumpPads();
      this.updatePlaza(realDt);
    }

    this.weapons.update(playerDt, realDt, this.input, controlsEnabled);
    this.updateGrapple(playerDt, controlsEnabled && this.mode === 'level');
    this.enemies.update(worldDt, this.player);
    if (this.mode === 'level' && this.boss && (this.state === 'playing' || this.state === 'dead')) this.boss.update(worldDt, this.player);
    this.hud.setBoss(this.mode === 'level' && this.boss ? this.boss.status() : null);
    this.particles.setViewport(this.engine.viewportHeight, this.engine.camera.fov);
    this.level.setViewport(this.engine.viewportHeight, this.engine.camera.fov);
    this.particles.update(worldDt);
    this.level.update(worldDt, this.engine.camera.position);
    this.secretTime += worldDt;
    for (const sec of this.secrets) sec.update(worldDt, this.secretTime);
    this.powerups.update(worldDt);

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
    this.hud.setPowers(this.mode === 'level' && this.state === 'playing' ? this.powerChips() : []);
    const letter = this.style.letter;
    this.style.update(realDt);
    this.hud.setStyle(letter.rank, letter.progress, this.mode === 'level' && letter.visible, this.mode === 'level' ? this.style.combo : 0, this.style.comboProgress);
    this.hud.setCharge(
      this.weapons.chargeLevel,
      this.weapons.chargeVisible || this.weapons.isChargeStriking,
      this.weapons.isChargeStriking ? -1 : this.weapons.chargeCooldownProgress,
      this.weapons.current,
    );
    this.touch?.update({
      weapon: this.weapons.current,
      sandevistanActive: this.player.sandevistanActive,
      sandevistan: this.player.sandevistanEnergy,
      dashCharges: this.player.dashCharges,
    });

    const speedFx = THREE.MathUtils.clamp((this.player.horizontalSpeed - 12) / 18, 0, 1);
    this.killFlash = Math.max(0, this.killFlash - realDt * 4);
    this.engine.setEffects({
      sandevistan: sand,
      damage: this.player.hurtFlash,
      death: this.player.deathBlend,
      speed: speedFx,
      kill: this.killFlash * this.killFlash,
    });
    this.engine.render(realDt);
  }

  /**
   * Grappin : cible la mieux centrée (ancre ou ennemi), lancer sur F / G ou le
   * bouton tactile, câble tendu pendant la traction. Un ennemi harponné est
   * éliminé à l'arrivée et le joueur rebondit dessus.
   */
  private updateGrapple(dt: number, active: boolean): void {
    const p = this.player;
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    if (!active && this.state !== 'playing') {
      if (p.isGrappling) p.endGrapple(false);
      this.grappleEnemy = null;
    }
    const e = this.grappleEnemy;
    if (e) {
      if (!e.alive) {
        this.grappleEnemy = null;
        p.endGrapple(false);
      } else if (p.position.distanceTo(e.center) < 2.8) {
        this.grappleEnemy = null;
        p.endGrapple(false);
        this.tmp.subVectors(e.center, p.position).normalize();
        this.enemies.kill(e, this.tmp, 'grapple');
        p.velocity.set(p.velocity.x * 0.35, GRAPPLE.killBounce, p.velocity.z * 0.35);
        this.hitstop = Math.max(this.hitstop, 0.09);
        this.audio.playPunch();
        vibrate(25);
      } else if (!p.isGrappling) {
        this.grappleEnemy = null;
      } else {
        p.setGrapplePoint(e.center);
      }
    }

    const cam = this.engine.camera;
    cam.getWorldPosition(this.eye);
    cam.getWorldDirection(this.aimDir);
    this.grappleTarget =
      active && !p.isGrappling && p.alive
        ? this.grapple.findTarget(this.eye, this.aimDir, this.enemies.list, this.physics, this.touch ? GRAPPLE.touchConeDeg : GRAPPLE.coneDeg)
        : null;
    if (this.grappleTarget && this.grappleCooldown <= 0 && this.input.wasPressed('grapple')) {
      const t = this.grappleTarget;
      p.startGrapple(t.point, GRAPPLE.pullTime, t.carry);
      this.grappleEnemy = t.enemy;
      this.grappleCooldown = GRAPPLE.cooldown;
      this.grappleTarget = null;
      this.audio.playGrapple();
      vibrate(12);
    }

    // Câble : de la main gauche (bas gauche de l'écran) au point d'accroche
    if (p.isGrappling) {
      cam.updateMatrixWorld();
      const m = cam.matrixWorld.elements;
      this.hand
        .copy(this.eye)
        .addScaledVector(this.tmp.set(m[0], m[1], m[2]), -0.28)
        .addScaledVector(this.tmp.set(m[4], m[5], m[6]), -0.24)
        .addScaledVector(this.aimDir, 0.5);
      this.grapple.update(dt, null, this.hand, p.grapplePoint);
    } else {
      this.grapple.update(dt, this.grappleTarget, null, null);
    }

    const t = this.grappleTarget;
    if (t) {
      this.screen.copy(t.point).project(cam);
      if (this.screen.z < 1) {
        this.hud.setGrappleTarget(((this.screen.x + 1) / 2) * window.innerWidth, ((1 - this.screen.y) / 2) * window.innerHeight, t.enemy !== null);
      } else {
        this.hud.setGrappleTarget(null);
      }
    } else {
      this.hud.setGrappleTarget(null);
    }
    this.touch?.setGrapple(t ? (t.enemy ? 'enemy' : 'anchor') : 'none');
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
    this.grappleEnemy = null;
    this.grappleTarget = null;
    this.grappleCooldown = 0;
    this.grapple.update(0, null, null, null);
    this.style.reset();
    this.powerups.reset();
    this.powers.clear();
    if (this.boss) {
      this.boss.reset();
      this.level.setFinishVisible(false);
    }
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
    this.hud.showPause(this.audio.musicEnabled);
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
    if (this.boss && !this.boss.defeated) return;
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
    // Rang et médaille de la course
    const levelDef = LEVELS[this.currentLevel];
    const run = scoreRun(this.elapsed, levelDef.par, this.kills, this.enemies.totalCount, this.style);
    const medal = medalFor(this.elapsed, levelDef.par);
    const bonus = rankBonus(run.rank);
    if (bonus > 0) {
      reward.total += bonus;
      reward.lines.push(`RANG ${run.rank} +${bonus}`);
    }
    const prevRank = this.readValue(RANK_PREFIX + levelDef.id) as Rank | null;
    if (!prevRank || RANK_ORDER.indexOf(run.rank) > RANK_ORDER.indexOf(prevRank)) this.writeValue(RANK_PREFIX + levelDef.id, run.rank);
    this.progress.addCredits(reward.total);
    this.audio.stopLoops();
    this.audio.playFinish();

    // Fragment du message de Sacha délivré par la balise
    const story = logForLevel(this.currentLevel);
    let log: FinishLog | null = null;
    if (story) {
      const first = this.progress.setFlag(logFlag(story.level));
      log = {
        code: story.code,
        title: story.title,
        from: story.fragment ? `MESSAGE DE SACHA · ${siblingWords(this.progress.sibling).Ton.toUpperCase()}` : 'NÉO-VÉRIDIAN',
        text: story.text(this.progress.sibling, this.fragments()),
        first,
      };
      if (first) this.audio.playLogStart();
    }
    const secrets = LEVELS[this.currentLevel].secrets ?? [];
    const found = secrets.filter((sd) => this.progress.hasFlag(`secret-${sd.id}`)).length;
    this.hud.showFinish(
      {
        time: this.elapsed,
        best: isRecord ? this.elapsed : best,
        isRecord,
        kills: this.kills,
        totalEnemies: this.enemies.totalCount,
        secrets: secrets.length > 0 ? `SECRETS DU NIVEAU ${found}/${secrets.length}` : '',
        rank: run.rank,
        medal,
        score: run.score,
        scoreLines: run.lines,
        bestCombo: this.style.bestCombo,
      },
      'CONTINUER VERS LA PLAZA ▶',
      reward,
      log,
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
    this.enemies.targets.length = 0;
    this.boss = null;
    this.enemies.clearAll();
    this.particles.clear();
    this.secrets = [];
    this.levelData = this.level.loadLevel(def, (b) => {
      plaza.build(b, (id) => this.progress.hasEgg(id));
      this.powerups.build(b, []);
      this.grapple.build(b, []);
    });
    this.audio.setMusicTheme('plaza');
    this.plaza = plaza;
    this.director.attach(plaza);
    this.engine.setTheme(def.theme);
    this.audio.setRainLevel(def.theme.rain);
    this.physics.step();
    this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
    this.hud.setLevelName('LA PLAZA');
    this.hud.setMode('plaza');
  }

  private updatePlaza(dt: number): void {
    if (!this.plaza) return;
    // Chute hors de la dalle : retour à l'entrée, sans pénalité
    if (this.player.feetY < -18) {
      this.player.reset(this.levelData.spawn, this.levelData.spawnYaw);
      this.hud.flashMessage('RETOUR À LA PLAZA', '#ff7ad9', 1200);
      this.director.onRespawn();
    }
    // Téléporteurs (entrée et bout de la rue) : direction le niveau suivant
    const p = this.player.position;
    const f = this.levelData.finish;
    const inBeacon = (p.x - f.position.x) ** 2 + (p.z - f.position.z) ** 2 < f.radius * f.radius && Math.abs(this.player.feetY - f.position.y) < 3;
    const inPad = this.plaza.teleporters.some((t) => (p.x - t.x) ** 2 + (p.z - t.z) ** 2 < 1.5 * 1.5 && Math.abs(this.player.feetY - t.y) < 1.5);
    if (inBeacon || inPad) {
      this.hud.fade();
      this.audio.playElevator();
      this.loadLevel(this.plazaNext);
      this.restart();
      return;
    }
    this.director.update(dt);
    this.hud.setObjective(this.director.objective());
  }

  /**
   * Niveau « suivant » quand on entre à la Plaza depuis le menu : celui d'après
   * si le niveau courant est déjà terminé, sinon le niveau courant.
   */
  private nextLevelToPlay(): number {
    const done = this.loadBestTime(this.currentLevel) !== null;
    return done ? (this.currentLevel + 1) % LEVELS.length : this.currentLevel;
  }

  /** Ascenseurs de la Plaza : fondu au noir et téléportation. */
  private teleport(position: THREE.Vector3, yaw: number): void {
    this.hud.fade();
    this.player.reset(position, yaw);
    this.particles.clear();
  }

  private pickThanks(lines: readonly string[]): string {
    return lines[Math.floor(Math.random() * lines.length)];
  }

  private shopItems(vendor: VendorId | 'indic'): ShopItem[] {
    if (vendor === 'indic') {
      // Un tuyau par secret encore introuvé (ou déjà acheté : il reste lisible)
      const items: ShopItem[] = [];
      LEVELS.forEach((l) => {
        for (const sec of l.secrets ?? []) {
          const found = this.progress.hasFlag(`secret-${sec.id}`);
          const bought = this.progress.hasFlag(`hint-${sec.id}`);
          if (found && !bought) continue;
          items.push({
            id: `hint-${sec.id}`,
            name: `TUYAU · ${l.name}`,
            desc: bought ? sec.hint : found ? 'Déjà trouvé.' : 'Un secret dort quelque part dans ce niveau.',
            price: HINT_PRICE,
            owned: bought,
            ownedLabel: found ? 'TROUVÉ ✓' : 'NOTÉ ✓',
          });
        }
      });
      return items;
    }
    return UPGRADES.filter((u) => u.vendor === vendor).map((u) => {
      const owned = this.progress.has(u.id);
      if (u.ink) {
        const equipped = this.progress.ink === u.id;
        return { id: u.id, name: u.name, desc: u.desc, price: u.price, owned: owned && equipped, equip: owned && !equipped, ownedLabel: 'ÉQUIPÉE ✓' };
      }
      return { id: u.id, name: u.name, desc: u.desc, price: u.price, owned };
    });
  }

  private openShop(vendor: VendorId | 'indic'): void {
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
    if (items.length === 0 || items.every((i) => i.owned)) this.shop.refresh(items, this.progress.credits, v.soldOut);
    this.input.exitPointerLock();
  }

  private buyUpgrade(id: string): void {
    const vendor = this.shopVendor;
    const v = VENDORS[vendor];
    const refresh = (msg: string) => this.shop.refresh(this.shopItems(vendor), this.progress.credits, msg);
    // Tuyaux de l'Indic
    if (id.startsWith('hint-')) {
      if (this.progress.hasFlag(id)) return;
      if (!this.progress.spend(HINT_PRICE)) {
        this.audio.playDenied();
        refresh('Les infos, ça se paie. Reviens avec des crédits.');
        return;
      }
      this.progress.setFlag(id);
      this.audio.playCoin();
      refresh(this.pickThanks(v.thanks));
      return;
    }
    // Encre déjà achetée : on l'équipe
    if (this.progress.has(id) && this.progress.equipInk(id)) {
      this.applyInk();
      this.audio.playUiBlip();
      refresh('Belle couleur. Elle te va bien.');
      return;
    }
    if (this.progress.buy(id)) {
      this.audio.playCoin();
      // Effet immédiat des améliorations
      this.player.health = STATS.maxHealth;
      this.player.dashCharges = STATS.dashMax;
      this.applyLoadout();
      if (id === 'monowire') this.hud.flashMessage('MONOWIRE · TOUCHE 3', '#ff8a2b', 1800);
      if (id === 'gorilla') this.hud.flashMessage('BRAS GORILLE · TOUCHE 4', '#ffa040', 1800);
      refresh(this.pickThanks(v.thanks));
    } else {
      this.audio.playDenied();
      refresh('Pas assez de crédits, runner. Termine un niveau et reviens.');
    }
  }

  /** Armes débloquées et encre des lames selon la progression. */
  private applyLoadout(): void {
    if (this.progress.has('monowire')) this.weapons.unlocked.add('monowire');
    if (this.progress.has('gorilla')) this.weapons.unlocked.add('gorilla');
    this.hud.setUnlocked(this.weapons.unlocked);
    this.applyInk();
  }

  private applyInk(): void {
    const [right, left] = this.progress.inkColors();
    this.weapons.setInk(right, left);
  }

  // ---------------------------------------------------------------------------
  // Histoire, secrets, journal
  // ---------------------------------------------------------------------------

  /** Fragments du message de Sacha déjà reçus. */
  private fragments(): number {
    return STORY_LOGS.filter((l) => l.fragment && this.progress.hasFlag(logFlag(l.level))).length;
  }

  private checkSecretsNearby(): void {
    for (const sec of this.secrets) {
      if (sec.found || sec.def.radius <= 0) continue;
      if (sec.center.distanceTo(this.player.position) < sec.def.radius) this.discoverSecret(sec);
    }
  }

  /** Tir du pistolet : les secrets à abattre sont touchés avant le décor. */
  private checkSecretShot(origin: THREE.Vector3, dir: THREE.Vector3, distance: number): void {
    if (this.mode !== 'level') return;
    for (const sec of this.secrets) {
      if (sec.found || !sec.def.shootable) continue;
      const d = raySphere(origin, dir, sec.center, 1.5);
      if (d !== null && d < distance + 1.5) this.discoverSecret(sec);
    }
  }

  private discoverSecret(sec: SecretRuntime): void {
    sec.found = true;
    sec.reveal();
    if (!this.progress.setFlag(`secret-${sec.def.id}`)) return;
    this.progress.addCredits(SECRET_REWARD);
    const n = this.progress.countEggs('secret-');
    this.audio.playSecret();
    if (sec.def.kind === 'vinyl') this.audio.playVinyl();
    if (sec.def.kind === 'payphone') this.audio.playLogStart();
    vibrate(30);
    this.hud.showSecret(`SECRET ${n}/${SECRET_TOTAL} · ${sec.def.name}`, `${sec.def.text} +${SECRET_REWARD} ¢`);
  }

  private journalData(): JournalData {
    const w = siblingWords(this.progress.sibling);
    const logs = STORY_LOGS.map((l) => {
      const unlocked = this.progress.hasFlag(logFlag(l.level));
      return {
        title: `${l.code} · ${l.title}`,
        subtitle: LEVELS[l.level]?.name ?? '',
        text: unlocked ? l.text(this.progress.sibling, this.fragments()) : `— Signal non récupéré. Atteins la balise de ${LEVELS[l.level]?.name ?? '?'}. —`,
        unlocked,
      };
    });
    const secrets = LEVELS.flatMap((l) =>
      (l.secrets ?? []).map((sec) => {
        const found = this.progress.hasFlag(`secret-${sec.id}`);
        const hinted = this.progress.hasFlag(`hint-${sec.id}`);
        return {
          title: found ? sec.name : '???',
          subtitle: l.name,
          text: found ? sec.text : hinted ? `Tuyau : ${sec.hint}` : 'Introuvé. L\'Indic, rue des Lanternes, vend des tuyaux.',
          unlocked: found,
        };
      }),
    );
    return { siblingLabel: w.Ton.toUpperCase(), logs, secrets, quests: this.director.quests() };
  }

  private openJournal(): void {
    this.audio.init();
    this.audio.playUiBlip();
    this.journal.open(this.journalData());
  }

  private toggleSibling(): void {
    this.progress.sibling = this.progress.sibling === 'frere' ? 'soeur' : 'frere';
    this.progress.save();
    this.audio.playUiBlip();
    if (this.journal.isOpen) this.journal.refresh(this.journalData());
    if (this.state === 'menu') this.showMenu();
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
    this.director.detach();
    this.hud.setMode('level');
    this.hud.setObjective(null);
    this.touch?.setInteract(null);
    this.enemies.clearAll();
    this.particles.clear();
    const secrets: SecretRuntime[] = [];
    this.enemies.targets.length = 0;
    this.boss = null;
    this.levelData = this.level.loadLevel(def, (b) => {
      for (const sd of def.secrets ?? []) secrets.push(buildSecret(b, sd, this.progress.hasFlag(`secret-${sd.id}`)));
      this.powerups.build(b, def.powerups ?? []);
      this.grapple.build(b, def.anchors ?? []);
      for (const lm of def.landmarks ?? []) if (lm.kind === 'antenna') buildAntenna(b, lm.pos[0], lm.pos[1], lm.pos[2], lm.height);
      if (def.boss) this.boss = new Boss(b, def.boss, { enemies: this.enemies, particles: this.particles, audio: this.audio });
    });
    this.secrets = secrets;
    if (this.boss) this.setupBoss(this.boss);
    this.enemies.spawnAll(this.levelData.enemySpawns);
    this.engine.setTheme(def.theme);
    this.audio.setRainLevel(def.theme.rain);
    this.audio.setMusicTheme(def.music);
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
    this.grappleEnemy = null;
    this.grapple.update(0, null, null, null);
    this.enemies.reset();
    this.weapons.reset();
    this.hud.setVisible(false);
    const cards: LevelCard[] = LEVELS.map((l, i) => {
      const best = this.loadBestTime(i);
      return {
        name: l.name,
        subtitle: l.subtitle,
        difficulty: l.difficulty,
        best,
        accent: l.theme.skyGlow,
        rank: this.readValue(RANK_PREFIX + l.id),
        medal: best !== null ? medalFor(best, l.par) : null,
      };
    });
    this.audio.setMusicTheme('plaza');
    this.hud.showStart(cards, this.currentLevel, this.progress.credits, {
      sibling: siblingWords(this.progress.sibling).Ton.toUpperCase(),
      fragments: this.fragments(),
      secrets: this.progress.countEggs('secret-'),
      secretTotal: SECRET_TOTAL,
    });
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
