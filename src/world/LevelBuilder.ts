import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics } from '../core/Physics';
import type { EnemySpawn } from '../enemies/EnemyManager';
import { Rain } from './Rain';
import {
  createAdTexture,
  createHoloTexture,
  createPanelTexture,
  createRng,
  createRoofTexture,
  createSignTexture,
  createStreetTexture,
  createWindowTexture,
  scaleBoxUVs,
} from './Textures';
import { LIGHTING, WORLD } from '../config';
import { QUALITY } from '../core/Device';

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

const NEON = {
  cyan: 0x00e5ff,
  magenta: 0xff2bd6,
  purple: 0x8a4dff,
  orange: 0xff8a2b,
  red: 0xff2040,
  green: 0x2bffb0,
  yellow: 0xffd23b,
} as const;

const BASE_Y = -70;
const WINDOW_TILE_U = 14.4;
const WINDOW_TILE_V = 28.8;

interface Flicker {
  material: THREE.Material & { opacity: number };
  base: number;
  phase: number;
}

/**
 * Construit le parcours sur les toits (immeubles, murs de wall-run balisés,
 * tremplins, obstacles à glisser dessous), la ville en arrière-plan, la
 * circulation aérienne et la pluie.
 */
export class LevelBuilder {
  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly rng = createRng(1337);
  private readonly batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly windowMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly roofMaterial: THREE.MeshStandardMaterial;
  private readonly panelMaterial: THREE.MeshStandardMaterial;
  private readonly darkMaterial: THREE.MeshStandardMaterial;
  private readonly neonMaterials = new Map<number, THREE.MeshBasicMaterial>();
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
  /** Zones à garder libres (ennemis, tremplins, obstacles) lors du placement des accessoires. */
  private readonly exclusions: { x: number; z: number; r: number }[] = [];
  private readonly roofs: { cx: number; cz: number; w: number; d: number; top: number; seed: number }[] = [];
  private time = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene = scene;
    this.physics = physics;

    for (let i = 0; i < 3; i++) {
      const tex = createWindowTexture(100 + i * 17);
      this.windowMaterials.push(
        new THREE.MeshStandardMaterial({
          color: 0x14151c,
          roughness: 0.55,
          metalness: 0.5,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: 0.9 * LIGHTING.windows,
        }),
      );
    }
    const roofTex = createRoofTexture(7);
    roofTex.repeat.set(1, 2);
    this.roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8a9a,
      map: roofTex,
      roughness: 0.32,
      metalness: 0.35,
    });
    const panelTex = createPanelTexture(3);
    this.panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x9a9aae,
      map: panelTex,
      roughness: 0.45,
      metalness: 0.7,
    });
    this.darkMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.8, metalness: 0.2 });
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  build(): LevelData {
    const enemySpawns: EnemySpawn[] = [];
    const guard = (x: number, y: number, z: number, yaw = 0) => {
      enemySpawns.push({ type: 'guard', position: new THREE.Vector3(x, y, z), yaw });
      this.exclusions.push({ x, z, r: 3 });
    };
    const drone = (x: number, y: number, z: number) =>
      enemySpawns.push({ type: 'drone', position: new THREE.Vector3(x, y, z), yaw: 0 });

    this.exclusions.push({ x: 0, z: 6, r: 3 });

    // --- B1 : toit de départ -------------------------------------------------
    this.addBuilding(0, -9, 16, 42, 0, NEON.cyan, 0);
    this.queueRoofProps(0, -9, 16, 42, 0, 11);
    this.addHoloSign(['ZQSD / WASD : COURIR', 'SOURIS : VISER'], new THREE.Vector3(0, 2.7, -3), NEON.cyan, 5.5);
    this.addHoloSign(['ESPACE : SAUTER', 'ESPACE EN L\'AIR : DOUBLE SAUT'], new THREE.Vector3(-3.5, 2.8, -22), NEON.cyan, 5.5);
    this.addHoloSign(['CLIC GAUCHE : LAMES MANTIS', '1 / 2 : CHANGER D\'ARME'], new THREE.Vector3(4.5, 3.2, -14), NEON.magenta, 5);
    guard(4.5, 0, -27, 0);
    this.addNeonLight(new THREE.Vector3(0, 6, -10), NEON.cyan, 22, 30);

    // --- B2 : obstacle à glisser dessous ------------------------------------
    this.addBuilding(0, -55, 18, 34, 0.5, NEON.magenta, 1);
    this.queueRoofProps(0, -55, 18, 34, 0.5, 23);
    this.addSlideBarrier(0, -50, 18, 0.5);
    this.addHoloSign(['C / CTRL : GLISSADE', 'GARDE TON ÉLAN !'], new THREE.Vector3(-3, 3.2, -43), NEON.orange, 5);
    this.addHoloSign(['WALL-RUN ►', 'SAUTE VERS LE MUR', 'EN MAINTENANT AVANCER'], new THREE.Vector3(5, 3.6, -68), NEON.green, 4.6);
    guard(-4, 0.5, -63, 0);
    guard(5.5, 0.5, -69, -0.3);
    this.addNeonLight(new THREE.Vector3(0, 6, -60), NEON.magenta, 22, 30);

    // --- Gouffre 2 : double mur de wall-run ---------------------------------
    this.addWallRunWall(3.9, -71, -90, 9, -1, NEON.green, 'NEON//VERTIGO', 'RUN THE WALLS', 0);
    this.addWallRunWall(-3.9, -86, -104, 9, 1, NEON.cyan, 'ネオン 電脳', 'KALLIOPE SYSTEMS', 1);
    this.addNeonLight(new THREE.Vector3(0, 5, -87), NEON.green, 16, 28);

    // --- B3 : premier vrai combat + tremplin --------------------------------
    this.addBuilding(0, -120, 18, 32, 0, NEON.purple, 2);
    this.queueRoofProps(0, -120, 18, 32, 0, 37);
    this.addHoloSign(['CLIC DROIT : SANDEVISTAN', 'LE TEMPS RALENTIT'], new THREE.Vector3(-5, 3, -108), NEON.green, 5);
    this.addHoloSign(['▲ TREMPLIN ▲'], new THREE.Vector3(0, 4.2, -128), NEON.green, 3.6);
    guard(-5, 0, -117, 0.2);
    guard(5, 0, -125, -0.2);
    drone(0, 6.5, -114);
    this.addJumpPad(new THREE.Vector3(0, 0, -132), 22.5, new THREE.Vector3(0, 0, -6));
    this.addNeonLight(new THREE.Vector3(0, 6, -124), NEON.purple, 22, 30);

    // --- B4 : toit haut --------------------------------------------------------
    this.addBuilding(0, -164, 16, 36, 8, NEON.orange, 0);
    this.queueRoofProps(0, -164, 16, 36, 8, 41);
    this.addSlideBarrier(0, -160, 16, 8);
    this.addHoloSign(['SHIFT EN L\'AIR : DASH', 'MUR À GAUCHE ◄'], new THREE.Vector3(-3, 11.4, -178), NEON.yellow, 5);
    guard(5, 8, -170, 0);
    guard(-4.5, 8, -176, 0.3);
    drone(0, 14, -166);
    this.addNeonLight(new THREE.Vector3(0, 14, -165), NEON.orange, 22, 30);

    // --- Gouffre 4 : wall-run descendant ---------------------------------------
    this.addWallRunWall(-3.9, -181, -205, 14, 1, NEON.magenta, '夜市 NIGHT MARKET', 'DESCENDS EN COURANT', 2);
    drone(6, 10, -193);
    drone(-1, 13, -201);
    this.addNeonLight(new THREE.Vector3(2, 10, -195), NEON.magenta, 19, 30);

    // --- B5 ---------------------------------------------------------------------
    this.addBuilding(0, -221, 18, 30, 4, NEON.cyan, 1);
    this.queueRoofProps(0, -221, 18, 30, 4, 53);
    guard(3, 4, -216, 0);
    guard(-5, 4, -229, 0.4);
    this.addNeonLight(new THREE.Vector3(0, 10, -222), NEON.cyan, 22, 30);

    // --- Plateformes ascendantes -------------------------------------------------
    this.addBuilding(0, -244, 7, 7, 5, NEON.magenta, 2);
    this.addBuilding(4, -255, 7, 7, 6, NEON.purple, 0);
    this.addBuilding(-2, -266, 7, 7, 7, NEON.cyan, 1);
    this.addJumpPad(new THREE.Vector3(-2, 7, -266.5), 14.5, new THREE.Vector3(0.6, 0, -6));
    drone(7, 12, -255);

    // --- B6 : tour finale + extraction ----------------------------------------------
    this.addBuilding(0, -291, 20, 30, 9, NEON.yellow, 2);
    this.queueRoofProps(0, -291, 20, 30, 9, 67);
    guard(-6, 9, -284, 0);
    guard(6, 9, -290, 0);
    guard(0, 9, -297, 0);
    drone(0, 15.5, -290);
    const finish = new THREE.Vector3(0, 9, -301);
    this.addFinishBeacon(finish);
    this.addNeonLight(new THREE.Vector3(0, 15, -292), NEON.yellow, 25, 32);

    // Accessoires de toit placés en dernier pour éviter les zones réservées
    for (const r of this.roofs) this.addRoofProps(r.cx, r.cz, r.w, r.d, r.top, r.seed);

    // --- Décor ----------------------------------------------------------------------
    this.addCourseSigns();
    this.buildCity();
    this.buildTraffic();
    this.addStreetGlow();
    this.flushBatches();
    this.rain = new Rain(this.scene);

    return {
      spawn: new THREE.Vector3(0, 0, 6),
      spawnYaw: 0,
      enemySpawns,
      jumpPads: this.jumpPads,
      finish: { position: finish, radius: 3.2 },
      killPlaneY: WORLD.killPlaneY,
    };
  }

  reset(): void {
    for (const p of this.jumpPads) {
      p.cooldown = 0;
      p.pulse = 0;
    }
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;

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
    this.rain?.update(dt, cameraPosition);
  }

  // ---------------------------------------------------------------------------
  // Éléments du parcours
  // ---------------------------------------------------------------------------

  private neon(color: number, intensity = 3): THREE.MeshBasicMaterial {
    const key = color * 10 + intensity;
    let m = this.neonMaterials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity * LIGHTING.neon), toneMapped: false });
      this.neonMaterials.set(key, m);
    }
    return m;
  }

  private batch(material: THREE.Material, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    // Uniformise les attributs pour la fusion
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    let list = this.batches.get(material);
    if (!list) {
      list = [];
      this.batches.set(material, list);
    }
    list.push(g);
  }

  private batchBox(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, rotX = 0): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    this.batch(material, new THREE.BoxGeometry(w, h, d), m);
  }

  private flushBatches(): void {
    for (const [material, geos] of this.batches) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      this.scene.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.batches.clear();
  }

  private addBuilding(cx: number, cz: number, w: number, d: number, top: number, trimColor: number, windowVariant: number): void {
    const h = top - BASE_Y;
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d, WINDOW_TILE_U, WINDOW_TILE_V, Math.floor(this.rng() * 8) / 16, Math.floor(this.rng() * 16) / 32);
    // Le toit utilise une échelle d'UV propre (dalles de ~7 m)
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 8; i < 12; i++) {
      uv.setXY(i, (uv.getX(i) * WINDOW_TILE_U) / 7.2, (uv.getY(i) * WINDOW_TILE_U) / 7.2);
    }
    const win = this.windowMaterials[windowVariant % this.windowMaterials.length];
    const mesh = new THREE.Mesh(geo, [win, win, this.roofMaterial, this.darkMaterial, win, win]);
    mesh.position.set(cx, BASE_Y + h / 2, cz);
    this.scene.add(mesh);
    this.physics.addBox(new THREE.Vector3(cx, BASE_Y + h / 2, cz), new THREE.Vector3(w / 2, h / 2, d / 2));

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
    const band = this.neon(trimColor, 1.6);
    this.batchBox(band, w + 0.1, 0.25, d + 0.1, cx, top - 1.4, cz);
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

  private addRoofProps(cx: number, cz: number, w: number, d: number, top: number, seed: number): void {
    const rng = createRng(seed);
    const count = Math.floor(d / 9);
    for (let i = 0; i < count; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const z = cz + d / 2 - 4 - (i + rng() * 0.5) * ((d - 8) / count);
      const x = cx + side * (w / 2 - 1.6 - rng() * 1.2);
      const kind = rng();
      if (!this.isFree(x, z, 1.6)) continue;
      if (kind < 0.5) this.addACUnit(x, top, z, rng);
      else if (kind < 0.75) this.addWaterTank(x, top, z);
      else this.addAntenna(x, top, z, 4 + rng() * 5);
    }
    // Petits conduits bas au milieu (couverture, franchissables)
    if (d > 30) {
      const z = cz + (rng() - 0.5) * 6;
      const x = cx + (rng() < 0.5 ? -1 : 1) * 2.8;
      if (!this.isFree(x, z, 1.5)) return;
      this.batchBox(this.panelMaterial, 2.6, 0.9, 1.2, x, top + 0.45, z);
      this.physics.addBox(new THREE.Vector3(x, top + 0.45, z), new THREE.Vector3(1.3, 0.45, 0.6));
    }
  }

  private addACUnit(x: number, top: number, z: number, rng: () => number): void {
    const w = 2.2;
    const h = 1.3;
    const d = 1.6;
    this.batchBox(this.panelMaterial, w, h, d, x, top + h / 2, z);
    this.batchBox(this.darkMaterial, 1.0, 0.06, 1.0, x, top + h + 0.03, z);
    this.batchBox(this.neon(rng() < 0.5 ? NEON.green : NEON.red, 4), 0.08, 0.08, 0.02, x + 0.8, top + h - 0.25, z + d / 2 + 0.01);
    this.physics.addBox(new THREE.Vector3(x, top + h / 2, z), new THREE.Vector3(w / 2, h / 2, d / 2));
  }

  private addWaterTank(x: number, top: number, z: number): void {
    const tank = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 16);
    this.batch(this.panelMaterial, tank, new THREE.Matrix4().makeTranslation(x, top + 1.1 + 0.9, z));
    for (const [ox, oz] of [
      [-0.7, -0.7],
      [0.7, -0.7],
      [-0.7, 0.7],
      [0.7, 0.7],
    ]) {
      this.batchBox(this.darkMaterial, 0.12, 0.9, 0.12, x + ox, top + 0.45, z + oz);
    }
    this.batchBox(this.neon(NEON.cyan, 3), 2.24, 0.06, 0.06, x, top + 2.6, z + 0.9);
    this.physics.addBox(new THREE.Vector3(x, top + 1.55, z), new THREE.Vector3(1.0, 1.55, 1.0));
  }

  private addAntenna(x: number, top: number, z: number, height: number): void {
    this.batchBox(this.darkMaterial, 0.12, height, 0.12, x, top + height / 2, z);
    this.batchBox(this.darkMaterial, 0.8, 0.05, 0.05, x, top + height * 0.7, z);
    this.batchBox(this.darkMaterial, 0.6, 0.05, 0.05, x, top + height * 0.85, z);
    if (!this.blinkMaterial) {
      this.blinkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.2).multiplyScalar(LIGHTING.neon), toneMapped: false });
    }
    this.batchBox(this.blinkMaterial, 0.18, 0.18, 0.18, x, top + height + 0.1, z);
    this.physics.addBox(new THREE.Vector3(x, top + height / 2, z), new THREE.Vector3(0.1, height / 2, 0.1));
  }

  /**
   * Mur vertical pour le wall-run : `faceDir` est la direction (en X) de la face
   * sur laquelle on court. Une affiche lumineuse et des bandes néon le balisent.
   */
  private addWallRunWall(
    x: number,
    zStart: number,
    zEnd: number,
    top: number,
    faceDir: 1 | -1,
    color: number,
    title: string,
    subtitle: string,
    seed: number,
  ): void {
    const thickness = 0.6;
    const length = Math.abs(zEnd - zStart);
    const cz = (zStart + zEnd) / 2;
    const h = top - BASE_Y;
    const geo = new THREE.BoxGeometry(thickness, h, length);
    scaleBoxUVs(geo, thickness, h, length, 4, 4);
    const mesh = new THREE.Mesh(geo, this.panelMaterial);
    mesh.position.set(x, BASE_Y + h / 2, cz);
    this.scene.add(mesh);
    this.physics.addBox(mesh.position.clone(), new THREE.Vector3(thickness / 2, h / 2, length / 2));

    const faceX = x + faceDir * (thickness / 2 + 0.015);
    const adHeight = 7;
    const adCenterY = top - 4.2;
    const ad = createAdTexture(title, subtitle, faceDir > 0 ? '#00b8ff' : '#ff2bd6', faceDir > 0 ? '#7a2bff' : '#ff8a2b', seed);
    const adMat = new THREE.MeshBasicMaterial({ map: ad, color: new THREE.Color(1, 1, 1).multiplyScalar(LIGHTING.signs) });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(length - 0.4, adHeight), adMat);
    plane.position.set(faceX, adCenterY, cz);
    plane.rotation.y = faceDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.scene.add(plane);

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
    const ad = createAdTexture('▼ GLISSE ▼', 'C / CTRL — PASSE DESSOUS', '#ff8a2b', '#ff2040', 5 + Math.round(z));
    const adMat = new THREE.MeshBasicMaterial({ map: ad, color: new THREE.Color(1, 1, 1).multiplyScalar(1.05 * LIGHTING.signs) });
    const mesh = new THREE.Mesh(geo, [this.panelMaterial, this.panelMaterial, this.panelMaterial, this.panelMaterial, adMat, adMat]);
    mesh.position.set(cx, cy, z);
    this.scene.add(mesh);
    this.physics.addBox(new THREE.Vector3(cx, cy, z), new THREE.Vector3(width / 2, h / 2, thickness / 2));

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
    this.scene.add(base);

    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON.green).multiplyScalar(4 * LIGHTING.neon), toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 48, Math.PI * 1.6), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(position.x, position.y + 0.1, position.z);
    this.scene.add(ring);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), this.neon(NEON.green, 1.6));
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(position.x, position.y + 0.09, position.z);
    this.scene.add(inner);

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
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 5, 32, 1, true), columnMat);
    column.position.set(position.x, position.y + 2.5, position.z);
    this.scene.add(column);
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
    const column = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 140, 48, 1, true), mat);
    column.position.set(position.x, position.y + 70, position.z);
    this.scene.add(column);

    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON.yellow).multiplyScalar(4 * LIGHTING.neon), toneMapped: false });
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6 + i * 0.5, 0.06, 8, 64, Math.PI * (1.2 + i * 0.4)), ringMat);
      ring.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.position.set(position.x, position.y + 0.12 + i * 0.05, position.z);
      holder.add(ring);
      this.scene.add(holder);
      this.spinners.push({ object: holder, speed: i === 0 ? 1.2 : -0.8 });
    }
    this.addHoloSign(['◆ EXTRACTION ◆'], new THREE.Vector3(position.x, position.y + 4.5, position.z), NEON.yellow, 5);
    const light = new THREE.PointLight(NEON.yellow, 18 * LIGHTING.pointLights, 25, 2);
    light.position.set(position.x, position.y + 3, position.z);
    this.scene.add(light);
  }

  private addHoloSign(lines: string[], position: THREE.Vector3, color: number, width: number): void {
    const hex = '#' + new THREE.Color(color).getHexString();
    const { texture, aspect } = createHoloTexture(lines, hex);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      color: new THREE.Color(1, 1, 1).multiplyScalar(1.6 * LIGHTING.signs),
      transparent: true,
      depthWrite: false,
      opacity: 0.92,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    this.exclusions.push({ x: position.x, z: position.z, r: 1.5 });
    sprite.scale.set(width, width / aspect, 1);
    this.scene.add(sprite);
    this.flickers.push({ material: mat, base: 0.92, phase: this.rng() * 100 });
  }

  private addNeonLight(position: THREE.Vector3, color: number, intensity: number, distance: number): void {
    // Sur mobile, chaque lumière ponctuelle alourdit tous les shaders : on s'en passe.
    if (!QUALITY.neonLights) return;
    const light = new THREE.PointLight(color, intensity * LIGHTING.pointLights, distance, 1.6);
    light.position.copy(position);
    this.scene.add(light);
  }

  /** Enseignes verticales sur les façades visibles depuis le parcours. */
  private addCourseSigns(): void {
    // texte, couleur, x, y, z de la façade avant (+Z) de l'immeuble
    const signs: [string, number, number, number, number][] = [
      ['HOTEL', NEON.magenta, 5, -5, -38],
      ['ラーメン', NEON.orange, -6, -7, -38],
      ['24H', NEON.cyan, 6, -6, -104],
      ['電脳街', NEON.purple, -6, -9, -104],
      ['CLUB', NEON.magenta, 5, 2, -146],
      ['BAR', NEON.green, -5, 1, -146],
      ['未来', NEON.cyan, 6, -3, -206],
      ['NOODLES', NEON.yellow, -5, -2, -206],
      ['KALLIOPE', NEON.cyan, -5, 4, -276],
      ['夜', NEON.red, 7, 3, -276],
    ];
    for (const [text, color, x, y, z] of signs) {
      const hex = '#' + new THREE.Color(color).getHexString();
      const vertical = text.length <= 4;
      const tex = createSignTexture(text, hex, vertical);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.8 * LIGHTING.signs), transparent: true });
      const w = vertical ? 1.6 : 6;
      const h = vertical ? 6.4 : 1.5;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      plane.position.set(x, y, z + 0.06);
      this.scene.add(plane);
      this.flickers.push({ material: mat, base: 1, phase: this.rng() * 100 });
    }
  }

  // ---------------------------------------------------------------------------
  // Arrière-plan
  // ---------------------------------------------------------------------------

  private buildCity(): void {
    const rng = createRng(4242);
    const sides = { pos: [] as number[], nrm: [] as number[], uv: [] as number[] };
    const tops = { pos: [] as number[], nrm: [] as number[], uv: [] as number[] };
    const blinkers: THREE.Vector3[] = [];
    const signSpots: { x: number; y: number; z: number; face: number }[] = [];

    const quad = (
      target: { pos: number[]; nrm: number[]; uv: number[] },
      a: number[],
      b: number[],
      c: number[],
      d: number[],
      n: number[],
      uvs: number[][],
    ) => {
      // Deux triangles a-b-c, a-c-d
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

    const addTower = (cx: number, cz: number, w: number, d: number, top: number, bottom: number) => {
      const x0 = cx - w / 2;
      const x1 = cx + w / 2;
      const z0 = cz - d / 2;
      const z1 = cz + d / 2;
      const ou = Math.floor(rng() * 16) / 16;
      const ov = Math.floor(rng() * 32) / 32;
      const vB = ov;
      const vT = ov + (top - bottom) / WINDOW_TILE_V;
      const uw = w / WINDOW_TILE_U;
      const ud = d / WINDOW_TILE_U;
      // +Z
      quad(sides, [x0, bottom, z1], [x1, bottom, z1], [x1, top, z1], [x0, top, z1], [0, 0, 1], [
        [ou, vB],
        [ou + uw, vB],
        [ou + uw, vT],
        [ou, vT],
      ]);
      // -Z
      quad(sides, [x1, bottom, z0], [x0, bottom, z0], [x0, top, z0], [x1, top, z0], [0, 0, -1], [
        [ou, vB],
        [ou + uw, vB],
        [ou + uw, vT],
        [ou, vT],
      ]);
      // +X
      quad(sides, [x1, bottom, z1], [x1, bottom, z0], [x1, top, z0], [x1, top, z1], [1, 0, 0], [
        [ou, vB],
        [ou + ud, vB],
        [ou + ud, vT],
        [ou, vT],
      ]);
      // -X
      quad(sides, [x0, bottom, z0], [x0, bottom, z1], [x0, top, z1], [x0, top, z0], [-1, 0, 0], [
        [ou, vB],
        [ou + ud, vB],
        [ou + ud, vT],
        [ou, vT],
      ]);
      // Toit
      quad(tops, [x0, top, z1], [x1, top, z1], [x1, top, z0], [x0, top, z0], [0, 1, 0], [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]);
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
          addTower(cx, cz, w, d, top, BASE_Y);
          if (h > 150) blinkers.push(new THREE.Vector3(cx, top + 1.5, cz));
          if (!far && rng() < 0.35) {
            signSpots.push({ x: cx - side * (w / 2 + 0.1), y: top - 6 - rng() * 30, z: cz + (rng() - 0.5) * d * 0.5, face: -side });
          }
          // Étages en retrait (silhouettes plus intéressantes)
          if (h > 120 && rng() < 0.6) {
            addTower(cx, cz, w * 0.6, d * 0.6, top + 10 + rng() * 30, top);
          }
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
        addTower(side * (13 + w / 2 + rng() * 3), z, w, d, top, BASE_Y);
      }
    }
    // Rideau de tours au loin, droit devant et derrière
    for (let x = -260; x < 260; x += 20 + rng() * 15) {
      const w = 14 + rng() * 18;
      addTower(x, -720 - rng() * 40, w, 20, BASE_Y + 80 + rng() * 260, BASE_Y);
      addTower(x, 330 + rng() * 40, w, 20, BASE_Y + 60 + rng() * 200, BASE_Y);
    }

    const buildGeo = (data: { pos: number[]; nrm: number[]; uv: number[] }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(data.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      g.computeBoundingSphere();
      return g;
    };
    const cityMat = this.windowMaterials[1].clone();
    cityMat.emissiveIntensity = 1.1 * LIGHTING.windows;
    this.scene.add(new THREE.Mesh(buildGeo(sides), cityMat));
    this.scene.add(new THREE.Mesh(buildGeo(tops), this.darkMaterial));

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

    // Enseignes géantes
    const words = ['ネオン', 'HOTEL', 'サイバー', 'BAR', '電脳', 'CLUB', '24/7', 'RAMEN', '夜市', 'ARCADE', '未来', 'SUSHI'];
    const colors = ['#ff2bd6', '#00e5ff', '#8a4dff', '#ff8a2b', '#2bffb0', '#ffd23b'];
    signSpots.forEach((s, i) => {
      const text = words[i % words.length];
      const color = colors[Math.floor(rng() * colors.length)];
      const vertical = text.length <= 4;
      const tex = createSignTexture(text, color, vertical);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(2.2 * LIGHTING.signs), transparent: true });
      const scale = 3 + rng() * 3;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? scale : scale * 4, vertical ? scale * 4 : scale), mat);
      plane.position.set(s.x, s.y, s.z);
      plane.rotation.y = s.face > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(plane);
      if (rng() < 0.3) this.flickers.push({ material: mat, base: 1, phase: rng() * 100 });
    });

    // Quelques panneaux publicitaires holographiques géants
    const ads: [string, string, string, string][] = [
      ['SANDEVISTAN', 'TIME IS A LUXURY', '#00e5ff', '#2bffb0'],
      ['MANTIS', 'CUT THROUGH THE NIGHT', '#ff2bd6', '#8a4dff'],
      ['VERTIGO', 'DON\'T LOOK DOWN', '#ff8a2b', '#ff2040'],
      ['KALLIOPE', 'YOUR VOICE. OUR CITY.', '#8a4dff', '#00e5ff'],
    ];
    ads.forEach(([title, sub, a, b], i) => {
      const tex = createAdTexture(title, sub, a, b, 900 + i);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.15 * LIGHTING.signs), side: THREE.DoubleSide });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(48, 24), mat);
      const side = i % 2 === 0 ? 1 : -1;
      plane.position.set(side * 42, 32 + i * 6, -60 - i * 85);
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
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x15151c, metalness: 0.9, roughness: 0.3 });
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.5).multiplyScalar(LIGHTING.neon), toneMapped: false });
    const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.4).multiplyScalar(LIGHTING.neon), toneMapped: false });
    const underMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.5, 4).multiplyScalar(LIGHTING.neon), toneMapped: false });
    const meshes = [
      new THREE.InstancedMesh(bodyGeo, bodyMat, count),
      new THREE.InstancedMesh(headGeo, headMat, count),
      new THREE.InstancedMesh(tailGeo, tailMat, count),
      new THREE.InstancedMesh(underGeo, underMat, count),
    ];
    for (const m of meshes) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }
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
