// LobbyRoom.js
const { Room } = require('colyseus');
const { LobbyState } = require('../schema/LobbyState');
const { Player } = require('../schema/Player');
const auth = require('../auth');
const db = require('../db');
const { activeMatches } = require('../matchRegistry');

class LobbyRoom extends Room {
  onCreate(options) {
    this.setState(new LobbyState());
    this.maxClients = 300;
    this.queue = [];

    this.onMessage('move', (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.x = data.x;
      player.y = data.y;
      player.z = data.z;
      player.rotation = data.rotation;
    });

    this.onMessage('registerArena', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isRegistered) return;
      if (player.gold < 250) return client.send('error', { msg: 'Not enough gold' });
      player.gold -= 250;
      player.isRegistered = true;
      const pData = db.getPlayer(player.uuid);
      if (pData) {
        pData.gold = player.gold;
        db.savePlayer(player.uuid, pData);
      }
    });

    this.onMessage('queueForMatch', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isRegistered) return;
      if (this.queue.find(q => q.client.sessionId === client.sessionId)) return;
      this.queue.push({ sessionId: client.sessionId, client, tier: player.tier, uuid: player.uuid });
      this.tryMatchmake();
    });

    this.onMessage('leaveQueue', (client) => {
      this.queue = this.queue.filter(q => q.client.sessionId !== client.sessionId);
    });

    this.onMessage('listMatches', (client) => {
      const matches = [];
      for (const [roomId, match] of activeMatches) {
        matches.push({
          roomId,
          fighter1Id: match.fighter1,
          fighter2Id: match.fighter2,
          startedAt: match.startedAt
        });
      }
      client.send('matchList', matches);
    });

    this.onMessage('spectateMatch', (client, msg) => {
      const roomId = msg.roomId;
      if (!activeMatches.has(roomId)) return client.send('error', { msg: 'Match not found' });
      client.send('spectateMatch', { roomId });
    });
  }

  tryMatchmake() {
    if (this.queue.length < 2) return;
    const tierGroups = {};
    for (const entry of this.queue) {
      if (!tierGroups[entry.tier]) tierGroups[entry.tier] = [];
      tierGroups[entry.tier].push(entry);
    }
    for (const tier of Object.keys(tierGroups)) {
      const group = tierGroups[tier];
      while (group.length >= 2) {
        const p1 = group.shift();
        const p2 = group.shift();
        this.createMatch(p1, p2);
      }
    }
    this.queue = Object.values(tierGroups).flat();
  }

  async createMatch(p1, p2) {
    // Use player UUIDs for identification across rooms
    const room = await this.presence.create("arena_match", {
      fighterUUID1: p1.uuid,
      fighterUUID2: p2.uuid
    });
    p1.client.send('matchFound', { roomId: room.roomId });
    p2.client.send('matchFound', { roomId: room.roomId });
    this.queue = this.queue.filter(q => q.client.sessionId !== p1.client.sessionId && q.client.sessionId !== p2.client.sessionId);
  }

  onAuth(client, options, request) {
    if (options.token) {
      const uuid = auth.verifyToken(options.token);
      if (uuid) return uuid;
    }
    return options.uuid || 'guest-' + client.sessionId;
  }

  onJoin(client, options, auth) {
    const uuid = auth;
    const player = new Player();
    player.uuid = uuid;
    player.username = `Fighter_${uuid.slice(0,6)}`;
    const pData = db.getPlayer(uuid);
    if (pData) {
      player.gold = pData.gold;
      player.inventory.push(...pData.inventory);
      player.equippedWeapon = pData.equipped_weapon || 'rusty_dagger';
      player.equippedArmor = pData.equipped_armor || '';
      player.tier = pData.tier || 0;
      player.stars = pData.stars || 0;
      player.isRegistered = false;
    }
    player.x = Math.random() * 5 - 2.5;
    player.z = Math.random() * 5 - 2.5;
    player.y = 1.6;
    this.state.players.set(client.sessionId, player);
    client.send('session', { sessionId: client.sessionId, uuid });
  }

  onLeave(client, consented) {
    this.queue = this.queue.filter(q => q.client.sessionId !== client.sessionId);
    this.state.players.delete(client.sessionId);
  }
}

module.exports = { LobbyRoom };