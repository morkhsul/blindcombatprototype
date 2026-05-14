// main.js
import * as THREE from 'three';
import {
  initRenderer,
  getCamera,
  getCameraRig,
  getControls,
  getScene,
  getDummyMesh,
  renderFrame,
  enterArenaMode,
  exitArenaMode,
  getChromaticAberration,
  getVelocityBlur,
  smoothCamera,
  remoteMeshes           // we still need to read the mesh object directly
} from './renderer.js';
import { connectToServer, getRoom, getArenaRoom } from './networking.js';
import { startInputCapture, updateMovement, getMovementState } from './playerController.js';
import { createCombatSystem } from './combat.js';
import { createCameraEffects } from './cameraEffects.js';
import { startArenaFlow, leaveArenaFlow, isArenaActive } from './arenaClient.js';
import { hideAllArenaUI } from './arenaUI.js';
import { startCombatInput, stopCombatInput } from './arenaCombat.js';
import { WEAPONS, ARMORS } from './itemDefs.js';
import { addRemotePlayer, removeRemotePlayer } from './remotePlayers.js'; // we still use these to create/delete meshes

let playerUUID;
let clock = new THREE.Clock();
let lobbyCombatSystem = null;
let weaponHolder = null;
let cameraEffects = null;

const playerState = {
  gold: 0,
  wins: 0,
  inventory: ['rusty_dagger'],
  equippedWeapon: 'rusty_dagger',
  equippedArmor: '',
  maxHP: 100,
  hp: 100,
  lastAttackTime: 0
};

let currentMode = 'lobby';
let arenaPhaseListenerSetup = false;

// ── Interpolation data for remote players ──────────
const remoteTargets = {};          // sessionId -> THREE.Vector3 target position
const LERP_SPEED = 25.0;           // higher = snappier, lower = smoother (20‑30 recommended)

async function main() {
  await initRenderer();

  playerUUID = localStorage.getItem('arenaUUID');
  if (!playerUUID) {
    playerUUID = crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now();
    localStorage.setItem('arenaUUID', playerUUID);
  }

  // ── Create weapon hierarchy ──────────────────────────────
  weaponHolder = new THREE.Group();
  const weaponMesh = createWeaponMesh();
  weaponHolder.add(weaponMesh);
  weaponMesh.position.set(0.3, -0.3, -0.5);
  const scene = getScene();
  scene.add(weaponHolder);

  // ── Combat system ────────────────────────────────────────
  const dummyMesh = getDummyMesh();
  lobbyCombatSystem = createCombatSystem(weaponMesh, dummyMesh, playerState, WEAPONS, ARMORS, async () => {
    await fetch('/api/dummyDefeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid: playerUUID })
    });
    await refreshPlayerData();
  });

  // ── Connect to server ────────────────────────────────────
  let room = null;
  try {
    room = await connectWithTimeout(5000);
    console.log('Connected to server');
    startInputCapture(room, lobbyCombatSystem);
  } catch (err) {
    console.warn('Could not connect to server, running offline:', err);
  }

  await refreshPlayerData();

  // ── Camera effects ───────────────────────────────────────
  const camera = getCamera();
  const rig = getCameraRig();
  const chromAberr = getChromaticAberration();
  const velBlur = getVelocityBlur();

  cameraEffects = createCameraEffects(camera, rig, {
    postProcessors: {
      chromaticAberration: chromAberr,
      velocityEffect: velBlur,
    },
  });

  // ── UI ───────────────────────────────────────────────────
  setupInventoryUI();
  setupShopUI();
  setupLeaderboard();
  setupSettingsToggle();
  setupAttackMouseHandlers(lobbyCombatSystem);
  setupShopProximityHint();

  setInterval(refreshLeaderboard, 10000);
  refreshLeaderboard();

  setupArenaPhaseWatcher();

  // ── Game loop ────────────────────────────────────────────
  function gameLoop() {
    requestAnimationFrame(gameLoop);
    const delta = clock.getDelta();
    const dt = Math.min(delta, 0.1); // clamp

    if (currentMode === 'lobby') {
      smoothCamera(dt);
      updateMovement(dt);
      if (lobbyCombatSystem) lobbyCombatSystem.update(dt);

      const movementState = getMovementState();
      cameraEffects.update(dt, movementState);

      const camWorldPos = camera.getWorldPosition(new THREE.Vector3());
      const camWorldQuat = camera.getWorldQuaternion(new THREE.Quaternion());
      if (weaponHolder) {
        weaponHolder.position.copy(camWorldPos);
        weaponHolder.quaternion.copy(camWorldQuat);
      }

      // Smooth remote player positions
      updateRemotePlayers(dt);
    }

    updateCombatHUD();
    renderFrame();
  }
  gameLoop();
}

// ────────── helpers ──────────────────────────────

function connectWithTimeout(ms) {
  return Promise.race([
    connectToServer(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), ms)
    )
  ]);
}

function createWeaponMesh() {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, emissive: 0x331100 })
  );
  handle.position.y = 0.3;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.7, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x331100 })
  );
  blade.position.y = 0.85;
  blade.userData.isBlade = true;
  group.add(handle);
  group.add(blade);
  return group;
}

function setupArenaPhaseWatcher() {
  setInterval(() => {
    const arenaRoom = getArenaRoom();
    if (arenaRoom && isArenaActive() && !arenaPhaseListenerSetup) {
      arenaPhaseListenerSetup = true;
      arenaRoom.onStateChange((state) => {
        if (!state) return;
        const phase = state.phase;
        if (weaponHolder) {
          weaponHolder.visible = (phase === 'combat' && currentMode === 'arena');
        }
        if (phase === 'combat' && currentMode === 'arena') {
          startCombatInput();
        } else {
          stopCombatInput();
        }
        if (phase === 'results') {
          setupResultsReturnHandler();
        }
      });
      const isSpectator = !arenaRoom.state.fighters.has(arenaRoom.sessionId);
      enterArenaMode(null, null, isSpectator);
      currentMode = 'arena';
    }
    if (!getArenaRoom() && currentMode === 'arena') {
      currentMode = 'lobby';
      arenaPhaseListenerSetup = false;
      stopCombatInput();
      exitArenaMode();
      hideAllArenaUI();
      if (weaponHolder) weaponHolder.visible = true;
      document.getElementById('hud').style.display = 'block';
      document.getElementById('crosshair').style.display = 'block';
    }
  }, 500);
}

function setupResultsReturnHandler() {
  const returnBtn = document.getElementById('results-return-btn');
  if (returnBtn && !returnBtn.__handlerSet) {
    returnBtn.__handlerSet = true;
    returnBtn.addEventListener('click', () => {
      leaveArenaFlow();
    });
  }
}

function setupAttackMouseHandlers(combat) {
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('mousedown', (e) => {
    if (currentMode !== 'lobby') return;
    if (!getControls()?.isLocked) return;
    if (e.button === 0) combat.tryLightAttack();
    else if (e.button === 2) combat.tryHeavyAttack();
  });
}

function updateCombatHUD() {}

async function refreshPlayerData() {
  try {
    const res = await fetch(`/api/player/${playerUUID}`);
    const data = await res.json();
    playerState.gold = data.gold;
    playerState.wins = data.wins;
    playerState.inventory = data.inventory;
    playerState.equippedWeapon = data.equipped_weapon;
    playerState.equippedArmor = data.equipped_armor;
    playerState.hp = playerState.maxHP;
    updateHUD(data);
  } catch (e) {
    console.error('Failed to fetch player data', e);
  }
}

function updateHUD(data) {
  document.getElementById('player-hp').textContent = playerState.hp;
  document.getElementById('player-gold').textContent = data.gold;
  document.getElementById('weapon-name').textContent = WEAPONS[data.equipped_weapon]?.name || 'None';
  document.getElementById('armor-name').textContent = data.equipped_armor ? ARMORS[data.equipped_armor].name : 'None';
  document.getElementById('wins').textContent = data.wins;
}

function setupInventoryUI() {
  document.getElementById('close-inv').addEventListener('click', () => {
    document.getElementById('inventory-panel').style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyI' && getControls()?.isLocked) {
      openInventory();
    }
  });
}

async function openInventory() {
  const res = await fetch(`/api/player/${playerUUID}`);
  const data = await res.json();
  playerState.inventory = data.inventory;
  const invWeapons = document.getElementById('inv-weapons');
  const invArmors = document.getElementById('inv-armors');
  invWeapons.innerHTML = '<strong>Weapons:</strong><br>';
  invArmors.innerHTML = '<strong>Armors:</strong><br>';
  data.inventory.forEach(key => {
    if (WEAPONS[key]) {
      const btn = document.createElement('button');
      btn.textContent = `Equip ${WEAPONS[key].name}`;
      btn.onclick = async () => {
        await fetch('/api/equip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: playerUUID, type: 'weapon', key })
        });
        await refreshPlayerData();
        openInventory();
      };
      invWeapons.appendChild(btn);
      invWeapons.appendChild(document.createElement('br'));
    } else if (ARMORS[key]) {
      const btn = document.createElement('button');
      btn.textContent = `Equip ${ARMORS[key].name}`;
      btn.onclick = async () => {
        await fetch('/api/equip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: playerUUID, type: 'armor', key })
        });
        await refreshPlayerData();
        openInventory();
      };
      invArmors.appendChild(btn);
      invArmors.appendChild(document.createElement('br'));
    }
  });
  document.getElementById('inventory-panel').style.display = 'block';
  if (getControls().isLocked) getControls().unlock();
}

function setupShopUI() {
  document.getElementById('close-shop').addEventListener('click', () => {
    document.getElementById('shop-panel').style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && getControls()?.isLocked) {
      const dist = getCamera().position.distanceTo(new THREE.Vector3(-5, 0, 0));
      if (dist < 4) openShop();
    }
  });
}

async function openShop() {
  const res = await fetch(`/api/player/${playerUUID}`);
  const data = await res.json();
  playerState.inventory = data.inventory;
  const weaponsDiv = document.getElementById('shop-weapons');
  const armorsDiv = document.getElementById('shop-armors');
  weaponsDiv.innerHTML = '<strong>Weapons:</strong><br>';
  armorsDiv.innerHTML = '<strong>Armors:</strong><br>';
  for (const [key, w] of Object.entries(WEAPONS)) {
    if (data.inventory.includes(key)) continue;
    const btn = document.createElement('button');
    btn.textContent = `${w.name} - 💥${w.damage} dmg | ⏱️${w.speed}ms | 💰${w.cost}`;
    btn.onclick = async () => {
      await fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: playerUUID, type: 'weapon', key })
      });
      await refreshPlayerData();
      openShop();
    };
    weaponsDiv.appendChild(btn);
    weaponsDiv.appendChild(document.createElement('br'));
  }
  for (const [key, a] of Object.entries(ARMORS)) {
    if (data.inventory.includes(key)) continue;
    const btn = document.createElement('button');
    btn.textContent = `${a.name} - 🛡️${a.defense} def | 💰${a.cost}`;
    btn.onclick = async () => {
      await fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: playerUUID, type: 'armor', key })
      });
      await refreshPlayerData();
      openShop();
    };
    armorsDiv.appendChild(btn);
    armorsDiv.appendChild(document.createElement('br'));
  }
  document.getElementById('shop-panel').style.display = 'block';
  if (getControls().isLocked) getControls().unlock();
}

function setupLeaderboard() {}

async function refreshLeaderboard() {
  const res = await fetch('/api/leaderboard');
  const rows = await res.json();
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = rows.map((r, i) => `<li>#${i+1} Wins: ${r.wins} | 💰${r.gold}</li>`).join('');
}

function setupSettingsToggle() {
  document.getElementById('close-settings').addEventListener('click', () => {
    document.getElementById('settings-panel').style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      e.preventDefault();
      const panel = document.getElementById('settings-panel');
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
      if (getControls().isLocked) getControls().unlock();
    }
  });
}

function setupShopProximityHint() {
  setInterval(() => {
    const hint = document.getElementById('shop-hint');
    if (!getControls()?.isLocked) {
      hint.style.display = 'none';
      return;
    }
    const dist = getCamera().position.distanceTo(new THREE.Vector3(-5, 0, 0));
    hint.style.display = (dist < 4) ? 'block' : 'none';
  }, 200);
}

// ── Smooth remote player interpolation ─────────────────
function updateRemotePlayers(dt) {
  const room = getRoom();
  if (!room || !room.state) return;

  const players = room.state.players;
  const mySessionId = room.sessionId;

  // 1. Update targets, create/remove meshes
  players.forEach((player, sessionId) => {
    if (sessionId === mySessionId) return;

    // Store latest position as target
    if (!remoteTargets[sessionId]) {
      remoteTargets[sessionId] = new THREE.Vector3(player.x, player.y, player.z);
    } else {
      remoteTargets[sessionId].set(player.x, player.y, player.z);
    }

    if (!remoteMeshes[sessionId]) {
      addRemotePlayer(sessionId, player);
    }
  });

  // Clean up players that left
  for (const sessionId in remoteMeshes) {
    if (!players.has(sessionId)) {
      removeRemotePlayer(sessionId);
      delete remoteTargets[sessionId];
    }
  }

  // 2. Interpolate each mesh toward its target
  const lerpFactor = 1.0 - Math.exp(-LERP_SPEED * dt);
  for (const sessionId in remoteMeshes) {
    const mesh = remoteMeshes[sessionId];
    const target = remoteTargets[sessionId];
    if (!mesh || !target) continue;

    // Smooth position
    mesh.position.lerp(target, lerpFactor);

    // Snap rotation (single Y angle)
    const player = players.get(sessionId);
    if (player) mesh.rotation.y = player.rotation;
  }
}

main();