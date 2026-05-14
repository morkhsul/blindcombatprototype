// itemDefs.js
export const WEAPONS = {
  // Pig-Leather tier (1)
  bone_dagger:       { name: 'Bone Dagger',              damage: 4,  speed: 600,  cost: 0,  tier: 1 },
  wooden_club:       { name: 'Wooden Club',              damage: 6,  speed: 900,  cost: 10, tier: 1 },
  slingshot:         { name: 'Slingshot',                damage: 5,  speed: 700,  cost: 10, tier: 1 },

  // Bronze tier (2)
  bronze_shortsword: { name: 'Bronze Shortsword',        damage: 9,  speed: 650,  cost: 60, tier: 2 },
  bronze_spear:      { name: 'Bronze Spear',             damage: 10, speed: 750,  cost: 70, tier: 2 },
  bronze_hatchet:    { name: 'Bronze Hatchet',           damage: 11, speed: 800,  cost: 80, tier: 2 },

  // Brass tier (3)
  brass_longsword:   { name: 'Brass Longsword',          damage: 14, speed: 700,  cost: 130, tier: 3 },
  brass_mace:        { name: 'Brass Mace',               damage: 16, speed: 850,  cost: 150, tier: 3 },
  brass_bow:         { name: 'Brass Bow',                damage: 13, speed: 750,  cost: 140, tier: 3 },

  // Iron tier (4)
  iron_broadsword:   { name: 'Iron Broadsword',          damage: 20, speed: 800,  cost: 220, tier: 4 },
  iron_war_axe:      { name: 'Iron War Axe',             damage: 24, speed: 1000, cost: 250, tier: 4 },
  iron_lance:        { name: 'Iron Lance',               damage: 22, speed: 1100, cost: 230, tier: 4 },

  // Steel-Laced tier (5)
  reinforced_steel_blade: { name: 'Reinforced Steel Blade', damage: 28, speed: 850,  cost: 340, tier: 5 },
  steel_flanged_mace:     { name: 'Steel Flanged Mace',     damage: 30, speed: 950,  cost: 370, tier: 5 },
  steel_katana:           { name: 'Steel Katana',           damage: 27, speed: 750,  cost: 350, tier: 5 },

  // Steel-Plate tier (6)
  steel_greatsword: { name: 'Steel Greatsword',          damage: 36, speed: 1000, cost: 500, tier: 6 },
  steel_warhammer:  { name: 'Steel Warhammer',           damage: 40, speed: 1200, cost: 550, tier: 6 },
  steel_halberd:    { name: 'Steel Halberd',             damage: 38, speed: 1100, cost: 520, tier: 6 }
};

export const ARMORS = {
  // Pig-Leather (tier 1)
  pig_leather_armor:   { name: 'Pig-Leather Armor',   defense: 2,  cost: 20, tier: 1 },
  // Bronze-Plate (tier 2)
  bronze_plate_armor:  { name: 'Bronze-Plate Armor',  defense: 5,  cost: 80, tier: 2 },
  // Brass-Plate (tier 3)
  brass_plate_armor:   { name: 'Brass-Plate Armor',   defense: 9,  cost: 180, tier: 3 },
  // Iron-Plate (tier 4)
  iron_plate_armor:    { name: 'Iron-Plate Armor',    defense: 14, cost: 320, tier: 4 },
  // Steel-Laced (tier 5)
  steel_laced_armor:   { name: 'Steel-Laced Armor',   defense: 20, cost: 500, tier: 5 },
  // Steel-Plate (tier 6)
  steel_plate_armor:   { name: 'Steel-Plate Armor',   defense: 28, cost: 750, tier: 6 }
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

// Tier values for quick access
export const TIER_NAMES = {
  1: 'Pig-Leather',
  2: 'Bronze',
  3: 'Brass',
  4: 'Iron',
  5: 'Steel-Laced',
  6: 'Steel-Plate'
};