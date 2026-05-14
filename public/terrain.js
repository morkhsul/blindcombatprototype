// terrain.js
import * as THREE from 'three';

let collidableMeshes = [];
const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
const MAX_RAY_DISTANCE = 5000;

/**
 * Call once after loading the map GLB scene.
 * @param {THREE.Object3D} rootObject - the loaded map's root
 */
export function initTerrainCollision(rootObject) {
  collidableMeshes = [];
  rootObject.traverse((child) => {
    if (child.isMesh) {
      // In the future you can filter out meshes that shouldn't be walked on
      // (e.g. by name, material, or custom user data).
      collidableMeshes.push(child);
    }
  });
  console.log(`Terrain initialised with ${collidableMeshes.length} meshes`);
}

/**
 * Returns the height of the terrain at world (x, z).
 * If no ground is hit, returns -9999 (void).
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function getTerrainHeight(x, z) {
  const origin = new THREE.Vector3(x, 5000, z);
  raycaster.set(origin, DOWN);
  raycaster.far = MAX_RAY_DISTANCE;
  const intersections = raycaster.intersectObjects(collidableMeshes, false);
  if (intersections.length > 0) {
    return intersections[0].point.y;
  }
  return -9999; // void
}