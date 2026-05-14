const { Schema, type, MapSchema } = require('@colyseus/schema');
const { Fighter } = require('./Fighter');

class Bet extends Schema {
  constructor() {
    super();
    this.sessionId = "";
    this.fighterId = "";
    this.amount = 0;
  }
}

type("string")(Bet.prototype, "sessionId");
type("string")(Bet.prototype, "fighterId");
type("number")(Bet.prototype, "amount");

class ArenaMatchState extends Schema {
  constructor() {
    super();
    this.phase = "waiting"; // waiting | layout | betting | combat | results
    this.fighters = new MapSchema();
    this.bets = new MapSchema();
    this.countdown = 0;
    this.winner = null;
    this.underdogBonus = false;
  }
}

type("string")(ArenaMatchState.prototype, "phase");
type({ map: Fighter })(ArenaMatchState.prototype, "fighters");
type({ map: Bet })(ArenaMatchState.prototype, "bets");
type("number")(ArenaMatchState.prototype, "countdown");
type("string")(ArenaMatchState.prototype, "winner");
type("boolean")(ArenaMatchState.prototype, "underdogBonus");

module.exports = { ArenaMatchState, Bet };