/**
 * Gestion des entrées clavier / souris / tactile.
 * Les touches sont lues via `KeyboardEvent.code` (position physique), ce qui couvre
 * automatiquement ZQSD (AZERTY) et WASD (QWERTY). Les deux jeux de lettres sont en plus
 * explicitement liés pour éviter toute surprise.
 * En mode tactile, les commandes virtuelles (joystick, boutons, glisser pour viser)
 * alimentent les mêmes actions via `setVirtualAction`, `setVirtualMouse`,
 * `setMoveAxis` et `addLookDelta`.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'slide'
  | 'dash'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
  | 'music'
  | 'cycleWeapon'
  | 'restart'
  | 'interact'
  | 'grapple';

const BINDINGS: Record<Action, readonly string[]> = {
  forward: ['KeyW', 'KeyZ', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'KeyQ', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  slide: ['KeyC', 'ControlLeft', 'ControlRight'],
  dash: ['ShiftLeft', 'ShiftRight'],
  weapon1: ['Digit1', 'Numpad1'],
  weapon2: ['Digit2', 'Numpad2'],
  weapon3: ['Digit3', 'Numpad3'],
  weapon4: ['Digit4', 'Numpad4'],
  music: ['KeyM'],
  /** Arme suivante (bouton tactile ⇄ ; la molette fait de même au clavier/souris). */
  cycleWeapon: [],
  restart: ['KeyR'],
  interact: ['KeyE'],
  grapple: ['KeyF', 'KeyG'],
};

export const MouseButton = {
  Left: 0,
  Middle: 1,
  Right: 2,
} as const;

const MAX_MOUSE_DELTA = 250;

export class InputManager {
  private readonly element: HTMLElement;
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly mouseDown = new Set<number>();
  private readonly mousePressed = new Set<number>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelSteps = 0;
  private locked = false;
  private everLocked = false;
  /** Repli quand le pointer lock est indisponible : la souris reste libre. */
  private freeMouse = false;
  private touchMode = false;
  private readonly virtualDown = new Set<Action>();
  private readonly virtualPressed = new Set<Action>();
  private readonly axis = { x: 0, y: 0 };

  /** Appelé quand le pointer lock change (true = verrouillé). */
  onPointerLockChange: ((locked: boolean) => void) | null = null;
  /** Appelé quand le navigateur refuse le pointer lock (on passe en souris libre). */
  onPointerLockUnavailable: (() => void) | null = null;
  /** Appelé sur Échap en mode souris libre (sinon Échap libère déjà le pointer lock). */
  onEscape: (() => void) | null = null;

  constructor(element: HTMLElement) {
    this.element = element;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('wheel', this.handleWheel, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', () => this.enableFreeMouse());
    // Protection contre Ctrl+W (glissade + avancer) qui fermerait l'onglet en jeu.
    window.addEventListener('beforeunload', (e) => {
      if (this.locked) {
        e.preventDefault();
      }
    });
  }

  get isPointerLocked(): boolean {
    return this.locked;
  }

  /** Vrai quand les commandes de jeu peuvent être lues (souris capturée, libre ou tactile). */
  get isActive(): boolean {
    return this.locked || this.touchMode || this.freeMouse;
  }

  get usesFreeMouse(): boolean {
    return this.freeMouse;
  }

  get isTouchMode(): boolean {
    return this.touchMode;
  }

  setTouchMode(enabled: boolean): void {
    this.touchMode = enabled;
  }

  // --- Entrées virtuelles (tactile) ------------------------------------------

  setVirtualAction(action: Action, down: boolean): void {
    if (down) {
      if (!this.virtualDown.has(action)) this.virtualPressed.add(action);
      this.virtualDown.add(action);
    } else {
      this.virtualDown.delete(action);
    }
  }

  setVirtualMouse(button: number, down: boolean): void {
    if (down) {
      if (!this.mouseDown.has(button)) this.mousePressed.add(button);
      this.mouseDown.add(button);
    } else {
      this.mouseDown.delete(button);
    }
  }

  /** Axe analogique de déplacement (x = droite, y = avant), chaque composante dans [-1, 1]. */
  setMoveAxis(x: number, y: number): void {
    this.axis.x = x;
    this.axis.y = y;
  }

  /** Ajoute un déplacement de visée exprimé en « pixels souris ». */
  addLookDelta(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Relâche toutes les entrées virtuelles (pause, perte de focus). */
  releaseVirtual(): void {
    this.virtualDown.clear();
    this.mouseDown.clear();
    this.axis.x = 0;
    this.axis.y = 0;
  }

  /** Déplacement combiné clavier + joystick (x = droite, y = avant). */
  getMoveAxis(): { x: number; y: number } {
    const kx = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const ky = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    return {
      x: Math.max(-1, Math.min(1, kx + this.axis.x)),
      y: Math.max(-1, Math.min(1, ky + this.axis.y)),
    };
  }

  requestPointerLock(): void {
    if (this.locked || this.freeMouse || this.touchMode) return;
    try {
      if (typeof this.element.requestPointerLock !== 'function') {
        this.enableFreeMouse();
        return;
      }
      const result = this.element.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => this.enableFreeMouse());
    } catch {
      this.enableFreeMouse();
    }
  }

  /**
   * Page intégrée sans pointer lock : on lit les mouvements de la souris libre.
   * Après un premier verrouillage réussi, un refus est seulement temporaire
   * (délai imposé par le navigateur après Échap) : on reste alors en pause.
   */
  private enableFreeMouse(): void {
    if (this.freeMouse || this.touchMode || this.everLocked) return;
    this.freeMouse = true;
    this.onPointerLockUnavailable?.();
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action: Action): boolean {
    if (this.virtualDown.has(action)) return true;
    for (const code of BINDINGS[action]) {
      if (this.down.has(code)) return true;
    }
    return false;
  }

  wasPressed(action: Action): boolean {
    if (this.virtualPressed.has(action)) return true;
    for (const code of BINDINGS[action]) {
      if (this.pressed.has(code)) return true;
    }
    return false;
  }

  isMouseDown(button: number): boolean {
    return this.mouseDown.has(button);
  }

  wasMousePressed(button: number): boolean {
    return this.mousePressed.has(button);
  }

  /** Renvoie le déplacement souris accumulé depuis la dernière lecture puis le remet à zéro. */
  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

  /** Nombre de crans de molette depuis la dernière lecture (signe = direction). */
  consumeWheel(): number {
    const steps = this.wheelSteps;
    this.wheelSteps = 0;
    return steps;
  }

  /** À appeler à la fin de chaque frame pour réinitialiser les fronts montants. */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressed.clear();
    this.virtualPressed.clear();
  }

  private isGameKey(code: string): boolean {
    for (const action of Object.keys(BINDINGS) as Action[]) {
      if (BINDINGS[action].includes(code)) return true;
    }
    return false;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && this.freeMouse) this.onEscape?.();
    if (this.isGameKey(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private handleBlur = (): void => {
    this.down.clear();
    this.releaseVirtual();
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.locked && !this.freeMouse) return;
    this.mouseDown.add(e.button);
    this.mousePressed.add(e.button);
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (this.touchMode) return;
    this.mouseDown.delete(e.button);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked && !this.freeMouse) return;
    this.mouseDX += Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementX));
    this.mouseDY += Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementY));
  };

  private handleWheel = (e: WheelEvent): void => {
    if ((!this.locked && !this.freeMouse) || e.deltaY === 0) return;
    this.wheelSteps += Math.sign(e.deltaY);
  };

  private handlePointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (this.locked) this.everLocked = true;
    if (!this.locked) {
      this.mouseDown.clear();
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    this.onPointerLockChange?.(this.locked);
  };
}
