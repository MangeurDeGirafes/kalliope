import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelBuilder } from './LevelBuilder';
import type { LevelDef } from './levels';
import { createPixelSign, drawPixelText, pixelTexture, SIGN_SCHEMES } from './PixelTextures';
import { createRng } from './Textures';
import { LIGHTING } from '../config';

/**
 * La Plaza : parc suspendu entre deux niveaux. Exploration libre, marchands
 * d'améliorations, personnages à qui parler et easter eggs (chats néon cachés,
 * borne d'arcade, oracle, fontaine à vœux, statue secrète).
 */

export type InteractKind = 'clinic' | 'atelier' | 'ramen' | 'arcade' | 'oracle' | 'fountain' | 'statue' | 'mamie' | 'npc';

export interface Interactable {
  id: string;
  kind: InteractKind;
  /** Nom affiché (bulle de dialogue, invite). */
  name: string;
  /** Verbe de l'invite : « PARLER À », « JOUER À »… */
  verb: string;
  position: THREE.Vector3;
  radius: number;
  color: string;
  /** Répliques tirées au hasard (personnages simples). */
  lines?: readonly string[];
}

interface Npc {
  root: THREE.Group;
  head: THREE.Object3D;
  baseYaw: number;
  dance: boolean;
  phase: number;
}

interface Cat {
  id: string;
  sprite: THREE.Sprite;
  base: THREE.Vector3;
  collected: boolean;
  phase: number;
}

export const CAT_COUNT = 5;

type Rng = () => number;

const SKIN = [0xf1c7a0, 0xd9a27a, 0xa9744f, 0x7a4e32, 0xf6d9c0];
const CHERRY = [0xff9ac8, 0xf27ab8, 0xffb8d8, 0xe85a9a, 0xffd0e6];
const GREENS = [0x3f8f3f, 0x5faf4f, 0x2f6f4f, 0x7fbf3f, 0x4f9f6f];
const FLOWERS = [0xff5a7a, 0xffd23b, 0xff8a2b, 0xf2f2f2, 0xb86af2, 0x7fd8ff];

/** Niveau de base de la Plaza (dalle, tremplin, sortie, ambiance). */
export function plazaDef(exitLabel: string): LevelDef {
  return {
    id: 'plaza',
    name: 'LA PLAZA',
    subtitle: 'Marchands, secrets et repos',
    difficulty: 1,
    spawn: [0, 0, 20],
    spawnYaw: 0,
    buildings: [{ x: 0, z: -22, w: 56, d: 96, top: 0, trim: 'pink', facade: 1, roof: 'concrete' }],
    walls: [],
    barriers: [],
    pads: [{ pos: [17, 0, -44], power: 22.5, boost: [0, 0, -6] }],
    guards: [],
    drones: [],
    holos: [
      { lines: ['BIENVENUE À LA PLAZA', 'MARCHANDS · SECRETS · REPOS'], pos: [0, 3.1, 11], color: 'pink', width: 5.5 },
      { lines: ['SORTIE ▶', exitLabel], pos: [0, 7.6, -60], color: 'yellow', width: 6.5 },
      { lines: ['▲ TREMPLIN ▲'], pos: [17, 3.2, -40.5], color: 'green', width: 3.2 },
    ],
    lights: [
      { pos: [0, 5, -14], color: 'cyan', intensity: 20, distance: 26 },
      { pos: [-17, 4.5, -2], color: 'teal', intensity: 16, distance: 18 },
      { pos: [17, 4.5, -2], color: 'orange', intensity: 16, distance: 18 },
      { pos: [-17, 4.5, -30], color: 'red', intensity: 16, distance: 18 },
      { pos: [17, 4.5, -30], color: 'purple', intensity: 16, distance: 18 },
      { pos: [0, 6, -58], color: 'yellow', intensity: 20, distance: 24 },
    ],
    signs: [],
    finish: [0, 0, -63],
    theme: {
      fog: 0x22142a,
      fogDensity: 0.0058,
      rain: 0.2,
      skyHorizon: 0x4a2050,
      skyGlow: 0xff7ab0,
      skyWarm: 0xffb060,
      ambient: 0x6a5090,
      key: 0xffa860,
    },
  };
}

// -----------------------------------------------------------------------------
// Géométrie colorée (personnages)
// -----------------------------------------------------------------------------

function cbox(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

interface Look {
  skin: number;
  hair: number;
  top: number;
  pants: number;
  accent: number;
  /** Accessoire de tête. */
  extra?: 'visor' | 'goggles' | 'bandana' | 'headphones' | 'bun' | 'cap';
  apron?: number;
  scale?: number;
}

const tmpV = new THREE.Vector3();

export class Plaza {
  readonly interactables: Interactable[] = [];
  readonly cats: Cat[] = [];
  private readonly npcs: Npc[] = [];
  private water: THREE.MeshBasicMaterial | null = null;
  private arcade: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture; timer: number; frame: number } | null = null;
  private time = 0;

  /** Construit la Plaza (appelé par LevelBuilder.loadLevel). */
  build(b: LevelBuilder, catFound: (id: string) => boolean): void {
    this.interactables.length = 0;
    this.cats.length = 0;
    this.npcs.length = 0;
    const rng = createRng(777);

    this.ground(b, rng);
    this.railing(b);
    this.fountain(b);
    this.lamps(b, rng);
    for (const [x, z, kind] of [
      [12, 10, 'cherry'],
      [8, -3, 'green'],
      [-12, 10, 'green'],
      [-8, 1, 'cherry'],
      [11, -40, 'cherry'],
      [9.5, -28, 'green'],
      [-11, -26, 'cherry'],
      [-8, -39, 'green'],
      [24, 14, 'green'],
      [-24, 16, 'cherry'],
    ] as const) {
      this.tree(b, x, z, kind, rng);
    }
    this.bench(b, 4.3, 6, rng);
    this.bench(b, -4.3, 6, rng);
    this.bench(b, 4.3, -34, rng);
    this.bench(b, -4.3, -34, rng);

    // Marchands
    this.stall(b, -21, -2, 1, 'CLINIQUE', 7, [0x2a4a4a, 0xd8f0f0, 0x2bd9c5], 'clinic', rng);
    this.stall(b, 21, -2, -1, 'ATELIER', 8, [0x4a2e1a, 0x8a6a4a, 0xff8a2b], 'atelier', rng);
    this.stall(b, -21, -30, 1, 'RAMEN', 0, [0x3a0a0a, 0xf0e6d0, 0xff3b3b], 'ramen', rng);
    this.stall(b, 21, -30, -1, 'ARCADE', 4, [0x1a0a2a, 0x2a1a3a, 0xa36bff], 'arcade', rng);
    this.npc(b, -21.6, -2, Math.PI / 2, { skin: SKIN[0], hair: 0x1a1a22, top: 0xe8f4f4, pants: 0x2a3a4a, accent: 0x2bd9c5, extra: 'visor' });
    this.npc(b, 21.6, -2, -Math.PI / 2, { skin: SKIN[4], hair: 0xd8d8e0, top: 0x6a4a2a, pants: 0x3a2a1a, accent: 0xff8a2b, extra: 'goggles', apron: 0x5a3a1f, scale: 0.92 });
    this.npc(b, -21.6, -30, Math.PI / 2, { skin: SKIN[1], hair: 0x2a1a10, top: 0xf2f2f2, pants: 0x2a2a30, accent: 0xff3b3b, extra: 'bandana', apron: 0xf0e6d0 });

    this.interact('clinic', 'clinic', 'DOC SATO', 'PARLER À', -18.6, 0, -2, 2.4, '#2bd9c5');
    this.interact('atelier', 'atelier', 'MÉMÉ RIVET', 'PARLER À', 18.6, 0, -2, 2.4, '#ff8a2b');
    this.interact('ramen', 'ramen', 'OKONOMI', 'COMMANDER UN RAMEN CHEZ', -18.6, 0, -30, 2.4, '#ff3b3b');
    this.interact('arcade', 'arcade', 'NEON RUSH', 'JOUER À', 18.6, 0, -30, 2.4, '#a36bff');

    // Personnages de la Plaza
    this.npc(b, 9.6, 9.6, -Math.PI / 2, { skin: SKIN[4], hair: 0xb8b8c8, top: 0xb86af2, pants: 0x4a2a5a, accent: 0xff7ad9, extra: 'bun', scale: 0.9 });
    b.addCollider(new THREE.Vector3(9.6, 0.9, 9.6), new THREE.Vector3(0.35, 0.9, 0.35));
    this.interact('mamie', 'mamie', 'MAMIE CHAT', 'PARLER À', 9.6, 0, 9.6, 2.4, '#ff7ad9');

    this.npc(b, 17.6, -24.6, -2.2, { skin: SKIN[2], hair: 0x1a1a1a, top: 0xffd23b, pants: 0x1a3a6a, accent: 0x7fd8ff, extra: 'cap', scale: 0.72 });
    b.addCollider(new THREE.Vector3(17.6, 0.7, -24.6), new THREE.Vector3(0.3, 0.7, 0.3));
    this.interact('kid', 'npc', 'PETIT ZÉRO', 'PARLER À', 17.6, 0, -24.6, 2.2, '#ffd23b', [
      'Paraît que si tu fais sept vœux à la fontaine, il se passe un truc.',
      'Moi aussi, un jour, j\'aurai des lames Mantis. Et un vrai sandwich.',
      'Le tremplin là-bas ? Tout en haut, y a une statue en or. Juré.',
      'Les chats de Mamie se cachent toujours en hauteur. Sauf un, qui aime le miso.',
    ]);

    this.djCorner(b, rng);
    this.oracle(b);
    this.crates(b);
    this.tower(b);

    // Chats néon cachés
    const spots: [number, number, number, number][] = [
      [0, 3.4, -14, 0xff7ad9],
      [-22.5, 4.75, -55.5, 0x7fd8ff],
      [19.5, 8.75, -64.6, 0x9dff5c],
      [-25.5, 0.75, -31, 0xffd23b],
      [21.3, 3.85, -30, 0xa36bff],
    ];
    spots.forEach(([x, y, z, color], i) => {
      const id = `cat-${i + 1}`;
      if (catFound(id)) return;
      this.cat(b, id, x, y, z, color, i);
    });
  }

  update(dt: number, player: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;
    const k = 1 - Math.exp(-6 * dt);
    for (const n of this.npcs) {
      if (n.dance) {
        n.root.position.y = Math.abs(Math.sin(t * 4.2 + n.phase)) * 0.18;
        n.root.rotation.y = n.baseYaw + Math.sin(t * 2.1 + n.phase) * 0.6;
        n.head.rotation.z = Math.sin(t * 4.2 + n.phase) * 0.15;
        continue;
      }
      n.root.position.y = Math.sin(t * 1.6 + n.phase) * 0.01;
      // La tête suit le joueur quand il s'approche
      const p = n.root.parent!.position;
      const dx = player.x - p.x;
      const dz = player.z - p.z;
      let target = 0;
      if (dx * dx + dz * dz < 64) {
        target = Math.atan2(dx, dz) - n.baseYaw;
        target = THREE.MathUtils.clamp(Math.atan2(Math.sin(target), Math.cos(target)), -1.1, 1.1);
      }
      n.head.rotation.y += (target - n.head.rotation.y) * k;
    }
    for (const c of this.cats) {
      if (c.collected) continue;
      c.sprite.position.y = c.base.y + Math.sin(t * 2 + c.phase) * 0.12;
      // « Clignement » : le chat se retourne de temps en temps
      const flip = Math.sin(t * 0.7 + c.phase * 3) > 0.92 ? -1 : 1;
      c.sprite.scale.x = Math.abs(c.sprite.scale.x) * flip;
    }
    if (this.water) this.water.opacity = 0.62 + Math.sin(t * 2.3) * 0.08;
    if (this.arcade) {
      this.arcade.timer -= dt;
      if (this.arcade.timer <= 0) {
        this.arcade.timer = 0.12;
        this.drawArcade(this.arcade.ctx, this.arcade.frame++);
        this.arcade.texture.needsUpdate = true;
      }
    }
  }

  /** Point d'intérêt à portée du joueur (le plus proche). */
  findInteractable(position: THREE.Vector3, feetY: number): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      const dx = position.x - it.position.x;
      const dz = position.z - it.position.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius || Math.abs(feetY - it.position.y) > 2.2) continue;
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  /** Chat ramassé à cette frame (centre du joueur à moins de 1,5 m). */
  collectCat(center: THREE.Vector3): Cat | null {
    for (const c of this.cats) {
      if (c.collected) continue;
      if (tmpV.copy(c.sprite.position).distanceTo(center) < 1.5) {
        c.collected = true;
        c.sprite.visible = false;
        return c;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Sol, bordures, éclairage
  // ---------------------------------------------------------------------------

  private ground(b: LevelBuilder, rng: Rng): void {
    // Allée centrale en pavés
    for (let z = 25; z > -69; z -= 1) {
      for (let x = -2; x <= 2; x++) {
        b.prop(0.98, 0.03, 0.98, x, 0.015, z - 0.5, (x + Math.floor(z)) % 2 === 0 ? 0x8a7a6a : 0x76685a);
      }
    }
    // Pelouses en dalles de pixels, fleurs et touffes
    const lawns: [number, number, number, number][] = [
      [5, 15, -6, 14],
      [-15, -5, -6, 14],
      [5, 13, -44, -22],
      [-13, -5, -44, -22],
    ];
    for (const [x0, x1, z0, z1] of lawns) {
      for (let x = x0; x < x1; x += 2) {
        for (let z = z0; z < z1; z += 2) {
          b.prop(2, 0.04, 2, x + 1, 0.02, z + 1, GREENS[Math.floor(rng() * GREENS.length)]);
          if (rng() < 0.45) b.prop(0.14, 0.14, 0.14, x + rng() * 2, 0.1, z + rng() * 2, FLOWERS[Math.floor(rng() * FLOWERS.length)]);
          if (rng() < 0.3) b.prop(0.25, 0.18, 0.25, x + rng() * 2, 0.1, z + rng() * 2, 0x2f6f2f, rng() * 3);
        }
      }
      // Bordure de pierre
      b.prop(x1 - x0, 0.12, 0.2, (x0 + x1) / 2, 0.06, z0, 0x5a5048);
      b.prop(x1 - x0, 0.12, 0.2, (x0 + x1) / 2, 0.06, z1, 0x5a5048);
    }
  }

  private railing(b: LevelBuilder): void {
    const h = 1.05;
    const edges: [number, number, number, number][] = [
      [-27.85, 25.85, 27.85, 25.85],
      [-27.85, -69.85, 27.85, -69.85],
      [-27.85, -69.85, -27.85, 25.85],
      [27.85, -69.85, 27.85, 25.85],
    ];
    for (const [x0, z0, x1, z1] of edges) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = Math.abs(z1 - z0) < 0.01;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      b.prop(alongX ? len : 0.08, 0.08, alongX ? 0.08 : len, cx, h, cz, 0x2a2a34);
      b.glow(alongX ? len : 0.05, 0.04, alongX ? 0.05 : len, cx, h + 0.06, cz, 0xff7ad9, 1.6);
      const n = Math.floor(len / 3);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        b.prop(0.1, h, 0.1, x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t, 0x3a3a46);
      }
      b.addCollider(new THREE.Vector3(cx, h / 2, cz), new THREE.Vector3(alongX ? len / 2 : 0.1, h / 2, alongX ? 0.1 : len / 2));
    }
  }

  private lamps(b: LevelBuilder, rng: Rng): void {
    const zs = [16, 4, -26, -38, -50];
    for (const z of zs) {
      for (const x of [-3.4, 3.4]) {
        b.prop(0.12, 3.6, 0.12, x, 1.8, z, 0x2a2a30);
        b.prop(0.5, 0.12, 0.5, x, 3.62, z, 0x1a1a20);
        b.glow(0.36, 0.18, 0.36, x, 3.5, z, 0xffd8a0, 2.2);
        b.addCollider(new THREE.Vector3(x, 1.8, z), new THREE.Vector3(0.08, 1.8, 0.08));
      }
      b.stringLights(-3.4, z, 3.4, z, 3.35, rng);
    }
  }

  // ---------------------------------------------------------------------------
  // Mobilier
  // ---------------------------------------------------------------------------

  private tree(b: LevelBuilder, x: number, z: number, kind: 'cherry' | 'green', rng: Rng): void {
    const palette = kind === 'cherry' ? CHERRY : GREENS;
    b.prop(0.36, 2.4, 0.36, x, 1.2, z, 0x5a3a24);
    b.prop(0.2, 0.9, 0.2, x + 0.35, 2.1, z, 0x5a3a24, 0, 0.6);
    for (let i = 0; i < 9; i++) {
      const s = 1 + rng() * 0.8;
      b.prop(s, s * 0.8, s, x + (rng() - 0.5) * 2.2, 2.6 + rng() * 1.4, z + (rng() - 0.5) * 2.2, palette[Math.floor(rng() * palette.length)], rng() * 3);
    }
    if (kind === 'cherry') {
      // Pétales tombés
      for (let i = 0; i < 10; i++) b.prop(0.12, 0.02, 0.12, x + (rng() - 0.5) * 4, 0.05, z + (rng() - 0.5) * 4, CHERRY[Math.floor(rng() * CHERRY.length)]);
    }
    b.addCollider(new THREE.Vector3(x, 1.2, z), new THREE.Vector3(0.25, 1.2, 0.25));
  }

  private bench(b: LevelBuilder, x: number, z: number, rng: Rng): void {
    const wood = rng() < 0.5 ? 0x8a5a2a : 0x6a4a2a;
    b.prop(0.5, 0.08, 1.9, x, 0.46, z, wood);
    b.prop(0.08, 0.5, 1.9, x + Math.sign(x) * 0.25, 0.75, z, wood);
    for (const dz of [-0.8, 0.8]) b.prop(0.45, 0.46, 0.08, x, 0.23, z + dz, 0x2a2a30);
    b.addCollider(new THREE.Vector3(x, 0.25, z), new THREE.Vector3(0.25, 0.25, 0.95));
  }

  private fountain(b: LevelBuilder): void {
    const cx = 0;
    const cz = -14;
    const r = 4;
    const seg = 2 * r * Math.tan(Math.PI / 8) + 0.1;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const rot = -a - Math.PI / 2;
      b.propGeo(new THREE.BoxGeometry(seg, 0.6, 0.5), b.matrix(x, 0.3, z, rot), 0x8a8a96);
      b.propGeo(new THREE.BoxGeometry(seg, 0.06, 0.56), b.matrix(x, 0.63, z, rot), 0xb8b8c8);
      b.addCollider(new THREE.Vector3(x, 0.3, z), new THREE.Vector3(seg / 2, 0.3, 0.25), rot);
    }
    // Colonne centrale, vasque et jets lumineux
    b.propGeo(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 8), b.matrix(cx, 1.3, cz), 0x9a9aa8);
    b.propGeo(new THREE.CylinderGeometry(1.1, 0.6, 0.3, 8), b.matrix(cx, 2.65, cz), 0xb8b8c8);
    b.addCollider(new THREE.Vector3(cx, 1.4, cz), new THREE.Vector3(0.6, 1.4, 0.6));
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        const d = 0.9 + t * 2;
        b.glow(0.09, 0.09, 0.09, cx + Math.cos(a) * d, 2.8 + Math.sin(t * Math.PI) * 0.7 - t * 2.2, cz + Math.sin(a) * d, 0x7fe8ff, 2);
      }
    }
    const water = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x2bd9ff).multiplyScalar(0.7 * LIGHTING.neon + 0.3),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    b.courseDisposables.push(water);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 3.85, 0.06, 8), water);
    disc.rotation.y = Math.PI / 8;
    disc.position.set(cx, 0.45, cz);
    b.course.add(disc);
    this.water = water;
    this.interact('fountain', 'fountain', 'LA FONTAINE', 'JETER UNE PIÈCE DANS', cx, 0, cz + r + 0.9, 2.2, '#7fd8ff');
  }

  // ---------------------------------------------------------------------------
  // Échoppes
  // ---------------------------------------------------------------------------

  /** Échoppe ouverte vers +X (f = 1) ou -X (f = -1), centrée en (x, z). */
  private stall(
    b: LevelBuilder,
    x: number,
    z: number,
    f: 1 | -1,
    sign: string,
    scheme: number,
    [base, counter, accent]: [number, number, number],
    kind: 'clinic' | 'atelier' | 'ramen' | 'arcade',
    rng: Rng,
  ): void {
    const ux = (u: number) => x + f * u;
    // Murs, toit, auvent rayé
    b.prop(0.2, 3, 4.2, ux(-1.7), 1.5, z, base);
    for (const s of [-1, 1]) b.prop(3, 3, 0.15, ux(-0.3), 1.5, z + s * 2.05, base);
    b.prop(3.4, 0.16, 4.5, ux(-0.2), 3.08, z, 0x1a1a22);
    for (let i = 0; i < 8; i++) {
      const col = i % 2 === 0 ? accent : 0xf2ece0;
      b.propGeo(new THREE.BoxGeometry(1, 0.06, 0.56), b.matrix(ux(1.85), 2.82, z - 1.96 + i * 0.56, 0, 0, -f * 0.38), col);
    }
    for (const s of [-1, 1]) {
      b.prop(0.12, 3, 0.12, ux(1.3), 1.5, z + s * 2.1, 0x2a2a30);
      b.glow(0.22, 0.32, 0.22, ux(2.25), 2.4, z + s * 2.05, accent, 2.4);
    }
    // Comptoir (ou borne d'arcade)
    if (kind === 'arcade') {
      this.arcadeCabinet(b, ux(0.4), z, f);
    } else {
      b.prop(0.7, 1.1, 3.8, ux(0.85), 0.55, z, counter);
      b.prop(0.8, 0.08, 3.9, ux(0.85), 1.14, z, 0x2a2a30);
      b.glow(0.04, 0.05, 3.8, ux(1.21), 1.0, z, accent, 2);
    }
    // Étagères garnies sur le mur du fond
    for (const y of [1.3, 1.9, 2.5]) {
      b.prop(0.35, 0.05, 3.6, ux(-1.5), y, z, 0x3a2a20);
      for (let v = -1.6; v <= 1.6; v += 0.32 + rng() * 0.2) {
        const h = 0.15 + rng() * 0.25;
        if (kind === 'clinic' && rng() < 0.6) b.glow(0.12, h, 0.12, ux(-1.5), y + h / 2 + 0.03, z + v, pick(rng, [0x2bffb0, 0x7fd8ff, 0xff7ad9]), 1.6);
        else b.prop(0.18, h, 0.16, ux(-1.5), y + h / 2 + 0.03, z + v, pick(rng, [0xd83a3a, 0x3a6ad8, 0xf2c83a, 0x4ab84a, 0xf2f2f2, 0xb86af2]));
      }
    }
    // Détails selon le marchand
    if (kind === 'clinic') {
      b.glow(0.06, 0.6, 0.18, ux(-1.58), 2.4, z + 1.4, 0x2bffb0, 2.4);
      b.glow(0.06, 0.18, 0.6, ux(-1.58), 2.4, z + 1.4, 0x2bffb0, 2.4);
      b.prop(0.9, 0.5, 1.7, ux(-0.6), 0.25, z - 1.2, 0xe8eef0);
      b.prop(0.9, 0.9, 0.2, ux(-0.6), 0.75, z - 2, 0xe8eef0);
    } else if (kind === 'atelier') {
      for (let i = 0; i < 4; i++) b.prop(0.04, 1.1, 0.08, ux(-1.58), 2.0, z - 1.5 + i * 0.35, 0xc8ccd8, 0, 0.3);
      b.prop(0.6, 0.8, 0.6, ux(0.85), 1.6, z - 1.3, 0x3a3a40);
      b.glow(0.2, 0.2, 0.2, ux(0.85), 2.05, z - 1.3, 0xff8a2b, 3);
    } else if (kind === 'ramen') {
      for (let i = 0; i < 4; i++) b.propGeo(new THREE.CylinderGeometry(0.16, 0.11, 0.12, 8), b.matrix(ux(0.85), 1.24, z - 1.4 + i * 0.9), 0xf2ece0);
      b.propGeo(new THREE.CylinderGeometry(0.4, 0.4, 0.55, 10), b.matrix(ux(-0.9), 1.4, z + 1.3), 0x9a9aa8);
      b.addSteamVent(new THREE.Vector3(ux(-0.9), 1.75, z + 1.3), 3);
      for (const s of [-1, 1]) {
        b.glow(0.4, 0.55, 0.4, ux(1.6), 2.2, z + s * 1.2, 0xff3b3b, 2.6);
        b.prop(0.42, 0.06, 0.42, ux(1.6), 2.5, z + s * 1.2, 0x1a1a1a);
      }
    }
    // Enseigne pixel au-dessus du toit
    const { texture, aspect } = createPixelSign(sign, SIGN_SCHEMES[scheme], false);
    const mat = b.signMaterial(texture, 1.7);
    mat.transparent = true;
    b.courseDisposables.push(mat, texture);
    const h = 0.95;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), mat);
    plane.position.set(ux(1.0), 3.7, z);
    plane.rotation.y = (f * Math.PI) / 2;
    b.course.add(plane);
    b.prop(0.1, 0.6, h * aspect + 0.2, ux(0.94), 3.7, z, 0x1a1a22);

    b.addCollider(new THREE.Vector3(ux(-0.3), 1.58, z), new THREE.Vector3(1.55, 1.58, 2.2));
  }

  private arcadeCabinet(b: LevelBuilder, x: number, z: number, f: 1 | -1): void {
    b.prop(0.9, 1.9, 1.1, x, 0.95, z, 0x2a1a3a);
    b.prop(0.9, 0.35, 1.15, x + f * 0.1, 2.05, z, 0x1a0a2a);
    b.glow(0.04, 0.25, 0.95, x + f * 0.56, 2.05, z, 0xff7ad9, 2.2);
    b.prop(0.5, 0.12, 1.0, x + f * 0.55, 1.05, z, 0x3a2a4a);
    b.glow(0.06, 0.06, 0.06, x + f * 0.62, 1.14, z - 0.2, 0xff3b3b, 3);
    b.glow(0.06, 0.06, 0.06, x + f * 0.62, 1.14, z + 0.1, 0x2bffb0, 3);
    b.glow(0.06, 0.06, 0.06, x + f * 0.62, 1.14, z + 0.3, 0x7fd8ff, 3);
    // Écran animé (mode démo)
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 24;
    const ctx = c.getContext('2d')!;
    const texture = pixelTexture(c, false);
    const mat = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1, 1, 1).multiplyScalar(1.4 * LIGHTING.signs) });
    b.courseDisposables.push(mat, texture);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.64), mat);
    screen.position.set(x + f * 0.46, 1.5, z);
    screen.rotation.y = (f * Math.PI) / 2;
    b.course.add(screen);
    this.arcade = { ctx, texture, timer: 0, frame: 0 };
    this.drawArcade(ctx, 0);
  }

  private drawArcade(ctx: CanvasRenderingContext2D, frame: number): void {
    ctx.fillStyle = '#05020c';
    ctx.fillRect(0, 0, 32, 24);
    // Étoiles qui défilent
    for (let i = 0; i < 14; i++) {
      const sx = (i * 37 + 64 - ((frame * (1 + (i % 3))) % 64)) % 32;
      ctx.fillStyle = i % 4 === 0 ? '#ff7ad9' : '#7fd8ff';
      ctx.fillRect(sx, (i * 7) % 24, 1, 1);
    }
    const phase = Math.floor(frame / 16) % 3;
    if (phase === 0) {
      drawPixelText(ctx, 'NEON', 8, 5, '#ff2bd6');
      drawPixelText(ctx, 'RUSH', 8, 13, '#00e5ff');
    } else if (phase === 1) {
      // Petit coureur qui saute des obstacles
      const jump = Math.max(0, Math.sin((frame % 16) / 16 * Math.PI)) * 6;
      ctx.fillStyle = '#9dff5c';
      ctx.fillRect(9, 15 - jump, 3, 4);
      ctx.fillStyle = '#ffd23b';
      const ox = 30 - ((frame * 2) % 34);
      ctx.fillRect(ox, 17, 2, 2);
      ctx.fillStyle = '#3a2a5a';
      ctx.fillRect(0, 19, 32, 1);
    } else {
      drawPixelText(ctx, 'INSERT', 4, 6, '#ffd23b');
      if (frame % 4 < 2) drawPixelText(ctx, 'COIN', 8, 14, '#ffffff');
    }
  }

  private oracle(b: LevelBuilder): void {
    const x = 6.3;
    const z = -24;
    b.prop(1.2, 2.3, 1.1, x, 1.15, z, 0x3a1a4a);
    b.prop(1.3, 0.2, 1.2, x, 2.4, z, 0xffd23b);
    b.glow(0.06, 0.9, 0.8, x - 0.62, 1.55, z, 0x7a3aff, 1.4);
    b.propGeo(new THREE.SphereGeometry(0.32, 10, 8), b.matrix(x - 0.45, 1.55, z), 0xd8b8ff);
    b.glow(0.06, 0.2, 0.5, x - 0.62, 0.7, z, 0xffd23b, 2);
    const { texture, aspect } = createPixelSign('ORACLE', SIGN_SCHEMES[4], false);
    const mat = b.signMaterial(texture, 1.7);
    mat.transparent = true;
    b.courseDisposables.push(mat, texture);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.5 * aspect, 0.5), mat);
    plane.position.set(x - 0.66, 2.75, z);
    plane.rotation.y = -Math.PI / 2;
    b.course.add(plane);
    b.addCollider(new THREE.Vector3(x, 1.2, z), new THREE.Vector3(0.6, 1.2, 0.55));
    this.interact('oracle', 'oracle', 'ORACLE-9000', 'CONSULTER', x - 1.4, 0, z, 2, '#b86af2', [
      'Un mur vert croisera ta route. Cours dessus.',
      'Celui qui glisse sous la barrière garde son élan… et sa dignité.',
      'Ton prochain record se cache à 0,3 seconde d\'hésitation près.',
      'Les chats néon aiment les hauteurs. Et les fontaines.',
      'Le tremplin mène à la muse. La muse mène aux crédits.',
      'Méfie-toi des lasers rouges : ils annoncent toujours la suite.',
      'Le Sandevistan ne ralentit pas le temps. Il te rend plus rapide que lui.',
      'Derrière la cuisine qui fume, quelqu\'un ronronne.',
    ]);
  }

  /** Coin du DJ : enceintes, guirlandes et un danseur. */
  private djCorner(b: LevelBuilder, rng: Rng): void {
    const x = -10;
    const z = -52;
    b.prop(2.4, 0.9, 1, x, 0.45, z - 1.4, 0x1a1a22);
    b.glow(2.2, 0.05, 0.05, x, 0.92, z - 0.9, 0xff2bd6, 2);
    for (const s of [-1, 1]) {
      b.prop(0.9, 1.6, 0.8, x + s * 2.2, 0.8, z - 1.4, 0x101014);
      b.propGeo(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), b.matrix(x + s * 2.2, 1.1, z - 0.98, 0, Math.PI / 2), 0x3a3a46);
      b.glow(0.5, 0.04, 0.04, x + s * 2.2, 0.35, z - 0.98, 0x00e5ff, 2.2);
      b.addCollider(new THREE.Vector3(x + s * 2.2, 0.8, z - 1.4), new THREE.Vector3(0.45, 0.8, 0.4));
    }
    b.addCollider(new THREE.Vector3(x, 0.45, z - 1.4), new THREE.Vector3(1.2, 0.45, 0.5));
    b.stringLights(x - 4, z - 2, x + 4, z - 2, 3.2, rng);
    b.stringLights(x - 4, z - 2, x - 4, z + 4, 3.0, rng);
    b.prop(0.1, 3.2, 0.1, x - 4, 1.6, z - 2, 0x2a2a30);
    b.prop(0.1, 3.2, 0.1, x + 4, 1.6, z - 2, 0x2a2a30);
    b.prop(0.1, 3.0, 0.1, x - 4, 1.5, z + 4, 0x2a2a30);
    const npc = this.npc(b, x, z, 0, { skin: SKIN[3], hair: 0x2bd9c5, top: 0x1a1a22, pants: 0x3a1a4a, accent: 0xff2bd6, extra: 'headphones' });
    npc.dance = true;
    b.addCollider(new THREE.Vector3(x, 0.9, z), new THREE.Vector3(0.35, 0.9, 0.35));
    this.interact('dj', 'npc', 'DJ BAO', 'PARLER À', x, 0, z, 2.6, '#ff2bd6', [
      'Ce beat ? 128 BPM, comme ton cœur sur un mur.',
      'Je mixe la pluie et les sirènes. Ça cartonne.',
      'Danse un peu, runner. Les toits peuvent attendre.',
      'Un jour je jouerai au sommet de la tour. En attendant, y a un chat là-haut à gauche.',
    ]);
  }

  /** Pile de caisses à escalader (un chat attend tout en haut). */
  private crates(b: LevelBuilder): void {
    const steps: [number, number, number, number][] = [
      [-15, -48, 2, 1],
      [-17.5, -50.5, 2, 2],
      [-20, -53, 2, 3],
      [-22.5, -55.5, 2.4, 4],
    ];
    for (const [x, z, s, h] of steps) {
      b.prop(s, h, s, x, h / 2, z, 0x8a5a2a);
      b.prop(s + 0.04, 0.08, s + 0.04, x, h - 0.04, z, 0x5a3a1a);
      b.prop(s + 0.04, h, 0.08, x, h / 2, z + s / 2, 0x6a4420);
      b.addCollider(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(s / 2, h / 2, s / 2));
    }
    // Benne près de l'arcade : marchepied vers son toit
    b.prop(2.4, 1.4, 1.4, 21.5, 0.7, -25, 0x2f6f4f);
    b.prop(2.5, 0.1, 1.5, 21.5, 1.42, -25, 0x1f4f3f);
    b.addCollider(new THREE.Vector3(21.5, 0.7, -25), new THREE.Vector3(1.2, 0.7, 0.7));
  }

  /** Tour panneau publicitaire atteinte par le tremplin, avec la statue secrète. */
  private tower(b: LevelBuilder): void {
    const x = 17;
    const z = -62;
    b.prop(7, 8, 8, x, 4, z, 0x24202e);
    b.glow(7.04, 0.08, 0.08, x, 8, z + 4, 0x9dff5c, 2);
    b.glow(0.08, 0.08, 8.04, x - 3.5, 8, z, 0x9dff5c, 2);
    const mat = b.signMaterial(b.billboard('kalliope', 64), 1.05);
    b.courseDisposables.push(mat);
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), mat);
    ad.position.set(x, 4.6, z + 4.02);
    b.course.add(ad);
    b.addCollider(new THREE.Vector3(x, 4, z), new THREE.Vector3(3.5, 4, 4));
    // Statue dorée de la muse
    const sx = x;
    const sz = z - 1;
    b.prop(1.3, 0.8, 1.3, sx, 8.4, sz, 0x6a5020);
    const gold = 0xffc83a;
    b.prop(0.7, 1.2, 0.5, sx, 9.4, sz, gold);
    b.prop(0.9, 0.5, 0.6, sx, 8.95, sz, 0xe8a820);
    b.prop(0.4, 0.42, 0.4, sx, 10.25, sz, gold);
    b.prop(0.18, 0.8, 0.18, sx - 0.45, 10.0, sz, gold);
    b.prop(0.18, 0.8, 0.18, sx + 0.45, 10.0, sz, gold);
    b.prop(0.6, 0.5, 0.08, sx, 10.55, sz + 0.1, 0xfff0a0);
    b.glow(0.8, 0.04, 0.04, sx, 10.85, sz, 0xffe070, 3);
    b.addCollider(new THREE.Vector3(sx, 9.4, sz), new THREE.Vector3(0.65, 1.4, 0.65));
    this.interact('statue', 'statue', 'LA MUSE KALLIOPE', 'CONTEMPLER', sx, 8, sz + 1.6, 2.6, '#ffd23b');
  }

  // ---------------------------------------------------------------------------
  // Personnages et chats
  // ---------------------------------------------------------------------------

  private npc(b: LevelBuilder, x: number, z: number, yaw: number, look: Look): Npc {
    const parts = [
      cbox(0.22, 0.8, 0.24, -0.13, 0.4, 0, look.pants),
      cbox(0.22, 0.8, 0.24, 0.13, 0.4, 0, look.pants),
      cbox(0.24, 0.1, 0.32, -0.13, 0.05, 0.04, 0x1a1a1a),
      cbox(0.24, 0.1, 0.32, 0.13, 0.05, 0.04, 0x1a1a1a),
      cbox(0.6, 0.75, 0.32, 0, 1.17, 0, look.top),
      cbox(0.62, 0.06, 0.34, 0, 1.36, 0, look.accent),
      cbox(0.17, 0.68, 0.2, -0.39, 1.16, 0, look.top),
      cbox(0.17, 0.68, 0.2, 0.39, 1.16, 0, look.top),
      cbox(0.15, 0.14, 0.17, -0.39, 0.76, 0, look.skin),
      cbox(0.15, 0.14, 0.17, 0.39, 0.76, 0, look.skin),
    ];
    if (look.apron !== undefined) parts.push(cbox(0.5, 0.75, 0.03, 0, 0.95, 0.17, look.apron));
    const root = new THREE.Group();
    const body = new THREE.Mesh(merged(parts), b.propMaterial);
    root.add(body);

    const headParts = [
      cbox(0.42, 0.44, 0.4, 0, 0.22, 0, look.skin),
      cbox(0.46, 0.14, 0.44, 0, 0.47, -0.01, look.hair),
      cbox(0.46, 0.32, 0.12, 0, 0.3, -0.18, look.hair),
      cbox(0.07, 0.06, 0.02, -0.09, 0.26, 0.205, 0x101018),
      cbox(0.07, 0.06, 0.02, 0.09, 0.26, 0.205, 0x101018),
      cbox(0.14, 0.03, 0.02, 0, 0.12, 0.205, 0x8a3a3a),
    ];
    switch (look.extra) {
      case 'visor':
        headParts.push(cbox(0.46, 0.1, 0.06, 0, 0.27, 0.21, look.accent));
        break;
      case 'goggles':
        headParts.push(cbox(0.46, 0.06, 0.44, 0, 0.36, 0, 0x2a2a30), cbox(0.12, 0.1, 0.05, -0.1, 0.38, 0.22, look.accent), cbox(0.12, 0.1, 0.05, 0.1, 0.38, 0.22, look.accent));
        break;
      case 'bandana':
        headParts.push(cbox(0.46, 0.1, 0.44, 0, 0.4, 0, look.accent));
        break;
      case 'headphones':
        headParts.push(cbox(0.08, 0.2, 0.2, -0.25, 0.25, 0, look.accent), cbox(0.08, 0.2, 0.2, 0.25, 0.25, 0, look.accent), cbox(0.5, 0.05, 0.08, 0, 0.52, 0, 0x2a2a30));
        break;
      case 'bun':
        headParts.push(cbox(0.2, 0.18, 0.2, 0, 0.6, -0.1, look.hair), cbox(0.16, 0.07, 0.02, -0.09, 0.27, 0.215, look.accent), cbox(0.16, 0.07, 0.02, 0.09, 0.27, 0.215, look.accent));
        break;
      case 'cap':
        headParts.push(cbox(0.46, 0.12, 0.46, 0, 0.5, 0, look.accent), cbox(0.4, 0.04, 0.22, 0, 0.45, 0.3, look.accent));
        break;
      default:
        break;
    }
    const head = new THREE.Mesh(merged(headParts), b.propMaterial);
    head.position.y = 1.56;
    root.add(head);
    const s = look.scale ?? 1;
    root.scale.setScalar(s);
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    holder.add(root);
    root.rotation.y = yaw;
    b.course.add(holder);
    const npc: Npc = { root, head, baseYaw: yaw, dance: false, phase: x * 1.7 + z };
    this.npcs.push(npc);
    return npc;
  }

  private cat(b: LevelBuilder, id: string, x: number, y: number, z: number, color: number, index: number): void {
    const texture = pixelTexture(catCanvas(color), false);
    const mat = new THREE.SpriteMaterial({ map: texture, color: new THREE.Color(1, 1, 1).multiplyScalar(1.5 * LIGHTING.signs + 0.3), transparent: true });
    b.courseDisposables.push(mat, texture);
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(0.9, 0.9, 1);
    b.course.add(sprite);
    this.cats.push({ id, sprite, base: new THREE.Vector3(x, y, z), collected: false, phase: index * 1.3 });
  }

  private interact(id: string, kind: InteractKind, name: string, verb: string, x: number, y: number, z: number, radius: number, color: string, lines?: readonly string[]): void {
    this.interactables.push({ id, kind, name, verb, position: new THREE.Vector3(x, y, z), radius, color, lines });
  }
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Petit chat assis en pixel art (12 × 12), couleur néon. */
function catCanvas(color: number): HTMLCanvasElement {
  const art = [
    'X.........X.',
    'XX.......XX.',
    'XXXXXXXXXXX.',
    'XOOXXXXXOOX.',
    'XXXXXNXXXXX.',
    '.XXXXXXXXX..',
    '..XXXXXXX...',
    '.XXXXXXXXX..',
    'XXXXXXXXXXX.',
    'XXXXXXXXXXXT',
    'XXXXXXXXXXXT',
    '.XXXX.XXXXTT',
  ];
  const c = document.createElement('canvas');
  c.width = 14;
  c.height = 14;
  const ctx = c.getContext('2d')!;
  const main = `#${new THREE.Color(color).getHexString()}`;
  const dark = `#${new THREE.Color(color).multiplyScalar(0.45).getHexString()}`;
  art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'O' ? '#ffffff' : ch === 'N' ? '#ff9ac8' : ch === 'T' ? dark : main;
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  });
  return c;
}
