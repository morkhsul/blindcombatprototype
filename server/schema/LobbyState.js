const { Schema, type, MapSchema } = require('@colyseus/schema');
const { Player } = require('./Player');

class LobbyState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
  }
}

type({ map: Player })(LobbyState.prototype, "players");

module.exports = { LobbyState };