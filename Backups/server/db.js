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
      inventory TEXT DEFAULT '[]',
      equipped_weapon TEXT DEFAULT 'rusty_dagger',
      equipped_armor TEXT DEFAULT '',
      stars INTEGER DEFAULT 0,
      tier INTEGER DEFAULT 0
    )
  `);
  // Migration for existing tables
  try { db.run('ALTER TABLE players ADD COLUMN stars INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run('ALTER TABLE players ADD COLUMN tier INTEGER DEFAULT 0'); } catch(e) {}
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      email TEXT UNIQUE,
      passwordHash TEXT,
      uuid TEXT PRIMARY KEY
    )
  `);
  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function getPlayer(uuid) {
  const rows = db.exec('SELECT * FROM players WHERE uuid = ?', [uuid]);
  if (!rows.length || !rows[0].values.length) {
    db.run('INSERT INTO players (uuid, gold, wins, inventory, equipped_weapon, equipped_armor, stars, tier) VALUES (?, 0, 0, ?, ?, ?, 0, 0)',
      [uuid, '["rusty_dagger"]', 'rusty_dagger', '']);
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