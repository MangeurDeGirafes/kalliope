import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CAMERA, GRAPHICS, LIGHTING, WORLD } from '../config';
import { QUALITY } from './Device';
import type { ThemeDef } from '../world/levels';

/** Shader final : aberration chromatique, vignette, teinte Sandevistan, dégâts, mort, grain. */
const CyberFxShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uSandevistan: { value: 0 },
    uDamage: { value: 0 },
    uDeath: { value: 0 },
    uSpeed: { value: 0 },
    uKill: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSandevistan;
    uniform float uDamage;
    uniform float uDeath;
    uniform float uSpeed;
    uniform float uKill;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered * vec2(uAspect, 1.0));

      // Aberration chromatique radiale
      float ca = 0.0012 + uSandevistan * 0.006 + uDamage * 0.012 + uSpeed * 0.002 + uKill * 0.009;
      vec2 dir = centered * ca * (0.4 + dist * 2.0);

      // Glitch horizontal pendant le Sandevistan
      float band = step(0.985, hash(vec2(floor(vUv.y * 90.0), floor(uTime * 24.0))));
      vec2 glitch = vec2(band * uSandevistan * 0.012, 0.0);

      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir + glitch).r;
      col.g = texture2D(tDiffuse, vUv + glitch * 0.5).g;
      col.b = texture2D(tDiffuse, vUv - dir).b;

      // Teinte Sandevistan : vert/cyan désaturé + lignes de balayage
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 sandTint = mix(vec3(luma), col, 0.6) * vec3(0.62, 0.98, 0.9);
      sandTint = pow(max(sandTint, vec3(0.0)), vec3(1.18)) + vec3(0.0, 0.012, 0.01);
      float scan = 0.93 + 0.07 * sin(vUv.y * 900.0 + uTime * 30.0);
      col = mix(col, sandTint * scan, uSandevistan);

      // Impact d'élimination : bref éclat froid sur les bords
      col += vec3(0.25, 0.7, 1.0) * uKill * 0.12 * smoothstep(0.2, 0.9, dist);
      col *= 1.0 + uKill * 0.08;

      // Vignette
      float vig = smoothstep(0.95, 0.25, dist);
      col *= mix(0.55, 1.0, vig);

      // Bords rouges lors des dégâts
      float edge = smoothstep(0.25, 0.85, dist);
      col = mix(col, vec3(0.9, 0.02, 0.08), edge * uDamage * 0.75);

      // Mort : désaturation rouge
      vec3 dead = vec3(luma * 0.9, luma * 0.12, luma * 0.18);
      col = mix(col, dead, uDeath * 0.85);

      // Grain
      float grain = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.0)) - 0.5;
      col += grain * 0.035;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface ScreenEffects {
  sandevistan: number;
  damage: number;
  death: number;
  speed: number;
  /** Éclat d'élimination (0 → 1, décroît vite). */
  kill?: number;
}

/**
 * Moteur de rendu : scène principale, scène des armes (rendue par-dessus avec
 * un depth buffer vidé pour éviter que les armes ne traversent les murs), éclairage
 * néon, brouillard et chaîne de post-traitement.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly weaponScene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;
  private readonly afterimagePass: AfterimagePass;
  private readonly fxPass: ShaderPass;
  private readonly container: HTMLElement;
  private skyMaterial: THREE.ShaderMaterial | null = null;
  private elapsed = 0;
  /** Éclair d'orage : appelé avec le délai (s) avant le tonnerre. */
  onLightning: ((thunderDelay: number) => void) | null = null;
  private hemiLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private storm = false;
  private nextStrike = 4;
  private readonly strikeTimes: number[] = [];
  private flash = 0;
  private readonly fogBase = new THREE.Color(WORLD.fogColor);
  private readonly flashColor = new THREE.Color(0x8a80b8);
  // Résolution dynamique
  private pixelRatio: number;
  private frameAccum = 0;
  private frameCount = 0;
  private warmup = 2;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio, QUALITY.initialPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHTING.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(WORLD.fogColor);
    this.scene.fog = new THREE.FogExp2(WORLD.fogColor, WORLD.fogDensity);

    this.weaponScene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / window.innerHeight,
      CAMERA.near,
      CAMERA.far,
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.setupEnvironment();
    this.setupLights();
    this.createSky();

    // --- Post-traitement --------------------------------------------------
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    const mainPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(mainPass);

    const weaponPass = new RenderPass(this.weaponScene, this.camera);
    weaponPass.clear = false;
    weaponPass.clearDepth = true;
    this.composer.addPass(weaponPass);

    this.bloomPass = new UnrealBloomPass(
      size,
      LIGHTING.bloomStrength,
      LIGHTING.bloomRadius,
      LIGHTING.bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);

    this.afterimagePass = new AfterimagePass(0);
    this.composer.addPass(this.afterimagePass);

    this.fxPass = new ShaderPass(CyberFxShader);
    this.composer.addPass(this.fxPass);

    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Hauteur du viewport en pixels physiques (utile pour la taille des particules). */
  get viewportHeight(): number {
    return this.renderer.domElement.height;
  }

  setEffects(fx: ScreenEffects): void {
    const u = this.fxPass.uniforms;
    u.uSandevistan.value = fx.sandevistan;
    u.uDamage.value = fx.damage;
    u.uDeath.value = fx.death;
    u.uSpeed.value = fx.speed;
    u.uKill.value = fx.kill ?? 0;
    // Traînées fantômes façon Sandevistan
    this.afterimagePass.damp = fx.sandevistan * 0.7;
    this.bloomPass.strength = LIGHTING.bloomStrength + fx.sandevistan * 0.08;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.fxPass.uniforms.uAspect.value = w / h;
  }

  /** Orage : éclairs espacés (double flash) qui illuminent ciel, brouillard et décor. */
  private updateWeather(dt: number): void {
    if (this.storm) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = 6 + Math.random() * 7;
        this.strikeTimes.push(this.elapsed, this.elapsed + 0.12 + Math.random() * 0.1);
        this.onLightning?.(0.4 + Math.random() * 1.1);
      }
    }
    for (let i = this.strikeTimes.length - 1; i >= 0; i--) {
      if (this.elapsed >= this.strikeTimes[i]) {
        this.flash = Math.max(this.flash, 0.75 + Math.random() * 0.25);
        this.strikeTimes.splice(i, 1);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5.5);
      this.applyFlash();
    }
  }

  private applyFlash(): void {
    const k = this.flash * LIGHTING.effects;
    this.hemiLight.intensity = 1.1 + k * 1.8;
    (this.scene.fog as THREE.FogExp2).color.copy(this.fogBase).lerp(this.flashColor, k * 0.35);
    if (this.skyMaterial) this.skyMaterial.uniforms.uFlash.value = k;
  }

  render(realDt: number): void {
    this.elapsed += realDt;
    this.updateWeather(realDt);
    this.fxPass.uniforms.uTime.value = this.elapsed;
    this.composer.render(realDt);
    this.adaptResolution(realDt);
  }

  /** Rapport de pixels courant (résolution de rendu / résolution CSS). */
  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  /**
   * Résolution dynamique : baisse le rapport de pixels si les frames sont trop
   * lentes, le remonte doucement quand il y a de la marge.
   */
  private adaptResolution(realDt: number): void {
    if (this.warmup > 0) {
      this.warmup -= realDt;
      return;
    }
    this.frameAccum += realDt;
    this.frameCount++;
    if (this.frameAccum < GRAPHICS.resolutionCheckInterval) return;
    const avg = this.frameAccum / this.frameCount;
    this.frameAccum = 0;
    this.frameCount = 0;

    const max = Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio);
    let next = this.pixelRatio;
    if (avg > GRAPHICS.slowFrameTime) next = Math.max(QUALITY.minPixelRatio, this.pixelRatio - 0.15);
    else if (avg < GRAPHICS.targetFrameTime) next = Math.min(max, this.pixelRatio + 0.05);
    if (Math.abs(next - this.pixelRatio) < 0.01) return;
    this.pixelRatio = next;
    this.renderer.setPixelRatio(next);
    this.composer.setPixelRatio(next);
    this.resize();
  }

  /** Carte d'environnement néon générée procéduralement (reflets cyan / magenta). */
  private setupEnvironment(): void {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x05030a);
    const panel = (color: THREE.ColorRepresentation, intensity: number, pos: THREE.Vector3, scale: THREE.Vector3) => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.position.copy(pos);
      mesh.scale.copy(scale);
      envScene.add(mesh);
    };
    // Reflets variés : enseignes de toutes les couleurs, ciel violet, rue orangée
    panel(0x00e5ff, 2.4, new THREE.Vector3(-6, 1, 2), new THREE.Vector3(0.2, 3, 4));
    panel(0xff9a3c, 3, new THREE.Vector3(-6, 0.5, -3), new THREE.Vector3(0.2, 2, 3));
    panel(0xff2bd6, 2.2, new THREE.Vector3(6, 1.5, 2), new THREE.Vector3(0.2, 2, 3));
    panel(0x9dff5c, 1.8, new THREE.Vector3(6, 0.8, -3), new THREE.Vector3(0.2, 1.5, 3));
    panel(0x7a3cff, 1.4, new THREE.Vector3(0, 7, 0), new THREE.Vector3(10, 0.2, 2));
    panel(0xfff1d6, 1.6, new THREE.Vector3(0, 0.5, -7), new THREE.Vector3(6, 1, 0.2));
    panel(0xffd23b, 1.6, new THREE.Vector3(0, 1, 7), new THREE.Vector3(4, 1, 0.2));
    panel(0x3a1a10, 1, new THREE.Vector3(0, -4, 0), new THREE.Vector3(20, 0.2, 20));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envMap = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();

    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.35 * LIGHTING.environment;
    this.weaponScene.environment = envMap;
    this.weaponScene.environmentIntensity = 0.55 * LIGHTING.environment;
  }

  private setupLights(): void {
    // Ciel violet au-dessus, rebond orangé des rues en dessous
    this.hemiLight = new THREE.HemisphereLight(0x4a3a7a, 0x4a2a14, 1.1);
    this.scene.add(this.hemiLight);
    this.scene.add(new THREE.AmbientLight(0x2a1c30, 0.55));

    const moon = new THREE.DirectionalLight(0x9fb4ff, 0.5);
    moon.position.set(-60, 120, 40);
    this.scene.add(moon);

    // Lumière rasante des lampadaires au sodium, d'un côté…
    const sodium = new THREE.DirectionalLight(0xff8a3c, 0.5);
    sodium.position.set(-70, 12, -40);
    this.scene.add(sodium);
    this.keyLight = sodium;

    // …et néons froids / roses de l'autre
    const cyanFill = new THREE.DirectionalLight(0x2bd9c5, 0.3);
    cyanFill.position.set(80, 30, -100);
    this.scene.add(cyanFill);

    const pinkFill = new THREE.DirectionalLight(0xff4fa3, 0.22);
    pinkFill.position.set(60, 15, 80);
    this.scene.add(pinkFill);
  }

  /** Ambiance d'un niveau : brouillard, ciel et couleur de fond. */
  setTheme(theme: ThemeDef): void {
    (this.scene.background as THREE.Color).setHex(theme.fog);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(theme.fog);
    fog.density = theme.fogDensity;
    this.fogBase.setHex(theme.fog);
    this.hemiLight.color.setHex(theme.ambient);
    this.keyLight.color.setHex(theme.key);
    this.storm = theme.storm === true;
    this.nextStrike = 3 + Math.random() * 3;
    this.strikeTimes.length = 0;
    this.flash = 0;
    this.applyFlash();
    if (this.skyMaterial) {
      const u = this.skyMaterial.uniforms;
      (u.uHorizon.value as THREE.Color).setHex(theme.skyHorizon);
      (u.uGlow.value as THREE.Color).setHex(theme.skyGlow);
      (u.uWarm.value as THREE.Color).setHex(theme.skyWarm);
    }
  }

  private createSky(): void {
    const geo = new THREE.SphereGeometry(1400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHorizon: { value: new THREE.Color(0x3a1838) },
        uGlow: { value: new THREE.Color(0xff3a8a) },
        uWarm: { value: new THREE.Color(0xff7a30) },
        uZenith: { value: new THREE.Color(0x03030c) },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uWarm;
        uniform vec3 uZenith;
        uniform float uFlash;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }
        void main() {
          float h = vDir.y;
          vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.6, h));
          // Lueur orangée des lampadaires au ras de l'horizon, halo rose plus haut
          col += uWarm * 0.3 * exp(-abs(h - 0.01) * 14.0);
          col += uGlow * 0.12 * exp(-abs(h - 0.07) * 6.0);
          // Nuages bas éclairés par la ville (orangés près de l'horizon, roses au-dessus)
          float bands = sin(vDir.x * 9.0 + sin(vDir.z * 6.0) * 2.0) * sin(vDir.z * 7.0 + vDir.x * 3.0);
          vec3 cloud = mix(vec3(0.35, 0.14, 0.05), vec3(0.25, 0.06, 0.22), smoothstep(0.02, 0.25, h));
          col += cloud * smoothstep(0.3, 1.0, bands) * smoothstep(0.45, 0.05, h) * 0.35;
          // Quelques étoiles perçant la pollution lumineuse
          float s = step(0.9985, hash(floor(vDir * 300.0)));
          col += vec3(s) * smoothstep(0.25, 0.6, h) * 0.6;
          col += vec3(0.55, 0.5, 0.85) * uFlash * (0.25 + 0.75 * smoothstep(-0.05, 0.45, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMaterial = mat;
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    // Le ciel suit la caméra
    sky.onBeforeRender = () => {
      sky.position.copy(this.camera.position);
      sky.updateMatrixWorld();
    };
  }
}
