import type { Action, InputManager } from '../core/InputManager';
import { MouseButton } from '../core/InputManager';
import type { WeaponId } from '../weapons/WeaponManager';
import { CAMERA, TOUCH } from '../config';

/** Icônes SVG (trait = currentColor). */
const ICONS = {
  blades:
    '<path d="M3 21 L9 13 L13 5 L15 3"/><path d="M13 5 L19 8 Q22 11 19 16 L17 13"/><path d="M15 9 l-1 2 M17 10 l-1 2"/>',
  pistol: '<path d="M3 8 h15 l3 -2 v6 h-9 l-2 6 h-4 l2 -6 h-5 z"/><path d="M9 12 v2"/>',
  jump: '<path d="M6 13 l6 -6 l6 6"/><path d="M6 19 l6 -6 l6 6"/>',
  slide: '<path d="M4 5 l6 9 h10"/><path d="M16 10 l4 4 l-4 4"/><path d="M4 20 h9"/>',
  dash: '<path d="M4 6 l6 6 l-6 6"/><path d="M11 6 l6 6 l-6 6"/><path d="M18 6 v12"/>',
  sandevistan: '<path d="M7 3 h10 M7 21 h10"/><path d="M8 3 c0 7 8 7 8 18"/><path d="M16 3 c0 7 -8 7 -8 18"/>',
  swap: '<path d="M4 8 h15 l-4 -4"/><path d="M20 16 h-15 l4 4"/>',
  pause: '<path d="M8 5 v14"/><path d="M16 5 v14"/>',
  restart: '<path d="M19 12 a7 7 0 1 1 -2.4 -5.3"/><path d="M19 4 v5 h-5"/>',
} as const;

function svg(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

interface ButtonSpec {
  key: string;
  label: string;
  icon: string;
  action?: Action;
  mouse?: number;
  /** Glisser le doigt depuis ce bouton fait aussi tourner la caméra. */
  lookThrough?: boolean;
  tap?: () => void;
}

interface ButtonState {
  spec: ButtonSpec;
  el: HTMLDivElement;
  pointers: Set<number>;
}

type Tracked =
  | { kind: 'joy' }
  | { kind: 'look'; lastX: number; lastY: number }
  | { kind: 'button'; button: ButtonState; lastX: number; lastY: number };

export interface TouchHudState {
  weapon: WeaponId;
  sandevistanActive: boolean;
  sandevistan: number;
  dashCharges: number;
}

/**
 * Commandes tactiles : joystick dynamique (moitié gauche), glisser pour viser
 * (moitié droite), boutons d'action. Tout passe par les entrées virtuelles de
 * l'InputManager, le reste du jeu ne fait pas la différence avec le clavier.
 */
export class TouchControls {
  onPause: (() => void) | null = null;

  private readonly input: InputManager;
  private readonly root: HTMLDivElement;
  private readonly joyZone: HTMLDivElement;
  private readonly lookZone: HTMLDivElement;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly lookHint: HTMLDivElement;
  private readonly buttons = new Map<string, ButtonState>();
  private readonly tracked = new Map<number, Tracked>();
  private joyPointer: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private weapon: WeaponId = 'blades';
  private visible = false;

  constructor(container: HTMLElement, input: InputManager) {
    this.input = input;
    this.root = document.createElement('div');
    this.root.className = 'touch-ui hidden';
    container.appendChild(this.root);

    this.joyZone = this.div('touch-zone joy-zone');
    this.lookZone = this.div('touch-zone look-zone');
    this.joyBase = this.div('joy-base idle');
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    this.lookHint = this.div('look-hint');
    this.lookHint.textContent = 'GLISSE POUR VISER';
    const joyHint = document.createElement('span');
    joyHint.className = 'joy-hint';
    joyHint.textContent = 'COURIR';
    this.joyBase.appendChild(joyHint);

    this.bindZone(this.joyZone, 'joy');
    this.bindZone(this.lookZone, 'look');

    const specs: ButtonSpec[] = [
      { key: 'attack', label: 'ATTAQUE', icon: ICONS.blades, mouse: MouseButton.Left, lookThrough: true },
      { key: 'jump', label: 'SAUT', icon: ICONS.jump, action: 'jump', lookThrough: true },
      { key: 'slide', label: 'GLISSE', icon: ICONS.slide, action: 'slide', lookThrough: true },
      { key: 'dash', label: 'DASH', icon: ICONS.dash, action: 'dash', lookThrough: true },
      { key: 'sandevistan', label: 'SANDEVISTAN', icon: ICONS.sandevistan, mouse: MouseButton.Right },
      { key: 'swap', label: 'ARME', icon: ICONS.swap, tap: () => this.pulseAction(this.weapon === 'blades' ? 'weapon2' : 'weapon1') },
      { key: 'restart', label: '', icon: ICONS.restart, tap: () => this.pulseAction('restart') },
      { key: 'pause', label: '', icon: ICONS.pause, tap: () => this.onPause?.() },
    ];
    for (const spec of specs) this.createButton(spec);
    this.resetJoystick();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.releaseAll();
  }

  update(state: TouchHudState): void {
    if (state.weapon !== this.weapon) {
      this.weapon = state.weapon;
      const attack = this.buttons.get('attack');
      if (attack) attack.el.querySelector('.icon')!.innerHTML = svg(state.weapon === 'blades' ? ICONS.blades : ICONS.pistol);
    }
    const sand = this.buttons.get('sandevistan');
    if (sand) {
      sand.el.classList.toggle('active', state.sandevistanActive);
      sand.el.style.setProperty('--energy', String(Math.round(state.sandevistan * 100)));
    }
    const dash = this.buttons.get('dash');
    if (dash) {
      dash.el.dataset.charges = String(state.dashCharges);
      dash.el.classList.toggle('empty', state.dashCharges <= 0);
    }
  }

  /** Relâche toutes les commandes (pause, fin de partie). */
  releaseAll(): void {
    for (const b of this.buttons.values()) {
      b.pointers.clear();
      b.el.classList.remove('pressed');
    }
    this.tracked.clear();
    this.joyPointer = null;
    this.resetJoystick();
    this.input.releaseVirtual();
  }

  // ---------------------------------------------------------------------------
  // Construction / événements
  // ---------------------------------------------------------------------------

  private div(className: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = className;
    this.root.appendChild(d);
    return d;
  }

  private createButton(spec: ButtonSpec): void {
    const el = this.div(`touch-btn tb-${spec.key}`);
    el.innerHTML = `<span class="icon">${svg(spec.icon)}</span>${spec.label ? `<span class="label">${spec.label}</span>` : ''}`;
    const state: ButtonState = { spec, el, pointers: new Set() };
    this.buttons.set(spec.key, state);

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      state.pointers.add(e.pointerId);
      this.tracked.set(e.pointerId, { kind: 'button', button: state, lastX: e.clientX, lastY: e.clientY });
      el.classList.add('pressed');
      if (state.pointers.size === 1) this.press(spec, true);
    });
    el.addEventListener('pointermove', (e) => this.handleMove(e));
    const end = (e: PointerEvent) => {
      if (!state.pointers.delete(e.pointerId)) return;
      this.tracked.delete(e.pointerId);
      if (state.pointers.size === 0) {
        el.classList.remove('pressed');
        this.press(spec, false);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  private press(spec: ButtonSpec, down: boolean): void {
    if (spec.action) this.input.setVirtualAction(spec.action, down);
    if (spec.mouse !== undefined) this.input.setVirtualMouse(spec.mouse, down);
    if (down) spec.tap?.();
  }

  /** Appui bref sur une action (déclenche `wasPressed` pour une frame). */
  private pulseAction(action: Action): void {
    this.input.setVirtualAction(action, true);
    window.setTimeout(() => this.input.setVirtualAction(action, false), 60);
  }

  private bindZone(zone: HTMLDivElement, kind: 'joy' | 'look'): void {
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (kind === 'joy') {
        if (this.joyPointer !== null) return;
        this.joyPointer = e.pointerId;
        this.tracked.set(e.pointerId, { kind: 'joy' });
        this.startJoystick(e.clientX, e.clientY);
      } else {
        this.tracked.set(e.pointerId, { kind: 'look', lastX: e.clientX, lastY: e.clientY });
        this.lookHint.classList.add('gone');
      }
      zone.setPointerCapture?.(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => this.handleMove(e));
    const end = (e: PointerEvent) => {
      const t = this.tracked.get(e.pointerId);
      if (!t) return;
      this.tracked.delete(e.pointerId);
      if (t.kind === 'joy') {
        this.joyPointer = null;
        this.resetJoystick();
      }
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  private handleMove(e: PointerEvent): void {
    const t = this.tracked.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    if (t.kind === 'joy') {
      this.moveJoystick(e.clientX, e.clientY);
      return;
    }
    if (t.kind === 'button' && !t.button.spec.lookThrough) return;
    const dx = e.clientX - t.lastX;
    const dy = e.clientY - t.lastY;
    t.lastX = e.clientX;
    t.lastY = e.clientY;
    const factor = t.kind === 'button' ? TOUCH.buttonLookFactor : 1;
    // Conversion en « pixels souris » pour réutiliser la sensibilité de la caméra.
    this.input.addLookDelta(
      (dx * TOUCH.lookSensitivityX * factor) / CAMERA.sensitivity,
      (dy * TOUCH.lookSensitivityY * factor) / CAMERA.sensitivity,
    );
  }

  // ---------------------------------------------------------------------------
  // Joystick
  // ---------------------------------------------------------------------------

  private startJoystick(x: number, y: number): void {
    const r = TOUCH.joystickRadius;
    // On garde la base entièrement à l'écran
    this.joyOrigin.x = Math.max(r + 8, x);
    this.joyOrigin.y = Math.min(window.innerHeight - r - 8, Math.max(r + 8, y));
    this.joyBase.classList.remove('idle');
    this.joyBase.style.left = `${this.joyOrigin.x}px`;
    this.joyBase.style.top = `${this.joyOrigin.y}px`;
    this.moveJoystick(x, y);
  }

  private moveJoystick(x: number, y: number): void {
    const r = TOUCH.joystickRadius;
    let dx = x - this.joyOrigin.x;
    let dy = y - this.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > r) {
      dx = (dx / len) * r;
      dy = (dy / len) * r;
    }
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Zone morte + courbe de réponse : pleine vitesse avant la butée
    const m = Math.min(1, len / r);
    if (m < TOUCH.deadzone || len < 1e-3) {
      this.input.setMoveAxis(0, 0);
      return;
    }
    const k = Math.min(1, (m - TOUCH.deadzone) / (TOUCH.fullSpeedAt - TOUCH.deadzone));
    const nx = dx / Math.max(1e-3, Math.hypot(dx, dy));
    const ny = dy / Math.max(1e-3, Math.hypot(dx, dy));
    this.input.setMoveAxis(nx * k, -ny * k);
  }

  private resetJoystick(): void {
    this.joyBase.classList.add('idle');
    this.joyBase.style.left = '';
    this.joyBase.style.top = '';
    this.joyKnob.style.transform = 'translate(-50%, -50%)';
    this.input.setMoveAxis(0, 0);
  }
}
