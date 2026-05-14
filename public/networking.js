// networking.js
import { addRemotePlayer, removeRemotePlayer } from './remotePlayers.js';

const client = new Colyseus.Client('ws://localhost:3000');
let lobbyRoom = null;
let arenaRoom = null;
let playerUUID = null;

async function ensureUUID() {
  if (!playerUUID) {
    playerUUID = localStorage.getItem('arenaUUID');
    if (!playerUUID) {
      playerUUID = crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now();
      localStorage.setItem('arenaUUID', playerUUID);
    }
  }
}

export async function connectToServer() {
  await ensureUUID();

  try {
    lobbyRoom = await client.joinOrCreate('lobby', { uuid: playerUUID });
  } catch (err) {
    console.error('Could not join lobby:', err);
    alert('Failed to connect to the game server. Make sure the server is running.');
    throw err;
  }

  console.log('Joined lobby as', lobbyRoom.sessionId);

  // Suppress session message
  lobbyRoom.onMessage('session', () => {});

  // Match events
  lobbyRoom.onMessage('matchFound', (msg) => {
    console.log('Match found, roomId:', msg.roomId);
    joinArenaMatch(msg.roomId, false);
  });

  lobbyRoom.onMessage('spectateMatch', (msg) => {
    console.log('Spectate match, roomId:', msg.roomId);
    joinArenaMatch(msg.roomId, true);
  });

  return lobbyRoom;
}

export async function joinArenaMatch(roomId, asSpectator) {
  await ensureUUID();

  if (lobbyRoom) {
    try { lobbyRoom.leave(); } catch (e) { /* ignore */ }
    lobbyRoom = null;
  }

  try {
    arenaRoom = await client.joinById(roomId, {
      uuid: playerUUID,
      spectate: asSpectator
    });
    console.log(`Joined arena match ${roomId} as ${asSpectator ? 'spectator' : 'fighter'}`);
  } catch (err) {
    console.error('Failed to join arena match:', err);
    returnToLobby();
    throw err;
  }

  return arenaRoom;
}

export async function returnToLobby() {
  if (arenaRoom) {
    try { arenaRoom.leave(); } catch (e) { /* ignore */ }
    arenaRoom = null;
  }

  if (!lobbyRoom) {
    await ensureUUID();
    try {
      lobbyRoom = await client.joinOrCreate('lobby', { uuid: playerUUID });
    } catch (err) {
      console.error('Could not rejoin lobby:', err);
    }
  }

  return lobbyRoom;
}

export function getRoom() {
  return lobbyRoom;
}

export function getArenaRoom() {
  return arenaRoom;
}