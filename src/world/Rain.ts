import * as THREE from 'three';
import { WORLD } from '../config';
import { QUALITY } from '../core/Device';

/**
 * Pluie en particules : segments de ligne recyclés dans une boîte qui suit la
 * caméra. Elle utilise le temps du monde : pendant le Sandevistan, les gouttes
 * se figent presque.
 */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly count = QUALITY.rainCount;
  private active = QUALITY.rainCount;
  private readonly drops: Float32Array;
  private readonly speeds: Float32Array;
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.drops = new Float32Array(this.count * 3);
    this.speeds = new Float32Array(this.count);
    this.positions = new Float32Array(this.count * 6);
    const s = WORLD.rainAreaSize;
    const h = WORLD.rainAreaHeight;
    for (let i = 0; i < this.count; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * s;
      this.drops[i * 3 + 1] = (Math.random() - 0.5) * h;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * s;
      this.speeds[i] = WORLD.rainSpeed * (0.8 + Math.random() * 0.4);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.55, 0.7, 1.0),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Densité de pluie (0..1) : seules les premières gouttes sont animées et dessinées. */
  setIntensity(k: number): void {
    this.active = Math.round(this.count * THREE.MathUtils.clamp(k, 0, 1));
    this.geometry.setDrawRange(0, this.active * 2);
    this.mesh.visible = this.active > 0;
  }

  update(dt: number, center: THREE.Vector3): void {
    const s = WORLD.rainAreaSize;
    const h = WORLD.rainAreaHeight;
    const half = s / 2;
    const halfH = h / 2;
    const wind = WORLD.rainWind;
    const len = WORLD.rainLength;
    for (let i = 0; i < this.active; i++) {
      const sp = this.speeds[i];
      let x = this.drops[i * 3] + wind * dt;
      let y = this.drops[i * 3 + 1] - sp * dt;
      let z = this.drops[i * 3 + 2];

      // Positions monde, repliées dans une boîte centrée sur la caméra (parallaxe correcte).
      if (y < center.y - halfH) {
        y += h;
        x = center.x + (Math.random() - 0.5) * s;
        z = center.z + (Math.random() - 0.5) * s;
      } else if (y > center.y + halfH) {
        y -= h;
      }
      if (x > center.x + half) x -= s;
      else if (x < center.x - half) x += s;
      if (z > center.z + half) z -= s;
      else if (z < center.z - half) z += s;

      this.drops[i * 3] = x;
      this.drops[i * 3 + 1] = y;
      this.drops[i * 3 + 2] = z;

      const k = len / sp;
      const o = i * 6;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.positions[o + 3] = x - wind * k;
      this.positions[o + 4] = y + len;
      this.positions[o + 5] = z;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
