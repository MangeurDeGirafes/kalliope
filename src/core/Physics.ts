import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * Fine couche au-dessus de Rapier : monde statique, requêtes (raycasts / tests de forme)
 * et création du contrôleur de personnage cinématique.
 */
export class Physics {
  readonly world: RAPIER.World;
  private ignored: RAPIER.Collider | null = null;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;
  }

  /** Collider ignoré par défaut par toutes les requêtes (le joueur). */
  setIgnoredCollider(collider: RAPIER.Collider | null): void {
    this.ignored = collider;
  }

  addBox(center: THREE.Vector3, halfExtents: THREE.Vector3, rotationY = 0): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(0);
    if (rotationY !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
      desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    return this.world.createCollider(desc);
  }

  createCapsule(center: THREE.Vector3, halfHeight: number, radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(center.x, center.y, center.z);
    return this.world.createCollider(desc);
  }

  createCharacterController(offset: number): RAPIER.KinematicCharacterController {
    return this.world.createCharacterController(offset);
  }

  /** Raycast contre le monde statique. `dir` doit être normalisé. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDistance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.ignored ?? undefined,
    );
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    };
  }

  /** Vrai si une capsule verticale tient à cet endroit sans intersecter le décor. */
  isCapsuleFree(center: THREE.Vector3, halfHeight: number, radius: number): boolean {
    const shape = new RAPIER.Capsule(halfHeight, radius);
    const hit = this.world.intersectionWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.ignored ?? undefined,
    );
    return hit === null;
  }

  /** Met à jour les structures d'accélération (broad-phase) utilisées par les requêtes. */
  step(): void {
    this.world.step();
  }
}
