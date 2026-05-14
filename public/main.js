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
  remoteMeshes,
  normalGround,      // ← new import
} from './renderer.js';
import { connectToServer, getRoom, getArenaRoom } from './networking.js';
import { startInputCapture, updateMovement, getMovementState } from './playerController.js';
import { createCombatSystem } from './combat.js';
import { createCameraEffects } from './cameraEffects.js';
import { startArenaFlow, leaveArenaFlow, isArenaActive } from './arenaClient.js';
import { hideAllArenaUI } from './arenaUI.js';
import { startCombatInput, stopCombatInput } from './arenaCombat.js';
import { WEAPONS, ARMORS, TIER_NAMES } from './itemDefs.js';
import { addRemotePlayer, removeRemotePlayer } from './remotePlayers.js';
import { Bot } from './bot.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';   // ← new import

const DEBUG_MAIN = true;
function log(...args) { if (DEBUG_MAIN) console.log('[MAIN]', ...args); }

let playerUUID;
let clock = new THREE.Clock();
let lobbyCombatSystem = null;
let weaponHolder = null;
let cameraEffects = null;

let currentMode = 'lobby';
let arenaPhaseListenerSetup = false;
const remoteTargets = {};

const playerState = {
  gold: 0,
  wins: 0,
  inventory: ['bone_dagger'],
  equippedWeapon: 'bone_dagger',
  equippedArmor: '',
  maxHP: 100,
  hp: 100,
  lastAttackTime: 0,
  weaponSharpness: {},
  armorDurability: {},
  weaponMastery: {},
};

const BASE_SHRPNESS = 100;
const BASE_DURABILITY = 100;
const MASTERY_XP_PER_HIT = 10;

function calculateDurabilityLoss(attackerTier, defenderTier, isHeavy = false) {
  const baseLoss = 1;
  let factor;
  if (attackerTier > defenderTier) {
    factor = 0.2;
  } else if (attackerTier < defenderTier) {
    factor = (defenderTier - attackerTier + 1) * 2;
  } else {
    factor = 1;
  }
  let loss = baseLoss * factor;
  if (isHeavy) loss *= 1.5;
  return Math.round(loss);
}

function calculateMasteryLevel(xp) {
  const scaled = xp / 100;
  const level = Math.floor(Math.pow(scaled, 1 / 1.5)) + 1;
  return Math.max(1, level);
}

function initWeaponSharpness(weaponKey) {
  if (!playerState.weaponSharpness[weaponKey]) {
    playerState.weaponSharpness[weaponKey] = {
      current: BASE_SHRPNESS,
      max: BASE_SHRPNESS,
    };
  }
}

function initArmorDurability(armorKey) {
  if (armorKey && !playerState.armorDurability[armorKey]) {
    playerState.armorDurability[armorKey] = {
      current: BASE_DURABILITY,
      max: BASE_DURABILITY,
    };
  }
}

function onAttackHit(weaponKey, attackType) {
  const weapon = WEAPONS[weaponKey];
  if (!weapon) return;
  const attackerTier = weapon.tier;
  const defenderTier = 0;
  const loss = calculateDurabilityLoss(attackerTier, defenderTier, attackType === 'heavy');

  if (!playerState.weaponSharpness[weaponKey]) {
    initWeaponSharpness(weaponKey);
  }
  const state = playerState.weaponSharpness[weaponKey];
  state.current = Math.max(0, state.current - loss);

  if (!playerState.weaponMastery[weaponKey]) {
    playerState.weaponMastery[weaponKey] = 0;
  }
  playerState.weaponMastery[weaponKey] += MASTERY_XP_PER_HIT;
}

function onPlayerHitCallback(armorKey) {
  if (!armorKey || armorKey === 'none') return;
  const armor = ARMORS[armorKey];
  if (!armor) return;
  const attackerTier = 0;
  const defenderTier = armor.tier;
  const loss = calculateDurabilityLoss(attackerTier, defenderTier);

  if (!playerState.armorDurability[armorKey]) {
    initArmorDurability(armorKey);
  }
  const state = playerState.armorDurability[armorKey];
  state.current = Math.max(0, state.current - loss);
}

const bots = [];
const GROUND_Y = 1.6;

function refreshLockOnTargets() {
  const targets = [window._dummyMesh];
  bots.filter(b => b.alive).forEach(b => targets.push(b.mesh));
  if (lobbyCombatSystem) lobbyCombatSystem.setLockOnTargets(targets);
}

function spawnBot(position) {
  const scene = getScene();
  if (!scene) return null;
  const pos = position || new THREE.Vector3(
    (Math.random() - 0.5) * 8,
    GROUND_Y,
    (Math.random() - 0.5) * 8
  );
  const bot = new Bot(scene, pos);
  bots.push(bot);
  refreshLockOnTargets();
  log('Bot spawned at', pos.toArray());
  return bot;
}

function clearAllBots() {
  bots.forEach(bot => bot.remove());
  bots.length = 0;
  refreshLockOnTargets();
  log('All bots cleared');
}

function setBotForceState(state) {
  bots.forEach(bot => { bot.forceState = state; });
  log('Bots forced state:', state || 'none');
}

window.devConsole = {
  spawnBot: (count = 1) => { for (let i = 0; i < count; i++) spawnBot(); },
  clearBots: clearAllBots,
  setBotsIdle: () => setBotForceState('idle'),
  setBotsHostile: () => setBotForceState(undefined),
  listBots: () => console.table(bots.map(b => ({ hp: b.hp, state: b.state, pos: b.mesh.position.clone() }))),
};

async function main() {
  await initRenderer();

  playerUUID = localStorage.getItem('arenaUUID');
  if (!playerUUID) {
    playerUUID = crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now();
    localStorage.setItem('arenaUUID', playerUUID);
  }

  const scene = getScene();

  // ── Load map and spawn point ────────────────────────────
  const gltfLoader = new GLTFLoader();
  const mapGltf = await gltfLoader.loadAsync('/assets/Grounds_of_Varkh_Map.glb');
  scene.add(mapGltf.scene);
  log('Map loaded');

  // Hide the old flat ground
  if (normalGround) normalGround.visible = false;

  // Locate the spawnpoint
  let spawnpoint = null;
  mapGltf.scene.traverse((child) => {
    if (child.name === 'spawnpoint_test1') {
      spawnpoint = child;
    }
  });

  const rig = getCameraRig();
  if (spawnpoint) {
    const spawnPos = spawnpoint.getWorldPosition(new THREE.Vector3());
    rig.position.copy(spawnPos);
    rig.position.y += 1.6;  // eye height
    rig.quaternion.identity();
    log('Player spawned at', spawnPos.toArray());
  } else {
    console.warn('Spawnpoint “spawnpoint_test1” not found, using default position');
    rig.position.set(0, GROUND_Y + 1.6, 0);
  }

  // ── Reposition dummy near the player ────────────────────
  const dummyMesh = getDummyMesh();
  const playerFeetPos = rig.position.clone();
  playerFeetPos.y = GROUND_Y;
  const angle = Math.random() * Math.PI * 2;
  const dist = 4 + Math.random() * 6;   // 4–10 m away
  dummyMesh.position.copy(playerFeetPos).add(
    new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
  );
  log('Dummy moved to', dummyMesh.position.toArray());

  // ── Rest of the original setup ──────────────────────────
  dummyMesh.hp = 100;
  dummyMesh.maxHp = 100;
  dummyMesh.isDummy = true;

  dummyMesh.geometry.dispose();
  dummyMesh.geometry = new THREE.CylinderGeometry(0.25, 0.25, 1.6, 8);
  dummyMesh.material.color.set(0xaaaaaa);
  // dummyMesh.position is already set above; do not overwrite

  window._dummyMesh = dummyMesh;

  weaponHolder = new THREE.Group();
  const weaponMesh = createWeaponMesh();
  weaponHolder.add(weaponMesh);
  weaponMesh.position.set(0.3, -0.3, -0.5);
  scene.add(weaponHolder);

  lobbyCombatSystem = createCombatSystem(
    weaponMesh,
    dummyMesh,
    playerState,
    WEAPONS,
    ARMORS,
    (target) => {
      log('onTargetDefeated', target === window._dummyMesh ? 'dummy' : 'bot');
      if (target.isDummy) {
        fetch('/api/dummyDefeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: playerUUID }),
        }).then(() => refreshPlayerData()).catch(err => console.error('dummyDefeat error:', err));
        target.hp = target.maxHp;
        log('Dummy respawned');
      } else {
        const bot = bots.find(b => b.mesh === target);
        if (bot && bot.alive) {
          bot.die();
          playerState.gold += 10;
          log('Bot defeated, +10 gold. Total gold:', playerState.gold);
        }
      }
      refreshLockOnTargets();
    },
    onAttackHit,
    onPlayerHitCallback,
    (target, damage) => {
      log('onTargetDamaged called. Target:', target === window._dummyMesh ? 'dummy' : 'bot', 'damage:', damage);
      if (target.isDummy) {
        target.hp -= damage;
        log('Dummy HP now:', target.hp);
      } else {
        const bot = bots.find(b => b.mesh === target);
        if (bot) {
          log('Applying damage to bot, current HP:', bot.hp);
          bot.takeDamage(damage);
          log('Bot HP after damage:', bot.hp);
        } else {
          log('ERROR: Bot not found for target!');
        }
      }
    }
  );

  refreshLockOnTargets();

  let room = null;
  try {
    room = await connectWithTimeout(5000);
    console.log('Connected to server');
    startInputCapture(room, lobbyCombatSystem);
  } catch (err) {
    console.warn('Could not connect to server, running offline:', err);
  }

  await refreshPlayerData();

  const camera = getCamera();
  const chromAberr = getChromaticAberration();
  const velBlur = getVelocityBlur();
  cameraEffects = createCameraEffects(camera, rig, {
    postProcessors: {
      chromaticAberration: chromAberr,
      velocityEffect: velBlur,
    },
  });

  setupInventoryUI();
  setupShopUI();
  setupLeaderboard();
  setupSettingsToggle();
  setupAttackMouseHandlers(lobbyCombatSystem);
  setupShopProximityHint();
  setupTargetCycling();

  setInterval(refreshLeaderboard, 10000);
  refreshLeaderboard();

  setupArenaPhaseWatcher();

  // ── Spawn bots around the player ────────────────────────
  const spawnNear = () => {
    const a = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * 7; // 3–10 m
    spawnBot(new THREE.Vector3(
      playerFeetPos.x + Math.cos(a) * d,
      GROUND_Y,
      playerFeetPos.z + Math.sin(a) * d
    ));
  };
  spawnNear();
  spawnNear();
  log('Initial bots spawned around player');

  setInterval(refreshLockOnTargets, 1000);

  function gameLoop() {
    requestAnimationFrame(gameLoop);
    const delta = clock.getDelta();
    const dt = Math.min(delta, 0.1);

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

      const playerCapsule = getPlayerCapsuleFromRig();
      bots.forEach(bot => {
        bot.update(dt, playerCapsule, (damage) => {
          log('Player hit by bot! damage:', damage);
          playerState.hp -= damage;
          log('Player HP now:', playerState.hp);
          if (playerState.hp <= 0) {
            playerState.hp = playerState.maxHP;
            log('Player died, respawned');
          }
        });
      });

      updateRemotePlayers(dt);
    }

    updateCombatHUD();
    renderFrame();
  }
  gameLoop();
}

function getPlayerCapsuleFromRig() {
  const rig = getCameraRig();
  if (!rig) return { top: new THREE.Vector3(), bottom: new THREE.Vector3(), radius: 0.4 };
  const bottom = rig.position.clone();
  const top = bottom.clone().add(new THREE.Vector3(0, 2.0, 0));
  return { top, bottom, radius: 0.4 };
}

function setupTargetCycling() {
  document.addEventListener('keydown', (e) => {
    if (currentMode !== 'lobby') return;
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!lobbyCombatSystem || !getControls()?.isLocked) return;
      const current = lobbyCombatSystem.getTarget();
      const targets = [window._dummyMesh];
      bots.filter(b => b.alive).forEach(b => targets.push(b.mesh));
      if (targets.length === 0) return;
      const currentIdx = targets.indexOf(current);
      const nextIdx = (currentIdx + 1) % targets.length;
      lobbyCombatSystem.setTarget(targets[nextIdx]);
      log('Switched target to', targets[nextIdx] === window._dummyMesh ? 'dummy' : 'bot');
    }
  });
}

function updateCombatHUD() {
  document.getElementById('player-hp').textContent = `${playerState.hp}/${playerState.maxHP}`;
}

function connectWithTimeout(ms) {
  return Promise.race([
    connectToServer(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), ms)
    ),
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
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousedown', (e) => {
    if (currentMode !== 'lobby') return;
    if (!getControls()?.isLocked) return;
    if (e.button === 0) combat.tryLightAttack();
    else if (e.button === 2) combat.tryHeavyAttack();
  });
}

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

    initWeaponSharpness(playerState.equippedWeapon);
    if (playerState.equippedArmor) {
      initArmorDurability(playerState.equippedArmor);
    }

    updateHUD(data);
  } catch (e) {
    console.error('Failed to fetch player data', e);
  }
}

function updateHUD(data) {
  document.getElementById('player-hp').textContent = playerState.hp;
  document.getElementById('player-gold').textContent = data.gold;
  document.getElementById('weapon-name').textContent = WEAPONS[data.equipped_weapon]?.name || 'None';
  document.getElementById('armor-name').textContent = data.equipped_armor
    ? ARMORS[data.equipped_armor].name
    : 'None';
  document.getElementById('wins').textContent = data.wins;

  const weaponKey = data.equipped_weapon;
  if (weaponKey && WEAPONS[weaponKey]) {
    const sharp = playerState.weaponSharpness[weaponKey];
    const masteryXP = playerState.weaponMastery[weaponKey] || 0;
    const level = calculateMasteryLevel(masteryXP);
    const sharpStr = sharp ? `${sharp.current}/${sharp.max}` : '?';
    document.getElementById('weapon-name').textContent +=
      ` [⚔️ ${sharpStr} | 🧠 Lv${level}]`;
  }
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

  data.inventory.forEach((key) => {
    if (WEAPONS[key]) {
      const btn = document.createElement('button');
      btn.textContent = `Equip ${WEAPONS[key].name}`;
      btn.onclick = async () => {
        await fetch('/api/equip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: playerUUID, type: 'weapon', key }),
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
          body: JSON.stringify({ uuid: playerUUID, type: 'armor', key }),
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
      const dist = getCamera()
        .position.distanceTo(new THREE.Vector3(-5, 0, 0));
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
    btn.textContent = `${w.name} - 💥${w.damage} dmg | ⏱️${w.speed}ms | 🛡️Tier${w.tier} | 💰${w.cost}`;
    btn.onclick = async () => {
      await fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: playerUUID, type: 'weapon', key }),
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
    btn.textContent = `${a.name} - 🛡️${a.defense} def | 🛡️Tier${a.tier} | 💰${a.cost}`;
    btn.onclick = async () => {
      await fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: playerUUID, type: 'armor', key }),
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
  list.innerHTML = rows
    .map((r, i) => `<li>#${i + 1} Wins: ${r.wins} | 💰${r.gold}</li>`)
    .join('');
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
    const dist = getCamera()
      .position.distanceTo(new THREE.Vector3(-5, 0, 0));
    hint.style.display = dist < 4 ? 'block' : 'none';
  }, 200);
}

function updateRemotePlayers(dt) {
  const room = getRoom();
  if (!room || !room.state) return;

  const players = room.state.players;
  const mySessionId = room.sessionId;

  players.forEach((player, sessionId) => {
    if (sessionId === mySessionId) return;
    if (!remoteTargets[sessionId]) {
      remoteTargets[sessionId] = new THREE.Vector3(player.x, player.y, player.z);
    } else {
      remoteTargets[sessionId].set(player.x, player.y, player.z);
    }
    if (!remoteMeshes[sessionId]) {
      addRemotePlayer(sessionId, player);
    }
  });

  for (const sessionId in remoteMeshes) {
    if (!players.has(sessionId)) {
      removeRemotePlayer(sessionId);
      delete remoteTargets[sessionId];
    }
  }

  const lerpFactor = 1.0 - Math.exp(-25.0 * dt);
  for (const sessionId in remoteMeshes) {
    const mesh = remoteMeshes[sessionId];
    const target = remoteTargets[sessionId];
    if (!mesh || !target) continue;
    mesh.position.lerp(target, lerpFactor);
    const player = players.get(sessionId);
    if (player) mesh.rotation.y = player.rotation;
  }
}

main();