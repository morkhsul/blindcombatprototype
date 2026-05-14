// combat.js
import * as THREE from 'three';
import { createSwingAnimation } from './animations.js';
import { getControls, getCamera, getCameraRig, setLockOnOverride, resetSmoothRotation } from './renderer.js';

const DEBUG_COMBAT = false;
function log(...args) { if (DEBUG_COMBAT) console.log('[COMBAT]', ...args); }

const LOCK_ON_RANGE = 25;
const LOCK_ON_DOT = 0.7;
const LOCK_ON_SMOOTH_TIME = 0.3;
const GROUND_Y = 1.6;

function findBladeMesh(root) {
  let found = null;
  root.traverse((child) => {
    if (child.isMesh && child.userData && child.userData.isBlade === true) found = child;
  });
  return found;
}

export function getCharacterCapsule(mesh) {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const worldPos = mesh.getWorldPosition(new THREE.Vector3());
  const halfHeight = size.y / 2;
  const radius = Math.max(size.x, size.z) / 2;
  const bottom = worldPos.clone().add(new THREE.Vector3(0, -halfHeight, 0));
  const top = worldPos.clone().add(new THREE.Vector3(0, halfHeight, 0));
  return { top, bottom, radius };
}

export function getPlayerCapsule() {
  const rig = getCameraRig();
  if (!rig) return { top: new THREE.Vector3(), bottom: new THREE.Vector3(), radius: 0.4 };
  const worldPos = rig.position.clone();
  const height = 2.0;
  const radius = 0.4;
  const bottom = worldPos.clone();
  const top = worldPos.clone().add(new THREE.Vector3(0, height, 0));
  return { top, bottom, radius };
}

export function getBladeWorldSegment(bladeMesh) {
  bladeMesh.updateWorldMatrix(true, false);
  const worldMatrix = bladeMesh.matrixWorld;
  bladeMesh.geometry.computeBoundingBox();
  const box = bladeMesh.geometry.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);

  const localBottom = new THREE.Vector3(center.x, box.min.y, center.z);
  const localTop = new THREE.Vector3(center.x, box.max.y, center.z);
  const worldBottom = localBottom.clone().applyMatrix4(worldMatrix);
  const worldTop = localTop.clone().applyMatrix4(worldMatrix);

  const extentX = (box.max.x - box.min.x) / 2;
  const extentZ = (box.max.z - box.min.z) / 2;
  const thickness = Math.max(extentX, extentZ) * 1.5;
  return { start: worldBottom, end: worldTop, thickness };
}

function closestDistanceSegmentToCapsule(segment, capsule) {
  const segDir = new THREE.Vector3().subVectors(segment.end, segment.start);
  const segLen = segDir.length();
  const capDir = new THREE.Vector3().subVectors(capsule.top, capsule.bottom);
  const capLen = capDir.length();
  if (segLen < 0.0001) {
    const closest = closestPointOnSegment(segment.start, capsule.bottom, capsule.top);
    return segment.start.distanceTo(closest);
  }
  if (capLen < 0.0001) {
    const closestOnSeg = closestPointOnSegment(capsule.bottom, segment.start, segment.end);
    return closestOnSeg.distanceTo(capsule.bottom);
  }
  const d1 = segDir.normalize();
  const d2 = capDir.normalize();
  const r = new THREE.Vector3().subVectors(segment.start, capsule.bottom);
  const a = d1.dot(d1);
  const b = d1.dot(d2);
  const c = d2.dot(d2);
  const e = d1.dot(r);
  const f = d2.dot(r);
  const det = a * c - b * b;
  let t = 0, u = 0;
  if (Math.abs(det) > 0.0001) {
    t = (b * f - c * e) / det;
    u = (a * f - b * e) / det;
  }
  t = Math.max(0, Math.min(segLen, t));
  u = Math.max(0, Math.min(capLen, u));
  const pSeg = segment.start.clone().add(d1.clone().multiplyScalar(t));
  const pCap = capsule.bottom.clone().add(d2.clone().multiplyScalar(u));
  return pSeg.distanceTo(pCap);
}

function segmentCapsuleIntersect(segment, capsule) {
  const dist = closestDistanceSegmentToCapsule(segment, capsule);
  const combined = segment.thickness + capsule.radius;
  return dist <= combined;
}

function closestPointOnSegment(point, segA, segB) {
  const ab = new THREE.Vector3().subVectors(segB, segA);
  const ap = new THREE.Vector3().subVectors(point, segA);
  let t = ap.dot(ab) / ab.lengthSq();
  t = Math.max(0, Math.min(1, t));
  return segA.clone().add(ab.multiplyScalar(t));
}

export function checkBladeHitTarget(bladeMesh, capsule) {
  const bladeSeg = getBladeWorldSegment(bladeMesh);
  return segmentCapsuleIntersect(bladeSeg, capsule);
}

export function createCombatSystem(
  weaponMesh,
  targetMesh,
  playerState,
  weaponData,
  armorData,
  onTargetDefeated,
  onAttackHit,
  onPlayerHit,
  onTargetDamaged
) {
  const lightSwing = createSwingAnimation(weaponMesh, { duration: 120, angle: -0.5 });
  const heavySwing = createSwingAnimation(weaponMesh, { duration: 300, angle: -1.2 });

  let lockOnTarget = null;
  let auraRing;
  let controlsDisabledByLock = false;
  let currentTarget = targetMesh;
  let lockOnTargets = [];
  let potentialTargets = [];

  let attackActive = false;
  let attackStartTime = 0;
  let attackWindowDuration = 0;
  let currentAttackType = null;
  let bladeMesh = null;

  bladeMesh = findBladeMesh(weaponMesh);
  if (!bladeMesh) console.warn('No blade mesh found.');

  if (currentTarget) {
    createAuraRing(currentTarget);
  }

  function createAuraRing(target) {
    auraRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.05, 16, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.visible = false;
    target.add(auraRing);
  }

  function moveAuraTo(target) {
    if (auraRing && currentTarget) currentTarget.remove(auraRing);
    if (target) {
      createAuraRing(target);
    } else {
      auraRing = null;
    }
  }

  function getCameraWorldPos() {
    return getCamera().getWorldPosition(new THREE.Vector3());
  }

  function isGrounded() {
    const rig = getCameraRig();
    return rig ? rig.position.y <= GROUND_Y : true;
  }

  function toggleLockOn() {
    if (lockOnTarget) {
      releaseLock();
      return;
    }

    const camera = getCamera();
    const controls = getControls();
    if (!camera || !controls || !controls.isLocked) return;

    const camPos = getCameraWorldPos();
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);

    let bestTarget = null;
    let bestScore = -Infinity;

    lockOnTargets.forEach((target) => {
      if (!target || (target.hp !== undefined && target.hp <= 0)) return;
      const targetPos = target.getWorldPosition(new THREE.Vector3());
      const toTarget = targetPos.clone().sub(camPos);
      const distance = toTarget.length();
      if (distance > LOCK_ON_RANGE) return;

      const dot = camForward.dot(toTarget.normalize());
      if (dot < LOCK_ON_DOT) return;

      const score = dot * 10 - distance;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    });

    if (bestTarget) {
      lockOnTarget = bestTarget;
      currentTarget = bestTarget;
      moveAuraTo(bestTarget);
      if (auraRing) auraRing.visible = true;
      controls.enabled = false;
      controlsDisabledByLock = true;
      setLockOnOverride(true);
      log('Lock-on acquired');
    }
  }

  function releaseLock() {
    lockOnTarget = null;
    if (auraRing) auraRing.visible = false;
    if (controlsDisabledByLock) {
      const controls = getControls();
      const rig = getCameraRig();
      if (controls) {
        controls.enabled = true;
        resetSmoothRotation(rig.quaternion);
      }
      controlsDisabledByLock = false;
    }
    setLockOnOverride(false);
  }

  function setLockOnTargets(targets) {
    lockOnTargets = targets;
  }

  function setPotentialTargets(targets) {
    potentialTargets = targets;
  }

  function setTarget(newTarget) {
    if (lockOnTarget) {
      releaseLock();
    }
    moveAuraTo(newTarget);
    currentTarget = newTarget;
  }

  function tryLightAttack() { return startAttack('light'); }
  function tryHeavyAttack() { return startAttack('heavy'); }

  function startAttack(attackType) {
    const controls = getControls();
    if (!controls || !controls.isLocked) return { hit: false };

    const weapon = weaponData[playerState.equippedWeapon];
    if (!weapon) return { hit: false };
    const now = performance.now();
    if (now - playerState.lastAttackTime < weapon.speed) return { hit: false };
    if (attackType === 'heavy' && !isGrounded()) return { hit: false };

    if (attackType === 'heavy') {
      heavySwing.trigger();
      attackWindowDuration = 300;
    } else {
      lightSwing.trigger();
      attackWindowDuration = 120;
    }
    attackActive = true;
    attackStartTime = now;
    currentAttackType = attackType;
    playerState.lastAttackTime = now;
    return { hit: true, pending: true };
  }

  function updateCollision() {
    if (!attackActive || !bladeMesh) return;
    const now = performance.now();
    if (now - attackStartTime > attackWindowDuration) {
      attackActive = false;
      return;
    }

    if (potentialTargets.length === 0) return;

    const bladeSeg = getBladeWorldSegment(bladeMesh);

    for (let target of potentialTargets) {
      if (!target || (target.hp !== undefined && target.hp <= 0)) continue;

      const targetCaps = getCharacterCapsule(target);
      const dist = closestDistanceSegmentToCapsule(bladeSeg, targetCaps);
      const combined = bladeSeg.thickness + targetCaps.radius;

      if (dist <= combined) {
        attackActive = false;

        const weapon = weaponData[playerState.equippedWeapon];
        let damageToTarget = weapon.damage;
        if (currentAttackType === 'heavy') {
          damageToTarget = Math.floor(weapon.damage * 1.5);
        } else if (!isGrounded()) {
          damageToTarget = Math.floor(weapon.damage * 1.4);
        }

        if (onTargetDamaged) onTargetDamaged(target, damageToTarget);

        if (target.material) {
          target.material.color.set(0xff0000);
          setTimeout(() => {
            if (target.material) target.material.color.set(0xaaaaaa);
          }, 100);
        }

        if (onAttackHit) onAttackHit(playerState.equippedWeapon, currentAttackType);

        if (target.hp !== undefined && target.hp <= 0) {
          if (target === lockOnTarget) releaseLock();
          if (onTargetDefeated) onTargetDefeated(target);
        }

        break;
      }
    }
  }

  function update(deltaTime) {
    const camera = getCamera();
    const controls = getControls();
    if (!camera) return;

    if (lockOnTarget && controls?.isLocked) {
      const rig = getCameraRig();
      const camWorldPos = rig.position;
      const targetPos = lockOnTarget.getWorldPosition(new THREE.Vector3());
      const desiredQuat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(camWorldPos, targetPos, camera.up)
      );
      rig.quaternion.slerp(desiredQuat, 1 - Math.exp(-deltaTime / LOCK_ON_SMOOTH_TIME));
    }

    if (lockOnTarget && lockOnTarget.hp !== undefined && lockOnTarget.hp <= 0) {
      releaseLock();
    }

    lightSwing.update(performance.now());
    heavySwing.update(performance.now());
    updateCollision();
  }

  return {
    tryLightAttack,
    tryHeavyAttack,
    toggleLockOn,
    update,
    setTarget,
    getTarget: () => currentTarget,
    getLockOnTarget: () => lockOnTarget,
    releaseLock,
    isLockedOn: () => lockOnTarget !== null,
    setLockOnTargets,
    setPotentialTargets,
  };
}