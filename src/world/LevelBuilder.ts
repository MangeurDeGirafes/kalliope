import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics } from '../core/Physics';
import type { EnemySpawn } from '../enemies/EnemyManager';
import { Rain } from './Rain';
import { Steam } from './Steam';
import { createHoloTexture, createPanelTexture, createRng, createStreetTexture, scaleBoxUVs } from './Textures';
import {
  FACADE_CELLS,
  SIGN_SCHEMES,
  createFacade,
  createPixelBillboard,
  createPixelRoof,
  createPixelSign,
} from './PixelTextures';
import type { BillboardKind, FacadeStyle, RoofStyle } from './PixelTextures';
import { LIGHTING, WORLD } from '../config';
import { QUALITY } from '../core/Device';
import { NEON } from './levels';
import type { LevelDef, ThemeDef } from './levels';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface JumpPad {
  position: THREE.Vector3;
  radius: number;
  power: number;
  boost: THREE.Vector3;
  cooldown: number;
  pulse: number;
}

export interface LevelData {
  spawn: THREE.Vector3;
  spawnYaw: number;
  enemySpawns: EnemySpawn[];
  jumpPads: JumpPad[];
  finish: { position: THREE.Vector3; radius: number };
  killPlaneY: number;
}

const BASE_Y = -70;
/** Une texture de façade couvre 20 m × 24 m (modules de 2,5 m × 3 m). */
const FACADE_TILE_U = 20;
const FACADE_TILE_V = 24;
/** Une texture de toit couvre ~7,7 m (un pixel ≈ 6 cm). */
const ROOF_TILE = 7.7;

/** Variantes de façade (style + graine) partagées par le parcours et la ville. */
const FACADES: readonly [FacadeStyle, number][] = [
  ['brick', 11],
  ['tile', 23],
  ['concrete', 37],
  ['metal', 41],
  ['pastel', 53],
  ['pastel', 67],
  ['brick', 79],
  ['glass', 83],
];

const CLOTHES = [0xf2f2f2, 0xd83a3a, 0x3a6ad8, 0xf2c83a, 0x4ab84a, 0xf28a3a, 0xf27ab8, 0x8a5ad8, 0x2ac8c8];
const LEAVES = [0x3f8f3f, 0x5faf4f, 0x2f6f4f, 0x7fbf3f, 0x4f9f6f];
const FLOWERS = [0xff5a7a, 0xffd23b, 0xff8a2b, 0xf2f2f2, 0xb86af2];
const BULBS = [0xffc86a, 0xffb040, 0xffe0a0, 0xff6a5a, 0x9dff5c, 0x7fd8ff, 0xff7ad9];

interface Flicker {
  material: THREE.Material & { opacity: number };
  base: number;
  phase: number;
}

type Rng = () => number;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

/**
 * Construit le parcours sur les toits (immeubles, murs de wall-run balisés,
 * tremplins, obstacles à glisser dessous), une ville habitée en pixel art
 * (façades vivantes, toits encombrés, enseignes, affiches), la circulation
 * aérienne, la vapeur et la pluie.
 */
export class LevelBuilder {
  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly rng = createRng(1337);
  private readonly batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly facadeMaterials: THREE.MeshStandardMaterial[];
  private readonly roofMaterials = new Map<RoofStyle, THREE.MeshStandardMaterial>();
  private readonly panelMaterial: THREE.MeshStandardMaterial;
  private readonly darkMaterial: THREE.MeshStandardMaterial;
  /** Accessoires colorés (couleurs par sommet) : un seul draw call pour tous. */
  readonly propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.2 });
  /** Éléments lumineux colorés (ampoules, écrans, voyants) : un seul draw call. */
  readonly glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private readonly neonMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly billboardTextures = new Map<string, THREE.CanvasTexture>();
  private readonly facadeTime = { value: 0 };
  private readonly jumpPads: JumpPad[] = [];
  private readonly padVisuals: { ring: THREE.Mesh; column: THREE.ShaderMaterial; pad: JumpPad }[] = [];
  private readonly flickers: Flicker[] = [];
  private readonly beaconMaterials: THREE.ShaderMaterial[] = [];
  private readonly spinners: { object: THREE.Object3D; speed: number }[] = [];
  private blinkMaterial: THREE.MeshBasicMaterial | null = null;
  private traffic: {
    meshes: THREE.InstancedMesh[];
    cars: { x: number; y: number; z: number; speed: number; dir: number }[];
  } | null = null;
  private rain: Rain | null = null;
  private readonly steam: Steam;
  /** Contenu du niveau courant (retiré au changement de niveau). */
  readonly course = new THREE.Group();
  private readonly courseColliders: RAPIER.Collider[] = [];
  readonly courseDisposables: { dispose(): void }[] = [];
  /** Zones à garder libres (ennemis, tremplins, obstacles) lors du placement des accessoires. */
  private readonly exclusions: { x: number; z: number; r: number }[] = [];
  private readonly roofs: { cx: number; cz: number; w: number; d: number; top: number; seed: number }[] = [];
  private time = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene = scene;
    this.physics = physics;
    this.steam = new Steam(scene);
    scene.add(this.course);

    this.facadeMaterials = FACADES.map(([style, seed]) => this.createFacadeMaterial(style, seed));
    const roofSeeds: Record<RoofStyle, number> = { tar: 7, concrete: 19, green: 29, rust: 31 };
    for (const style of Object.keys(roofSeeds) as RoofStyle[]) {
      const map = createPixelRoof(style, roofSeeds[style]);
      // Le toit est légèrement auto-éclairé (lumière diffuse de la ville) pour rester lisible.
      this.roofMaterials.set(
        style,
        new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.18, roughness: 0.42, metalness: 0.18 }),
      );
    }
    const panelTex = createPanelTexture(3);
    panelTex.magFilter = THREE.NearestFilter;
    this.panelMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9aae, map: panelTex, roughness: 0.45, metalness: 0.7 });
    this.darkMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.8, metalness: 0.2 });
    // Accessoires : leur couleur propre reste visible la nuit (léger auto-éclairage).
    this.propMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * 0.22;',
      );
    };
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /** Décor commun à tous les niveaux : ville, circulation, rues, pluie. */
  buildEnvironment(): void {
    this.buildCity();
    this.buildTraffic();
    this.addStreetGlow();
    this.flushBatches(this.scene);
    this.rain = new Rain(this.scene);
  }

  /**
   * Remplace le parcours courant par celui de `def`. `decorate` ajoute des
   * éléments sur mesure (Plaza) avec les mêmes outils, nettoyés au changement.
   */
  loadLevel(def: LevelDef, decorate?: (builder: LevelBuilder) => void): LevelData {
    this.clearCourse();
    const enemySpawns: EnemySpawn[] = [];
    for (const [x, y, z, yaw] of def.guards) {
      enemySpawns.push({ type: 'guard', position: new THREE.Vector3(x, y, z), yaw });
      this.exclusions.push({ x, z, r: 3 });
    }
    for (const [x, y, z] of def.drones) enemySpawns.push({ type: 'drone', position: new THREE.Vector3(x, y, z), yaw: 0 });
    this.exclusions.push({ x: def.spawn[0], z: def.spawn[2], r: 3 });

    for (const b of def.buildings) {
      this.addBuilding(b.x, b.z, b.w, b.d, b.top, NEON[b.trim], b.facade, b.roof);
      if (b.props !== undefined) this.queueRoofProps(b.x, b.z, b.w, b.d, b.top, b.props);
    }
    for (const w of def.walls) this.addWallRunWall(w.x, w.z0, w.z1, w.top, w.face, NEON.lime, w.ad);
    for (const bar of def.barriers) this.addSlideBarrier(bar.x, bar.z, bar.roofWidth, bar.roofY);
    for (const p of def.pads) this.addJumpPad(new THREE.Vector3(...p.pos), p.power, new THREE.Vector3(...p.boost));
    for (const h of def.holos) this.addHoloSign(h.lines, new THREE.Vector3(...h.pos), NEON[h.color], h.width);
    const finish = new THREE.Vector3(...def.finish);
    this.addFinishBeacon(finish);

    if (def.lights) {
      for (const l of def.lights) this.addNeonLight(new THREE.Vector3(...l.pos), NEON[l.color], l.intensity, l.distance);
    } else {
      for (const b of def.buildings) {
        if (b.d >= 20) this.addNeonLight(new THREE.Vector3(b.x, b.top + 6, b.z), NEON[b.trim], 22, 30);
      }
    }

    decorate?.(this);
    // Accessoires de toit placés en dernier pour éviter les zones réservées
    for (const r of this.roofs) this.addRoofProps(r.cx, r.cz, r.w, r.d, r.top, r.seed);
    this.addSigns(def);
    this.flushBatches(this.course);
    this.rain?.setIntensity(def.theme.rain);

    return {
      spawn: new THREE.Vector3(...def.spawn),
      spawnYaw: def.spawnYaw,
      enemySpawns,
      jumpPads: this.jumpPads,
      finish: { position: finish, radius: 3.2 },
      killPlaneY: WORLD.killPlaneY,
    };
  }

  /** Thème visuel du niveau (utilisé par le moteur pour le ciel et le brouillard). */
  static themeOf(def: LevelDef): ThemeDef {
    return def.theme;
  }

  private clearCourse(): void {
    this.course.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) obj.geometry.dispose();
    });
    this.course.clear();
    for (const c of this.courseColliders) this.physics.removeCollider(c);
    this.courseColliders.length = 0;
    for (const d of this.courseDisposables) d.dispose();
    this.courseDisposables.length = 0;
    this.steam.clearVents();
    this.jumpPads.length = 0;
    this.padVisuals.length = 0;
    this.flickers.length = 0;
    this.beaconMaterials.length = 0;
    this.spinners.length = 0;
    this.exclusions.length = 0;
    this.roofs.length = 0;
  }

  /** Zone gardée libre d'accessoires de toit (secrets, points d'appel). */
  reserve(x: number, z: number, radius: number): void {
    this.exclusions.push({ x, z, r: radius });
  }

  /** Bouche de vapeur (supprimée au changement de parcours). */
  addSteamVent(position: THREE.Vector3, rate = 5): void {
    this.steam.addVent(position, rate);
  }

  /** Collision statique appartenant au parcours courant. */
  addCollider(center: THREE.Vector3, halfExtents: THREE.Vector3, rotationY = 0, rotationX = 0): void {
    this.courseColliders.push(this.physics.addBox(center, halfExtents, rotationY, rotationX));
  }

  reset(): void {
    for (const p of this.jumpPads) {
      p.cooldown = 0;
      p.pulse = 0;
    }
  }

  /** Taille de rendu des particules de vapeur (à appeler à chaque frame). */
  setViewport(viewportHeightPx: number, fovDeg: number): void {
    this.steam.setViewport(viewportHeightPx, fovDeg);
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;
    this.facadeTime.value = t;

    for (const v of this.padVisuals) {
      v.pad.cooldown = Math.max(0, v.pad.cooldown - dt);
      v.pad.pulse = Math.max(0, v.pad.pulse - dt * 2.5);
      v.column.uniforms.uTime.value = t;
      v.column.uniforms.uBoost.value = v.pad.pulse;
      v.ring.rotation.z = t * 1.5;
      v.ring.scale.setScalar(1 + v.pad.pulse * 0.4);
    }
    for (const m of this.beaconMaterials) m.uniforms.uTime.value = t;
    for (const s of this.spinners) s.object.rotation.y += s.speed * dt;

    // Néons qui grésillent
    for (const f of this.flickers) {
      const n = Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 2);
      f.material.opacity = n > 0.92 ? f.base * 0.25 : f.base;
    }
    if (this.blinkMaterial) {
      const on = Math.sin(t * 3) > 0.6;
      const b = LIGHTING.neon;
      this.blinkMaterial.color.setRGB((on ? 6 : 0.4) * b, (on ? 0.2 : 0.02) * b, (on ? 0.2 : 0.02) * b);
    }

    this.updateTraffic(dt);
    this.steam.update(dt, cameraPosition);
    this.rain?.update(dt, cameraPosition);
  }

  // ---------------------------------------------------------------------------
  // Matériaux
  // ---------------------------------------------------------------------------

  /**
   * Façade pixel art. Le shader est enrichi pour animer la vie des fenêtres :
   * quelques télés scintillent et des lumières s'allument / s'éteignent.
   */
  private createFacadeMaterial(style: FacadeStyle, seed: number): THREE.MeshStandardMaterial {
    const { map, emissive } = createFacade(style, seed);
    const glass = style === 'glass';
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: 0xffffff,
      emissiveIntensity: 1.15 * LIGHTING.windows,
      roughness: glass ? 0.25 : 0.82,
      metalness: glass ? 0.55 : 0.08,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFacadeTime = this.facadeTime;
      shader.fragmentShader =
        'uniform float uFacadeTime;\n' +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            vec2 cell = floor(vEmissiveMapUv * ${FACADE_CELLS}.0);
            float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
            if (h > 0.985) {
              float tv = 0.6 + 0.4 * sin(uFacadeTime * (7.0 + h * 13.0)) * sin(uFacadeTime * 2.3 + h * 50.0);
              totalEmissiveRadiance *= tv * vec3(0.75, 0.9, 1.35);
            } else if (h > 0.965) {
              totalEmissiveRadiance *= 0.1 + 0.9 * step(0.0, sin(uFacadeTime * 0.15 + h * 200.0));
            }
          }`,
        );
    };
    return mat;
  }

  private neon(color: number, intensity = 3): THREE.MeshBasicMaterial {
    const key = color * 10 + intensity;
    let m = this.neonMaterials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity * LIGHTING.neon), toneMapped: false });
      this.neonMaterials.set(key, m);
    }
    return m;
  }

  billboard(kind: BillboardKind, width = 64): THREE.CanvasTexture {
    const key = `${kind}-${width}`;
    let tex = this.billboardTextures.get(key);
    if (!tex) {
      tex = createPixelBillboard(kind, width, 7 + this.billboardTextures.size);
      this.billboardTextures.set(key, tex);
    }
    return tex;
  }

  signMaterial(map: THREE.Texture, brightness: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(1, 1, 1).multiplyScalar(brightness * LIGHTING.signs) });
  }

  // ---------------------------------------------------------------------------
  // Fusion de géométrie
  // ---------------------------------------------------------------------------

  private batch(material: THREE.Material, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color?: THREE.Color): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    // Uniformise les attributs pour la fusion
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    const count = g.getAttribute('position').count;
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    if (color) {
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    let list = this.batches.get(material);
    if (!list) {
      list = [];
      this.batches.set(material, list);
    }
    list.push(g);
  }

  matrix(x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0): THREE.Matrix4 {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
  }

  private batchBox(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, rotX = 0): void {
    this.batch(material, new THREE.BoxGeometry(w, h, d), this.matrix(x, y, z, rotY, rotX));
  }

  /** Boîte colorée (matériau d'accessoires partagé). */
  prop(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, rotY = 0, rotX = 0): void {
    this.batch(this.propMaterial, new THREE.BoxGeometry(w, h, d), this.matrix(x, y, z, rotY, rotX), this.tmpColor.set(hex));
  }

  /** Géométrie quelconque colorée. */
  propGeo(geo: THREE.BufferGeometry, m: THREE.Matrix4, hex: number): void {
    this.batch(this.propMaterial, geo, m, this.tmpColor.set(hex));
  }

  /** Boîte lumineuse colorée (ampoules, écrans, voyants). */
  glow(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, intensity = 2.5): void {
    const c = this.tmpColor.set(hex).multiplyScalar(intensity * LIGHTING.neon);
    this.batch(this.glowMaterial, new THREE.BoxGeometry(w, h, d), this.matrix(x, y, z), c);
  }

  private flushBatches(target: THREE.Object3D): void {
    for (const [material, geos] of this.batches) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      target.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.batches.clear();
  }

  // ---------------------------------------------------------------------------
  // Immeubles du parcours
  // ---------------------------------------------------------------------------

  private addBuilding(cx: number, cz: number, w: number, d: number, top: number, trimColor: number, facade: number, roof: RoofStyle): void {
    const h = top - BASE_Y;
    const geo = new THREE.BoxGeometry(w, h, d);
    const cells = FACADE_CELLS;
    scaleBoxUVs(geo, w, h, d, FACADE_TILE_U, FACADE_TILE_V, Math.floor(this.rng() * cells) / cells, Math.floor(this.rng() * cells) / cells);
    // Toit : UV à l'échelle du monde (pixels carrés)
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const ru = w / ROOF_TILE;
    const rv = d / ROOF_TILE;
    uv.setXY(8, 0, rv);
    uv.setXY(9, ru, rv);
    uv.setXY(10, 0, 0);
    uv.setXY(11, ru, 0);
    const fac = this.facadeMaterials[facade % this.facadeMaterials.length];
    const roofMat = this.roofMaterials.get(roof)!;
    const mesh = new THREE.Mesh(geo, [fac, fac, roofMat, this.darkMaterial, fac, fac]);
    mesh.position.set(cx, BASE_Y + h / 2, cz);
    this.course.add(mesh);
    this.addCollider(new THREE.Vector3(cx, BASE_Y + h / 2, cz), new THREE.Vector3(w / 2, h / 2, d / 2));

    // Liseré néon sur le pourtour du toit
    const trim = this.neon(trimColor, 3);
    const t = 0.09;
    const y = top + 0.02;
    this.batchBox(trim, w, t, t, cx, y, cz + d / 2 - t / 2);
    this.batchBox(trim, w, t, t, cx, y, cz - d / 2 + t / 2);
    this.batchBox(trim, t, t, d, cx + w / 2 - t / 2, y, cz);
    this.batchBox(trim, t, t, d, cx - w / 2 + t / 2, y, cz);
    // Arêtes verticales lumineuses
    const edgeLen = 26;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.batchBox(trim, 0.12, edgeLen, 0.12, cx + sx * (w / 2 + 0.03), top - edgeLen / 2 - 0.3, cz + sz * (d / 2 + 0.03));
      }
    }
    // Bandeau lumineux sous le toit
    this.batchBox(this.neon(trimColor, 1.4), w + 0.1, 0.25, d + 0.1, cx, top - 1.4, cz);
  }

  private queueRoofProps(cx: number, cz: number, w: number, d: number, top: number, seed: number): void {
    this.roofs.push({ cx, cz, w, d, top, seed });
  }

  private isFree(x: number, z: number, radius: number): boolean {
    for (const e of this.exclusions) {
      if (Math.hypot(e.x - x, e.z - z) < e.r + radius) return false;
    }
    return true;
  }

  /** Toit habité : chaque emplacement le long des bords reçoit un accessoire. */
  private addRoofProps(cx: number, cz: number, w: number, d: number, top: number, seed: number): void {
    const rng = createRng(seed);
    for (const side of [-1, 1] as const) {
      let z = cz + d / 2 - 2.5 - rng() * 1.5;
      while (z > cz - d / 2 + 2.5) {
        const x = cx + side * (w / 2 - 1.5);
        const facing: 1 | -1 = side > 0 ? -1 : 1; // face tournée vers le centre du toit
        const roll = rng();
        let used = 2.5;
        if (this.isFree(x, z, 1.7)) {
          if (roll < 0.17) used = this.propAC(x, top, z, rng);
          else if (roll < 0.29) used = this.propVending(x, top, z, facing, rng);
          else if (roll < 0.42) used = this.propGarden(x, top, z, rng);
          else if (roll < 0.52) used = this.propLaundry(x + side * 0.4, top, z, rng);
          else if (roll < 0.6) used = this.propTank(x, top, z, rng);
          else if (roll < 0.68) used = this.propSolar(x, top, z, rng);
          else if (roll < 0.76) used = this.propCrates(x, top, z, rng);
          else if (roll < 0.83) used = this.propShack(x, top, z, facing, rng);
          else if (roll < 0.9) used = this.propLounge(x, top, z, rng);
          else if (roll < 0.95) used = this.propDish(x, top, z, rng);
          else used = this.propAntenna(x, top, z, 4 + rng() * 5);
        }
        z -= used + 1 + rng() * 1.5;
      }
    }
    // Guirlande lumineuse le long d'un bord
    const gs = rng() < 0.5 ? -1 : 1;
    const gx = cx + gs * (w / 2 - 0.4);
    const z0 = cz + d / 2 - 2;
    const z1 = cz - d / 2 + 2;
    if (this.isFree(gx, (z0 + z1) / 2, 0)) {
      this.prop(0.08, 2.6, 0.08, gx, top + 1.3, z0, 0x2a2a30);
      this.prop(0.08, 2.6, 0.08, gx, top + 1.3, z1, 0x2a2a30);
      this.stringLights(gx, z0, gx, z1, top + 2.55, rng);
    }
    // Petit conduit bas au milieu (couverture franchissable) + bouche de vapeur
    if (d > 30) {
      const z = cz + (rng() - 0.5) * 6;
      const x = cx + (rng() < 0.5 ? -1 : 1) * 2.8;
      if (this.isFree(x, z, 1.5)) {
        this.prop(2.6, 0.9, 1.2, x, top + 0.45, z, 0x8a8e96);
        this.prop(0.4, 0.5, 0.4, x + 0.8, top + 1.15, z, 0x5a5e66);
        this.steam.addVent(new THREE.Vector3(x + 0.8, top + 1.45, z), 4);
        this.addCollider(new THREE.Vector3(x, top + 0.45, z), new THREE.Vector3(1.3, 0.45, 0.6));
      }
    }
  }

  // --- Accessoires (renvoient la longueur occupée le long du toit) -----------------

  private propAC(x: number, top: number, z: number, rng: Rng): number {
    const body = pick(rng, [0xd8d2c0, 0xb8bcc4, 0x9aa0a8, 0xc8c0a8]);
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const zi = z - i * 1.7;
      this.prop(1.6, 1.1, 1.4, x, top + 0.55, zi, body);
      this.propGeo(new THREE.CylinderGeometry(0.48, 0.48, 0.05, 14), this.matrix(x, top + 1.13, zi), 0x2a2a2e);
      this.prop(1.0, 0.06, 0.06, x, top + 1.16, zi, 0x5a5a60);
      this.glow(0.06, 0.06, 0.06, x + 0.62, top + 0.9, zi + 0.71, pick(rng, [0x2bff6a, 0xff3b3b, 0x3b8bff]), 3);
    }
    if (rng() < 0.6) this.steam.addVent(new THREE.Vector3(x, top + 1.25, z), 3);
    this.addCollider(new THREE.Vector3(x, top + 0.55, z - (n - 1) * 0.85), new THREE.Vector3(0.8, 0.55, (n * 1.7 - 0.3) / 2));
    return n * 1.7;
  }

  private propVending(x: number, top: number, z: number, facing: 1 | -1, rng: Rng): number {
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const zi = z - i * 1.1;
      const body = pick(rng, [0xc8202a, 0x1f5fbf, 0xe8e8e8, 0x2a8a3a, 0xe0a020, 0x8a2ad8]);
      const fx = x + facing * 0.41;
      this.prop(0.8, 1.9, 1.0, x, top + 0.95, zi, body);
      this.glow(0.02, 0.95, 0.8, fx, top + 1.28, zi, 0xfff1d6, 1.4);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          this.glow(0.03, 0.14, 0.13, fx + facing * 0.01, top + 0.98 + r * 0.28, zi - 0.3 + c * 0.2, pick(rng, [0xff3b3b, 0xffd23b, 0x2bff6a, 0x3b8bff, 0xff8a2b, 0xf2f2f2]), 2.2);
        }
      }
      this.prop(0.03, 0.18, 0.6, fx, top + 0.42, zi, 0x15151a);
      this.glow(0.02, 0.16, 0.9, fx, top + 1.83, zi, body, 2.4);
    }
    this.addCollider(new THREE.Vector3(x, top + 0.95, z - (n - 1) * 0.55), new THREE.Vector3(0.4, 0.95, (n * 1.1) / 2));
    return n * 1.1;
  }

  private propGarden(x: number, top: number, z: number, rng: Rng): number {
    const n = 2 + Math.floor(rng() * 2);
    const box = pick(rng, [0xa0522d, 0x7a5230, 0x8a857a, 0x5a6a7a]);
    for (let i = 0; i < n; i++) {
      const zi = z - i * 1.05;
      this.prop(0.9, 0.45, 0.9, x, top + 0.225, zi, box);
      for (let k = 0; k < 6; k++) {
        const s = 0.18 + rng() * 0.2;
        this.prop(s, s, s, x + (rng() - 0.5) * 0.6, top + 0.5 + rng() * 0.35, zi + (rng() - 0.5) * 0.6, pick(rng, LEAVES), rng() * 3);
      }
      for (let k = 0; k < 3; k++) {
        this.prop(0.1, 0.1, 0.1, x + (rng() - 0.5) * 0.6, top + 0.85 + rng() * 0.2, zi + (rng() - 0.5) * 0.6, pick(rng, FLOWERS));
      }
    }
    // Petit arbre en pot
    if (rng() < 0.6) {
      const zt = z - n * 1.05;
      this.prop(0.7, 0.6, 0.7, x, top + 0.3, zt, box);
      this.prop(0.12, 1.3, 0.12, x, top + 1.25, zt, 0x5a3a1f);
      for (let k = 0; k < 4; k++) {
        const s = 0.6 + rng() * 0.4;
        this.prop(s, s * 0.8, s, x + (rng() - 0.5) * 0.5, top + 1.8 + rng() * 0.5, zt + (rng() - 0.5) * 0.5, pick(rng, LEAVES), rng() * 3);
      }
      this.addCollider(new THREE.Vector3(x, top + 0.3, zt), new THREE.Vector3(0.35, 0.3, 0.35));
    }
    this.addCollider(new THREE.Vector3(x, top + 0.225, z - (n - 1) * 0.525), new THREE.Vector3(0.45, 0.225, (n * 1.05) / 2));
    return n * 1.05 + 1;
  }

  private propLaundry(x: number, top: number, z: number, rng: Rng): number {
    const len = 3 + rng() * 2;
    const z0 = z;
    const z1 = z - len;
    this.prop(0.06, 1.95, 0.06, x, top + 0.975, z0, 0x3a3a40);
    this.prop(0.06, 1.95, 0.06, x, top + 0.975, z1, 0x3a3a40);
    this.prop(0.02, 0.02, len, x, top + 1.9, (z0 + z1) / 2, 0x1a1a1a);
    for (let zz = z0 - 0.3; zz > z1 + 0.2; zz -= 0.35 + rng() * 0.25) {
      const h = 0.35 + rng() * 0.4;
      const wdt = 0.22 + rng() * 0.2;
      this.prop(0.02, h, wdt, x, top + 1.9 - h / 2, zz, pick(rng, CLOTHES));
    }
    return len;
  }

  private propTank(x: number, top: number, z: number, rng: Rng): number {
    const wood = rng() < 0.6;
    const color = wood ? 0x6b4a2f : pick(rng, [0x2f5f9a, 0xd8d8d0, 0x3a7a4a]);
    this.propGeo(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 16), this.matrix(x, top + 2.0, z), color);
    if (wood) {
      for (const y of [1.3, 2.0, 2.7]) this.propGeo(new THREE.CylinderGeometry(1.13, 1.13, 0.08, 16), this.matrix(x, top + y, z), 0x2a2a2a);
      this.propGeo(new THREE.ConeGeometry(1.2, 0.6, 16), this.matrix(x, top + 3.4, z), 0x4a3220);
    } else {
      this.propGeo(new THREE.CylinderGeometry(1.0, 1.1, 0.25, 16), this.matrix(x, top + 3.2, z), color);
    }
    for (const [ox, oz] of [
      [-0.7, -0.7],
      [0.7, -0.7],
      [-0.7, 0.7],
      [0.7, 0.7],
    ]) {
      this.prop(0.12, 0.9, 0.12, x + ox, top + 0.45, z + oz, 0x2a2a30);
    }
    this.addCollider(new THREE.Vector3(x, top + 1.7, z), new THREE.Vector3(1.0, 1.7, 1.0));
    return 2.4;
  }

  private propSolar(x: number, top: number, z: number, rng: Rng): number {
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const zi = z - i * 1.2;
      this.prop(1.7, 0.06, 1.05, x, top + 0.62, zi, 0x9aa0a8, 0, 0.35);
      this.prop(1.62, 0.07, 0.98, x, top + 0.63, zi, 0x1b2a4a, 0, 0.35);
      for (let k = -1; k <= 1; k++) this.prop(1.64, 0.075, 0.015, x, top + 0.63 + k * 0.1, zi + k * 0.3, 0x3a5a8a, 0, 0.35);
      this.prop(0.06, 0.6, 0.06, x - 0.7, top + 0.3, zi, 0x5a5a60);
      this.prop(0.06, 0.6, 0.06, x + 0.7, top + 0.3, zi, 0x5a5a60);
    }
    this.addCollider(new THREE.Vector3(x, top + 0.45, z - (n - 1) * 0.6), new THREE.Vector3(0.85, 0.45, (n * 1.2) / 2));
    return n * 1.2;
  }

  private propCrates(x: number, top: number, z: number, rng: Rng): number {
    const n = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const stack = rng() < 0.35 ? 1 : 0;
      const zi = z - (i % 3) * 0.7;
      const xi = x + (Math.floor(i / 3) - 0.5) * 0.7;
      if (rng() < 0.3) {
        this.propGeo(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), this.matrix(xi, top + 0.45, zi), pick(rng, [0x2f5f9a, 0xb02a2a, 0x2a7a3a, 0xd8a020]));
      } else {
        const col = pick(rng, [0x8b5a2b, 0x2f6fbf, 0xe0b020, 0x7a5230, 0xc84a2a]);
        this.prop(0.62, 0.62, 0.62, xi, top + 0.31, zi, col, rng() * 0.3);
        if (stack) this.prop(0.55, 0.55, 0.55, xi, top + 0.9, zi, pick(rng, [0x8b5a2b, 0x2f6fbf, 0xe0b020]), rng() * 0.5);
      }
    }
    this.addCollider(new THREE.Vector3(x, top + 0.4, z - 0.7), new THREE.Vector3(0.7, 0.4, 1.05));
    return 2.2;
  }

  private propShack(x: number, top: number, z: number, facing: 1 | -1, rng: Rng): number {
    const wall = pick(rng, [0x8d8679, 0x6f8f7a, 0x9a6a4a, 0x7a7f9a, 0xa08a5a]);
    const zc = z - 1.5;
    this.prop(2.4, 2.6, 3, x, top + 1.3, zc, wall);
    this.prop(2.6, 0.15, 3.2, x, top + 2.67, zc, 0x3a3a40);
    const fx = x + facing * 1.21;
    // Porte entrouverte : lumière chaude qui s'échappe
    this.prop(0.03, 1.95, 0.95, fx, top + 0.98, zc + 0.5, 0x3a2a1a);
    this.glow(0.02, 1.85, 0.12, fx + facing * 0.01, top + 0.95, zc + 0.02, 0xffc27a, 2.4);
    this.glow(0.12, 0.08, 0.25, fx + facing * 0.06, top + 2.15, zc + 0.5, 0xffe0a0, 3);
    // Fenêtre éclairée
    this.glow(0.02, 0.45, 0.6, fx, top + 1.6, zc - 0.8, pick(rng, [0xffd08a, 0xbfe8ff, 0xffa8c8]), 1.6);
    // Tuyau de ventilation fumant
    this.propGeo(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), this.matrix(x - facing * 0.6, top + 3.1, zc - 0.8), 0x5a5e66);
    this.steam.addVent(new THREE.Vector3(x - facing * 0.6, top + 3.55, zc - 0.8), 3.5);
    this.addCollider(new THREE.Vector3(x, top + 1.3, zc), new THREE.Vector3(1.2, 1.3, 1.5));
    return 3;
  }

  private propLounge(x: number, top: number, z: number, rng: Rng): number {
    const zc = z - 1;
    this.prop(0.7, 0.05, 0.7, x, top + 0.72, zc, 0xe8e8e8);
    this.prop(0.06, 0.7, 0.06, x, top + 0.35, zc, 0x8a8a90);
    for (const dz of [-0.75, 0.75]) {
      const col = pick(rng, [0xd83a3a, 0xe8e8e8, 0x3a6ad8, 0xf2c83a, 0x4ab84a]);
      this.prop(0.45, 0.06, 0.45, x, top + 0.45, zc + dz, col);
      this.prop(0.45, 0.45, 0.06, x, top + 0.68, zc + dz + Math.sign(dz) * 0.22, col);
      for (const lx of [-0.18, 0.18]) this.prop(0.04, 0.45, 0.04, x + lx, top + 0.22, zc + dz, col);
    }
    // Canette et bol sur la table
    this.prop(0.06, 0.12, 0.06, x + 0.15, top + 0.8, zc, pick(rng, [0xc8202a, 0x2a8a3a, 0x1f5fbf]));
    this.prop(0.16, 0.06, 0.16, x - 0.12, top + 0.77, zc - 0.1, 0xf2ead8);
    // Guirlande au-dessus du salon
    this.prop(0.06, 2.4, 0.06, x, top + 1.2, z, 0x2a2a30);
    this.prop(0.06, 2.4, 0.06, x, top + 1.2, z - 2, 0x2a2a30);
    this.stringLights(x, z, x, z - 2, top + 2.35, rng);
    return 2.2;
  }

  private propDish(x: number, top: number, z: number, rng: Rng): number {
    this.prop(0.08, 1.2, 0.08, x, top + 0.6, z, 0x6a6a70);
    const dish = new THREE.CylinderGeometry(0.7, 0.12, 0.25, 14);
    this.propGeo(dish, this.matrix(x, top + 1.35, z, rng() * Math.PI * 2, 0, 1.1), 0xd8d8d8);
    this.glow(0.05, 0.05, 0.05, x, top + 1.5, z, NEON.red, 3);
    return 1.4;
  }

  private propAntenna(x: number, top: number, z: number, height: number): number {
    this.batchBox(this.darkMaterial, 0.12, height, 0.12, x, top + height / 2, z);
    this.batchBox(this.darkMaterial, 0.8, 0.05, 0.05, x, top + height * 0.7, z);
    this.batchBox(this.darkMaterial, 0.6, 0.05, 0.05, x, top + height * 0.85, z);
    if (!this.blinkMaterial) {
      this.blinkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.2).multiplyScalar(LIGHTING.neon), toneMapped: false });
    }
    this.batchBox(this.blinkMaterial, 0.18, 0.18, 0.18, x, top + height + 0.1, z);
    this.addCollider(new THREE.Vector3(x, top + height / 2, z), new THREE.Vector3(0.1, height / 2, 0.1));
    return 1;
  }

  /** Guirlande d'ampoules colorées légèrement affaissée entre deux points. */
  stringLights(x0: number, z0: number, x1: number, z1: number, y: number, rng: Rng): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.floor(len / 0.35));
    const warm = rng() < 0.6;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const sag = Math.sin(t * Math.PI) * Math.min(0.5, len * 0.05);
      const bx = x0 + (x1 - x0) * t;
      const bz = z0 + (z1 - z0) * t;
      this.prop(0.015, 0.015, len / n, bx, y - sag + 0.06, bz, 0x1a1a1a);
      const col = warm ? pick(rng, BULBS.slice(0, 3)) : pick(rng, BULBS);
      this.glow(0.07, 0.09, 0.07, bx, y - sag, bz, col, 3);
    }
  }

  // ---------------------------------------------------------------------------
  // Murs, obstacles, tremplins, balise
  // ---------------------------------------------------------------------------

  /**
   * Mur vertical pour le wall-run : `faceDir` est la direction (en X) de la face
   * sur laquelle on court. Une affiche pixel art et des bandes néon le balisent.
   */
  private addWallRunWall(x: number, zStart: number, zEnd: number, top: number, faceDir: 1 | -1, color: number, ad: BillboardKind): void {
    const thickness = 0.6;
    const length = Math.abs(zEnd - zStart);
    const cz = (zStart + zEnd) / 2;
    const h = top - BASE_Y;
    const geo = new THREE.BoxGeometry(thickness, h, length);
    scaleBoxUVs(geo, thickness, h, length, 4, 4);
    const mesh = new THREE.Mesh(geo, this.panelMaterial);
    mesh.position.set(x, BASE_Y + h / 2, cz);
    this.course.add(mesh);
    this.addCollider(mesh.position.clone(), new THREE.Vector3(thickness / 2, h / 2, length / 2));

    const faceX = x + faceDir * (thickness / 2 + 0.015);
    const adHeight = 7;
    const adCenterY = top - 4.2;
    const width = Math.round(((length - 0.4) / adHeight) * 32);
    const adMaterial = this.signMaterial(this.billboard(ad, width), 1.05);
    this.courseDisposables.push(adMaterial);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(length - 0.4, adHeight), adMaterial);
    plane.position.set(faceX, adCenterY, cz);
    plane.rotation.y = faceDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.course.add(plane);

    // Bandes néon (haut / bas de la zone de course) + flèches
    const neon = this.neon(color, 4);
    const stripX = x + faceDir * (thickness / 2 + 0.04);
    this.batchBox(neon, 0.06, 0.12, length, stripX, adCenterY + adHeight / 2 + 0.1, cz);
    this.batchBox(neon, 0.06, 0.12, length, stripX, adCenterY - adHeight / 2 - 0.1, cz);
    this.batchBox(neon, 0.08, 0.12, length + 0.1, x, top + 0.05, cz);
    // Chevrons « > » indiquant le sens de course
    const dirZ = Math.sign(zEnd - zStart);
    const chevronY = adCenterY - adHeight / 2 - 0.75;
    for (let i = 0; i < Math.floor(length / 3); i++) {
      const z = zStart + dirZ * (1.5 + i * 3);
      this.batchBox(neon, 0.05, 0.08, 0.7, stripX, chevronY + 0.2, z, 0, 0.6 * dirZ);
      this.batchBox(neon, 0.05, 0.08, 0.7, stripX, chevronY - 0.2, z, 0, -0.6 * dirZ);
    }
    // Arêtes verticales
    this.batchBox(neon, 0.1, h * 0.4, 0.1, stripX, top - h * 0.2, zStart);
    this.batchBox(neon, 0.1, h * 0.4, 0.1, stripX, top - h * 0.2, zEnd);
  }

  /** Panneau suspendu sous lequel il faut glisser (bord inférieur à 1,25 m du toit). */
  private addSlideBarrier(cx: number, z: number, roofWidth: number, roofY: number): void {
    const width = roofWidth + 4;
    const bottom = roofY + 1.25;
    const top = roofY + 7.5;
    const h = top - bottom;
    const thickness = 0.5;
    const cy = bottom + h / 2;
    this.exclusions.push({ x: cx - 4, z, r: 4 }, { x: cx + 4, z, r: 4 }, { x: cx, z, r: 4 });

    const geo = new THREE.BoxGeometry(width, h, thickness);
    const adMat = this.signMaterial(this.billboard('glide', Math.round((width / h) * 32)), 1.05);
    this.courseDisposables.push(adMat);
    const mesh = new THREE.Mesh(geo, [this.panelMaterial, this.panelMaterial, this.panelMaterial, this.panelMaterial, adMat, adMat]);
    mesh.position.set(cx, cy, z);
    this.course.add(mesh);
    this.addCollider(new THREE.Vector3(cx, cy, z), new THREE.Vector3(width / 2, h / 2, thickness / 2));

    // Bord inférieur lumineux + bandes d'avertissement
    const warn = this.neon(NEON.orange, 5);
    this.batchBox(warn, width, 0.1, thickness + 0.06, cx, bottom - 0.05, z);
    this.batchBox(this.neon(NEON.red, 3), width, 0.08, thickness + 0.06, cx, top + 0.04, z);
    // Pylônes extérieurs (hors du toit)
    for (const s of [-1, 1]) {
      const px = cx + s * (width / 2 + 0.25);
      this.batchBox(this.darkMaterial, 0.5, top - BASE_Y, 0.5, px, (top + BASE_Y) / 2, z);
      this.batchBox(warn, 0.08, 9, 0.08, px - s * 0.27, top - 4.5, z + 0.27);
    }
  }

  private addJumpPad(position: THREE.Vector3, power: number, boost: THREE.Vector3): void {
    const pad: JumpPad = { position: position.clone(), radius: 1.45, power, boost, cooldown: 0, pulse: 0 };
    this.jumpPads.push(pad);
    this.exclusions.push({ x: position.x, z: position.z, r: 3 });
    this.exclusions.push({ x: position.x, z: position.z + 6, r: 2.5 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.65, 0.08, 32), this.panelMaterial);
    base.position.set(position.x, position.y + 0.04, position.z);
    this.course.add(base);

    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON.green).multiplyScalar(4 * LIGHTING.neon), toneMapped: false });
    this.courseDisposables.push(ringMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 48, Math.PI * 1.6), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(position.x, position.y + 0.1, position.z);
    this.course.add(ring);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), this.neon(NEON.green, 1.6));
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(position.x, position.y + 0.09, position.z);
    this.course.add(inner);

    const columnMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBoost: { value: 0 },
        uColor: { value: new THREE.Color(NEON.green).multiplyScalar(2.5 * LIGHTING.neon) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uBoost;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float fade = pow(1.0 - vUv.y, 1.6);
          float bands = 0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * 9.0);
          float a = fade * (0.25 + 0.5 * bands) * (0.6 + uBoost * 1.5);
          gl_FragColor = vec4(uColor * (1.0 + uBoost * 2.0), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.courseDisposables.push(columnMat);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 5, 32, 1, true), columnMat);
    column.position.set(position.x, position.y + 2.5, position.z);
    this.course.add(column);
    this.padVisuals.push({ ring, column: columnMat, pad });
  }

  private addFinishBeacon(position: THREE.Vector3): void {
    this.exclusions.push({ x: position.x, z: position.z, r: 4.5 });
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(NEON.yellow).multiplyScalar(2.2 * LIGHTING.neon) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float fade = pow(1.0 - vUv.y, 0.8);
          float bands = 0.6 + 0.4 * sin(vUv.y * 120.0 - uTime * 6.0);
          float edge = 0.55 + 0.45 * sin(vUv.x * 6.2831 * 6.0 + uTime * 2.0);
          gl_FragColor = vec4(uColor, fade * bands * edge * 0.32);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.beaconMaterials.push(mat);
    this.courseDisposables.push(mat);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 140, 48, 1, true), mat);
    column.position.set(position.x, position.y + 70, position.z);
    this.course.add(column);

    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON.yellow).multiplyScalar(4 * LIGHTING.neon), toneMapped: false });
    this.courseDisposables.push(ringMat);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6 + i * 0.5, 0.06, 8, 64, Math.PI * (1.2 + i * 0.4)), ringMat);
      ring.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.position.set(position.x, position.y + 0.12 + i * 0.05, position.z);
      holder.add(ring);
      this.course.add(holder);
      this.spinners.push({ object: holder, speed: i === 0 ? 1.2 : -0.8 });
    }
    this.addHoloSign(['◆ EXTRACTION ◆'], new THREE.Vector3(position.x, position.y + 4.5, position.z), NEON.yellow, 5);
    const light = new THREE.PointLight(NEON.yellow, 18 * LIGHTING.pointLights, 25, 2);
    light.position.set(position.x, position.y + 3, position.z);
    this.course.add(light);
  }

  addHoloSign(lines: string[], position: THREE.Vector3, color: number, width: number): void {
    const hex = '#' + new THREE.Color(color).getHexString();
    const { texture, aspect } = createHoloTexture(lines, hex);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      color: new THREE.Color(1, 1, 1).multiplyScalar(1.6 * LIGHTING.signs),
      transparent: true,
      depthWrite: false,
      opacity: 0.92,
    });
    this.courseDisposables.push(mat, texture);
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    this.exclusions.push({ x: position.x, z: position.z, r: 1.5 });
    sprite.scale.set(width, width / aspect, 1);
    this.course.add(sprite);
    this.flickers.push({ material: mat, base: 0.92, phase: this.rng() * 100 });
  }

  addNeonLight(position: THREE.Vector3, color: number, intensity: number, distance: number): void {
    // Sur mobile, chaque lumière ponctuelle alourdit tous les shaders : on s'en passe.
    if (!QUALITY.neonLights) return;
    const light = new THREE.PointLight(color, intensity * LIGHTING.pointLights, distance, 1.6);
    light.position.copy(position);
    this.course.add(light);
  }

  /**
   * Enseignes en pixel art sur les façades avant visibles depuis le parcours :
   * celles du niveau, ou à défaut deux par grand immeuble (générées).
   */
  private addSigns(def: LevelDef): void {
    let signs = def.signs;
    if (!signs) {
      const rng = createRng(def.id.length * 977 + def.buildings.length);
      const words = ['HOTEL', 'RAMEN', '24H', 'KARAOKE', 'CLUB', 'BAR', 'CAFE', 'NOODLES', 'LIVE', 'SUSHI', 'TAXI', 'BAO', 'DISCO', 'TATTOO', 'ARCADE', 'PHARMA'];
      signs = [];
      def.buildings.forEach((b, i) => {
        if (i === 0 || b.d < 20) return;
        const front = b.z + b.d / 2;
        for (const side of [-1, 1]) {
          signs!.push({
            text: words[Math.floor(rng() * words.length)],
            scheme: Math.floor(rng() * SIGN_SCHEMES.length),
            x: b.x + side * (b.w / 2 - 3),
            y: b.top - 4 - rng() * 5,
            z: front,
          });
        }
      });
    }
    for (const sign of signs) {
      const vertical = sign.text.length <= 4;
      const { texture, aspect } = createPixelSign(sign.text, SIGN_SCHEMES[sign.scheme % SIGN_SCHEMES.length], vertical);
      const mat = this.signMaterial(texture, 1.6);
      mat.transparent = true;
      this.courseDisposables.push(mat, texture);
      const h = vertical ? 6.4 : 1.6;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), mat);
      plane.position.set(sign.x, sign.y, sign.z + 0.06);
      this.course.add(plane);
      this.flickers.push({ material: mat, base: 1, phase: this.rng() * 100 });
    }
  }

  // ---------------------------------------------------------------------------
  // Arrière-plan
  // ---------------------------------------------------------------------------

  private buildCity(): void {
    const rng = createRng(4242);
    type Buf = { pos: number[]; nrm: number[]; uv: number[] };
    const newBuf = (): Buf => ({ pos: [], nrm: [], uv: [] });
    const sides: Buf[] = this.facadeMaterials.map(newBuf);
    const tops = newBuf();
    const blinkers: THREE.Vector3[] = [];
    const signSpots: { x: number; y: number; z: number; face: number }[] = [];
    const rooftopBoards: { x: number; y: number; z: number; face: number }[] = [];

    const quad = (target: Buf, a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][]) => {
      for (const [p, t] of [
        [a, uvs[0]],
        [b, uvs[1]],
        [c, uvs[2]],
        [a, uvs[0]],
        [c, uvs[2]],
        [d, uvs[3]],
      ]) {
        target.pos.push(p[0], p[1], p[2]);
        target.nrm.push(n[0], n[1], n[2]);
        target.uv.push(t[0], t[1]);
      }
    };

    const addTower = (cx: number, cz: number, w: number, d: number, top: number, bottom: number, dense: boolean) => {
      const buf = sides[Math.floor(rng() * sides.length)];
      const tu = dense ? FACADE_TILE_U * 0.6 : FACADE_TILE_U;
      const tv = dense ? FACADE_TILE_V * 0.6 : FACADE_TILE_V;
      const x0 = cx - w / 2;
      const x1 = cx + w / 2;
      const z0 = cz - d / 2;
      const z1 = cz + d / 2;
      const ou = Math.floor(rng() * FACADE_CELLS) / FACADE_CELLS;
      const ov = Math.floor(rng() * FACADE_CELLS) / FACADE_CELLS;
      const vB = ov;
      const vT = ov + (top - bottom) / tv;
      const uw = w / tu;
      const ud = d / tu;
      quad(buf, [x0, bottom, z1], [x1, bottom, z1], [x1, top, z1], [x0, top, z1], [0, 0, 1], [[ou, vB], [ou + uw, vB], [ou + uw, vT], [ou, vT]]);
      quad(buf, [x1, bottom, z0], [x0, bottom, z0], [x0, top, z0], [x1, top, z0], [0, 0, -1], [[ou, vB], [ou + uw, vB], [ou + uw, vT], [ou, vT]]);
      quad(buf, [x1, bottom, z1], [x1, bottom, z0], [x1, top, z0], [x1, top, z1], [1, 0, 0], [[ou, vB], [ou + ud, vB], [ou + ud, vT], [ou, vT]]);
      quad(buf, [x0, bottom, z0], [x0, bottom, z1], [x0, top, z1], [x0, top, z0], [-1, 0, 0], [[ou, vB], [ou + ud, vB], [ou + ud, vT], [ou, vT]]);
      const r = ROOF_TILE;
      quad(tops, [x0, top, z1], [x1, top, z1], [x1, top, z0], [x0, top, z0], [0, 1, 0], [[x0 / r, z1 / r], [x1 / r, z1 / r], [x1 / r, z0 / r], [x0 / r, z0 / r]]);
    };

    /** Toits de la ville : climatiseurs, réservoirs, cabanons colorés. */
    const rooftopClutter = (cx: number, cz: number, w: number, d: number, top: number) => {
      const n = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const x = cx + (rng() - 0.5) * (w - 4);
        const z = cz + (rng() - 0.5) * (d - 4);
        const kind = rng();
        if (kind < 0.4) {
          this.prop(2.5, 1.6, 2, x, top + 0.8, z, pick(rng, [0xd8d2c0, 0xb8bcc4, 0x9aa0a8]));
        } else if (kind < 0.7) {
          this.propGeo(new THREE.CylinderGeometry(1.4, 1.4, 3, 10), this.matrix(x, top + 2.6, z), pick(rng, [0x6b4a2f, 0x2f5f9a, 0xd8d8d0]));
          this.prop(2.2, 1.1, 2.2, x, top + 0.55, z, 0x2a2a30);
        } else {
          this.prop(3, 2.8, 3.5, x, top + 1.4, z, pick(rng, [0x8d8679, 0x6f8f7a, 0x9a6a4a, 0x7a7f9a]));
          this.glow(0.05, 1.8, 0.9, x + 1.52, top + 0.95, z, pick(rng, [0xffc27a, 0xbfe8ff, 0xffa8c8]), 1.4);
        }
      }
    };

    // Bandes de tours à gauche et à droite du parcours
    for (const side of [-1, 1]) {
      let z = 260;
      while (z > -680) {
        const d = 14 + rng() * 22;
        let xDist = 30 + rng() * 10;
        while (xDist < 300) {
          const w = 12 + rng() * 24;
          const far = xDist > 120;
          const h = far ? 60 + rng() * 230 : 30 + rng() * 150;
          const top = BASE_Y + h;
          const cx = side * (xDist + w / 2);
          const cz = z - d / 2;
          addTower(cx, cz, w, d, top, BASE_Y, far);
          if (h > 150) blinkers.push(new THREE.Vector3(cx, top + 1.5, cz));
          if (!far) {
            if (top < 60) rooftopClutter(cx, cz, w, d, top);
            if (rng() < 0.4) signSpots.push({ x: cx - side * (w / 2 + 0.1), y: top - 6 - rng() * 30, z: cz + (rng() - 0.5) * d * 0.5, face: -side });
            if (xDist < 70 && top < 40 && rng() < 0.3) rooftopBoards.push({ x: cx - side * (w / 2 - 3), y: top, z: cz, face: -side });
          }
          // Étages en retrait (silhouettes plus intéressantes)
          if (h > 120 && rng() < 0.6) addTower(cx, cz, w * 0.6, d * 0.6, top + 10 + rng() * 30, top, far);
          xDist += w + 3 + rng() * 10;
        }
        z -= d + 4 + rng() * 10;
      }
    }

    // Ville basse sous le parcours (visible en regardant dans le vide)
    for (let z = 40; z > -360; z -= 16 + rng() * 10) {
      for (const side of [-1, 1]) {
        const w = 8 + rng() * 6;
        const d = 10 + rng() * 6;
        const top = -34 - rng() * 18;
        const cx = side * (13 + w / 2 + rng() * 3);
        addTower(cx, z, w, d, top, BASE_Y, false);
        rooftopClutter(cx, z, w, d, top);
      }
    }
    // Rideau de tours au loin, droit devant et derrière
    for (let x = -260; x < 260; x += 20 + rng() * 15) {
      const w = 14 + rng() * 18;
      addTower(x, -720 - rng() * 40, w, 20, BASE_Y + 80 + rng() * 260, BASE_Y, true);
      addTower(x, 330 + rng() * 40, w, 20, BASE_Y + 60 + rng() * 200, BASE_Y, true);
    }

    const buildGeo = (data: Buf) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(data.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      g.computeBoundingSphere();
      return g;
    };
    sides.forEach((buf, i) => {
      if (buf.pos.length > 0) this.scene.add(new THREE.Mesh(buildGeo(buf), this.facadeMaterials[i]));
    });
    this.scene.add(new THREE.Mesh(buildGeo(tops), this.roofMaterials.get('tar')!));

    // Feux d'obstacle aérien clignotants
    if (blinkers.length > 0) {
      if (!this.blinkMaterial) {
        this.blinkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.2).multiplyScalar(LIGHTING.neon), toneMapped: false });
      }
      const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 8, 6), this.blinkMaterial, blinkers.length);
      blinkers.forEach((p, i) => {
        this.dummy.position.copy(p);
        this.dummy.updateMatrix();
        inst.setMatrixAt(i, this.dummy.matrix);
      });
      this.scene.add(inst);
    }

    // Enseignes pixel art sur les façades
    const words = ['HOTEL', 'BAR', 'CLUB', 'RAMEN', 'SUSHI', 'ARCADE', '24/7', 'KARAOKE', 'NOODLES', 'PHARMA', 'LIVE', 'TAXI', 'CAFE', 'BOOKS', 'DINER', 'GYM', 'OPEN', 'TATTOO', 'BAO', 'DISCO'];
    signSpots.forEach((s, i) => {
      const text = words[i % words.length];
      const vertical = text.length <= 4 && rng() < 0.7;
      const { texture, aspect } = createPixelSign(text, pick(rng, SIGN_SCHEMES), vertical);
      const mat = this.signMaterial(texture, 1.9);
      const hgt = vertical ? 10 + rng() * 6 : 3 + rng() * 2;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(hgt * aspect, hgt), mat);
      plane.position.set(s.x, s.y, s.z);
      plane.rotation.y = s.face > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(plane);
      if (rng() < 0.3) {
        mat.transparent = true;
        this.flickers.push({ material: mat, base: 1, phase: rng() * 100 });
      }
    });

    // Panneaux publicitaires sur les toits (cadre + affiche pixel art)
    const kinds: BillboardKind[] = ['ramen', 'cola', 'cat', 'koi', 'pharmacy', 'arcade', 'kalliope'];
    rooftopBoards.forEach((b, i) => {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), this.signMaterial(this.billboard(kinds[i % kinds.length]), 1.2));
      plane.position.set(b.x, b.y + 5.5, b.z);
      plane.rotation.y = b.face > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(plane);
      for (const dz of [-4.5, 4.5]) this.prop(0.25, 5.5, 0.25, b.x - b.face * 0.2, b.y + 2.75, b.z + dz, 0x2a2a30);
      this.prop(0.2, 0.2, 12.4, b.x - b.face * 0.2, b.y + 2.45, b.z, 0x2a2a30);
      for (let k = -2; k <= 2; k++) this.glow(0.3, 0.12, 0.3, b.x + b.face * 0.4, b.y + 8.6, b.z + k * 2.6, NEON.warm, 2.5);
    });

    // Affiches géantes flottantes
    const ads: BillboardKind[] = ['cola', 'cat', 'arcade', 'kalliope', 'pharmacy', 'vertigo'];
    ads.forEach((kind, i) => {
      const mat = this.signMaterial(this.billboard(kind), 1.15);
      mat.side = THREE.DoubleSide;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(48, 24), mat);
      const side = i % 2 === 0 ? 1 : -1;
      plane.position.set(side * 42, 32 + (i % 3) * 6, -40 - i * 70);
      plane.rotation.y = side > 0 ? -Math.PI / 2 + 0.35 : Math.PI / 2 - 0.35;
      this.scene.add(plane);
    });
  }

  private buildTraffic(): void {
    const rng = createRng(99);
    const count = QUALITY.trafficCount;
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.6, 4.2);
    const headGeo = new THREE.BoxGeometry(1.5, 0.14, 0.08).translate(0, 0.05, -2.12);
    const tailGeo = new THREE.BoxGeometry(1.6, 0.12, 0.08).translate(0, 0.05, 2.12);
    const underGeo = new THREE.BoxGeometry(1.2, 0.04, 3.4).translate(0, -0.32, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.35 });
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.5).multiplyScalar(LIGHTING.neon), toneMapped: false });
    const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.4).multiplyScalar(LIGHTING.neon), toneMapped: false });
    const underMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(3 * LIGHTING.neon), toneMapped: false });
    const body = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    const under = new THREE.InstancedMesh(underGeo, underMat, count);
    const meshes = [body, new THREE.InstancedMesh(headGeo, headMat, count), new THREE.InstancedMesh(tailGeo, tailMat, count), under];
    for (const m of meshes) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }
    // Taxis jaunes, berlines, utilitaires… chacun avec sa lueur de châssis
    const bodies = [0xe0b020, 0xd8d8d8, 0xb02020, 0x1f8f8f, 0x15151c, 0xd8701f, 0x1f4fbf, 0x3a2a5a];
    const glows = [NEON.cyan, NEON.pink, NEON.lime, NEON.amber, NEON.purple, NEON.red];
    const cars: { x: number; y: number; z: number; speed: number; dir: number }[] = [];
    for (let i = 0; i < count; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const lane = Math.floor(rng() * 4);
      const dir = lane % 2 === 0 ? -1 : 1;
      cars.push({
        x: side * (24 + lane * 7 + rng() * 2),
        y: 18 + Math.floor(rng() * 4) * 14 + rng() * 2,
        z: 300 - rng() * 1000,
        speed: 25 + rng() * 30,
        dir,
      });
      body.setColorAt(i, this.tmpColor.set(pick(rng, bodies)));
      under.setColorAt(i, this.tmpColor.set(pick(rng, glows)));
    }
    this.traffic = { meshes, cars };
    this.updateTraffic(0);
  }

  private updateTraffic(dt: number): void {
    if (!this.traffic) return;
    const { meshes, cars } = this.traffic;
    cars.forEach((c, i) => {
      c.z += c.speed * c.dir * dt;
      if (c.z < -700) c.z += 1000;
      if (c.z > 300) c.z -= 1000;
      this.dummy.position.set(c.x, c.y + Math.sin(this.time * 0.8 + i) * 0.3, c.z);
      this.dummy.rotation.set(0, c.dir > 0 ? Math.PI : 0, 0);
      this.dummy.updateMatrix();
      for (const m of meshes) m.setMatrixAt(i, this.dummy.matrix);
    });
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  }

  private addStreetGlow(): void {
    const tex = createStreetTexture();
    tex.repeat.set(8, 8);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.4 * LIGHTING.signs) });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, BASE_Y, -200);
    this.scene.add(plane);
  }
}
