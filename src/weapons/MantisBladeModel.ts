import * as THREE from 'three';
import { bakeGroup } from '../core/GeometryUtils';
import { LIGHTING } from '../config';

/**
 * Pose complète d'un bras : transformation du bras dans l'espace caméra +
 * angles de l'articulation de la lame (fémur sur l'avant-bras, genou).
 */
export interface ArmPose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  /** Inclinaison du « fémur » au-dessus de l'avant-bras (rad, + = vers le haut). */
  femur: number;
  /** Angle du « genou » (rad, 0 = lame dépliée dans l'axe, négatif = repliée vers le bas). */
  knee: number;
}

export function armPose(x: number, y: number, z: number, rx: number, ry: number, rz: number, femur: number, knee: number): ArmPose {
  return {
    p: new THREE.Vector3(x, y, z),
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    femur,
    knee,
  };
}

export function mirrorArmPose(src: ArmPose): ArmPose {
  const e = new THREE.Euler().setFromQuaternion(src.q, 'YXZ');
  return armPose(-src.p.x, src.p.y, src.p.z, e.x, -e.y, -e.z, src.femur, src.knee);
}

export function lerpArmPose(a: ArmPose, b: ArmPose, k: number, out: ArmPose): ArmPose {
  out.p.lerpVectors(a.p, b.p, k);
  out.q.slerpQuaternions(a.q, b.q, k);
  out.femur = a.femur + (b.femur - a.femur) * k;
  out.knee = a.knee + (b.knee - a.knee) * k;
  return out;
}

export function createArmPose(): ArmPose {
  return { p: new THREE.Vector3(), q: new THREE.Quaternion(), femur: 0, knee: 0 };
}

/** Matériaux partagés par les deux bras. */
interface SharedMaterials {
  armor: THREE.MeshStandardMaterial;
  armorLight: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
}

let shared: SharedMaterials | null = null;

function sharedMaterials(): SharedMaterials {
  if (!shared) {
    shared = {
      armor: new THREE.MeshStandardMaterial({ color: 0x1b1e28, metalness: 0.88, roughness: 0.3 }),
      armorLight: new THREE.MeshStandardMaterial({ color: 0x3a3f4e, metalness: 0.9, roughness: 0.22 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x08090d, metalness: 0.4, roughness: 0.6 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x0c0d12, metalness: 0.15, roughness: 0.75 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xb8c2d8, metalness: 1, roughness: 0.12 }),
    };
  }
  return shared;
}

/** Longueurs des segments de la patte (m, espace caméra). */
const FEMUR_LENGTH = 0.46;
/** Étirement du tibia-lame (profil dessiné pour 0,36 m). */
const TIBIA_STRETCH = 1.22;
const TIBIA_LENGTH = 0.36 * TIBIA_STRETCH;
/** Pivot du fémur sur le dessus de l'avant-bras, côté coude. */
const FEMUR_PIVOT = new THREE.Vector3(0, 0.072, 0.17);
/** Points d'ancrage du vérin hydraulique (avant-bras / fémur). */
const PISTON_ARM_ANCHOR = new THREE.Vector3(0.026, 0.052, 0.02);
const PISTON_FEMUR_ANCHOR = new THREE.Vector3(0.026, -0.012, -0.26);

/**
 * Profil latéral extrudé : `u` = position le long du segment (vers l'avant),
 * `v` = hauteur. Renvoie une géométrie orientée segment → -Z, hauteur → +Y,
 * épaisseur → X (centrée).
 */
function extrudeProfile(shape: THREE.Shape, thickness: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** Fémur : poutre effilée dont le dessous porte une rangée d'épines alternées. */
function femurShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.03);
  s.quadraticCurveTo(0.2, 0.046, 0.43, 0.02);
  s.quadraticCurveTo(0.475, 0.006, 0.45, -0.02);
  const teeth = 7;
  for (let i = 0; i < teeth; i++) {
    const u = 0.41 - i * 0.052;
    const long = i % 2 === 0;
    s.lineTo(u, -0.021);
    s.lineTo(u - 0.014, long ? -0.064 : -0.043);
    s.lineTo(u - 0.026, -0.023);
  }
  s.lineTo(0.03, -0.03);
  s.quadraticCurveTo(0, -0.032, -0.006, 0.0);
  s.lineTo(0, 0.03);
  return s;
}

/** Tibia-lame : tranchant intérieur dentelé et griffe recourbée en crochet. */
function tibiaShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.024);
  s.quadraticCurveTo(0.17, 0.034, 0.3, 0.014);
  // Griffe terminale
  s.quadraticCurveTo(0.378, -0.002, 0.352, -0.066);
  s.quadraticCurveTo(0.338, -0.024, 0.3, -0.018);
  // Épines du tranchant, inclinées vers la griffe
  const teeth = 6;
  for (let i = 0; i < teeth; i++) {
    const u = 0.275 - i * 0.043;
    s.lineTo(u, -0.016);
    s.lineTo(u + 0.013, i % 2 === 0 ? -0.036 : -0.029);
    s.lineTo(u - 0.017, -0.017);
  }
  s.lineTo(0.015, -0.02);
  s.quadraticCurveTo(-0.012, -0.012, 0, 0.024);
  return s;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function axleX(radius: number, length: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(radius, radius, length, 16), mat, x, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}

function ringX(radius: number, tube: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = mesh(new THREE.TorusGeometry(radius, tube, 6, 24), mat, x, y, z);
  m.rotation.y = Math.PI / 2;
  return m;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Bras cybernétique portant une Mantis Blade en forme de patte ravisseuse de mante
 * religieuse : un « fémur » mécanique articulé sur le dessus de l'avant-bras (vérin
 * hydraulique, plaques d'armure, épines), un genou à moyeu lumineux et un « tibia »
 * dentelé terminé par une griffe. Le genou se déplie pendant la frappe.
 */
export class MantisArm {
  readonly group = new THREE.Group();
  readonly side: 1 | -1;
  /** Pointe de la griffe et milieu du tranchant (traînée lumineuse). */
  readonly tip = new THREE.Object3D();
  readonly edgeMid = new THREE.Object3D();

  private readonly inner = new THREE.Group();
  private readonly femurPivot = new THREE.Group();
  private readonly kneePivot = new THREE.Group();
  private readonly pistonBarrel: THREE.Mesh;
  private readonly pistonRod: THREE.Mesh;
  private readonly bladeMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly glowColor: THREE.Color;
  private readonly glowSoft: THREE.MeshBasicMaterial;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(side: 1 | -1, color: THREE.Color) {
    this.side = side;
    const m = sharedMaterials();
    this.glowColor = color.clone();
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(4 * LIGHTING.weaponGlow), toneMapped: false });
    const glowSoft = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.8 * LIGHTING.weaponGlow), toneMapped: false });
    this.glowSoft = glowSoft;
    this.bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0f15,
      metalness: 0.95,
      roughness: 0.2,
      emissive: color,
      emissiveIntensity: 0.25 * LIGHTING.weaponGlow,
    });

    this.inner.scale.x = side;
    this.group.add(this.inner);

    this.buildForearm(m, glowSoft);
    this.buildTibia(m);
    this.buildFemur(m, glowSoft);

    // Vérin hydraulique (animé, non fusionné)
    this.pistonBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 1, 10), m.dark);
    this.pistonRod = new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0048, 1, 8), m.chrome);
    this.inner.add(this.pistonBarrel, this.pistonRod);

    bakeGroup(this.inner, [this.femurPivot, this.pistonBarrel, this.pistonRod]);
  }

  /** Applique une pose complète (bras + articulations + vérin). */
  apply(pose: ArmPose): void {
    this.group.position.copy(pose.p);
    this.group.quaternion.copy(pose.q);
    this.femurPivot.rotation.x = pose.femur;
    this.kneePivot.rotation.x = pose.knee;
    this.updatePiston();
  }

  /** Change la couleur néon de la lame (encres cosmétiques). */
  setColor(color: THREE.Color): void {
    this.glowColor.copy(color);
    this.glowSoft.color.copy(color).multiplyScalar(1.8 * LIGHTING.weaponGlow);
    this.bladeMaterial.emissive.copy(color);
  }

  /** Pulsation lumineuse (0..1). */
  setPulse(k: number): void {
    const g = LIGHTING.weaponGlow;
    this.bladeMaterial.emissiveIntensity = (0.18 + k * 0.22) * g;
    this.glowMaterial.color.copy(this.glowColor).multiplyScalar((3.2 + k * 1.6) * g);
  }

  private updatePiston(): void {
    this.femurPivot.updateMatrix();
    const a = this.tmpA.copy(PISTON_ARM_ANCHOR);
    const b = this.tmpB.copy(PISTON_FEMUR_ANCHOR).applyMatrix4(this.femurPivot.matrix);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.divideScalar(len);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    // Corps du vérin (côté avant-bras) et tige chromée (côté fémur)
    const barrelLen = len * 0.58;
    this.pistonBarrel.position.copy(a).addScaledVector(dir, barrelLen / 2);
    this.pistonBarrel.quaternion.copy(q);
    this.pistonBarrel.scale.set(1, barrelLen, 1);
    this.pistonRod.position.copy(a).addScaledVector(dir, len * 0.5 + barrelLen * 0.25);
    this.pistonRod.quaternion.copy(q);
    this.pistonRod.scale.set(1, len - barrelLen * 0.5, 1);
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private buildForearm(m: SharedMaterials, glowSoft: THREE.Material): void {
    const g = this.inner;
    // Manchon principal + faisceau de câbles dessous
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.07, 0.4), m.armor, 0, 0, 0.04));
    g.add(mesh(new THREE.BoxGeometry(0.058, 0.03, 0.34), m.dark, 0, -0.044, 0.05));
    // Plaques latérales segmentées + jointures lumineuses
    for (let i = 0; i < 3; i++) {
      g.add(mesh(new THREE.BoxGeometry(0.012, 0.056, 0.098), m.armorLight, 0.046, 0.002, 0.17 - i * 0.11));
      if (i < 2) g.add(mesh(new THREE.BoxGeometry(0.004, 0.044, 0.008), glowSoft, 0.05, 0.002, 0.115 - i * 0.11));
    }
    // Rail de déploiement sur le dessus, avec fente lumineuse
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.022, 0.3), m.dark, 0, 0.046, 0.04));
    g.add(mesh(new THREE.BoxGeometry(0.008, 0.004, 0.26), this.glowMaterial, 0, 0.0585, 0.03));
    // Logement du pivot (côté coude) : flasques + axe + anneau lumineux
    for (const x of [-0.03, 0.03]) {
      g.add(mesh(new THREE.BoxGeometry(0.01, 0.06, 0.07), m.armorLight, x, 0.055, FEMUR_PIVOT.z));
    }
    g.add(axleX(0.022, 0.072, m.armor, 0, FEMUR_PIVOT.y, FEMUR_PIVOT.z));
    g.add(ringX(0.02, 0.004, this.glowMaterial, 0.037, FEMUR_PIVOT.y, FEMUR_PIVOT.z));
    // Ancrage du vérin
    g.add(mesh(new THREE.BoxGeometry(0.016, 0.02, 0.03), m.armorLight, PISTON_ARM_ANCHOR.x, PISTON_ARM_ANCHOR.y - 0.006, PISTON_ARM_ANCHOR.z));
    // Poignet + poing ganté
    const wrist = mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.045, 16), m.dark, 0, -0.004, -0.17);
    wrist.rotation.x = Math.PI / 2;
    g.add(wrist);
    const wristRing = mesh(new THREE.TorusGeometry(0.044, 0.003, 6, 24), glowSoft, 0, -0.004, -0.15);
    g.add(wristRing);
    g.add(mesh(new THREE.BoxGeometry(0.084, 0.088, 0.092), m.glove, 0, -0.01, -0.235));
    g.add(mesh(new THREE.BoxGeometry(0.086, 0.026, 0.03), m.armorLight, 0, 0.03, -0.275));
    g.add(mesh(new THREE.BoxGeometry(0.024, 0.03, 0.06), m.glove, -0.046, -0.012, -0.225));
  }

  private buildFemur(m: SharedMaterials, glowSoft: THREE.Material): void {
    const f = this.femurPivot;
    f.position.copy(FEMUR_PIVOT);
    this.inner.add(f);

    f.add(mesh(extrudeProfile(femurShape(), 0.024, 0.002), m.armor));
    // Plaques d'armure dorsales + interstices lumineux
    for (let i = 0; i < 3; i++) {
      const plate = mesh(new THREE.BoxGeometry(0.036, 0.012, 0.108), m.armorLight, 0, 0.044 - i * 0.004, -0.07 - i * 0.12);
      plate.rotation.x = -0.05;
      f.add(plate);
      if (i < 2) f.add(mesh(new THREE.BoxGeometry(0.03, 0.004, 0.008), this.glowMaterial, 0, 0.046 - i * 0.004, -0.13 - i * 0.12));
    }
    // Ligne lumineuse le long des épines (des deux côtés)
    for (const x of [-0.0135, 0.0135]) {
      f.add(mesh(new THREE.BoxGeometry(0.002, 0.004, 0.36), glowSoft, x, -0.016, -0.24));
    }
    // Ancrage du vérin sous le fémur
    f.add(mesh(new THREE.BoxGeometry(0.014, 0.024, 0.028), m.armorLight, PISTON_FEMUR_ANCHOR.x - 0.006, PISTON_FEMUR_ANCHOR.y + 0.004, PISTON_FEMUR_ANCHOR.z));
    // Genou : moyeu, flasques et anneaux lumineux
    f.add(axleX(0.03, 0.052, m.armor, 0, 0, -FEMUR_LENGTH));
    f.add(axleX(0.016, 0.06, m.chrome, 0, 0, -FEMUR_LENGTH));
    for (const x of [-0.027, 0.027]) f.add(ringX(0.024, 0.0045, this.glowMaterial, x, 0, -FEMUR_LENGTH));

    this.kneePivot.position.set(0, 0, -FEMUR_LENGTH);
    f.add(this.kneePivot);
    bakeGroup(f, [this.kneePivot]);
  }

  private buildTibia(m: SharedMaterials): void {
    const k = this.kneePivot;
    k.add(mesh(extrudeProfile(tibiaShape(), 0.014, 0.0025).scale(1, 1, TIBIA_STRETCH), this.bladeMaterial));
    // Tranchant lumineux qui suit l'intérieur de la lame jusqu'au bout de la griffe
    const edgeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.018, -0.02),
      new THREE.Vector3(0, -0.017, -0.14),
      new THREE.Vector3(0, -0.018, -0.27),
      new THREE.Vector3(0, -0.022, -0.315),
      new THREE.Vector3(0, -0.04, -0.342),
      new THREE.Vector3(0, -0.064, -0.351),
    ]);
    k.add(mesh(new THREE.TubeGeometry(edgeCurve, 32, 0.0032, 5, false).scale(1, 1, TIBIA_STRETCH), this.glowMaterial));
    // Filet lumineux sur le dos de la lame
    const backCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.025, -0.03),
      new THREE.Vector3(0, 0.031, -0.17),
      new THREE.Vector3(0, 0.014, -0.3),
      new THREE.Vector3(0, -0.004, -0.36),
    ]);
    k.add(mesh(new THREE.TubeGeometry(backCurve, 24, 0.002, 4, false).scale(1, 1, TIBIA_STRETCH), this.glowMaterial));
    // Collier d'articulation du tibia
    k.add(axleX(0.021, 0.034, m.armorLight, 0, 0, -0.012));
    k.add(mesh(new THREE.BoxGeometry(0.02, 0.03, 0.05), m.armor, 0, 0.004, -0.04));

    this.tip.position.set(0, -0.064, -0.351 * TIBIA_STRETCH);
    this.edgeMid.position.set(0, -0.017, -0.14 * TIBIA_STRETCH);
    k.add(this.tip, this.edgeMid);
    bakeGroup(k, [this.tip, this.edgeMid]);
  }

  /** Longueur totale de la patte (utile pour l'équilibrage visuel). */
  static get reach(): number {
    return FEMUR_LENGTH + TIBIA_LENGTH;
  }
}
