// itemDefs.js
// Client-side copy of weapon, armor, spell, and special definitions.
// Used by arena UI and other modules.

export const WEAPONS = {
  rusty_dagger: { name: 'Rusty Dagger', damage: 5, speed: 800, cost: 0 },
  iron_sword:   { name: 'Iron Sword',   damage: 10, speed: 700, cost: 50 },
  battle_axe:   { name: 'Battle Axe',   damage: 18, speed: 1000, cost: 120 },
  war_mace:     { name: 'War Mace',     damage: 14, speed: 850, cost: 100 },
  shadow_spear: { name: 'Shadow Spear', damage: 22, speed: 1100, cost: 200 }
};

export const ARMORS = {
  cloth_armor:   { name: 'Cloth Armor',   defense: 2, cost: 20 },
  leather_armor: { name: 'Leather Armor', defense: 5, cost: 60 },
  chainmail:     { name: 'Chainmail',     defense: 9, cost: 140 },
  plate_armor:   { name: 'Plate Armor',   defense: 14, cost: 250 },
  dragon_scale:  { name: 'Dragon Scale',  defense: 20, cost: 400 }
};

export const SPELLS = {
  fireball: { name: 'Fireball', damage: 15, manaCost: 30, cooldown: 5000 },
  heal:     { name: 'Heal',     healAmount: 20, manaCost: 20, cooldown: 8000 },
  shield:   { name: 'Shield',   damageReduction: 0.5, duration: 3000, manaCost: 25, cooldown: 12000 },
  poison:   { name: 'Poison',   dotDamage: 5, ticks: 4, interval: 1000, manaCost: 35, cooldown: 10000 },
  lightning:{ name: 'Lightning', damage: 25, manaCost: 40, cooldown: 7000 }
};

export const SPECIALS = {
  berserk:  { name: 'Berserk',   damageMultiplier: 1.5, duration: 4000, cooldown: 20000 },
  healAura: { name: 'Heal Aura', healPerSec: 10, duration: 5000, cooldown: 25000 },
  reflect:  { name: 'Reflect',   reflectPercent: 0.5, duration: 3000, cooldown: 18000 }
};