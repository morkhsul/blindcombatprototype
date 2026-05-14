/**
 * Weapon swing animation factory.
 * @param {THREE.Object3D} weaponMesh – the weapon model to animate
 * @param {Object} options
 * @param {number} options.duration - swing time in ms (default 150)
 * @param {number} options.angle - swing angle in radians (default -0.8)
 * @returns {{ trigger: () => void, update: (now: number) => void, isActive: () => boolean }}
 */
export function createSwingAnimation(weaponMesh, { duration = 150, angle = -0.8 } = {}) {
  let isActive = false;
  let startTime = 0;
  const originalX = weaponMesh.rotation.x;

  return {
    trigger() {
      if (isActive) return; // no overlapping swings
      isActive = true;
      startTime = performance.now();
    },
    update(now) {
      if (!isActive) return;

      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1.0);

      // Smooth ease-out/in using a sine curve
      weaponMesh.rotation.x = originalX + angle * Math.sin(progress * Math.PI);

      if (progress >= 1.0) {
        weaponMesh.rotation.x = originalX;
        isActive = false;
      }
    },
    isActive() {
      return isActive;
    }
  };
}