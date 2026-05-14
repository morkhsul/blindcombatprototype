const { Schema, type, ArraySchema, MapSchema } = require('@colyseus/schema');

class FighterLayout extends Schema {
  constructor() {
    super();
    this.weapon1 = "rusty_dagger";
    this.weapon2 = "rusty_dagger";
    this.armor = "";
    this.spells = new ArraySchema("fireball", "heal", "shield");
    this.special = "berserk";
    this.potions = new MapSchema(); // heal: number, mana: number
    this.selfBet = 50;
  }
}

type("string")(FighterLayout.prototype, "weapon1");
type("string")(FighterLayout.prototype, "weapon2");
type("string")(FighterLayout.prototype, "armor");
type(["string"])(FighterLayout.prototype, "spells");
type("string")(FighterLayout.prototype, "special");
type({ map: "number" })(FighterLayout.prototype, "potions");
type("number")(FighterLayout.prototype, "selfBet");

class Fighter extends Schema {
  constructor() {
    super();
    this.sessionId = "";
    this.uuid = "";
    this.hp = 100;
    this.maxHp = 100;
    this.mana = 100;
    this.maxMana = 100;
    this.layout = new FighterLayout();
    this.alive = true;
  }
}

type("string")(Fighter.prototype, "sessionId");
type("string")(Fighter.prototype, "uuid");
type("number")(Fighter.prototype, "hp");
type("number")(Fighter.prototype, "maxHp");
type("number")(Fighter.prototype, "mana");
type("number")(Fighter.prototype, "maxMana");
type(FighterLayout)(Fighter.prototype, "layout");
type("boolean")(Fighter.prototype, "alive");

module.exports = { Fighter, FighterLayout };