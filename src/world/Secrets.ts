import * as THREE from 'three';
import type { LevelBuilder } from './LevelBuilder';
import type { SecretDef } from './levels';
import { createPixelSign, drawPixelText, pixelTexture, SIGN_SCHEMES } from './PixelTextures';
import { LIGHTING } from '../config';

/**
 * Easter eggs des niveaux : chaque secret a un petit décor dédié (platine,
 * tag, balise « 24 », cabine, jardin, grue de papier, château d'eau), une
 * zone de découverte par proximité et/ou une sphère à abattre au pistolet.
 */
export interface SecretRuntime {
  readonly def: SecretDef;
  /** Centre de la zone de touche / de proximité (monde). */
  readonly center: THREE.Vector3;
  found: boolean;
  /** Animation propre (disque qui tourne, balise qui clignote…). */
  update(dt: number, time: number): void;
  /** Réaction visuelle à la découverte. */
  reveal(): void;
}

const tmp = new THREE.Vector3();

function rotateXZ(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

export function buildSecret(b: LevelBuilder, def: SecretDef, found: boolean): SecretRuntime {
  const [px, py, pz] = def.pos;
  const yaw = def.yaw ?? 0;
  const h = def.hit ?? [0, 1, 0];
  const center = new THREE.Vector3(px + h[0], py + h[1], pz + h[2]);
  b.reserve(px, pz, 4);
  if (def.approach) b.reserve(def.approach[0], def.approach[1], 3);
  // Devant la face principale : passage dégagé
  const [fx, fz] = rotateXZ(0, 2.2, yaw);
  b.reserve(px + fx, pz + fz, 2.6);
  /** Position locale (x vers la droite de la face, z vers l'avant) → monde. */
  const at = (x: number, y: number, z: number): [number, number, number] => {
    const [rx, rz] = rotateXZ(x, z, yaw);
    return [px + rx, py + y, pz + rz];
  };
  const prop = (w: number, hh: number, d: number, x: number, y: number, z: number, hex: number, extraYaw = 0) => {
    const [wx, wy, wz] = at(x, y, z);
    b.prop(w, hh, d, wx, wy, wz, hex, yaw + extraYaw);
  };
  const glow = (w: number, hh: number, d: number, x: number, y: number, z: number, hex: number, k = 2.5) => {
    const [wx, wy, wz] = at(x, y, z);
    b.glow(w, hh, d, wx, wy, wz, hex, k);
  };
  const collider = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
    const [wx, wy, wz] = at(x, y, z);
    b.addCollider(new THREE.Vector3(wx, wy, wz), new THREE.Vector3(hx, hy, hz), yaw);
  };
  const basic = (hex: number, k: number) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });
    b.courseDisposables.push(m);
    return m;
  };

  let update: (dt: number, time: number) => void = () => {};
  let reveal: () => void = () => {};

  switch (def.kind) {
    case 'vinyl': {
      // Tapis, table basse, platine, caisses de disques, lampe chaude
      prop(2.6, 0.03, 1.8, 0, 0.015, 0, 0x7a2a3a);
      prop(1.3, 0.62, 0.75, 0, 0.31, 0, 0x6a4423);
      prop(0.7, 0.1, 0.55, 0, 0.67, 0, 0x3a2414);
      prop(0.06, 0.04, 0.32, 0.22, 0.75, -0.05, 0xb8c2d8, 0.4);
      for (let i = 0; i < 2; i++) prop(0.5, 0.42, 0.5, -0.95 + i * 0.05, 0.21 + i * 0.42, 0.35, i ? 0x8a5a2a : 0x7a4a22);
      for (let i = 0; i < 6; i++) prop(0.03, 0.34, 0.32, -1.12 + i * 0.07, 0.6 + 0.42 * 0 + 0.24, 0.35, [0xd83a3a, 0x3a6ad8, 0xf2c83a, 0x2bffb0, 0xff7ad9, 0xf2f2f2][i]);
      prop(0.08, 1.4, 0.08, 1.0, 0.7, 0.4, 0x2a2a30);
      glow(0.34, 0.26, 0.34, 1.0, 1.45, 0.4, 0xffa040, 2.6);
      const [lx, ly, lz] = at(1.0, 1.9, 0.4);
      b.addNeonLight(new THREE.Vector3(lx, ly, lz), 0xffa040, 9, 9);
      collider(0, 0.36, 0, 0.65, 0.36, 0.38);
      // Disque qui tourne
      const disc = new THREE.Group();
      const vinylMat = basic(0x0a0a0e, 1);
      const labelMat = basic(0xff7a30, 2.2 * LIGHTING.signs);
      const record = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.012, 20), vinylMat);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.014, 12), labelMat);
      disc.add(record, label);
      const [dx, dy, dz] = at(-0.05, 0.73, 0);
      disc.position.set(dx, dy, dz);
      b.course.add(disc);
      update = (dt) => {
        disc.rotation.y += dt * 3.5;
      };
      break;
    }
    case 'tag': {
      // Bloc technique (4 m de large, 1,6 m d'épaisseur) ; le tag est peint sur sa face « côté vide »
      prop(4, 2.8, 1.6, 0, 1.4, 0, 0x6a6a72);
      prop(4.1, 0.12, 1.7, 0, 2.86, 0, 0x4a4a52);
      for (let i = 0; i < 3; i++) prop(0.7, 0.5, 0.3, -1.2 + i * 1.2, 3.15, -0.3, 0x3a3a40);
      collider(0, 1.4, 0, 2, 1.4, 0.8);
      const texture = pixelTexture(tagCanvas(), false);
      const mat = b.signMaterial(texture, 1.25);
      mat.transparent = true;
      b.courseDisposables.push(mat, texture);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), mat);
      const [tx, ty, tz] = at(0, 1.4, 0.82);
      plane.position.set(tx, ty, tz);
      plane.rotation.y = yaw;
      b.course.add(plane);
      break;
    }
    case 'beacon24': {
      prop(0.18, 2.2, 0.18, 0, 1.1, 0, 0x2a2a30);
      prop(1, 0.12, 1, 0, 0.06, 0, 0x3a3a40);
      const { texture } = createPixelSign('24', SIGN_SCHEMES[0], false);
      const mat = new THREE.SpriteMaterial({ map: texture, color: new THREE.Color(1, 0.35, 0.35).multiplyScalar(2 * LIGHTING.signs), transparent: true });
      b.courseDisposables.push(mat, texture);
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(px, py + 2.6, pz);
      sprite.scale.set(1.6, 1.1, 1);
      b.course.add(sprite);
      const lamp = basic(0xff3b3b, 3 * LIGHTING.neon);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), lamp);
      head.position.set(px, py + 1.95, pz);
      b.course.add(head);
      const color = new THREE.Color();
      let solved = found;
      update = (_dt, t) => {
        const k = solved ? 1 : Math.sin(t * 6) > 0 ? 1 : 0.25;
        color.set(solved ? 0x2bffb0 : 0xff3b3b).multiplyScalar(3 * LIGHTING.neon * k);
        lamp.color.copy(color);
        mat.color.set(solved ? 0x9dffcf : 0xff8080).multiplyScalar((1.2 + k) * LIGHTING.signs);
      };
      reveal = () => {
        solved = true;
      };
      break;
    }
    case 'payphone': {
      // Cabine : cadre bleu nuit, vitres, combiné, enseigne « TEL »
      const frame = 0x1a2a5a;
      for (const sx of [-0.55, 0.55]) {
        prop(0.08, 2.3, 0.08, sx, 1.15, 0.45, frame);
        prop(0.08, 2.3, 0.08, sx, 1.15, -0.45, frame);
        glow(0.02, 1.6, 0.8, sx, 1.2, 0, 0x7fd8ff, 0.35);
      }
      prop(1.2, 0.12, 1.0, 0, 2.36, 0, frame);
      prop(1.1, 2.3, 0.06, 0, 1.15, -0.48, 0x23305a);
      prop(0.45, 0.6, 0.15, 0, 1.35, -0.38, 0x8a8a96);
      prop(0.08, 0.32, 0.1, -0.16, 1.4, -0.28, 0x1a1a1a);
      collider(0, 1.15, -0.25, 0.6, 1.15, 0.3);
      const { texture, aspect } = createPixelSign('TEL', SIGN_SCHEMES[6], false);
      const mat = b.signMaterial(texture, 1.6);
      mat.transparent = true;
      b.courseDisposables.push(mat, texture);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.4 * aspect, 0.4), mat);
      const [sx, sy, sz] = at(0, 2.62, 0.4);
      sign.position.set(sx, sy, sz);
      sign.rotation.y = yaw;
      b.course.add(sign);
      // Voyant d'appel qui clignote tant que personne n'a décroché
      const ringMat = basic(0xffd23b, 3 * LIGHTING.neon);
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), ringMat);
      const [rx, ry, rz] = at(0.15, 1.6, -0.3);
      ring.position.set(rx, ry, rz);
      b.course.add(ring);
      let ringing = !found;
      update = (_dt, t) => {
        ring.visible = ringing ? Math.sin(t * 14) > -0.2 && Math.sin(t * 1.6) > 0 : false;
      };
      reveal = () => {
        ringing = false;
      };
      break;
    }
    case 'garden': {
      // Îlot de calme : pelouse, pierres, bassin, bonsaï, lanterne, lucioles
      for (let x = -3; x < 3; x += 1.5) {
        for (let z = -4.5; z < 4.5; z += 1.5) prop(1.5, 0.05, 1.5, x + 0.75, 0.025, z + 0.75, [0x3f8f3f, 0x5faf4f, 0x4f9f6f][Math.abs(Math.round(x * 3 + z)) % 3]);
      }
      prop(2.2, 0.08, 1.6, -1.2, 0.06, 1.8, 0x5a5a64);
      glow(2.0, 0.05, 1.4, -1.2, 0.11, 1.8, 0x2bd9ff, 0.8);
      for (const [x, z, s] of [[0.6, 2.4, 0.5], [1.2, 1.4, 0.35], [-2.6, 0.4, 0.45], [2.2, -2.8, 0.6]] as const) prop(s, s * 0.6, s, x, s * 0.3, z, 0x8a8a96);
      // Bonsaï
      prop(0.9, 0.35, 0.6, 1.2, 0.18, -1.2, 0x6a3a24);
      prop(0.12, 0.7, 0.12, 1.2, 0.7, -1.2, 0x5a3a24);
      prop(0.1, 0.5, 0.1, 1.35, 0.95, -1.2, 0x5a3a24, 0);
      for (const [x, y, z, s] of [[1.0, 1.15, -1.2, 0.5], [1.5, 1.25, -1.1, 0.45], [1.25, 1.45, -1.35, 0.4], [0.85, 1.35, -1.0, 0.3]] as const) {
        prop(s, s * 0.55, s, x, y, z, 0x2f7f3f);
      }
      // Lanterne de pierre
      prop(0.4, 0.8, 0.4, -2.4, 0.4, -2.6, 0x8a8a96);
      prop(0.6, 0.1, 0.6, -2.4, 1.15, -2.6, 0x6a6a72);
      glow(0.28, 0.25, 0.28, -2.4, 0.95, -2.6, 0xffd08a, 2.2);
      prop(1.6, 0.08, 0.45, 2.4, 0.45, 2.6, 0x6a4423);
      collider(1.2, 0.2, -1.2, 0.45, 0.2, 0.3);
      // Lucioles
      const flyMat = basic(0xd8ff7a, 3 * LIGHTING.effects);
      const flies: { m: THREE.Mesh; base: THREE.Vector3; ph: number }[] = [];
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), flyMat);
        const base = new THREE.Vector3(px + Math.sin(i * 2.4) * 2.6, py + 0.6 + (i % 4) * 0.45, pz + Math.cos(i * 1.7) * 3.4);
        m.position.copy(base);
        b.course.add(m);
        flies.push({ m, base, ph: i * 1.3 });
      }
      update = (_dt, t) => {
        for (const f of flies) {
          f.m.position.set(f.base.x + Math.sin(t * 0.7 + f.ph) * 0.4, f.base.y + Math.sin(t * 1.3 + f.ph * 2) * 0.25, f.base.z + Math.cos(t * 0.5 + f.ph) * 0.4);
          f.m.visible = Math.sin(t * 2 + f.ph * 3) > -0.4;
        }
      };
      break;
    }
    case 'crane': {
      // Antenne relais avec une grue de papier perchée tout en haut
      prop(0.14, 7, 0.14, 0, 3.5, 0, 0x3a3a46);
      for (let i = 1; i < 6; i++) prop(0.9 - i * 0.12, 0.05, 0.05, 0, i * 1.2, 0, 0x4a4a56);
      prop(0.9, 0.3, 0.9, 0, 0.15, 0, 0x2a2a30);
      collider(0, 3.5, 0, 0.12, 3.5, 0.12);
      const tip = basic(0xff3b3b, 3 * LIGHTING.neon);
      const tipMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), tip);
      tipMesh.position.set(px, py + 7.05, pz);
      b.course.add(tipMesh);
      const crane = new THREE.Group();
      const paper = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.9, emissive: 0x6a6660, emissiveIntensity: 0.6 });
      b.courseDisposables.push(paper);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.42), paper);
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.2), paper);
      const wingR = wingL.clone();
      wingL.position.set(-0.22, 0.05, 0);
      wingR.position.set(0.22, 0.05, 0);
      wingL.rotation.z = 0.4;
      wingR.rotation.z = -0.4;
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), paper);
      neck.position.set(0, 0.12, -0.2);
      neck.rotation.x = 0.5;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), paper);
      tail.position.set(0, 0.1, 0.2);
      tail.rotation.x = -0.5;
      crane.add(body, wingL, wingR, neck, tail);
      crane.position.set(px, py + 7.4, pz);
      b.course.add(crane);
      let fall = found ? 1 : -1;
      if (found) crane.position.set(px + 1.6, py + 0.08, pz + 1.2);
      update = (dt, t) => {
        tip.color.set(0xff3b3b).multiplyScalar((Math.sin(t * 3) > 0 ? 3 : 0.6) * LIGHTING.neon);
        if (fall < 0) {
          crane.rotation.y = Math.sin(t * 0.6) * 0.5;
          return;
        }
        if (fall < 1) {
          // Descente en spirale jusqu'au toit
          fall = Math.min(1, fall + dt / 3.2);
          const a = fall * Math.PI * 3;
          crane.position.set(px + Math.sin(a) * 1.6 * fall, py + 7.4 - fall * 7.3, pz + Math.cos(a) * 1.2 * fall);
          crane.rotation.y = a + Math.PI / 2;
          wingL.rotation.z = 0.4 + Math.sin(t * 9) * 0.35;
          wingR.rotation.z = -wingL.rotation.z;
        }
      };
      reveal = () => {
        if (fall < 0) fall = 0;
      };
      break;
    }
    case 'watertower': {
      // Château d'eau sur pieds, échelle, prénom gravé
      for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]] as const) prop(0.14, 2.4, 0.14, x, 1.2, z, 0x4a3a30);
      prop(2.6, 0.12, 2.6, 0, 2.4, 0, 0x5a4a3a);
      const [cx, cy, cz] = at(0, 3.55, 0);
      b.propGeo(new THREE.CylinderGeometry(1.45, 1.45, 2.2, 12), b.matrix(cx, cy, cz), 0x8a5a3a);
      b.propGeo(new THREE.ConeGeometry(1.55, 0.9, 12), b.matrix(cx, cy + 1.55, cz), 0x6a4430);
      for (let i = 0; i < 8; i++) prop(0.05, 0.05, 0.4, 1.3, 0.4 + i * 0.3, 1.2, 0x3a3a3a);
      collider(0, 1.2, 0, 1.3, 1.2, 1.3);
      collider(0, 3.55, 0, 1.4, 1.1, 1.4);
      const texture = pixelTexture(carvingCanvas(), false);
      const mat = b.signMaterial(texture, 0.9);
      mat.transparent = true;
      b.courseDisposables.push(mat, texture);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1), mat);
      const [tx, ty, tz] = at(0, 3.5, 1.47);
      plane.position.set(tx, ty, tz);
      plane.rotation.y = yaw;
      b.course.add(plane);
      break;
    }
  }

  const runtime: SecretRuntime = {
    def,
    center,
    found,
    update,
    reveal: () => reveal(),
  };
  return runtime;
}

/** Distance du rayon (origine, direction unitaire) au centre d'une sphère, ou null s'il la manque. */
export function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
  tmp.subVectors(center, origin);
  const along = tmp.dot(dir);
  if (along < 0) return null;
  const d2 = tmp.lengthSq() - along * along;
  return d2 <= radius * radius ? along : null;
}

/** Tag de runner : flèche vers le ciel, éclair, devise et signature « S ». */
function tagCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 68;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // Contour noir puis remplissage néon (flèche)
  const arrow = (dx: number, dy: number, col: string) => {
    px(14 + dx, 10 + dy, 6, 24, col);
    for (let i = 0; i < 9; i++) px(17 - i + dx, 2 + i + dy, i * 2 + 1, 1, col);
  };
  arrow(-1, 1, '#1a0a1a');
  arrow(0, 0, '#ff2bd6');
  px(15, 12, 2, 18, '#ffb8f0');
  // Éclair
  const bolt = [
    [30, 6, 6, 2], [28, 8, 6, 2], [26, 10, 6, 2], [24, 12, 12, 2], [30, 14, 6, 2], [28, 16, 6, 2], [26, 18, 6, 2],
  ];
  for (const [x, y, w, h] of bolt) px(x + 1, y + 1, w, h, '#1a1a0a');
  for (const [x, y, w, h] of bolt) px(x, y, w, h, '#ffd23b');
  // Signature « S » en gros traits
  const S = [
    [44, 6, 12, 3], [44, 6, 3, 10], [44, 14, 12, 3], [53, 14, 3, 10], [44, 22, 12, 3],
  ];
  for (const [x, y, w, h] of S) px(x + 1, y + 1, w, h, '#0a1a1a');
  for (const [x, y, w, h] of S) px(x, y, w, h, '#00e5ff');
  drawPixelText(ctx, 'TOUJOURS EN HAUT', 2, 38, '#fff1d6');
  // Coulures de peinture
  for (const [x, len, col] of [[16, 6, '#ff2bd6'], [46, 5, '#00e5ff'], [54, 8, '#00e5ff'], [30, 4, '#ffd23b']] as const) px(x, 34, 1, len, col);
  return c;
}

/** Gravure sur le château d'eau : « SACHA », « ET TOI » et des traits de comptage. */
function carvingCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 44;
  c.height = 28;
  const ctx = c.getContext('2d')!;
  drawPixelText(ctx, 'SACHA', 12, 2, '#3a2216');
  drawPixelText(ctx, 'SACHA', 11, 1, '#f2d8b8');
  drawPixelText(ctx, 'ET TOI', 10, 10, '#f2d8b8');
  ctx.fillStyle = '#f2d8b8';
  for (let i = 0; i < 17; i++) {
    const x = 3 + i * 2 + Math.floor(i / 5) * 2;
    if (i % 5 === 4) ctx.fillRect(x - 8, 21, 9, 1);
    else ctx.fillRect(x, 18, 1, 6);
  }
  return c;
}
