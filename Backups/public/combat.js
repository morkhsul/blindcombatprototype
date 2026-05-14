// combat.js
import * as THREE from 'three';
import { createSwingAnimation } from './animations.js';
import { getControls, getCamera, getCameraRig } from './renderer.js';

const DUMMY_MAX_HP = 100;
const LOCK_ON_RANGE = 10;
const LOCK_ON_DOT = 0.78;
const LOCK_ON_SMOOTH_TIME = 0.3;
const GROUND_Y = 1.6;

// ── Capacities for hitboxes ──────────────────────────────
function getDummyCapsule(dummyMesh) {
  dummyMesh.geometry.computeBoundingBox();
  const box = dummyMesh.geometry.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);
  const halfHeight = size.y / 2;
  const radius = Math.max(size.x, size.z) / 2;
  const worldCenter = dummyMesh.getWorldPosition(new THREE.Vector3());
  const top = worldCenter.clone().add(new THREE.Vector3(0, halfHeight, 0));
  const bottom = worldCenter.clone().add(new THREE.Vector3(0, -halfHeight, 0));
  return { top, bottom, radius };
}

// Compute blade world segment using the weapon holder's current transform
function getBladeWorldSegment(bladeMesh, weaponHolder) {
  bladeMesh.geometry.computeBoundingBox();
  const box = bladeMesh.geometry.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);
  const localBottom = new THREE.Vector3(center.x, box.min.y, center.z);
  const localTop = new THREE.Vector3(center.x, box.max.y, center.z);

  // Build the complete local-to-world transform: holder.world * weaponMesh.local
  weaponHolder.updateMatrixWorld();
  const holderWorldMatrix = weaponHolder.matrixWorld.clone();

  // weaponMesh is a child of the holder with local position/rotation/scale
  weaponMesh.updateMatrix();
  const weaponLocalMatrix = weaponMesh.matrix.clone();

  const fullMatrix = holderWorldMatrix.clone().multiply(weaponLocalMatrix);
  const worldBottom = localBottom.clone().applyMatrix4(fullMatrix);
  const worldTop = localTop.clone().applyMatrix4(fullMatrix);

  const extentX = (box.max.x - box.min.x) / 2;
  const extentZ = (box.max.z - box.min.z) / 2;
  const thickness = Math.max(extentX, extentZ) * 0.8;
  return { start: worldBottom, end: worldTop, thickness };
}

// Segment–capsule intersection
function segmentCapsuleIntersect(segment, capsule) {
  const segDir = new THREE.Vector3().subVectors(segment.end, segment.start);
  const segLen = segDir.length();
  if (segLen < 0.0001) {
    const closest = closestPointOnSegment(segment.start, capsule.bottom, capsule.top);
    return segment.start.distanceTo(closest) <= (segment.thickness + capsule.radius);
  }
  const d1 = segDir.clone().normalize();
  const capsDir = new THREE.Vector3().subVectors(capsule.top, capsule.bottom);
  const capsLen = capsDir.length();
  const d2 = capsLen > 0.0001 ? capsDir.normalize() : new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().subVectors(segment.start, capsule.bottom);
  const a = d1.dot(d1);
  const b = d1.dot(d2);
  const c = d2.dot(d2);
  const det = a * c - b * b;
  let t = 0, u = 0;
  if (Math.abs(det) > 0.0001) {
    t = (b * (d2.dot(r)) - c * (d1.dot(r))) / det;   // corrected formula
    u = (a * (d2.dot(r)) - b * (d1.dot(r))) / det;
  }
  t = Math.max(0, Math.min(segLen, t));
  u = Math.max(0, Math.min(capsLen, u));
  const pSeg = segment.start.clone().add(d1.clone().multiplyScalar(t));
  const pCap = capsule.bottom.clone().add(d2.clone().multiplyScalar(u));
  return pSeg.distanceTo(pCap) <= (segment.thickness + capsule.radius);
}

function closestPointOnSegment(point, segA, segB) {
  const ab = new THREE.Vector3().subVectors(segB, segA);
  const ap = new THREE.Vector3().subVectors(point, segA);
  let t = ap.dot(ab) / ab.lengthSq();
  t = Math.max(0, Math.min(1, t));
  return segA.clone().add(ab.multiplyScalar(t));
}

// ── Combat System ────────────────────────────────────────
export function createCombatSystem(weaponMesh, dummyMesh, playerState, weaponData, armorData, onDummyDefeated) {
  const lightSwing = createSwingAnimation(weaponMesh, { duration: 120, angle: -0.5 });
  const heavySwing = createSwingAnimation(weaponMesh, { duration: 300, angle: -1.2 });

  let lockOnTarget = null;
  let auraRing;
  let controlsDisabledByLock = false;
  let dummyHP = DUMMY_MAX_HP;

  let attackActive = false;
  let attackStartTime = 0;
  let attackWindowDuration = 0;
  let currentAttackType = null;
  let bladeMesh = null;

  bladeMesh = weaponMesh.getObjectByProperty('userData.isBlade', true);
  if (!bladeMesh) {
    console.warn('No blade mesh found (userData.isBlade missing). Attacks will not connect.');
  }

  auraRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.05, 16, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
  );
  auraRing.rotation.x = -Math.PI / 2;
  auraRing.visible = false;
  dummyMesh.add(auraRing);

  function getCameraWorldPos() {
    const camera = getCamera();
    return camera.getWorldPosition(new THREE.Vector3());
  }

  function isGrounded() {
    const rig = getCameraRig();
    return rig ? rig.position.y <= GROUND_Y : true;
  }

  function getPlayerDefense() {
    const armor = playerState.equippedArmor ? armorData[playerState.equippedArmor] : null;
    return armor ? armor.defense : 0;
  }

  function flashDummyRed() {
    dummyMesh.material.color.set(0xff0000);
    setTimeout(() => dummyMesh.material.color.set(0xaaaaaa), 100);
  }

  // ── Lock‑on ──────────────────────────────────────────────
  function toggleLockOn() {
    if (lockOnTarget) {
      releaseLock();
      return;
    }
    const camera = getCamera();
    const controls = getControls();
    if (!camera || !controls || !controls.isLocked) return;
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    const cameraWorldPos = getCameraWorldPos();
    const toTarget = dummyMesh.position.clone().sub(cameraWorldPos);
    const distance = toTarget.length();
    const dot = camForward.dot(toTarget.normalize());
    if (distance < LOCK_ON_RANGE && dot > LOCK_ON_DOT) {
      lockOnTarget = dummyMesh;
      auraRing.visible = true;
      controls.enabled = false;
      controlsDisabledByLock = true;
    }
  }

  function releaseLock() {
    lockOnTarget = null;
    auraRing.visible = false;
    if (controlsDisabledByLock) {
      const controls = getControls();
      if (controls) controls.enabled = true;
      controlsDisabledByLock = false;
    }
  }

  // ── Attack initiation ────────────────────────────────────
  function tryLightAttack() { return startAttack('light'); }
  function tryHeavyAttack() { return startAttack('heavy'); }

  function startAttack(attackType) {
    const controls = getControls();
    const camera = getCamera();
    if (!controls || !controls.isLocked) return { hit: false };
    if (dummyHP <= 0) return { hit: false };
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

  // ── Collision check (called every frame) ────────────────
  function updateCollision() {
    if (!attackActive || !bladeMesh) return;

    const now = performance.now();
    if (now - attackStartTime > attackWindowDuration) {
      attackActive = false;
      return;
    }

    // Use weaponHolder (the outermost group) to compute world transforms correctly
    const weaponHolder = weaponMesh.parent; // should be the Group added to scene
    if (!weaponHolder) return;

    const bladeSeg = getBladeWorldSegment(bladeMesh, weaponHolder);
    const dummyCaps = getDummyCapsule(dummyMesh);

    if (segmentCapsuleIntersect(bladeSeg, dummyCaps)) {
      attackActive = false;

      const weapon = weaponData[playerState.equippedWeapon];
      let playerDamage = weapon.damage;
      if (currentAttackType === 'heavy') {
        playerDamage = Math.floor(weapon.damage * 1.5);
      } else if (!isGrounded()) {
        playerDamage = Math.floor(weapon.damage * 1.4);
      }
      const playerDefense = getPlayerDefense();
      const dummyDamage = Math.max(0, 2 - playerDefense);

      dummyHP -= playerDamage;
      playerState.hp -= dummyDamage;

      flashDummyRed();

      if (dummyHP <= 0) {
        dummyHP = DUMMY_MAX_HP;
        playerState.hp = playerState.maxHP;
        releaseLock();
        onDummyDefeated();
      }
      if (playerState.hp <= 0) {
        playerState.hp = playerState.maxHP;
      }
    }
  }

  // ── Per‑frame update ────────────────────────────────────
  function update(deltaTime) {
    const camera = getCamera();
    const controls = getControls();
    if (!camera) return;

    if (lockOnTarget && controls && controls.isLocked) {
      const cameraWorldPos = getCameraWorldPos();
      const targetPos = lockOnTarget.getWorldPosition(new THREE.Vector3());
      const desiredQuat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(cameraWorldPos, targetPos, camera.up)
      );
      const smoothFactor = 1 - Math.exp(-deltaTime / LOCK_ON_SMOOTH_TIME);
      camera.quaternion.slerp(desiredQuat, smoothFactor);
    }

    if (lockOnTarget && dummyHP <= 0) {
      releaseLock();
    }

    const now = performance.now();
    lightSwing.update(now);
    heavySwing.update(now);

    updateCollision();
  }

  function getDummyHP() { return dummyHP; }
  function getDummyMaxHP() { return DUMMY_MAX_HP; }
  function isLockedOn() { return lockOnTarget !== null; }

  return {
    tryLightAttack,
    tryHeavyAttack,
    toggleLockOn,
    update,
    getDummyHP,
    getDummyMaxHP,
    isLockedOn,
    releaseLock
  };
}