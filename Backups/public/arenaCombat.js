// arenaCombat.js
// Input capture for arena combat phase.
// Listens for mouse clicks and key presses during combat, enforcing local cooldowns
// for responsiveness before sending messages to the server.
import { getArenaRoom } from './networking.js';
import { isArenaActive } from './arenaClient.js'; // to check current phase

const COOLDOWNS = {
  lightAttack: 800,   // ms, should match weapon speed, but we'll use a default
  heavyAttack: 1200,   // slower
  spell: 2000,         // generic spell cooldown, actual cooldowns vary per spell on server
  potion: 1000
};

let combatActive = false;
let lastAttackTime = 0;
let lastSpellTime = 0;
let lastPotionTime = 0;

// Handlers
function onMouseDown(e) {
  if (!combatActive) return;
  const room = getArenaRoom();
  if (!room) return;

  const now = Date.now();
  if (e.button === 0) { // left click -> light attack
    if (now - lastAttackTime < COOLDOWNS.lightAttack) return;
    lastAttackTime = now;
    room.send('attack', { type: 'light' });
  } else if (e.button === 2) { // right click -> heavy attack
    if (now - lastAttackTime < COOLDOWNS.heavyAttack) return;
    lastAttackTime = now;
    room.send('attack', { type: 'heavy' });
  }
}

function onKeyDown(e) {
  if (!combatActive) return;
  const room = getArenaRoom();
  if (!room) return;

  const now = Date.now();
  // Spell hotkeys: 1,2,3 correspond to spells in order (fireball, heal, shield? or from layout)
  // We'll assume fixed mapping; later could be dynamic based on layout.
  const spellMap = {
    'Digit1': 'fireball',
    'Digit2': 'heal',
    'Digit3': 'shield'
  };

  if (e.code in spellMap) {
    if (now - lastSpellTime < COOLDOWNS.spell) return;
    lastSpellTime = now;
    room.send('useSpell', { spell: spellMap[e.code] });
  }

  // Potion hotkeys: 'H' for heal, 'M' for mana
  if (e.code === 'KeyH') {
    if (now - lastPotionTime < COOLDOWNS.potion) return;
    lastPotionTime = now;
    room.send('usePotion', { type: 'heal' });
  } else if (e.code === 'KeyM') {
    if (now - lastPotionTime < COOLDOWNS.potion) return;
    lastPotionTime = now;
    room.send('usePotion', { type: 'mana' });
  }
}

function preventContextMenu(e) {
  e.preventDefault();
}

export function startCombatInput() {
  combatActive = true;
  document.addEventListener('contextmenu', preventContextMenu);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('keydown', onKeyDown);
}

export function stopCombatInput() {
  combatActive = false;
  document.removeEventListener('contextmenu', preventContextMenu);
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('keydown', onKeyDown);
  lastAttackTime = 0;
  lastSpellTime = 0;
  lastPotionTime = 0;
}