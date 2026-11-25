import type { WeaponId } from '../weapons/WeaponManager';

export interface HudState {
  time: number;
  kills: number;
  totalEnemies: number;
  sandevistan: number;
  sandevistanActive: boolean;
  dashCharges: number;
  dashMax: number;
  dashProgress: number;
  health: number;
  maxHealth: number;
  speed: number;
}

export interface FinishStats {
  time: number;
  best: number | null;
  isRecord: boolean;
  kills: number;
  totalEnemies: number;
}

const WEAPON_LABELS: Record<WeaponId, string> = {
  blades: 'LAMES MANTIS',
  pistol: 'PISTOLET CYBER',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Interface tête haute minimaliste + écrans (titre, pause, mort, arrivée). */
export class HUD {
  /** Appelé quand le joueur clique / touche l'écran superposé. */
  onOverlayClick: (() => void) | null = null;
  /** Appelé par le bouton « Recommencer » de l'écran de pause. */
  onRestartClick: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly targets: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly sandFill: HTMLDivElement;
  private readonly sandLabel: HTMLDivElement;
  private readonly dashPips: HTMLSpanElement[] = [];
  private readonly healthPips: HTMLSpanElement[] = [];
  private readonly weaponSlots = new Map<WeaponId, HTMLDivElement>();
  private readonly speed: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private messageTimer: number | null = null;
  private hitTimer: number | null = null;
  private lastTimerText = '';
  private readonly touch: boolean;
  /** Instant d'affichage de l'écran superposé (anti « clic fantôme » sur mobile). */
  private overlayShownAt = 0;

  constructor(container: HTMLElement, dashMax: number, maxHealth: number, touch = false) {
    this.touch = touch;
    if (touch) document.body.classList.add('touch-mode');
    this.root = el('div', 'hud hidden', container);

    const top = el('div', 'hud-top', this.root);
    this.timer = el('div', 'hud-timer', top, '00:00.00');
    this.targets = el('div', 'hud-targets', top, 'CIBLES 0/0');

    this.crosshair = el('div', 'crosshair blades', this.root);
    for (let i = 0; i < 4; i++) el('span', `tick t${i}`, this.crosshair);
    el('span', 'dot', this.crosshair);
    this.hitmarker = el('div', 'hitmarker', this.root);
    for (let i = 0; i < 4; i++) el('span', `hm h${i}`, this.hitmarker);

    const left = el('div', 'hud-left', this.root);
    this.sandLabel = el('div', 'label sand-label', left, 'SANDEVISTAN');
    const bar = el('div', 'bar', left);
    this.sandFill = el('div', 'fill', bar);
    const dashRow = el('div', 'row', left);
    el('div', 'label', dashRow, 'DASH');
    const dashBox = el('div', 'pips dash', dashRow);
    for (let i = 0; i < dashMax; i++) this.dashPips.push(el('span', 'pip', dashBox));
    const hpRow = el('div', 'row', left);
    el('div', 'label', hpRow, 'INTÉGRITÉ');
    const hpBox = el('div', 'pips health', hpRow);
    for (let i = 0; i < maxHealth; i++) this.healthPips.push(el('span', 'pip', hpBox));

    const right = el('div', 'hud-right', this.root);
    (['blades', 'pistol'] as WeaponId[]).forEach((id, i) => {
      const slot = el('div', 'weapon-slot', right);
      el('span', 'key', slot, String(i + 1));
      el('span', 'name', slot, WEAPON_LABELS[id]);
      this.weaponSlots.set(id, slot);
    });
    this.speed = el('div', 'hud-speed', right, '0 KM/H');

    this.message = el('div', 'hud-message', this.root);
    el('div', 'hud-hint', this.root, 'R : RECOMMENCER · ÉCHAP : PAUSE');

    this.overlay = el('div', 'overlay', container);
    this.overlay.addEventListener('click', (e) => {
      // Ignore le clic synthétique généré par le doigt qui vient d'ouvrir l'écran
      if (performance.now() - this.overlayShownAt < 450) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-act="restart"]')) {
        e.stopPropagation();
        this.onRestartClick?.();
        return;
      }
      this.onOverlayClick?.();
    });

    const rotate = el('div', 'rotate-hint', container);
    rotate.innerHTML = '<div class="phone"></div><div>TOURNE TON APPAREIL EN MODE PAYSAGE</div>';

    this.setWeapon('blades');
  }

  static formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const c = Math.floor((seconds * 100) % 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setWeapon(id: WeaponId): void {
    for (const [wid, slot] of this.weaponSlots) slot.classList.toggle('active', wid === id);
    this.crosshair.className = `crosshair ${id}`;
  }

  update(s: HudState): void {
    const t = HUD.formatTime(s.time);
    if (t !== this.lastTimerText) {
      this.timer.textContent = t;
      this.lastTimerText = t;
    }
    this.targets.textContent = `CIBLES ${s.kills}/${s.totalEnemies}`;
    this.sandFill.style.width = `${Math.round(s.sandevistan * 100)}%`;
    this.root.classList.toggle('sandevistan', s.sandevistanActive);
    this.sandLabel.textContent = s.sandevistanActive ? 'SANDEVISTAN // ACTIF' : 'SANDEVISTAN';
    this.dashPips.forEach((p, i) => {
      p.classList.toggle('full', i < s.dashCharges);
      p.style.setProperty('--progress', i === s.dashCharges ? String(s.dashProgress) : i < s.dashCharges ? '1' : '0');
    });
    this.healthPips.forEach((p, i) => p.classList.toggle('full', i < s.health));
    this.root.classList.toggle('critical', s.health <= 1);
    this.speed.textContent = `${Math.round(s.speed * 3.6)} KM/H`;
  }

  hitMarker(): void {
    this.hitmarker.classList.remove('show');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');
    if (this.hitTimer !== null) window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.hitmarker.classList.remove('show'), 260);
  }

  flashMessage(text: string, color = '#00e5ff', duration = 1400): void {
    this.message.textContent = text;
    this.message.style.color = color;
    this.message.style.textShadow = `0 0 12px ${color}, 0 0 30px ${color}`;
    this.message.classList.remove('show');
    void this.message.offsetWidth;
    this.message.classList.add('show');
    if (this.messageTimer !== null) window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => this.message.classList.remove('show'), duration);
  }

  // ---------------------------------------------------------------------------
  // Écrans
  // ---------------------------------------------------------------------------

  showStart(best: number | null): void {
    const desktopControls = `
          <div><kbd>ZQSD</kbd>/<kbd>WASD</kbd><span>Courir</span></div>
          <div><kbd>Souris</kbd><span>Viser</span></div>
          <div><kbd>Espace</kbd><span>Saut · double saut · saut mural</span></div>
          <div><kbd>C</kbd>/<kbd>Ctrl</kbd><span>Glissade (garde l'élan)</span></div>
          <div><kbd>Shift</kbd><span>Dash (au sol ou en l'air)</span></div>
          <div><kbd>Avancer</kbd><span>contre un mur en l'air : wall-run</span></div>
          <div><kbd>Clic G</kbd><span>Attaquer / tirer</span></div>
          <div><kbd>Clic D</kbd><span>Sandevistan (ralenti)</span></div>
          <div><kbd>1</kbd>/<kbd>2</kbd><span>Lames Mantis / Pistolet</span></div>
          <div><kbd>R</kbd><span>Recommencer instantanément</span></div>`;
    const touchControls = `
          <div><kbd>Pouce gauche</kbd><span>Joystick : courir</span></div>
          <div><kbd>Pouce droit</kbd><span>Glisser : viser</span></div>
          <div><kbd>SAUT</kbd><span>Saut · double saut · saut mural</span></div>
          <div><kbd>GLISSE</kbd><span>Glissade (garde l'élan)</span></div>
          <div><kbd>DASH</kbd><span>Dash (au sol ou en l'air)</span></div>
          <div><kbd>ATTAQUE</kbd><span>Maintenir pour enchaîner, glisser pour viser</span></div>
          <div><kbd>SANDEVISTAN</kbd><span>Ralenti</span></div>
          <div><kbd>Joystick ↑</kbd><span>contre un mur en l'air : wall-run</span></div>
          <div><kbd>ARME</kbd><span>Lames Mantis / Pistolet</span></div>
          <div><kbd>↻</kbd> <kbd>❚❚</kbd><span>Recommencer · pause</span></div>`;
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show start';
    this.overlay.innerHTML = `
      <div class="panel">
        <div class="title" data-text="NEON VERTIGO">NEON VERTIGO</div>
        <div class="subtitle">PROTOTYPE // PARKOUR · LAMES · SANDEVISTAN</div>
        <div class="controls">${this.touch ? touchControls : desktopControls}</div>
        <div class="objective">Rejoins la balise d'extraction dorée au bout des toits. Élimine les gardes et drones en un coup.</div>
        ${best !== null ? `<div class="best">RECORD : ${HUD.formatTime(best)}</div>` : ''}
        <div class="cta">${this.touch ? '[ TOUCHE POUR TE CONNECTER ]' : '[ CLIQUE POUR TE CONNECTER ]'}</div>
        ${this.touch ? '<div class="sub">Plein écran et mode paysage recommandés</div>' : ''}
      </div>`;
  }

  showPause(): void {
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show pause';
    this.overlay.innerHTML = `
      <div class="panel small">
        <div class="title small">PAUSE</div>
        <div class="cta">${this.touch ? '[ TOUCHE POUR REPRENDRE ]' : '[ CLIQUE POUR REPRENDRE ]'}</div>
        <button class="overlay-btn" data-act="restart">↻ RECOMMENCER</button>
        ${this.touch ? '' : '<div class="sub">R : recommencer</div>'}
      </div>`;
  }

  showDeath(time: number, kills: number, total: number): void {
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show death';
    this.overlay.innerHTML = `
      <div class="panel small">
        <div class="title small glitch" data-text="FLATLINE">FLATLINE</div>
        <div class="stats">TEMPS ${HUD.formatTime(time)} · CIBLES ${kills}/${total}</div>
        <div class="cta">${this.touch ? '[ TOUCHE POUR REDÉMARRER ]' : '[ R ] REDÉMARRER'}</div>
      </div>`;
  }

  showFinish(s: FinishStats): void {
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show finish';
    this.overlay.innerHTML = `
      <div class="panel small">
        <div class="title small">EXTRACTION RÉUSSIE</div>
        <div class="big-time">${HUD.formatTime(s.time)}</div>
        <div class="stats">${s.isRecord ? '★ NOUVEAU RECORD ★' : `RECORD : ${s.best !== null ? HUD.formatTime(s.best) : '--'}`}</div>
        <div class="stats">CIBLES ÉLIMINÉES ${s.kills}/${s.totalEnemies}</div>
        <div class="cta">${this.touch ? '[ TOUCHE POUR REJOUER ]' : '[ R ] REJOUER'}</div>
      </div>`;
  }

  showLoading(text: string): void {
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel small"><div class="cta">${text}</div></div>`;
  }

  hideOverlay(): void {
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = '';
  }
}
