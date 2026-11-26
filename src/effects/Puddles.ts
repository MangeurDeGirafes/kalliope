import * as THREE from 'three';
import { LIGHTING } from '../config';

export interface PuddleDef {
  x: number;
  y: number;
  z: number;
  /** Rayon moyen (m). */
  r: number;
  color: THREE.Color;
  seed: number;
}

/**
 * Flaques de pluie sur les toits : reflets de néon étirés et ondes des gouttes,
 * le tout dans un seul maillage fusionné (un appel de rendu par niveau).
 */
export function createPuddleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uGain: { value: 1 } }]),
    vertexShader: /* glsl */ `
      attribute vec3 tint;
      attribute float seed;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vTint = tint;
        vSeed = seed;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGain;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vSeed;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        // Contour irrégulier
        float edge = 0.8 + 0.1 * sin(a * 3.0 + vSeed * 6.0) + 0.07 * sin(a * 5.0 + vSeed * 11.0);
        float mask = smoothstep(edge, edge - 0.22, r);
        if (mask <= 0.001) discard;
        // Reflet de néon étiré, troublé par le vent
        float streak = 0.5 + 0.5 * sin(p.x * 7.0 + vSeed * 20.0 + sin(p.y * 4.0 + uTime * 0.8) * 0.7);
        float sheen = 0.25 + 0.75 * streak * streak;
        // Ondes de gouttes
        float rip = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          vec2 c = vec2(sin(vSeed * 13.0 + fi * 2.1), cos(vSeed * 7.0 + fi * 3.3)) * 0.45;
          float t = fract(uTime * 0.55 + fi * 0.33 + vSeed);
          float d = length(p - c);
          rip += smoothstep(0.05, 0.0, abs(d - t * 0.55)) * (1.0 - t);
        }
        vec3 col = vTint * (0.3 * sheen + 0.75 * rip) * mask * uGain;
        #ifdef USE_FOG
          float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          col *= 1.0 - fogFactor;
        #endif
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Maillage fusionné des flaques (quads horizontaux légèrement au-dessus du toit). */
export function createPuddleMesh(defs: readonly PuddleDef[], material: THREE.ShaderMaterial): THREE.Mesh | null {
  if (defs.length === 0) return null;
  const n = defs.length;
  const positions = new Float32Array(n * 4 * 3);
  const uvs = new Float32Array(n * 4 * 2);
  const tints = new Float32Array(n * 4 * 3);
  const seeds = new Float32Array(n * 4);
  const index: number[] = [];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  defs.forEach((d, i) => {
    const sx = d.r * (0.8 + (d.seed % 0.4));
    const sz = d.r * (1.2 - (d.seed % 0.4));
    const rot = d.seed * 6.28;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    corners.forEach(([u, v], k) => {
      const lx = u * sx;
      const lz = v * sz;
      const o = (i * 4 + k) * 3;
      positions[o] = d.x + lx * c - lz * s;
      positions[o + 1] = d.y;
      positions[o + 2] = d.z + lx * s + lz * c;
      uvs[(i * 4 + k) * 2] = (u + 1) / 2;
      uvs[(i * 4 + k) * 2 + 1] = (v + 1) / 2;
      tints[o] = d.color.r * LIGHTING.neon;
      tints[o + 1] = d.color.g * LIGHTING.neon;
      tints[o + 2] = d.color.b * LIGHTING.neon;
      seeds[i * 4 + k] = d.seed;
    });
    const b = i * 4;
    index.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 1;
  return mesh;
}
