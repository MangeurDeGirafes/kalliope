import * as THREE from 'three';
import { QUALITY } from '../core/Device';

export interface BurstOptions {
  count: number;
  color: THREE.ColorRepresentation;
  /** Couleur secondaire : chaque particule prend une teinte aléatoire entre les deux. */
  color2?: THREE.ColorRepresentation;
  /** Multiplicateur HDR (> 1 = déclenche le bloom). */
  intensity?: number;
  speedMin: number;
  speedMax: number;
  lifeMin: number;
  lifeMax: number;
  sizeMin: number;
  sizeMax: number;
  gravity?: number;
  drag?: number;
  /** Direction privilégiée (sinon émission sphérique). */
  direction?: THREE.Vector3;
  /** 0 = suit strictement la direction, 1 = sphérique. */
  spread?: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

interface FlashLight {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
  peak: number;
}

/**
 * Système de particules additives (étincelles, explosions, impacts) rendu en un seul
 * draw call, plus des flashs (sprites) et des lumières ponctuelles recyclées.
 */
export class ParticleSystem {
  private readonly max = QUALITY.maxParticles;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly baseSizes: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly flashes: Flash[] = [];
  private readonly lights: FlashLight[] = [];
  private readonly flashTexture: THREE.Texture;
  private readonly tmpColor = new THREE.Color();
  private readonly tmpColor2 = new THREE.Color();
  private readonly tmpDir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const n = this.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 4);
    this.baseColors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.baseSizes = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('pcolor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec4 pcolor;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          vColor = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          if (vColor.a <= 0.001) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.flashTexture = createRadialTexture();
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.flashTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0, maxLife: 1, startScale: 1, endScale: 1 });
    }
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 2);
      scene.add(light);
      this.lights.push({ light, life: 0, maxLife: 1, peak: 0 });
    }
  }

  /** Doit être appelé à chaque frame pour convertir la taille monde en pixels. */
  setViewport(viewportHeightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = (viewportHeightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5);
  }

  burst(position: THREE.Vector3, o: BurstOptions): void {
    const c1 = this.tmpColor.set(o.color);
    const c2 = this.tmpColor2.set(o.color2 ?? o.color);
    const intensity = o.intensity ?? 3;
    const spread = o.spread ?? 1;
    for (let k = 0; k < o.count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;

      // Direction aléatoire (sphérique ou en cône autour de `direction`)
      const dir = this.tmpDir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
      dir.normalize();
      if (o.direction) {
        dir.multiplyScalar(spread).add(o.direction).normalize();
      }
      const speed = THREE.MathUtils.lerp(o.speedMin, o.speedMax, Math.random());

      this.positions[i * 3] = position.x;
      this.positions[i * 3 + 1] = position.y;
      this.positions[i * 3 + 2] = position.z;
      this.velocities[i * 3] = dir.x * speed;
      this.velocities[i * 3 + 1] = dir.y * speed;
      this.velocities[i * 3 + 2] = dir.z * speed;

      const t = Math.random();
      this.baseColors[i * 3] = THREE.MathUtils.lerp(c1.r, c2.r, t) * intensity;
      this.baseColors[i * 3 + 1] = THREE.MathUtils.lerp(c1.g, c2.g, t) * intensity;
      this.baseColors[i * 3 + 2] = THREE.MathUtils.lerp(c1.b, c2.b, t) * intensity;

      const life = THREE.MathUtils.lerp(o.lifeMin, o.lifeMax, Math.random());
      this.life[i] = life;
      this.maxLife[i] = life;
      this.baseSizes[i] = THREE.MathUtils.lerp(o.sizeMin, o.sizeMax, Math.random());
      this.gravity[i] = o.gravity ?? 9.8;
      this.drag[i] = o.drag ?? 1.5;
    }
  }

  /** Flash lumineux (sprite qui grossit et s'estompe). */
  flash(position: THREE.Vector3, color: THREE.ColorRepresentation, startScale: number, endScale: number, life: number, intensity = 3): void {
    let slot = this.flashes.find((f) => f.life <= 0);
    if (!slot) slot = this.flashes[0];
    slot.life = life;
    slot.maxLife = life;
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.sprite.position.copy(position);
    slot.sprite.visible = true;
    const mat = slot.sprite.material;
    mat.color.set(color).multiplyScalar(intensity);
    mat.opacity = 1;
    slot.sprite.scale.setScalar(startScale);
  }

  /** Lumière ponctuelle temporaire (explosions, impacts). */
  light(position: THREE.Vector3, color: THREE.ColorRepresentation, peak: number, life: number): void {
    let slot = this.lights[0];
    for (const l of this.lights) {
      if (l.life <= 0) {
        slot = l;
        break;
      }
      if (l.life < slot.life) slot = l;
    }
    slot.light.position.copy(position);
    slot.light.color.set(color);
    slot.life = life;
    slot.maxLife = life;
    slot.peak = peak;
    slot.light.intensity = peak;
  }

  /** Explosion standard d'un ennemi détruit. */
  explosion(position: THREE.Vector3, accent: THREE.ColorRepresentation): void {
    this.burst(position, {
      count: 90,
      color: 0xff3020,
      color2: 0xffc040,
      intensity: 4,
      speedMin: 4,
      speedMax: 16,
      lifeMin: 0.4,
      lifeMax: 1.1,
      sizeMin: 0.06,
      sizeMax: 0.16,
      gravity: 14,
      drag: 2.2,
    });
    this.burst(position, {
      count: 45,
      color: accent,
      color2: 0xffffff,
      intensity: 5,
      speedMin: 8,
      speedMax: 22,
      lifeMin: 0.25,
      lifeMax: 0.55,
      sizeMin: 0.04,
      sizeMax: 0.09,
      gravity: 6,
      drag: 3,
    });
    this.burst(position, {
      count: 25,
      color: 0x401030,
      color2: 0x202040,
      intensity: 1.2,
      speedMin: 1,
      speedMax: 4,
      lifeMin: 0.8,
      lifeMax: 1.6,
      sizeMin: 0.35,
      sizeMax: 0.7,
      gravity: -1.5,
      drag: 1.5,
    });
    this.flash(position, 0xff6030, 0.5, 5.5, 0.28, 4);
    this.flash(position, accent, 0.2, 3.5, 0.18, 5);
    this.light(position, 0xff5030, 30, 0.35);
  }

  /** Petites étincelles d'impact. */
  sparks(position: THREE.Vector3, normal: THREE.Vector3 | null, color: THREE.ColorRepresentation, count = 18): void {
    this.burst(position, {
      count,
      color,
      color2: 0xffffff,
      intensity: 4,
      speedMin: 3,
      speedMax: 10,
      lifeMin: 0.15,
      lifeMax: 0.4,
      sizeMin: 0.03,
      sizeMax: 0.07,
      gravity: 12,
      drag: 2,
      direction: normal ?? undefined,
      spread: normal ? 0.9 : 1,
    });
    this.flash(position, color, 0.15, 0.9, 0.1, 4);
  }

  clear(): void {
    this.life.fill(0);
    this.colors.fill(0);
    this.sizes.fill(0);
    for (const f of this.flashes) {
      f.life = 0;
      f.sprite.visible = false;
    }
    for (const l of this.lights) {
      l.life = 0;
      l.light.intensity = 0;
    }
    this.markDirty();
  }

  update(dt: number): void {
    const p = this.positions;
    const v = this.velocities;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.colors[i * 4 + 3] !== 0) {
          this.colors[i * 4 + 3] = 0;
          this.sizes[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const dragF = Math.exp(-this.drag[i] * dt);
      v[i * 3] *= dragF;
      v[i * 3 + 1] = v[i * 3 + 1] * dragF - this.gravity[i] * dt;
      v[i * 3 + 2] *= dragF;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      this.colors[i * 4] = this.baseColors[i * 3];
      this.colors[i * 4 + 1] = this.baseColors[i * 3 + 1];
      this.colors[i * 4 + 2] = this.baseColors[i * 3 + 2];
      this.colors[i * 4 + 3] = t;
      this.sizes[i] = this.baseSizes[i] * (0.4 + 0.6 * t);
    }
    this.markDirty();

    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        continue;
      }
      const k = 1 - f.life / f.maxLife;
      f.sprite.scale.setScalar(THREE.MathUtils.lerp(f.startScale, f.endScale, 1 - Math.pow(1 - k, 3)));
      f.sprite.material.opacity = 1 - k;
    }

    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      const k = Math.max(0, l.life / l.maxLife);
      l.light.intensity = l.peak * k * k;
    }
  }

  private markDirty(): void {
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('pcolor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Texture radiale douce utilisée pour les flashs et halos. */
export function createRadialTexture(size = 128): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
