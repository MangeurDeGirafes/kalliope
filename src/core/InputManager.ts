/**
 * Gestion des entrées clavier / souris.
 * Les touches sont lues via `KeyboardEvent.code` (position physique), ce qui couvre
 * automatiquement ZQSD (AZERTY) et WASD (QWERTY). Les deux jeux de lettres sont en plus
 * explicitement liés pour éviter toute surprise.
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
  | 'restart';

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
  restart: ['KeyR'],
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

  /** Appelé quand le pointer lock change (true = verrouillé). */
  onPointerLockChange: ((locked: boolean) => void) | null = null;

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

  requestPointerLock(): void {
    if (this.locked) return;
    try {
      const result = this.element.requestPointerLock() as unknown;
      if (result instanceof Promise) {
        result.catch(() => {
          /* l'utilisateur a refusé ou le navigateur a bloqué : on réessaiera au prochain clic */
        });
      }
    } catch {
      /* navigateur sans pointer lock */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action: Action): boolean {
    for (const code of BINDINGS[action]) {
      if (this.down.has(code)) return true;
    }
    return false;
  }

  wasPressed(action: Action): boolean {
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
  }

  private isGameKey(code: string): boolean {
    for (const action of Object.keys(BINDINGS) as Action[]) {
      if (BINDINGS[action].includes(code)) return true;
    }
    return false;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
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
    this.mouseDown.clear();
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDown.add(e.button);
    this.mousePressed.add(e.button);
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.mouseDown.delete(e.button);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDX += Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementX));
    this.mouseDY += Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementY));
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.locked || e.deltaY === 0) return;
    this.wheelSteps += Math.sign(e.deltaY);
  };

  private handlePointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) {
      this.mouseDown.clear();
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    this.onPointerLockChange?.(this.locked);
  };
}
