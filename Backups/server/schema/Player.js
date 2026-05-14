const { Schema, type, ArraySchema } = require('@colyseus/schema');

class Player extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.rotation = 0;
    this.uuid = "";
    this.username = "";
    this.gold = 0;
    this.inventory = new ArraySchema();
    this.equippedWeapon = "rusty_dagger";
    this.equippedArmor = "";
    this.isRegistered = false;
    this.tier = 0;
    this.stars = 0;
  }
}

type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("number")(Player.prototype, "z");
type("number")(Player.prototype, "rotation");
type("string")(Player.prototype, "uuid");
type("string")(Player.prototype, "username");
type("number")(Player.prototype, "gold");
type(["string"])(Player.prototype, "inventory");
type("string")(Player.prototype, "equippedWeapon");
type("string")(Player.prototype, "equippedArmor");
type("boolean")(Player.prototype, "isRegistered");
type("number")(Player.prototype, "tier");
type("number")(Player.prototype, "stars");

module.exports = { Player };