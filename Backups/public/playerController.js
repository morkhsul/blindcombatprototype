// playerController.js
import * as THREE from 'three';
import { getControls } from './renderer.js';

const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};
const GROUND_Y = 1.6;
const JUMP_FORCE = 8;
const GRAVITY = -20;
const BASE_SPEED = 5.0;
const SPRINT_MULTIPLIER = 1.6;

let velocityY = 0;
let isGrounded = true;
let combatSystem = null;
let room = null;

let lastRigPosition = null;
let currentWorldVelocity = new THREE.Vector3();

let lastSendTime = 0;
const SEND_INTERVAL = 20; // ms between position updates (50 Hz)

export function startInputCapture(roomRef, combat) {
  combatSystem = combat;
  room = roomRef;
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}

function onKeyDown(e) {
  const controls = getControls();
  if (!controls || !controls.isLocked) return;

  switch (e.code) {
    case 'KeyW': moveState.forward = true; break;
    case 'KeyS': moveState.backward = true; break;
    case 'KeyA': moveState.left = true; break;
    case 'KeyD': moveState.right = true; break;
    case 'ShiftLeft':
    case 'ShiftRight':
      moveState.sprint = true;
      e.preventDefault();
      break;
    case 'Space':
      if (isGrounded) {
        velocityY = JUMP_FORCE;
        isGrounded = false;
      }
      e.preventDefault();
      break;
    case 'KeyQ':
      if (combatSystem) combatSystem.toggleLockOn();
      break;
  }
}

function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': moveState.forward = false; break;
    case 'KeyS': moveState.backward = false; break;
    case 'KeyA': moveState.left = false; break;
    case 'KeyD': moveState.right = false; break;
    case 'ShiftLeft':
    case 'ShiftRight':
      moveState.sprint = false;
      break;
  }
}

export function updateMovement(deltaTime) {
  const controls = getControls();
  if (!controls || !controls.isLocked) return;

  const dt = Math.min(deltaTime, 0.1);
  const speed = BASE_SPEED * (moveState.sprint ? SPRINT_MULTIPLIER : 1.0);
  const moveDistance = speed * dt;

  const rig = controls.getObject();
  const prevPosition = rig.position.clone();

  if (moveState.forward) controls.moveForward(moveDistance);
  if (moveState.backward) controls.moveForward(-moveDistance);
  if (moveState.left) controls.moveRight(-moveDistance);
  if (moveState.right) controls.moveRight(moveDistance);

  velocityY += GRAVITY * dt;
  rig.position.y += velocityY * dt;
  if (rig.position.y <= GROUND_Y) {
    rig.position.y = GROUND_Y;
    velocityY = 0;
    isGrounded = true;
  }

  currentWorldVelocity.subVectors(rig.position, prevPosition).divideScalar(dt);

  // Send position/rotation to the server at fixed rate
  if (room && room.connection.isOpen) {
    const now = performance.now();
    if (now - lastSendTime >= SEND_INTERVAL) {
      lastSendTime = now;
      room.send('move', {
        x: rig.position.x,
        y: rig.position.y,
        z: rig.position.z,
        rotation: rig.rotation.y
      });
    }
  }
}

export function getMovementState() {
  const isMoving =
    moveState.forward || moveState.backward || moveState.left || moveState.right;
  return {
    isMoving,
    isSprinting: isMoving && moveState.sprint,
    isGrounded,
    worldVelocity: currentWorldVelocity.clone(),
  };
}

export function isPlayerGrounded() {
  return isGrounded;
}