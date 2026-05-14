// utils.js
// Shared utility functions for the client.

export function getPlayerUUID() {
  let uuid = localStorage.getItem('arenaUUID');
  if (!uuid) {
    uuid = crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now();
    localStorage.setItem('arenaUUID', uuid);
  }
  return uuid;
}