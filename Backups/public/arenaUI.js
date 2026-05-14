// arenaUI.js
// Handles all phase-specific arena UI overlays.
import { getArenaRoom, returnToLobby } from './networking.js';
import { WEAPONS, ARMORS, SPELLS, SPECIALS } from './itemDefs.js';
import { getPlayerUUID } from './utils.js';

let currentPhase = null;
const SELF_BET_OPTIONS = [50, 100, 500, 1000];

// ---------- HTML element references ----------
const layoutPanel = document.getElementById('arena-layout-panel');
const bettingPanel = document.getElementById('arena-betting-panel');
const combatPanel = document.getElementById('arena-combat-panel');
const resultsPanel = document.getElementById('arena-results-panel');

// ---------- Show / Hide panels ----------
export function hideAllArenaUI() {
  [layoutPanel, bettingPanel, combatPanel, resultsPanel].forEach(panel => {
    if (panel) panel.style.display = 'none';
  });
}

// ---------- Layout Phase ----------
export function showLayoutUI(state, room) {
  if (!layoutPanel) return;
  layoutPanel.style.display = 'block';

  const weapon1Select = layoutPanel.querySelector('#layout-weapon1');
  const weapon2Select = layoutPanel.querySelector('#layout-weapon2');
  const armorSelect = layoutPanel.querySelector('#layout-armor');
  const spellCheckboxes = layoutPanel.querySelectorAll('.layout-spell-check');
  const specialSelect = layoutPanel.querySelector('#layout-special');
  const healPotionsInput = layoutPanel.querySelector('#layout-heal-potions');
  const manaPotionsInput = layoutPanel.querySelector('#layout-mana-potions');
  const selfBetSelect = layoutPanel.querySelector('#layout-self-bet');
  const submitBtn = layoutPanel.querySelector('#layout-submit');

  populateSelect(weapon1Select, WEAPONS);
  populateSelect(weapon2Select, WEAPONS);
  populateSelect(armorSelect, { '': { name: 'None' }, ...ARMORS });
  populateSelect(specialSelect, SPECIALS);
  populateSelect(selfBetSelect, Object.fromEntries(SELF_BET_OPTIONS.map(b => [b, b])));

  // Default values
  weapon1Select.value = 'rusty_dagger';
  weapon2Select.value = 'rusty_dagger';
  armorSelect.value = '';
  specialSelect.value = 'berserk';
  healPotionsInput.value = 0;
  manaPotionsInput.value = 0;
  selfBetSelect.value = 50;
  spellCheckboxes.forEach(cb => cb.checked = false);

  submitBtn.onclick = () => {
    const selectedSpells = [];
    spellCheckboxes.forEach(cb => {
      if (cb.checked) selectedSpells.push(cb.value);
    });
    // Ensure exactly 3 spells (fallback to fireball if less)
    while (selectedSpells.length < 3) selectedSpells.push('fireball');
    const chosenSpells = selectedSpells.slice(0, 3);

    const layout = {
      weapon1: weapon1Select.value,
      weapon2: weapon2Select.value,
      armor: armorSelect.value,
      spells: chosenSpells,
      special: specialSelect.value,
      healPotions: parseInt(healPotionsInput.value) || 0,
      manaPotions: parseInt(manaPotionsInput.value) || 0,
      selfBet: parseInt(selfBetSelect.value)
    };

    room.send('setLayout', { layout });
  };
}

// ---------- Betting Phase ----------
export function showBettingUI(state, room) {
  if (!bettingPanel) return;
  bettingPanel.style.display = 'block';

  const countdownEl = bettingPanel.querySelector('#bet-countdown');
  const fighter1Info = bettingPanel.querySelector('#bet-fighter1');
  const fighter2Info = bettingPanel.querySelector('#bet-fighter2');
  const betAmountInput = bettingPanel.querySelector('#bet-amount');
  const betOnFighter1Btn = bettingPanel.querySelector('#bet-fighter1-btn');
  const betOnFighter2Btn = bettingPanel.querySelector('#bet-fighter2-btn');

  const fighterArray = Array.from(state.fighters.values());
  if (fighterArray.length >= 2) {
    displayFighterLayout(fighter1Info, fighterArray[0].layout);
    displayFighterLayout(fighter2Info, fighterArray[1].layout);
  }

  const fighter1Id = fighterArray[0]?.sessionId;
  const fighter2Id = fighterArray[1]?.sessionId;

  betOnFighter1Btn.onclick = () => {
    const amount = parseInt(betAmountInput.value);
    if (amount > 0) room.send('placeBet', { fighterId: fighter1Id, amount });
  };
  betOnFighter2Btn.onclick = () => {
    const amount = parseInt(betAmountInput.value);
    if (amount > 0) room.send('placeBet', { fighterId: fighter2Id, amount });
  };

  updateCountdown(state.countdown);
}

export function updateCountdown(countdown) {
  const el = document.getElementById('bet-countdown');
  if (el) el.textContent = countdown;
}

// ---------- Combat Phase ----------
export function showCombatUI(state, room) {
  if (!combatPanel) return;
  combatPanel.style.display = 'block';

  // Fix HP bar IDs dynamically based on fighter session IDs
  const fighterKeys = Array.from(state.fighters.keys());
  if (fighterKeys.length === 2) {
    window._arenaFighter1Id = fighterKeys[0];
    window._arenaFighter2Id = fighterKeys[1];

    const hpBar1 = document.getElementById('combat-hp-fighter1');
    const hpBar2 = document.getElementById('combat-hp-fighter2');
    if (hpBar1) hpBar1.id = `combat-hp-${fighterKeys[0]}`;
    if (hpBar2) hpBar2.id = `combat-hp-${fighterKeys[1]}`;

    // Update current stats immediately
    updateFighterStats(state.fighters);
  }

  // Action buttons
  document.getElementById('combat-light-attack').onclick = () => room.send('attack', { type: 'light' });
  document.getElementById('combat-heavy-attack').onclick = () => room.send('attack', { type: 'heavy' });

  document.querySelectorAll('.combat-spell-btn').forEach(btn => {
    btn.onclick = () => room.send('useSpell', { spell: btn.dataset.spell });
  });

  document.getElementById('combat-heal-potion').onclick = () => room.send('usePotion', { type: 'heal' });
  document.getElementById('combat-mana-potion').onclick = () => room.send('usePotion', { type: 'mana' });
}

export function updateFighterStats(fighters) {
  fighters.forEach((fighter, sessionId) => {
    const hpBar = document.getElementById(`combat-hp-${sessionId}`);
    const manaBar = document.getElementById(`combat-mana-${sessionId}`);
    if (hpBar) hpBar.textContent = `HP: ${fighter.hp}/${fighter.maxHp}`;
    if (manaBar) manaBar.textContent = `Mana: ${fighter.mana}/${fighter.maxMana}`;
  });
}

// ---------- Results Phase ----------
export function showResultsUI(state, room) {
  if (!resultsPanel) return;
  resultsPanel.style.display = 'block';

  const winnerEl = resultsPanel.querySelector('#results-winner');
  const earningsEl = resultsPanel.querySelector('#results-earnings');
  const rankChangeEl = resultsPanel.querySelector('#results-rank-change');
  const returnBtn = resultsPanel.querySelector('#results-return-btn');

  const winner = state.winner;

  // Fetch updated player data from server to show correct gold/rank
  fetchPlayerResults().then(data => {
    winnerEl.textContent = `Winning Fighter: ${winner}`;
    if (state.underdogBonus) {
      earningsEl.textContent = `You won! Underdog bonus applied (3x multiplier)! New gold: ${data.gold}`;
    } else {
      earningsEl.textContent = `You won! New gold: ${data.gold}`;
    }
    rankChangeEl.textContent = `Stars: ${data.stars} | Tier: ${data.tier}`;
  }).catch(() => {
    winnerEl.textContent = `Winning Fighter: ${winner}`;
    earningsEl.textContent = 'Match ended.';
  });

  returnBtn.onclick = () => {
    // Use the leaveArenaFlow function from arenaClient to cleanly exit
    import('./arenaClient.js').then(module => module.leaveArenaFlow());
  };
}

// ---------- Helper functions ----------
function populateSelect(selectEl, items) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  for (const [key, item] of Object.entries(items)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = item.name || key;
    selectEl.appendChild(option);
  }
}

function displayFighterLayout(containerEl, layout) {
  if (!containerEl) return;
  containerEl.innerHTML = `
    Weapons: ${WEAPONS[layout.weapon1]?.name}, ${WEAPONS[layout.weapon2]?.name}<br>
    Armor: ${ARMORS[layout.armor]?.name || 'None'}<br>
    Spells: ${layout.spells.join(', ')}<br>
    Special: ${SPECIALS[layout.special]?.name}<br>
    Potions: Heal x${layout.potions?.heal ?? 0}, Mana x${layout.potions?.mana ?? 0}
  `;
}

async function fetchPlayerResults() {
  const uuid = getPlayerUUID();
  const res = await fetch(`/api/player/${uuid}`);
  return res.json();
}