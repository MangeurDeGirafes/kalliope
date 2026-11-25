import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Fusionne tous les meshes d'un groupe par matériau (moins de draw calls).
 * Les objets listés dans `keep` (pivots animés, points d'attache…) sont conservés
 * tels quels, réattachés directement au groupe avec leur transformation relative.
 */
export function bakeGroup(group: THREE.Object3D, keep: THREE.Object3D[] = []): void {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const kept = keep.map((o) => ({ o, m: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) }));
  const isKept = (obj: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = obj; p && p !== group; p = p.parent) {
      if (keep.includes(p)) return true;
    }
    return false;
  };

  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || isKept(obj)) return;
    const g = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld));
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    const mat = obj.material as THREE.Material;
    const list = buckets.get(mat) ?? [];
    list.push(g);
    buckets.set(mat, list);
  });

  for (const { o } of kept) o.removeFromParent();
  group.clear();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) group.add(new THREE.Mesh(merged, mat));
  }
  for (const { o, m } of kept) {
    m.decompose(o.position, o.quaternion, o.scale);
    group.add(o);
  }
}
