import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const sharedGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

/**
 * Faisceau lumineux (cylindre unitaire étiré entre deux points).
 * Utilisé pour les tirs laser du pistolet et les lasers de visée ennemis.
 */
export class Beam {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  private readonly baseColor = new THREE.Color();

  constructor(color: THREE.ColorRepresentation, intensity = 4) {
    this.baseColor.set(color).multiplyScalar(intensity);
    this.material = new THREE.MeshBasicMaterial({
      color: this.baseColor.clone(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(sharedGeometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  set(from: THREE.Vector3, to: THREE.Vector3, radius: number): void {
    tmpDir.subVectors(to, from);
    const length = tmpDir.length();
    if (length < 1e-4) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.position.copy(from).addScaledVector(tmpDir, 0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, tmpDir.divideScalar(length));
    this.mesh.scale.set(radius, length, radius);
    this.mesh.visible = true;
  }

  setIntensity(k: number): void {
    this.material.color.copy(this.baseColor).multiplyScalar(k);
  }

  setOpacity(alpha: number): void {
    this.material.opacity = alpha;
  }
}
