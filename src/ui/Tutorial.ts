import type { Scene } from './TutorialScenes';
import {
  SCENE_H,
  SCENE_W,
  sceneCharged,
  sceneCombat,
  sceneDash,
  sceneIntro,
  sceneJump,
  sceneLore,
  sceneObjective,
  scenePlaza,
  sceneSandevistan,
  sceneSlide,
  sceneSurvival,
  sceneWallrun,
} from './TutorialScenes';
import type { LorePage } from './IntroContent';

interface Page {
  kind: 'lore' | 'game';
  title: string;
  text: string;
  keys: string[];
  scene: Scene;
}

/** Pages d'explication du jeu (les touches s'adaptent au clavier ou au tactile). */
function gamePages(touch: boolean): Page[] {
  const keys = (desktop: string[], mobile: string[]) => (touch ? mobile : desktop);
  const page = (title: string, text: string, k: string[], scene: Scene): Page => ({ kind: 'game', title, text, keys: k, scene });
  return [
    page(
      'BIENVENUE, RUNNER',
      'NEON VERTIGO est un jeu de parkour et de combat à la première personne, sur les toits d\'une ville cyberpunk sous la pluie. Vitesse, précision et sang-froid.',
      [],
      sceneIntro,
    ),
    page(
      'OBJECTIF',
      'Traverse les toits jusqu\'à la balise d\'extraction dorée, le plus vite possible. Le chrono démarre à ton premier pas. Éliminer les gardes et les drones est facultatif… mais ça rapporte de l\'énergie.',
      [],
      sceneObjective,
    ),
    page(
      'COURIR ET SAUTER',
      'Saute par-dessus les gouffres, puis appuie de nouveau en l\'air pour un double saut. Le double saut permet aussi de réorienter ton élan.',
      keys(['ZQSD / WASD', 'ESPACE', 'ESPACE ×2'], ['JOYSTICK', 'SAUT', 'SAUT ×2']),
      sceneJump,
    ),
    page(
      'GLISSADE',
      'Glisse sous les obstacles bas sans perdre de vitesse. Saute pendant une glissade : tu gardes tout ton élan.',
      keys(['C / CTRL'], ['GLISSE']),
      sceneSlide,
    ),
    page(
      'WALL-RUN',
      'En l\'air, avance contre un mur balisé en vert citron pour courir dessus. Saute pour rebondir vers le mur suivant, puis vers le toit.',
      keys(['AVANCER + MUR', 'ESPACE'], ['JOYSTICK ↑ + MUR', 'SAUT']),
      sceneWallrun,
    ),
    page(
      'DASH',
      'Une poussée fulgurante, au sol comme en l\'air. Deux charges qui se rechargent seules. Garde la glissade enfoncée à la fin d\'un dash pour filer encore plus vite.',
      keys(['SHIFT'], ['DASH']),
      sceneDash,
    ),
    page(
      'COMBAT',
      'Les lames Mantis tuent en un seul coup. Un laser rouge annonce un tir imminent : tranche le projectile pour le renvoyer à son tireur. Le pistolet se charge des drones : maintiens puis relâche pour une décharge de chevrotine à trois projectiles. Le monowire (armurerie de la Plaza) frappe deux fois plus loin, en deux touches.',
      keys(['CLIC GAUCHE', '1 / 2 / 3 : ARME'], ['ATTAQUE', '⇄ : ARME']),
      sceneCombat,
    ),
    page(
      'ATTAQUE CHARGÉE',
      `Maintiens l'attaque un court instant (0,3 s), puis relâche : tu fonces sur l'ennemi le plus proche et tu le tranches. Ce dash ne consomme aucune charge et te rend invulnérable. Il faut ensuite quelques secondes de recharge (petit anneau autour du réticule).`,
      keys(['MAINTENIR CLIC GAUCHE'], ['MAINTENIR ATTAQUE']),
      sceneCharged,
    ),
    page(
      'SANDEVISTAN',
      'Ralentis le temps : le monde se fige presque, pas toi. La jauge se vide vite puis se recharge, et chaque élimination la remplit un peu.',
      keys(['CLIC DROIT'], ['⧗ (EN HAUT À DROITE)']),
      sceneSandevistan,
    ),
    page(
      'LA PLAZA',
      'Entre deux niveaux, souffle à la Plaza. Tes crédits (¢) gagnés en fin de niveau achètent des améliorations chez les marchands. Fouille partout : chats néon, borne d\'arcade, fontaine à vœux… La balise dorée mène au niveau suivant.',
      keys(['E : PARLER / ACHETER'], ['BOUTON PARLER']),
      scenePlaza,
    ),
    page(
      'SURVIE',
      'Trois points d\'intégrité qui se régénèrent si tu évites les tirs. Une chute dans le vide, c\'est le flatline. Recommence instantanément et bats ton record.',
      keys(['R : RECOMMENCER', 'ÉCHAP : PAUSE'], ['↻ : RECOMMENCER', '❚❚ : PAUSE']),
      sceneSurvival,
    ),
  ];
}

/**
 * Tutoriel d'introduction : pages de lore (facultatives, voir IntroContent.ts)
 * puis une page animée en pixel art par mécanique du jeu.
 */
export class Tutorial {
  /** `play` = vrai si le joueur a cliqué sur « Jouer » à la fin. */
  onClose: ((play: boolean) => void) | null = null;
  /** Première interaction (permet d'initialiser l'audio). */
  onInteract: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private readonly kindEl: HTMLDivElement;
  private readonly stepEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly keysEl: HTMLDivElement;
  private readonly dotsEl: HTMLDivElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private pages: Page[] = [];
  private loreCount = 0;
  private readonly touch: boolean;
  private readonly lore: () => LorePage[];
  private index = 0;
  private opened = false;
  private pageStart = 0;
  private swipeX: number | null = null;

  constructor(container: HTMLElement, touch: boolean, lore: () => LorePage[]) {
    this.touch = touch;
    this.lore = lore;

    this.root = document.createElement('div');
    this.root.className = 'tutorial';
    this.root.innerHTML = `
      <div class="tut-panel">
        <div class="tut-head">
          <div class="tut-kind"></div>
          <div class="tut-step"></div>
          <button class="tut-skip" type="button">PASSER ›</button>
        </div>
        <div class="tut-body">
          <div class="tut-screen"><canvas class="tut-canvas" width="${SCENE_W}" height="${SCENE_H}"></canvas></div>
          <div class="tut-text">
            <div class="tut-title"></div>
            <div class="tut-desc"></div>
            <div class="tut-keys"></div>
          </div>
        </div>
        <div class="tut-nav">
          <button class="tut-prev" type="button">‹ PRÉCÉDENT</button>
          <div class="tut-dots"></div>
          <button class="tut-next" type="button">SUIVANT ›</button>
        </div>
      </div>`;
    container.appendChild(this.root);

    const q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
    this.panel = q<HTMLDivElement>('.tut-panel');
    this.canvas = q<HTMLCanvasElement>('.tut-canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.kindEl = q<HTMLDivElement>('.tut-kind');
    this.stepEl = q<HTMLDivElement>('.tut-step');
    this.titleEl = q<HTMLDivElement>('.tut-title');
    this.textEl = q<HTMLDivElement>('.tut-desc');
    this.keysEl = q<HTMLDivElement>('.tut-keys');
    this.dotsEl = q<HTMLDivElement>('.tut-dots');
    this.prevBtn = q<HTMLButtonElement>('.tut-prev');
    this.nextBtn = q<HTMLButtonElement>('.tut-next');

    this.prevBtn.addEventListener('click', () => this.goTo(this.index - 1));
    this.nextBtn.addEventListener('click', () => this.goTo(this.index + 1));
    q<HTMLButtonElement>('.tut-skip').addEventListener('click', () => this.close(false));
    window.addEventListener('keydown', this.handleKey);

    // Balayage horizontal sur mobile
    this.panel.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.swipeX = e.clientX;
    });
    this.panel.addEventListener('pointerup', (e) => {
      if (this.swipeX === null) return;
      const dx = e.clientX - this.swipeX;
      this.swipeX = null;
      if (Math.abs(dx) > 50) this.goTo(this.index + (dx < 0 ? 1 : -1));
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Pages recalculées à chaque ouverture (le lore dépend du lien choisi avec Sacha). */
  private buildPages(): void {
    const lore = this.lore();
    this.loreCount = lore.length;
    this.pages = [
      ...lore.map((p): Page => ({ kind: 'lore', title: p.title, text: p.text, keys: [], scene: sceneLore })),
      ...gamePages(this.touch),
    ];
    this.dotsEl.innerHTML = '';
    for (let i = 0; i < this.pages.length; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'tut-dot';
      dot.setAttribute('aria-label', `Page ${i + 1}`);
      dot.addEventListener('click', () => this.goTo(i));
      this.dotsEl.appendChild(dot);
    }
  }

  open(): void {
    this.buildPages();
    this.opened = true;
    this.index = 0;
    this.root.classList.add('show');
    document.body.classList.add('tutorial-open');
    this.render();
    requestAnimationFrame(this.loop);
  }

  close(play: boolean): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove('show');
    document.body.classList.remove('tutorial-open');
    this.onInteract?.();
    this.onClose?.(play);
  }

  private goTo(i: number): void {
    this.onInteract?.();
    if (i < 0) return;
    if (i >= this.pages.length) {
      this.close(true);
      return;
    }
    this.index = i;
    this.render();
  }

  private render(): void {
    const page = this.pages[this.index];
    const gameIndex = this.index - this.loreCount;
    const gameTotal = this.pages.length - this.loreCount;
    this.kindEl.textContent = page.kind === 'lore' ? 'TRANSMISSION' : 'TUTORIEL';
    this.stepEl.textContent =
      page.kind === 'lore'
        ? `${String(this.index + 1).padStart(2, '0')} / ${String(this.loreCount).padStart(2, '0')}`
        : `${String(gameIndex + 1).padStart(2, '0')} / ${String(gameTotal).padStart(2, '0')}`;
    this.titleEl.textContent = page.title;
    this.textEl.textContent = page.kind === 'lore' ? '' : page.text;
    this.keysEl.innerHTML = page.keys.map((k) => `<kbd>${k}</kbd>`).join('');
    this.root.classList.toggle('lore', page.kind === 'lore');
    this.prevBtn.disabled = this.index === 0;
    const last = this.index === this.pages.length - 1;
    this.nextBtn.textContent = last ? 'JOUER ▶' : 'SUIVANT ›';
    this.nextBtn.classList.toggle('play', last);
    [...this.dotsEl.children].forEach((d, i) => d.classList.toggle('active', i === this.index));
    // Relance l'animation d'entrée du texte
    this.panel.classList.remove('enter');
    void this.panel.offsetWidth;
    this.panel.classList.add('enter');
    this.pageStart = performance.now();
  }

  private loop = (now: number): void => {
    if (!this.opened) return;
    const page = this.pages[this.index];
    const t = (now - this.pageStart) / 1000;
    page.scene(this.ctx, t);
    if (page.kind === 'lore') {
      // Effet machine à écrire pour le lore
      const shown = Math.min(page.text.length, Math.floor(t * 40));
      if (this.textEl.textContent!.length !== shown) this.textEl.textContent = page.text.slice(0, shown);
    }
    requestAnimationFrame(this.loop);
  };

  private handleKey = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      this.goTo(this.index + 1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      this.goTo(this.index - 1);
    } else if (e.code === 'Escape') {
      this.close(false);
    }
  };
}
