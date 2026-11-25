import * as THREE from 'three';

interface TrailSample {
  tip: THREE.Vector3;
  base: THREE.Vector3;
  age: number;
}

/**
 * Traînée lumineuse d'une lame : ruban de triangles reliant les positions
 * successives de la pointe et d'un point du tranchant, qui s'estompe avec l'âge.
 * Les positions sont exprimées dans l'espace local du parent (espace caméra).
 */
export class BladeTrail {
  readonly mesh: THREE.Mesh;
  private readonly maxSamples: number;
  private readonly samples: TrailSample[] = [];
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(color: THREE.ColorRepresentation, maxSamples = 40) {
    this.maxSamples = maxSamples;
    this.positions = new Float32Array(maxSamples * 2 * 3);
    this.alphas = new Float32Array(maxSamples * 2);

    const indices: number[] = [];
    for (let i = 0; i < maxSamples - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(indices);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(3.5) } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor * (0.6 + vAlpha), vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setColor(color: THREE.ColorRepresentation): void {
    (this.material.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(3.5);
  }

  addSample(tip: THREE.Vector3, base: THREE.Vector3): void {
    if (this.samples.length >= this.maxSamples) this.samples.shift();
    this.samples.push({ tip: tip.clone(), base: base.clone(), age: 0 });
  }

  clear(): void {
    this.samples.length = 0;
    this.geometry.setDrawRange(0, 0);
  }

  update(dt: number, life: number): void {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length > 0 && this.samples[0].age > life) this.samples.shift();

    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const k = 1 - s.age / life;
      const o = i * 6;
      this.positions[o] = s.tip.x;
      this.positions[o + 1] = s.tip.y;
      this.positions[o + 2] = s.tip.z;
      this.positions[o + 3] = s.base.x;
      this.positions[o + 4] = s.base.y;
      this.positions[o + 5] = s.base.z;
      this.alphas[i * 2] = k * k;
      this.alphas[i * 2 + 1] = k * k * 0.1;
    }
    this.geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
