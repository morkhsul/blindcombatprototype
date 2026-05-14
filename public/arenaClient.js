// arenaClient.js
// Handles arena room lifecycle and delegates UI updates to arenaUI.js
import { getArenaRoom, returnToLobby } from './networking.js';
import {
  showLayoutUI,
  showBettingUI,
  showCombatUI,
  showResultsUI,
  hideAllArenaUI,
  updateCountdown,
  updateFighterStats
} from './arenaUI.js';

let arenaFlowActive = false;
let lastPhase = null;

export async function startArenaFlow(roomId, asSpectator) {
  if (arenaFlowActive) return;
  arenaFlowActive = true;

  try {
    const { joinArenaMatch } = await import('./networking.js');
    const room = await joinArenaMatch(roomId, asSpectator);
    setupArenaRoomListeners(room);
  } catch (err) {
    console.error('Failed to start arena flow:', err);
    arenaFlowActive = false;
    // Fallback
    returnToLobby();
  }
}

function setupArenaRoomListeners(room) {
  // Listen for state changes to detect phase transitions
  room.onStateChange((state) => {
    if (!state) return;

    const phase = state.phase;
    if (phase !== lastPhase) {
      console.log('Arena phase changed to:', phase);
      hideAllArenaUI();
      switch (phase) {
        case 'layout':
          showLayoutUI(state, room);
          break;
        case 'betting':
          showBettingUI(state, room);
          break;
        case 'combat':
          showCombatUI(state, room);
          break;
        case 'results':
          showResultsUI(state, room);
          break;
        default:
          break;
      }
      lastPhase = phase;
    }

    // Update countdown (betting phase timer)
    if (phase === 'betting') {
      updateCountdown(state.countdown);
    }

    // Update fighter stats (HP, mana) during combat
    if (phase === 'combat') {
      updateFighterStats(state.fighters);
    }
  });

  room.onMessage('error', (msg) => {
    console.error('Arena error:', msg.msg);
    // Could show an error toast
  });

  // Handle leave (e.g., room closed)
  room.onLeave((code) => {
    console.log('Arena room left, code:', code);
    cleanupArena();
  });
}

function cleanupArena() {
  hideAllArenaUI();
  arenaFlowActive = false;
  lastPhase = null;

  // Return to lobby automatically
  returnToLobby().then(() => {
    // Notify main.js flow controller? In main.js we'll detect lobby availability.
  });
}

export function leaveArenaFlow() {
  const room = getArenaRoom();
  if (room) {
    room.leave();
  }
  cleanupArena();
}

export function isArenaActive() {
  return arenaFlowActive;
}