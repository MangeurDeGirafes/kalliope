import * as THREE from 'three';
import type { AudioSynthesizer } from '../core/AudioSynthesizer';
import type { InputManager } from '../core/InputManager';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { PlayerController } from '../player/PlayerController';
import type { Progress, VendorId } from '../progress/Progress';
import { STATS } from '../progress/Progress';
import type { HUD } from '../ui/HUD';
import type { JournalQuest } from '../ui/Journal';
import type { TouchControls } from '../ui/TouchControls';
import { CAT_COUNT, PACKAGE_COUNT, RACE_FINISH } from '../world/Plaza';
import type { Interactable, Plaza } from '../world/Plaza';
import { siblingWords } from '../story/Story';
import { vibrate } from '../core/Device';

const RAMEN_PRICE = 6;
const CAT_REWARD = 30;
const VENDING_PRICE = 2;
/** Temps imparti pour la course de Petit Zéro (s). */
export const RACE_LIMIT = 28;
/** Nombre total de secrets cachés dans les niveaux. */
export const SECRET_TOTAL = 8;

export interface PlazaServices {
  hud: HUD;
  audio: AudioSynthesizer;
  input: InputManager;
  progress: Progress;
  player: PlayerController;
  particles: ParticleSystem;
  touch: TouchControls | null;
  /** Ouvre la boutique d'un marchand (ou l'Indic). */
  openShop(vendor: VendorId | 'indic'): void;
  /** Téléporte le joueur (ascenseurs) avec un fondu. */
  teleport(position: THREE.Vector3, yaw: number): void;
  /** Fragments du message de Sacha récupérés (0 → 3). */
  fragments(): number;
}

/**
 * Logique de la Plaza : interactions (marchands, portes, ascenseurs, bar…),
 * quêtes secondaires (chats, colis, course, platine), répliques qui évoluent
 * avec l'histoire de Sacha.
 */
export class PlazaDirector {
  private plaza: Plaza | null = null;
  private readonly s: PlazaServices;
  private interactCooldown = 0;
  private readonly lastLine = new Map<string, number>();
  /** Course en cours : temps écoulé (s), ou -1. */
  private raceTime = -1;
  private readonly tmp = new THREE.Vector3();

  constructor(services: PlazaServices) {
    this.s = services;
  }

  attach(plaza: Plaza): void {
    this.plaza = plaza;
    this.raceTime = -1;
    this.interactCooldown = 0.3;
    plaza.setRaceMarker(false);
    this.syncPackages();
  }

  detach(): void {
    this.plaza = null;
    this.raceTime = -1;
  }

  /** Course de Petit Zéro en cours. */
  get racing(): boolean {
    return this.raceTime >= 0;
  }

  /** Bloque brièvement l'interaction (fermeture d'une boutique avec E…). */
  holdInteract(seconds: number): void {
    this.interactCooldown = Math.max(this.interactCooldown, seconds);
  }

  /** Ligne d'objectif affichée sous les crédits (course, colis), ou null. */
  objective(): string | null {
    if (this.raceTime >= 0) return `COURSE ${Math.max(0, RACE_LIMIT - this.raceTime).toFixed(1)} s`;
    const p = this.s.progress;
    if (p.hasFlag('quest-courier') && !p.hasFlag('quest-courier-done')) {
      const n = this.packagesTaken();
      return n >= PACKAGE_COUNT ? 'RETOURNE VOIR VEX' : `COLIS ${n}/${PACKAGE_COUNT}`;
    }
    return null;
  }

  /** Une chute pendant la course l'annule. */
  onRespawn(): void {
    if (this.raceTime >= 0) this.endRace(false);
  }

  update(dt: number): void {
    const plaza = this.plaza;
    if (!plaza) return;
    const { player, hud, progress, audio } = this.s;
    plaza.update(dt, player.position);
    this.interactCooldown = Math.max(0, this.interactCooldown - dt);

    const cat = plaza.collectCat(player.position);
    if (cat && progress.findEgg(cat.id)) {
      const n = progress.countEggs('cat-');
      progress.addCredits(CAT_REWARD);
      audio.playMeow();
      audio.playCoin();
      vibrate(30);
      this.sparkle(cat.sprite.position, 0xff7ad9);
      if (n >= CAT_COUNT) hud.flashMessage('TOUS LES CHATS ! VA VOIR MAMIE CHAT', '#ff7ad9', 2600);
      else hud.flashMessage(`CHAT NÉON ${n}/${CAT_COUNT} · +${CAT_REWARD} ¢`, '#ff7ad9', 1800);
    }

    const pkg = plaza.collectPackage(player.position);
    if (pkg) {
      progress.setFlag(pkg.id);
      const n = this.packagesTaken();
      audio.playCoin();
      this.sparkle(pkg.base, 0xffd23b);
      hud.flashMessage(n >= PACKAGE_COUNT ? 'TOUS LES COLIS ! RETOURNE VOIR VEX' : `COLIS ${n}/${PACKAGE_COUNT}`, '#ffd23b', 1800);
    }

    if (this.raceTime >= 0) {
      this.raceTime += dt;
      const dx = player.position.x - RACE_FINISH.x;
      const dz = player.position.z - RACE_FINISH.z;
      if (dx * dx + dz * dz < 2.6 * 2.6 && player.feetY > RACE_FINISH.y - 0.6) this.endRace(true);
      else if (this.raceTime > RACE_LIMIT) this.endRace(false);
    }

    const it = player.alive ? plaza.findInteractable(player.position, player.feetY) : null;
    hud.setPrompt(it ? `${this.s.touch ? '' : 'E : '}${it.verb} ${it.name}` : null);
    this.s.touch?.setInteract(it ? PlazaDirector.label(it) : null);
    if (it && this.interactCooldown <= 0 && this.s.input.wasPressed('interact')) {
      this.interactCooldown = 0.35;
      this.interact(it);
    }
  }

  /** Quêtes pour le journal. */
  quests(): JournalQuest[] {
    const p = this.s.progress;
    const frag = this.s.fragments();
    const cats = p.countEggs('cat-');
    const pk = this.packagesTaken();
    const secrets = p.countEggs('secret-');
    return [
      {
        title: 'LE MESSAGE DE SACHA',
        detail: `Atteins la balise des niveaux 1, 2 et 3 pour récupérer les fragments du message (${frag}/3).`,
        status: frag >= 3 ? 'done' : 'active',
      },
      {
        title: 'LES CHATS DE MAMIE',
        detail: `Retrouve les 5 chats néon cachés dans la Plaza (${cats}/${CAT_COUNT}), puis va voir Mamie Chat.`,
        status: p.hasFlag('cats-reward') ? 'done' : cats > 0 ? 'active' : 'todo',
      },
      {
        title: 'COLIS PERDUS',
        detail: p.hasFlag('quest-courier')
          ? `Ramasse les colis de Vex sur les toits de la rue des Lanternes (${pk}/${PACKAGE_COUNT}), puis rapporte-les-lui.`
          : 'Parle à Vex, à l\'entrée de la rue des Lanternes.',
        status: p.hasFlag('quest-courier-done') ? 'done' : p.hasFlag('quest-courier') ? 'active' : 'todo',
      },
      {
        title: 'LA COURSE DE PETIT ZÉRO',
        detail: p.raceBest
          ? `Record : ${p.raceBest.toFixed(2)} s. Limite : ${RACE_LIMIT} s jusqu'au drapeau du toit jaune.`
          : `Parle à Petit Zéro puis atteins le drapeau du toit jaune en moins de ${RACE_LIMIT} s.`,
        status: p.hasFlag('quest-race') ? 'done' : 'todo',
      },
      {
        title: 'LA PLATINE DE DJ BAO',
        detail: p.hasFlag('quest-dj')
          ? 'Trouve la vieille platine de Sacha dans TOITS DE NÉON, puis reviens voir DJ Bao.'
          : 'DJ Bao a quelque chose à te demander, près des enceintes.',
        status: p.hasFlag('quest-dj-done') ? 'done' : p.hasFlag('quest-dj') ? 'active' : 'todo',
      },
      {
        title: 'LES SECRETS DE NÉO-VÉRIDIAN',
        detail: `Easter eggs trouvés dans les niveaux : ${secrets}/${SECRET_TOTAL}. L'Indic vend des tuyaux.`,
        status: secrets >= SECRET_TOTAL ? 'done' : secrets > 0 ? 'active' : 'todo',
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  private static label(it: Interactable): string {
    switch (it.kind) {
      case 'shop':
      case 'indic':
        return 'BOUTIQUE';
      case 'ramen':
        return 'RAMEN';
      case 'arcade':
      case 'jukebox':
        return 'JOUER';
      case 'oracle':
        return 'ORACLE';
      case 'fountain':
        return 'VŒU';
      case 'statue':
        return 'VOIR';
      case 'vending':
        return 'ACHETER';
      case 'door':
        return 'FRAPPER';
      case 'elevator':
        return 'ASCENSEUR';
      case 'race':
        return 'COURSE';
      default:
        return 'PARLER';
    }
  }

  private interact(it: Interactable): void {
    const { audio, progress, player, hud } = this.s;
    audio.playUiBlip();
    const say = (text: string) => hud.showDialogue(it.name, text, it.color);
    const frag = this.s.fragments();
    const w = siblingWords(progress.sibling);
    switch (it.kind) {
      case 'shop':
        if (it.vendor) this.s.openShop(it.vendor);
        return;
      case 'indic':
        this.s.openShop('indic');
        return;
      case 'ramen': {
        if (!progress.spend(RAMEN_PRICE)) {
          audio.playDenied();
          say(`Un bol, c'est ${RAMEN_PRICE} ¢. Reviens avec de quoi payer, mon chou.`);
          return;
        }
        player.sandevistanEnergy = 1;
        if (progress.findEgg('ramen')) {
          say('Premier bol de la maison ? Non. Mais il te remplit le Sandevistan à ras bord.');
          return;
        }
        const lines = [
          'Bouillon de 48 heures, nouilles de synthèse, amour véritable. Sandevistan rechargé.',
          'Mange. Les toits seront encore là après.',
          'Le secret ? Une pincée de néon râpé.',
          'Paraît qu\'un chat dort derrière ma cuisine. Il adore l\'odeur du miso.',
        ];
        if (frag >= 3) lines.push('Trois heures du matin, c\'était l\'heure de Sacha. Je garde toujours un bol de côté.');
        say(this.pickLine(it.id, lines));
        return;
      }
      case 'arcade':
        audio.playArcade();
        if (progress.findEgg('arcade')) {
          this.reward(20);
          say('NOUVEAU RECORD ! Tu bats le score de démonstration. +20 ¢');
        } else {
          say(
            this.pickLine(it.id, [
              'GAME OVER. MEILLEUR SCORE : K.A.L.L.I.O.P.E — 999 999.',
              'Tu bats le record de… personne. La borne est en mode démo.',
              'INSERT COIN. Ah non, c\'est gratuit aujourd\'hui.',
              'Deuxième meilleur score : SACHA — 999 998. Ça te dit quelque chose ?',
            ]),
          );
        }
        return;
      case 'oracle':
        say(this.pickLine(it.id, it.lines ?? ['…']));
        return;
      case 'fountain': {
        if (!progress.spend(1)) {
          audio.playDenied();
          say('Il te faut au moins 1 ¢ pour faire un vœu.');
          return;
        }
        progress.coins++;
        progress.save();
        audio.playSplash();
        this.sparkle(this.tmp.set(0, 0.6, -14), 0x7fd8ff);
        if (progress.coins >= 7 && progress.findEgg('fountain')) {
          this.reward(77);
          say('JACKPOT ! Sept vœux, sept vies : la fontaine te recrache 77 ¢.');
        } else {
          say(
            this.pickLine(it.id, [
              'Plouf. Ton vœu a été enregistré dans le cloud.',
              'Plouf. Vœu en file d\'attente : position 4 096.',
              'Plouf. La fontaine fait semblant de ne pas avoir entendu.',
              `Plouf. Tu fais le vœu de revoir ${w.ton}. L'eau se tait.`,
            ]),
          );
        }
        return;
      }
      case 'statue':
        if (progress.findEgg('statue')) {
          this.reward(80);
          say('Tu as trouvé la muse KALLIOPE. Elle t\'offre 80 ¢ et un peu d\'inspiration.');
        } else {
          say('La muse veille sur la Plaza. Elle t\'a à l\'œil.');
        }
        return;
      case 'mamie': {
        const n = progress.countEggs('cat-');
        if (n >= CAT_COUNT) {
          if (progress.findEgg('cats-reward')) {
            this.reward(100);
            say('Mes bébés, tous rentrés ! Tiens, prends ça : 100 ¢. Tu es un amour.');
          } else {
            say('Ils ronronnent depuis que tu es passé. Sacha leur donnait des croquettes, tu sais.');
          }
        } else if (n === 0) {
          say('Mes cinq chats néon se sont encore sauvés dans la Plaza… Tu me les ramènes ? Ils aiment les endroits en hauteur.');
        } else {
          say(`Tu en as retrouvé ${n} sur ${CAT_COUNT}. Les autres se cachent : en hauteur, ou près de quelque chose qui sent bon.`);
        }
        return;
      }
      case 'dj': {
        if (progress.hasFlag('quest-dj-done')) {
          say(this.pickLine(it.id, it.lines ?? ['…']));
        } else if (progress.hasFlag('secret-vinyl')) {
          progress.setFlag('quest-dj');
          progress.setFlag('quest-dj-done');
          this.reward(70);
          audio.playVinyl();
          say('La platine de Sacha tourne encore ? Alors ce soir, je passe ses disques. Tiens, 70 ¢. Pour Sacha.');
        } else if (progress.setFlag('quest-dj')) {
          say('Sacha passait des vinyles ici, avant. Une de ses vieilles platines tournerait encore sur un toit des Toits de Néon… Tu me la trouves ?');
        } else {
          say('Toujours pas de platine ? Pas loin du départ des Toits de Néon, à ce qu\'on raconte. Sur un petit toit à part.');
        }
        return;
      }
      case 'bar': {
        const lines = [
          `Sacha ? Tout le monde connaissait Sacha, ici. Si tu cherches ses balises, commence par les Toits de Néon.`,
          '« Ne descends pas dans la rue »… C\'est ce qu\'on se répète tous depuis qu\'Aegis tient les niveaux bas.',
          'Des souvenirs, hein ? Aegis efface la mémoire du quartier. Pas étonnant que Sacha ait pris de l\'avance sur eux.',
          'Sacha avait raison : tant qu\'on se souvient, Aegis ne gagne pas. Ce verre-là, c\'est la maison qui l\'offre.',
        ];
        if (frag >= 3) player.sandevistanEnergy = 1;
        say(lines[Math.min(3, frag)]);
        return;
      }
      case 'jukebox': {
        if (Math.random() < 0.5) audio.playVinyl();
        else audio.playArcade();
        say(
          this.pickLine(it.id, [
            'Le juke-box crache un vieux synthwave. Quelqu\'un, au bar, fredonne.',
            'Morceau 24 : « Pluie sur Néo-Véridian ». La face B est rayée.',
            'Le juke-box hésite, puis lance la chanson préférée de Sacha. Hasard ?',
          ]),
        );
        return;
      }
      case 'vending': {
        if (!progress.spend(VENDING_PRICE)) {
          audio.playDenied();
          say(`Une canette coûte ${VENDING_PRICE} ¢.`);
          return;
        }
        audio.playCoin();
        player.dashCharges = STATS.dashMax;
        player.health = STATS.maxHealth;
        player.sandevistanEnergy = Math.min(1, player.sandevistanEnergy + 0.3);
        say(
          this.pickLine(it.id, [
            'NEURO-COLA, goût original. Tes charges de dash pétillent.',
            'SODA PIXEL saveur yuzu. Intégrité et dash rechargés.',
            'THÉ FROID AU GINSENG. Tu te sens presque reposé… presque.',
            'BOISSON « 24 HEURES ». L\'étiquette promet de ne jamais dormir.',
          ]),
        );
        return;
      }
      case 'door': {
        audio.playKnock();
        if (it.id === 'door-13' && progress.setFlag('door-13')) {
          this.reward(13);
          say('Une main glisse 13 ¢ sous la porte. Une voix : « Pour Sacha. »');
          return;
        }
        say(
          this.pickLine('door', [
            'Une voix étouffée : « On n\'achète rien ! »',
            'Une voix : « Si c\'est Aegis, je suis pas là. »',
            'Pas de réponse. Juste un chat qui miaule derrière la porte.',
            '« C\'est pour le colis ? Non ? Alors bonne nuit. »',
            'Quelqu\'un chuchote : « Sacha ? … Ah, non. Désolé. »',
            'Une radio grésille derrière la porte, puis se tait.',
          ]),
        );
        return;
      }
      case 'elevator':
        if (this.raceTime >= 0) {
          audio.playDenied();
          say('« Ascenseur en panne pendant la course. » Petit Zéro a pensé à tout.');
          return;
        }
        if (it.target) {
          audio.playElevator();
          this.s.teleport(it.target, it.targetYaw ?? 0);
          this.interactCooldown = 0.8;
        }
        return;
      case 'courier': {
        const n = this.packagesTaken();
        if (progress.hasFlag('quest-courier-done')) {
          say('Merci encore, runner. Ce quartier tient grâce aux gens comme toi.');
        } else if (!progress.hasFlag('quest-courier')) {
          progress.setFlag('quest-courier');
          this.syncPackages();
          say('J\'ai semé trois colis sur les toits du marché en fuyant un drone d\'Aegis. Tu me les ramènes ? Escalier de secours au fond à gauche, passerelle au milieu. Je paie bien.');
        } else if (n >= PACKAGE_COUNT) {
          progress.setFlag('quest-courier-done');
          this.reward(90);
          say('Tous mes colis ! Tiens, 90 ¢. Et si tu croises Aegis… tu ne m\'as jamais vu.');
        } else {
          say(`Encore ${PACKAGE_COUNT - n} colis là-haut : un sur le toit rose, un sur la passerelle, un sur le toit jaune.`);
        }
        return;
      }
      case 'race':
        if (this.raceTime >= 0) {
          say('Cours ! Le drapeau, sur le toit jaune au fond à droite !');
          return;
        }
        this.raceTime = 0;
        this.plaza?.setRaceMarker(true);
        audio.playStart();
        say(`Course jusqu'au drapeau du toit jaune, au fond à droite ! Tu as ${RACE_LIMIT} secondes. Escalier, toits, passerelle… et pas d'ascenseur. Partez !`);
        hud.flashMessage('COURSE !', '#ffd23b', 1200);
        return;
      default:
        say(this.pickLine(it.id, it.lines ?? ['…']));
    }
  }

  private endRace(won: boolean): void {
    const { progress, hud, audio } = this.s;
    const time = this.raceTime;
    this.raceTime = -1;
    this.plaza?.setRaceMarker(false);
    if (!won) {
      audio.playDenied();
      hud.flashMessage('TROP LENT !', '#ff3b3b', 1600);
      hud.showDialogue('PETIT ZÉRO', 'Raté ! Reviens me voir à l\'entrée de la rue pour retenter.', '#ffd23b');
      return;
    }
    const record = progress.raceBest === null || time < progress.raceBest;
    if (record) {
      progress.raceBest = time;
      progress.save();
    }
    const first = progress.setFlag('quest-race');
    this.reward(first ? 60 : 15);
    audio.playFinish();
    hud.flashMessage(`${time.toFixed(2)} s${record ? ' · RECORD' : ''}`, '#ffd23b', 2200);
    hud.showDialogue('PETIT ZÉRO', first ? 'Wouah, t\'es rapide ! Tiens, 60 ¢, c\'est toutes mes économies.' : `Encore ! ${time.toFixed(2)} s. Allez, 15 ¢ pour la peine.`, '#ffd23b');
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  private packagesTaken(): number {
    let n = 0;
    for (let i = 1; i <= PACKAGE_COUNT; i++) if (this.s.progress.hasFlag(`pkg-${i}`)) n++;
    return n;
  }

  private syncPackages(): void {
    const p = this.s.progress;
    const active = p.hasFlag('quest-courier') && !p.hasFlag('quest-courier-done');
    this.plaza?.setPackagesVisible(active, (id) => p.hasFlag(id));
  }

  /** Réplique au hasard, jamais deux fois la même d'affilée. */
  private pickLine(id: string, lines: readonly string[]): string {
    let i = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && i === this.lastLine.get(id)) i = (i + 1) % lines.length;
    this.lastLine.set(id, i);
    return lines[i];
  }

  private reward(amount: number): void {
    this.s.progress.addCredits(amount);
    this.s.audio.playCoin();
  }

  private sparkle(at: THREE.Vector3, color: number): void {
    this.s.particles.burst(at, {
      count: 36,
      color,
      color2: 0xffffff,
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
  }
}
