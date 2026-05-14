// remotePlayers.js
import * as THREE from 'three';                               // MUST import
import { addRemotePlayerMesh, removeRemotePlayerMesh, updateRemotePlayerMesh } from './renderer.js';

export function addRemotePlayer(sessionId, playerState) {
  const position = new THREE.Vector3(playerState.x, playerState.y, playerState.z);
  addRemotePlayerMesh(sessionId, position);

  // Listen to changes from the server
  playerState.onChange = () => {
    updateRemotePlayerMesh(sessionId, playerState.x, playerState.y, playerState.z);
  };
}

export function removeRemotePlayer(sessionId) {
  removeRemotePlayerMesh(sessionId);
}