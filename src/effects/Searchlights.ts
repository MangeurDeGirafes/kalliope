import * as THREE from 'three';

interface Beam {
  pivot: THREE.Object3D;
  tilt: number;
  speed: number;
  phase: number;
}

/**
 * Projecteurs d'Aegis : de longs cônes de lumière montent de la rue et
 * balaient le ciel au-dessus du parcours. Halo additif dont les bords
 * s'estompent selon l'angle de vue, et qui s'efface vers la pointe.
 */
export class Searchlights {
  private readonly beams: Beam[] = [];
  private readonly material: THREE.ShaderMaterial;
  private time = 0;

  constructor(scene: THREE.Scene, count = 9) {
    const length = 170;
    const geo = new THREE.CylinderGeometry(9, 0.6, length, 24, 1, true);
    // Pointe du cône à l'origine, ouverture vers +y
    geo.translate(0, length / 2, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.75, 0.85, 1) }, uIntensity: { value: 0.45 } },
      vertexShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vAlong = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying float vAlong;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float facing = abs(dot(normalize(vNormal), normalize(vView)));
          float edge = pow(facing, 2.2);
          float fade = pow(1.0 - vAlong, 1.1) * smoothstep(0.05, 0.35, vAlong);
          gl_FragColor = vec4(uColor * uIntensity * edge * fade, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // Deux rangées de projecteurs de part et d'autre du parcours (z de +30 à -330)
    for (let k = 0; k < count; k++) {
      // Répartis sur toute la longueur du parcours, quel que soit leur nombre
      const i = Math.round((k * 8) / Math.max(1, count - 1));
      const side = k % 2 === 0 ? -1 : 1;
      const pivot = new THREE.Object3D();
      pivot.position.set(side * (48 + (i % 3) * 9), -45, 30 - i * 44);
      const cone = new THREE.Mesh(geo, this.material);
      cone.frustumCulled = false;
      cone.renderOrder = 2;
      pivot.add(cone);
      scene.add(pivot);
      this.beams.push({ pivot, tilt: 0.38 + (i % 4) * 0.06, speed: 0.18 + (i % 3) * 0.07, phase: i * 1.7 });
    }
  }

  /** Teinte selon le niveau (mélange de blanc froid et de la lueur du ciel). */
  setTint(color: THREE.ColorRepresentation, intensity = 0.45): void {
    this.material.uniforms.uColor.value.set(0.78, 0.86, 1).lerp(new THREE.Color(color), 0.35);
    this.material.uniforms.uIntensity.value = intensity;
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.beams) {
      const s = this.time * b.speed + b.phase;
      // Balayage : le faisceau penche vers le parcours (croise au-dessus des toits) et oscille
      b.pivot.rotation.set(Math.sin(s * 0.8) * 0.35, 0, Math.sign(b.pivot.position.x) * (b.tilt + Math.sin(s) * 0.22));
    }
  }
}
