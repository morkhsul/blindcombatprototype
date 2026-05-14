// db.js
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'game.db');
let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode=WAL');

  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      uuid TEXT PRIMARY KEY,
      gold INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      inventory TEXT DEFAULT '["bone_dagger"]',
      equipped_weapon TEXT DEFAULT 'bone_dagger',
      equipped_armor TEXT DEFAULT '',
      stars INTEGER DEFAULT 0,
      tier INTEGER DEFAULT 0
    )
  `);

  try { db.run('ALTER TABLE players ADD COLUMN stars INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run('ALTER TABLE players ADD COLUMN tier INTEGER DEFAULT 0'); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      email TEXT UNIQUE,
      passwordHash TEXT,
      uuid TEXT PRIMARY KEY
    )
  `);

  // Migrate old item keys to new ones
  migrateOldItems();

  saveDB();
}

// ---- Migration maps ----
const WEAPON_MIGRATION = {
  'rusty_dagger':   'bone_dagger',
  'iron_sword':     'bronze_shortsword',
  'battle_axe':     'bronze_hatchet',
  'war_mace':       'brass_mace',
  'shadow_spear':   'bronze_spear'
};

const ARMOR_MIGRATION = {
  'cloth_armor':    'pig_leather_armor',
  'leather_armor':  'bronze_plate_armor',
  'chainmail':      'brass_plate_armor',
  'plate_armor':    'iron_plate_armor',
  'dragon_scale':   'steel_laced_armor'
};

function migrateOldItems() {
  // equipped_weapon
  for (const [oldKey, newKey] of Object.entries(WEAPON_MIGRATION)) {
    db.run('UPDATE players SET equipped_weapon = ? WHERE equipped_weapon = ?', [newKey, oldKey]);
  }
  // equipped_armor
  for (const [oldKey, newKey] of Object.entries(ARMOR_MIGRATION)) {
    db.run('UPDATE players SET equipped_armor = ? WHERE equipped_armor = ?', [newKey, oldKey]);
  }

  // inventory JSON
  const rows = db.exec("SELECT uuid, inventory FROM players");
  if (rows.length && rows[0].values.length) {
    const stmt = db.prepare("UPDATE players SET inventory = ? WHERE uuid = ?");
    for (const row of rows[0].values) {
      const uuid = row[0];
      let inv;
      try { inv = JSON.parse(row[1]); } catch (e) { continue; }
      let changed = false;
      for (let i = 0; i < inv.length; i++) {
        if (WEAPON_MIGRATION[inv[i]]) {
          inv[i] = WEAPON_MIGRATION[inv[i]];
          changed = true;
        } else if (ARMOR_MIGRATION[inv[i]]) {
          inv[i] = ARMOR_MIGRATION[inv[i]];
          changed = true;
        }
      }
      if (changed) stmt.run([JSON.stringify(inv), uuid]);
    }
    stmt.free();
  }
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function getPlayer(uuid) {
  const rows = db.exec('SELECT * FROM players WHERE uuid = ?', [uuid]);
  if (!rows.length || !rows[0].values.length) {
    db.run('INSERT INTO players (uuid) VALUES (?)', [uuid]);
    saveDB();
    return getPlayer(uuid);
  }
  const p = rows[0].values[0];
  return {
    uuid: p[0],
    gold: p[1],
    wins: p[2],
    inventory: JSON.parse(p[3]),
    equipped_weapon: p[4],
    equipped_armor: p[5],
    stars: p[6] || 0,
    tier: p[7] || 0
  };
}

function savePlayer(uuid, data) {
  db.run(`
    UPDATE players SET gold=?, wins=?, inventory=?, equipped_weapon=?, equipped_armor=?, stars=?, tier=? WHERE uuid=?
  `, [data.gold, data.wins, JSON.stringify(data.inventory), data.equipped_weapon, data.equipped_armor, data.stars, data.tier, uuid]);
  saveDB();
}

function createAccount(email, passwordHash, uuid) {
  db.run('INSERT INTO accounts (email, passwordHash, uuid) VALUES (?, ?, ?)', [email, passwordHash, uuid]);
  db.run('INSERT INTO players (uuid) VALUES (?)', [uuid]);
  saveDB();
}

function getAccountByEmail(email) {
  const rows = db.exec('SELECT * FROM accounts WHERE email = ?', [email]);
  return (rows.length && rows[0].values.length) ? rows[0].values[0] : null;
}

function getLeaderboard() {
  const rows = db.exec('SELECT wins, gold FROM players ORDER BY wins DESC LIMIT 10');
  if (!rows.length || !rows[0].values.length) return [];
  return rows[0].values.map(r => ({ wins: r[0], gold: r[1] }));
}

setInterval(() => {
  if (db) saveDB();
}, 30000);

module.exports = { initDB, getPlayer, savePlayer, createAccount, getAccountByEmail, saveDB, getLeaderboard };