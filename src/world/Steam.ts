import * as THREE from 'three';

interface Vent {
  position: THREE.Vector3;
  rate: number;
  acc: number;
}

/**
 * Vapeur qui s'échappe des bouches d'aération et des climatiseurs des toits.
 * Particules douces en mélange normal (pas additif) : elles voilent légèrement
 * les néons au lieu de briller. Elles suivent le temps du monde (Sandevistan).
 */
export class Steam {
  private readonly vents: Vent[] = [];
  private readonly max = 260;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const n = this.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.sizes = new Float32Array(n);
    this.alphas = new Float32Array(n);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color(0.62, 0.58, 0.66) } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    scene.add(points);
  }

  addVent(position: THREE.Vector3, rate = 5): void {
    this.vents.push({ position: position.clone(), rate, acc: Math.random() });
  }

  setViewport(viewportHeightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = (viewportHeightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5);
  }

  update(dt: number, camera: THREE.Vector3): void {
    for (const v of this.vents) {
      // Inutile de faire fumer les bouches trop lointaines
      if (v.position.distanceToSquared(camera) > 140 * 140) continue;
      v.acc += dt * v.rate;
      while (v.acc >= 1) {
        v.acc -= 1;
        this.spawn(v.position);
      }
    }
    const p = this.positions;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      p[i * 3] += this.velocities[i * 3] * dt;
      p[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      p[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.velocities[i * 3] += 0.35 * dt; // léger vent
      this.sizes[i] = 0.35 + t * 1.6;
      this.alphas[i] = Math.sin(Math.min(1, t) * Math.PI) * 0.22;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  private spawn(at: THREE.Vector3): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.positions[i * 3] = at.x + (Math.random() - 0.5) * 0.2;
    this.positions[i * 3 + 1] = at.y;
    this.positions[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.2;
    this.velocities[i * 3] = (Math.random() - 0.5) * 0.3;
    this.velocities[i * 3 + 1] = 0.7 + Math.random() * 0.6;
    this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    const life = 2.2 + Math.random() * 1.6;
    this.life[i] = life;
    this.maxLife[i] = life;
  }
}
