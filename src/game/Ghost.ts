import * as THREE from 'three';

/**
 * Fantôme du record : la meilleure course de chaque niveau est enregistrée
 * (15 positions par seconde, quantifiées au 5 cm) et rejouée par une
 * silhouette translucide qui court à côté du joueur.
 */

const RATE = 15;
const SCALE = 20;
const MAX_SECONDS = 300;
const STRIDE = 4;

export class GhostRecorder {
  private readonly data: number[] = [];
  private next = 0;

  reset(): void {
    this.data.length = 0;
    this.next = 0;
  }

  /** Enregistre la position des pieds à l'instant `t` (temps réel de la course). */
  sample(t: number, feet: THREE.Vector3, yaw: number): void {
    if (t > MAX_SECONDS) return;
    while (t >= this.next) {
      this.data.push(
        clamp16(Math.round(feet.x * SCALE)),
        clamp16(Math.round(feet.y * SCALE)),
        clamp16(Math.round(feet.z * SCALE)),
        clamp16(Math.round(wrapAngle(yaw) * 1000)),
      );
      this.next += 1 / RATE;
    }
  }

  get sampleCount(): number {
    return this.data.length / STRIDE;
  }

  encode(): string {
    const bytes = new Uint8Array(new Int16Array(this.data).buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
}

export function decodeGhost(encoded: string | null): Int16Array | null {
  if (!encoded) return null;
  try {
    const bin = atob(encoded);
    if (bin.length < STRIDE * 2 * 2 || bin.length % (STRIDE * 2) !== 0) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  } catch {
    return null;
  }
}

function clamp16(v: number): number {
  return Math.max(-32768, Math.min(32767, v));
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Silhouette translucide qui rejoue un enregistrement. */
export class GhostRunner {
  private readonly group = new THREE.Group();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly legs: THREE.Object3D[] = [];
  private readonly arms: THREE.Object3D[] = [];
  private data: Int16Array | null = null;
  private stride = 0;
  private cursor = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly last = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.45, 0.95, 1).multiplyScalar(1.3),
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.material);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    box(0.46, 0.62, 0.26, 0, 1.3, 0, this.group);
    box(0.26, 0.28, 0.26, 0, 1.78, 0, this.group);
    box(0.3, 0.05, 0.02, 0, 1.8, -0.14, this.group);
    for (const side of [-1, 1]) {
      const hip = new THREE.Object3D();
      hip.position.set(side * 0.13, 0.95, 0);
      box(0.16, 0.92, 0.18, 0, -0.46, 0, hip);
      this.group.add(hip);
      this.legs.push(hip);
      const shoulder = new THREE.Object3D();
      shoulder.position.set(side * 0.32, 1.55, 0);
      box(0.12, 0.6, 0.13, 0, -0.3, 0, shoulder);
      this.group.add(shoulder);
      this.arms.push(shoulder);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  get loaded(): boolean {
    return this.data !== null;
  }

  /** Durée de l'enregistrement chargé (s). */
  get duration(): number {
    return this.data ? (this.data.length / STRIDE - 1) / RATE : 0;
  }

  load(data: Int16Array | null): void {
    this.data = data;
    this.stride = 0;
    this.cursor = 0;
    this.group.visible = false;
  }

  /**
   * Instant où le fantôme a atteint la profondeur `z` (les parcours avancent
   * vers -z) ; null s'il ne l'a jamais atteinte. Recherche incrémentale.
   */
  timeAtZ(z: number): number | null {
    const d = this.data;
    if (!d) return null;
    const n = d.length / STRIDE;
    const target = z * SCALE;
    if (this.cursor > 0 && d[this.cursor * STRIDE + 2] < target) this.cursor = 0;
    for (let i = this.cursor; i < n; i++) {
      if (d[i * STRIDE + 2] <= target) {
        this.cursor = i;
        if (i === 0) return 0;
        const z0 = d[(i - 1) * STRIDE + 2];
        const z1 = d[i * STRIDE + 2];
        const k = z0 === z1 ? 0 : (z0 - target) / (z0 - z1);
        return (i - 1 + k) / RATE;
      }
    }
    return null;
  }

  /** Place le fantôme à l'instant `t` ; `camera` sert à l'estomper de près. */
  update(t: number, camera: THREE.Vector3): void {
    const d = this.data;
    if (!d || t > this.duration + 0.4) {
      this.group.visible = false;
      return;
    }
    const n = d.length / STRIDE;
    const f = Math.min(n - 1, Math.max(0, t * RATE));
    const i = Math.min(n - 2, Math.floor(f));
    const k = f - i;
    const o = i * STRIDE;
    this.a.set(d[o], d[o + 1], d[o + 2]).divideScalar(SCALE);
    this.b.set(d[o + STRIDE], d[o + STRIDE + 1], d[o + STRIDE + 2]).divideScalar(SCALE);
    this.a.lerp(this.b, k);
    let ya = d[o + 3] / 1000;
    const yb = d[o + STRIDE + 3] / 1000;
    ya += Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya)) * k;
    // Foulée : les membres balancent selon la distance parcourue au sol
    const step = Math.hypot(this.a.x - this.last.x, this.a.z - this.last.z);
    if (step < 2) this.stride += step * 2.2;
    this.last.copy(this.a);
    const swing = Math.sin(this.stride) * Math.min(1, step * 8);
    this.legs[0].rotation.x = swing * 0.8;
    this.legs[1].rotation.x = -swing * 0.8;
    this.arms[0].rotation.x = -swing * 0.7;
    this.arms[1].rotation.x = swing * 0.7;
    this.group.position.copy(this.a);
    this.group.rotation.y = ya;
    // Estompé quand il est collé à la caméra (départ commun)
    const dist = camera.distanceTo(this.b.copy(this.a).setY(this.a.y + 1.2));
    const fade = THREE.MathUtils.clamp((dist - 1.5) / 3, 0, 1);
    this.material.opacity = 0.3 * fade;
    this.group.visible = fade > 0.01;
  }
}
