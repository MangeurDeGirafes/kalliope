import type { WeaponId } from '../weapons/WeaponManager';
import type { Reward } from '../progress/Progress';

export interface HudState {
  time: number;
  /** Ligne sous le chrono (cibles en niveau, chats trouvés à la Plaza). */
  targetsText: string;
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
  /** « SECRETS DU NIVEAU 1/2 » (vide si le niveau n'en a pas). */
  secrets?: string;
}

/** Log audio délivré par la balise (fragment du message de Sacha). */
export interface FinishLog {
  code: string;
  title: string;
  from: string;
  text: string;
  /** Première écoute : texte déroulé ; sinon rappel compact. */
  first: boolean;
}

/** Progression de l'histoire affichée sur l'écran titre. */
export interface StoryStatus {
  sibling: string;
  fragments: number;
  secrets: number;
  secretTotal: number;
}

/** Carte de sélection de niveau sur l'écran titre. */
export interface LevelCard {
  name: string;
  subtitle: string;
  difficulty: number;
  best: number | null;
  /** Couleur d'accent (ciel du niveau). */
  accent: number;
}

const WEAPON_LABELS: Record<WeaponId, string> = {
  blades: 'LAMES MANTIS',
  pistol: 'PISTOLET CYBER',
  monowire: 'MONOWIRE',
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
  /** Appelé par le bouton « Tutoriel » de l'écran titre. */
  onTutorialClick: (() => void) | null = null;
  /** Appelé quand une carte de niveau est choisie (index). */
  onLevelSelect: ((index: number) => void) | null = null;
  /** Appelé par « Niveau suivant » sur l'écran d'arrivée. */
  onNextClick: (() => void) | null = null;
  /** Appelé par « Menu » (pause, mort, arrivée). */
  onMenuClick: (() => void) | null = null;
  /** Appelé par le bouton « La Plaza » de l'écran titre. */
  onPlazaClick: (() => void) | null = null;
  /** Ouvre le journal (écran titre, pause). */
  onJournalClick: (() => void) | null = null;
  /** Bascule frère / sœur pour Sacha. */
  onSiblingClick: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly levelLabel: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly targets: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly chargeRing: HTMLDivElement;
  private readonly chargeLabel: HTMLDivElement;
  private lastCharge = -1;
  private readonly sandFill: HTMLDivElement;
  private readonly sandLabel: HTMLDivElement;
  private readonly dashPips: HTMLSpanElement[] = [];
  private readonly healthPips: HTMLSpanElement[] = [];
  private readonly dashBox: HTMLDivElement;
  private readonly hpBox: HTMLDivElement;
  private readonly credits: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly dialogue: HTMLDivElement;
  private readonly objective: HTMLDivElement;
  private readonly secretToast: HTMLDivElement;
  private readonly fadeEl: HTMLDivElement;
  private secretTimer: number | null = null;
  private typeTimer: number | null = null;
  private typeFull = '';
  private dialogueTimer: number | null = null;
  private lastCredits = -1;
  private lastTargets = '';
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
    this.levelLabel = el('div', 'hud-level', top);
    this.timer = el('div', 'hud-timer', top, '00:00.00');
    this.targets = el('div', 'hud-targets', top, 'CIBLES 0/0');
    this.credits = el('div', 'hud-credits', top, '0 ¢');
    this.objective = el('div', 'hud-objective', top);

    this.crosshair = el('div', 'crosshair blades', this.root);
    for (let i = 0; i < 4; i++) el('span', `tick t${i}`, this.crosshair);
    el('span', 'dot', this.crosshair);
    this.chargeRing = el('div', 'charge-ring', this.root);
    this.chargeLabel = el('div', 'charge-label', this.root, 'RELÂCHE !');
    this.hitmarker = el('div', 'hitmarker', this.root);
    for (let i = 0; i < 4; i++) el('span', `hm h${i}`, this.hitmarker);

    const left = el('div', 'hud-left', this.root);
    this.sandLabel = el('div', 'label sand-label', left, 'SANDEVISTAN');
    const bar = el('div', 'bar', left);
    this.sandFill = el('div', 'fill', bar);
    const dashRow = el('div', 'row', left);
    el('div', 'label', dashRow, 'DASH');
    this.dashBox = el('div', 'pips dash', dashRow);
    for (let i = 0; i < dashMax; i++) this.dashPips.push(el('span', 'pip', this.dashBox));
    const hpRow = el('div', 'row', left);
    el('div', 'label', hpRow, 'INTÉGRITÉ');
    this.hpBox = el('div', 'pips health', hpRow);
    for (let i = 0; i < maxHealth; i++) this.healthPips.push(el('span', 'pip', this.hpBox));

    const right = el('div', 'hud-right', this.root);
    (['blades', 'pistol', 'monowire'] as WeaponId[]).forEach((id, i) => {
      const slot = el('div', `weapon-slot${id === 'monowire' ? ' locked' : ''}`, right);
      el('span', 'key', slot, String(i + 1));
      el('span', 'name', slot, WEAPON_LABELS[id]);
      this.weaponSlots.set(id, slot);
    });
    this.speed = el('div', 'hud-speed', right, '0 KM/H');

    this.message = el('div', 'hud-message', this.root);
    this.prompt = el('div', 'hud-prompt', this.root);
    this.dialogue = el('div', 'hud-dialogue', this.root);
    this.secretToast = el('div', 'hud-secret', this.root);
    this.fadeEl = el('div', 'hud-fade', container);
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
      if (target?.closest('[data-act="tutorial"]')) {
        e.stopPropagation();
        this.onTutorialClick?.();
        return;
      }
      const card = target?.closest<HTMLElement>('[data-act="level"]');
      if (card) {
        e.stopPropagation();
        this.onLevelSelect?.(Number(card.dataset.level));
        return;
      }
      if (target?.closest('[data-act="next"]')) {
        e.stopPropagation();
        this.onNextClick?.();
        return;
      }
      if (target?.closest('[data-act="menu"]')) {
        e.stopPropagation();
        this.onMenuClick?.();
        return;
      }
      if (target?.closest('[data-act="plaza"]')) {
        e.stopPropagation();
        this.onPlazaClick?.();
        return;
      }
      if (target?.closest('[data-act="journal"]')) {
        e.stopPropagation();
        this.onJournalClick?.();
        return;
      }
      if (target?.closest('[data-act="sibling"]')) {
        e.stopPropagation();
        this.onSiblingClick?.();
        return;
      }
      if (target?.closest('[data-act="log"]')) {
        // Toucher le log affiche tout le texte d'un coup
        e.stopPropagation();
        this.finishTyping();
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

  /** Affiche l'emplacement des armes débloquées (monowire acheté à l'armurerie). */
  setUnlocked(ids: Iterable<WeaponId>): void {
    const set = new Set(ids);
    for (const [wid, slot] of this.weaponSlots) slot.classList.toggle('locked', !set.has(wid));
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
    if (s.targetsText !== this.lastTargets) {
      this.targets.textContent = s.targetsText;
      this.lastTargets = s.targetsText;
    }
    // Améliorations achetées : nombre de charges / points d'intégrité variable
    this.syncPips(this.dashPips, this.dashBox, s.dashMax);
    this.syncPips(this.healthPips, this.hpBox, s.maxHealth);
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

  private syncPips(pips: HTMLSpanElement[], box: HTMLDivElement, count: number): void {
    while (pips.length < count) pips.push(el('span', 'pip', box));
    while (pips.length > count) pips.pop()!.remove();
  }

  /** Niveau (chrono, cibles) ou Plaza (exploration libre, crédits mis en avant). */
  setMode(mode: 'level' | 'plaza'): void {
    this.root.classList.toggle('plaza', mode === 'plaza');
    if (mode === 'level') this.setPrompt(null);
  }

  setCredits(amount: number): void {
    if (amount === this.lastCredits) return;
    const gained = this.lastCredits >= 0 && amount > this.lastCredits;
    this.lastCredits = amount;
    this.credits.textContent = `${amount} ¢`;
    if (gained) {
      this.credits.classList.remove('bump');
      void this.credits.offsetWidth;
      this.credits.classList.add('bump');
    }
  }

  /** Objectif en cours à la Plaza (course, colis), null pour le masquer. */
  setObjective(text: string | null): void {
    const t = text ?? '';
    if (this.objective.textContent === t) return;
    this.objective.textContent = t;
    this.objective.classList.toggle('show', text !== null);
  }

  /** Fondu au noir bref (ascenseurs). */
  fade(): void {
    this.fadeEl.classList.remove('show');
    void this.fadeEl.offsetWidth;
    this.fadeEl.classList.add('show');
  }

  /** Petit encart discret : secret trouvé. */
  showSecret(title: string, text: string): void {
    this.secretToast.innerHTML = '';
    el('div', 'sec-title', this.secretToast, `◆ ${title}`);
    el('div', 'sec-text', this.secretToast, text);
    this.secretToast.classList.remove('show');
    void this.secretToast.offsetWidth;
    this.secretToast.classList.add('show');
    if (this.secretTimer !== null) window.clearTimeout(this.secretTimer);
    this.secretTimer = window.setTimeout(() => this.secretToast.classList.remove('show'), 6500);
  }

  /** Invite d'interaction (« E : PARLER À … »), null pour la masquer. */
  setPrompt(text: string | null): void {
    const t = text ?? '';
    if (this.prompt.textContent === t) return;
    this.prompt.textContent = t;
    this.prompt.classList.toggle('show', text !== null);
  }

  /** Bulle de dialogue non bloquante en bas de l'écran. */
  showDialogue(speaker: string, text: string, color = '#ffd23b', duration = 4200): void {
    this.dialogue.innerHTML = '';
    const name = el('div', 'dlg-name', this.dialogue, speaker);
    name.style.color = color;
    el('div', 'dlg-text', this.dialogue, text);
    this.dialogue.style.borderColor = color;
    this.dialogue.classList.remove('show');
    void this.dialogue.offsetWidth;
    this.dialogue.classList.add('show');
    if (this.dialogueTimer !== null) window.clearTimeout(this.dialogueTimer);
    this.dialogueTimer = window.setTimeout(() => this.dialogue.classList.remove('show'), duration);
  }

  hideDialogue(): void {
    this.dialogue.classList.remove('show');
  }

  /**
   * Jauge circulaire autour du réticule : charge en cours (lames ou chevrotine),
   * ou recharge (`cooldown` de 0 à 1, -1 = disponible) affichée en discret.
   */
  setCharge(level: number, visible: boolean, cooldown = -1, kind: 'blades' | 'pistol' = 'blades'): void {
    const ready = visible && level >= 1;
    const cooling = !visible && cooldown >= 0;
    const q = visible ? Math.min(99, Math.floor(level * 100)) : cooling ? Math.floor(cooldown * 100) : -1;
    const key = (ready ? 1000 : q) + (cooling ? 2000 : 0) + (kind === 'pistol' ? 5000 : 0);
    if (key === this.lastCharge) return;
    this.lastCharge = key;
    this.chargeRing.classList.toggle('show', visible || cooling);
    this.chargeRing.classList.toggle('ready', ready);
    this.chargeRing.classList.toggle('cooling', cooling);
    this.chargeRing.classList.toggle('pistol', kind === 'pistol');
    this.chargeLabel.classList.toggle('show', ready);
    this.chargeLabel.textContent = kind === 'pistol' ? 'CHEVROTINE !' : 'RELÂCHE !';
    this.chargeRing.style.setProperty('--charge', String(ready ? 100 : Math.max(0, q)));
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

  /** Nom du niveau affiché au-dessus du chrono. */
  setLevelName(text: string): void {
    this.levelLabel.textContent = text;
  }

  showStart(levels: LevelCard[], selected: number, credits: number, story: StoryStatus): void {
    const quickKeys = this.touch
      ? ''
      : `<div class="quick-keys">
          <span><kbd>ZQSD</kbd> courir</span><span><kbd>ESPACE</kbd> saut</span><span><kbd>C</kbd> glisse</span>
          <span><kbd>SHIFT</kbd> dash</span><span><kbd>CLIC G</kbd> attaque · maintenir : chargée</span>
          <span><kbd>CLIC D</kbd> sandevistan</span><span><kbd>R</kbd> recommencer</span>
        </div>`;
    const cards = levels
      .map((l, i) => {
        const pips = Array.from({ length: 4 }, (_, k) => `<i class="${k < l.difficulty ? 'on' : ''}"></i>`).join('');
        const accent = `#${l.accent.toString(16).padStart(6, '0')}`;
        return `
          <button class="level-card${i === selected ? ' selected' : ''}" data-act="level" data-level="${i}" type="button" style="--accent:${accent}">
            <span class="lc-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="lc-name">${l.name}</span>
            <span class="lc-sub">${l.subtitle}</span>
            <span class="lc-foot"><span class="lc-diff" aria-label="Difficulté ${l.difficulty} sur 4">${pips}</span>
            <span class="lc-best">${l.best !== null ? `★ ${HUD.formatTime(l.best)}` : 'NON TERMINÉ'}</span></span>
          </button>`;
      })
      .join('');
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show start';
    this.overlay.innerHTML = `
      <div class="panel">
        <div class="title" data-text="NEON VERTIGO">NEON VERTIGO</div>
        <div class="subtitle">PROTOTYPE // PARKOUR · LAMES · SANDEVISTAN</div>
        <div class="pick">CHOISIS TON PARCOURS</div>
        <div class="level-grid">${cards}</div>
        ${quickKeys}
        <div class="cta">${this.touch ? '[ TOUCHE UN NIVEAU POUR TE CONNECTER ]' : '[ CLIQUE SUR UN NIVEAU POUR TE CONNECTER ]'}</div>
        <div class="story-line">MESSAGE DE SACHA ${story.fragments}/3 · SECRETS ${story.secrets}/${story.secretTotal}</div>
        <div class="btn-row">
          <button class="overlay-btn plaza-btn" data-act="plaza" type="button">◆ LA PLAZA · ${credits} ¢</button>
          <button class="overlay-btn" data-act="journal" type="button">▤ JOURNAL</button>
          <button class="overlay-btn" data-act="tutorial" type="button">▶ TUTORIEL &amp; COMMANDES</button>
          <button class="overlay-btn sibling-btn" data-act="sibling" type="button">SACHA : ${story.sibling} ⇄</button>
        </div>
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
        <div class="btn-row">
          <button class="overlay-btn" data-act="restart" type="button">↻ RECOMMENCER</button>
          <button class="overlay-btn" data-act="journal" type="button">▤ JOURNAL</button>
          <button class="overlay-btn" data-act="menu" type="button">☰ NIVEAUX</button>
        </div>
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
        <div class="cta">${this.touch ? '[ TOUCHE POUR REDÉMARRER ]' : '[ R ] OU CLIC : REDÉMARRER'}</div>
        <div class="btn-row">
          <button class="overlay-btn" data-act="menu" type="button">☰ NIVEAUX</button>
        </div>
      </div>`;
  }

  showFinish(s: FinishStats, nextLabel: string, reward: Reward, log: FinishLog | null = null): void {
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show finish';
    let logHtml = '';
    if (log && log.first) {
      logHtml = `
        <div class="audio-log" data-act="log">
          <div class="log-head"><span class="log-wave"><i></i><i></i><i></i><i></i><i></i></span>LOG AUDIO · ${log.code} · ${log.title}</div>
          <div class="log-from">${log.from}</div>
          <div class="log-text"></div>
        </div>`;
    } else if (log) {
      logHtml = `<div class="log-compact">✓ ${log.code} · ${log.title} — à réécouter dans le journal</div>`;
    }
    this.overlay.innerHTML = `
      <div class="panel small${log && log.first ? ' with-log' : ''}">
        <div class="finish-main">
        <div class="title small">EXTRACTION RÉUSSIE</div>
        <div class="big-time">${HUD.formatTime(s.time)}</div>
        <div class="stats">${s.isRecord ? '★ NOUVEAU RECORD ★' : `RECORD : ${s.best !== null ? HUD.formatTime(s.best) : '--'}`}</div>
        <div class="stats">CIBLES ÉLIMINÉES ${s.kills}/${s.totalEnemies}${s.secrets ? ` · ${s.secrets}` : ''}</div>
        <div class="reward"><span class="reward-total">+${reward.total} ¢</span><span class="reward-lines">${reward.lines.join(' · ')}</span></div>
        <button class="overlay-btn next-btn" data-act="next" type="button">${nextLabel}</button>
        <div class="cta">${this.touch ? '[ TOUCHE POUR REJOUER ]' : '[ R ] OU CLIC : REJOUER'}</div>
        <div class="btn-row">
          <button class="overlay-btn" data-act="menu" type="button">☰ NIVEAUX</button>
        </div>
        </div>
        ${logHtml}
      </div>`;
    if (log && log.first) this.typeLog(log.text);
  }

  /** Texte du log déroulé à la machine à écrire (le jeu reste maître du rythme). */
  private typeLog(text: string): void {
    this.stopTyping();
    this.typeFull = text;
    const target = this.overlay.querySelector('.log-text');
    if (!target) return;
    let shown = 0;
    this.typeTimer = window.setInterval(() => {
      shown = Math.min(text.length, shown + 2);
      target.textContent = text.slice(0, shown);
      if (shown >= text.length) this.stopTyping();
    }, 30);
  }

  private finishTyping(): void {
    const target = this.overlay.querySelector('.log-text');
    if (target && this.typeFull) target.textContent = this.typeFull;
    this.stopTyping();
  }

  private stopTyping(): void {
    if (this.typeTimer !== null) window.clearInterval(this.typeTimer);
    this.typeTimer = null;
  }

  showLoading(text: string): void {
    this.overlayShownAt = performance.now();
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel small"><div class="cta">${text}</div></div>`;
  }

  hideOverlay(): void {
    this.stopTyping();
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = '';
  }
}
