// bot.js – smaller body, stops at attack range, damage fix
import * as THREE from 'three';
import { getPlayerCapsule, getBladeWorldSegment } from './combat.js';
import { createSwingAnimation } from './animations.js';
import { getCameraRig } from './renderer.js';
import { getTerrainHeight } from './terrain.js';

const BOT_SPEED = 3.0;
const CHASE_RANGE = 15;
const ATTACK_RANGE = 1.5;
const ATTACK_COOLDOWN = 1.2;
const BOT_MAX_HP = 100;
const ATTACK_DAMAGE = 15;
const RESPAWN_TIME = 8;
const SPAWN_RADIUS = 10;

export class Bot {
  constructor(scene, initialPosition) {
    this.scene = scene;
    this.hp = BOT_MAX_HP;
    this.maxHp = BOT_MAX_HP;
    this.alive = true;
    this.respawnTimer = 0;
    this.lastAttackTime = 0;
    this.forceState = undefined;

    const geometry = new THREE.CylinderGeometry(0.25, 0.25, 1.6, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x3366cc });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.copy(initialPosition);
    scene.add(this.mesh);

    this.weaponMesh = this.createWeapon();
    this.mesh.add(this.weaponMesh);
    this.weaponMesh.position.set(0.4, 0.0, 0.8);

    this.bladeMesh = this.findBladeMesh(this.weaponMesh);
    this.swingAnim = createSwingAnimation(this.weaponMesh, { duration: 300, angle: 1.0 });

    this.healthBarGroup = new THREE.Group();
    this.mesh.add(this.healthBarGroup);
    this.healthBarGroup.position.set(0, 1.1, 0);
    this.createHealthBar();

    this.state = 'idle';
    this.idleDirection = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.idleTimer = 0;
  }

  findBladeMesh(root) {
    let found = null;
    root.traverse((child) => {
      if (child.isMesh && child.userData && child.userData.isBlade === true) found = child;
    });
    return found;
  }

  createWeapon() {
    const group = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x8b4513 })
    );
    handle.position.y = 0.25;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.6, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xcccccc })
    );
    blade.position.y = 0.75;
    blade.userData.isBlade = true;
    group.add(handle);
    group.add(blade);
    return group;
  }

  createHealthBar() {
    const bgWidth = 0.6, bgHeight = 0.08;
    const bgGeom = new THREE.PlaneGeometry(bgWidth, bgHeight);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    this.healthBarBg = new THREE.Mesh(bgGeom, bgMat);
    this.healthBarGroup.add(this.healthBarBg);

    const fgGeom = new THREE.PlaneGeometry(bgWidth, bgHeight);
    const fgMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
    this.healthBarFg = new THREE.Mesh(fgGeom, fgMat);
    this.healthBarFg.position.z = 0.01;
    this.healthBarGroup.add(this.healthBarFg);
  }

  updateHealthBar() {
    if (!this.alive) return;
    const fraction = Math.max(0, this.hp / this.maxHp);
    this.healthBarFg.scale.x = fraction;
    const fullWidth = 0.6;
    this.healthBarFg.position.x = -(fullWidth / 2) * (1 - fraction);
  }

  update(delta, playerCapsule, onPlayerHitCallback) {
    const nowSec = performance.now() / 1000;
    const cameraRig = getCameraRig();

    if (!this.alive) {
      this.respawnTimer -= delta;
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }

    if (cameraRig) this.healthBarGroup.lookAt(cameraRig.position);
    this.updateHealthBar();
    this.swingAnim.update(performance.now());

    const playerPos = cameraRig ? cameraRig.position.clone() : new THREE.Vector3(0, 1.6, 0);
    const botPos = this.mesh.position;
    const distToPlayer = botPos.distanceTo(playerPos);
    const effectiveState = this.forceState || this.state;

    // State transitions
    if (!this.forceState) {
      if (this.state !== 'attack' && distToPlayer <= ATTACK_RANGE && nowSec - this.lastAttackTime >= ATTACK_COOLDOWN) {
        this.state = 'attack';
        this.startAttack();
      } else if (this.state !== 'attack' && distToPlayer <= CHASE_RANGE) {
        this.state = 'chase';
      } else if (distToPlayer > CHASE_RANGE) {
        this.state = 'idle';
      }
      if (this.state === 'attack' && !this.swingAnim.isActive()) {
        this.state = 'chase';
        this.lastAttackTime = nowSec;
      }
    } else {
      this.state = this.forceState;
    }

    const moveSpeed = BOT_SPEED;
    if (effectiveState === 'chase') {
      const dir = new THREE.Vector3().subVectors(playerPos, botPos).normalize();
      dir.y = 0;
      if (distToPlayer > ATTACK_RANGE) {
        this.mesh.position.add(dir.clone().multiplyScalar(moveSpeed * delta));
      }
      if (dir.lengthSq() > 0.001) {
        const angle = Math.atan2(dir.x, dir.z);
        this.mesh.rotation.y = angle;
      }
    } else if (effectiveState === 'idle') {
      this.idleTimer -= delta;
      if (this.idleTimer <= 0) {
        this.idleDirection = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        this.idleTimer = 1 + Math.random() * 2;
      }
      this.mesh.position.add(this.idleDirection.clone().multiplyScalar(moveSpeed * 0.5 * delta));
      if (this.idleDirection.lengthSq() > 0.001) {
        const angle = Math.atan2(this.idleDirection.x, this.idleDirection.z);
        this.mesh.rotation.y = angle;
      }
    }

    // Snap to terrain after horizontal movement
    const terrainY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
    this.mesh.position.y = terrainY + 0.8; // centre of 1.6m tall cylinder

    // Attack hit detection
    if (effectiveState === 'attack' && this.swingAnim.isActive() && this.bladeMesh) {
      const bladeSeg = getBladeWorldSegment(this.bladeMesh);
      const caps = playerCapsule || getPlayerCapsule();
      if (this.segmentCapsuleIntersect(bladeSeg, caps)) {
        console.log('🤖 Bot hit player!');
        onPlayerHitCallback(ATTACK_DAMAGE);
        this.state = 'chase';
        this.lastAttackTime = nowSec;
        this.swingAnim.update(performance.now() + 1000);
      }
    }
  }

  startAttack() {
    this.lastAttackTime = performance.now() / 1000;
    this.swingAnim.trigger();
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.die();
    } else {
      this.mesh.material.color.set(0xff0000);
      setTimeout(() => { if (this.alive) this.mesh.material.color.set(0x3366cc); }, 100);
    }
  }

  die() {
    this.alive = false;
    this.state = 'dead';
    this.mesh.visible = false;
    this.respawnTimer = RESPAWN_TIME;
  }

  respawn() {
    this.hp = BOT_MAX_HP;
    this.alive = true;
    this.state = 'idle';
    this.mesh.visible = true;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * SPAWN_RADIUS;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    this.mesh.position.set(x, 0, z);
    const terrainY = getTerrainHeight(x, z);
    this.mesh.position.y = terrainY + 0.8;
    this.mesh.material.color.set(0x3366cc);
  }

  segmentCapsuleIntersect(segment, capsule) {
    const segDir = new THREE.Vector3().subVectors(segment.end, segment.start);
    const segLen = segDir.length();
    if (segLen < 0.0001) {
      const closest = this.closestPointOnSegment(segment.start, capsule.bottom, capsule.top);
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
      t = (b * d2.dot(r) - c * d1.dot(r)) / det;
      u = (a * d2.dot(r) - b * d1.dot(r)) / det;
    }
    t = Math.max(0, Math.min(segLen, t));
    u = Math.max(0, Math.min(capsLen, u));
    const pSeg = segment.start.clone().add(d1.clone().multiplyScalar(t));
    const pCap = capsule.bottom.clone().add(d2.clone().multiplyScalar(u));
    return pSeg.distanceTo(pCap) <= (segment.thickness + capsule.radius);
  }

  closestPointOnSegment(point, segA, segB) {
    const ab = new THREE.Vector3().subVectors(segB, segA);
    const ap = new THREE.Vector3().subVectors(point, segA);
    let t = ap.dot(ab) / ab.lengthSq();
    t = Math.max(0, Math.min(1, t));
    return segA.clone().add(ab.multiplyScalar(t));
  }

  remove() {
    this.scene.remove(this.mesh);
  }
}