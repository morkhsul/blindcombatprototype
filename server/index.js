const express = require('express');
const http = require('http');
const { Server } = require('colyseus');
const path = require('path');
const { initDB, getPlayer, savePlayer, getLeaderboard } = require('./db');
const auth = require('./auth');
const { WEAPONS, ARMORS } = require('./items');
require('./matchRegistry'); // initializes activeMatches map

async function start() {
  await initDB();

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Auth
  app.post('/api/register', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
      const uuid = await auth.register(email, password);
      const token = auth.generateToken(uuid);
      res.json({ uuid, token });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const uuid = auth.login(email, password);
    if (!uuid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = auth.generateToken(uuid);
    res.json({ uuid, token });
  });

  // Player data
  app.get('/api/player/:uuid', (req, res) => {
    const player = getPlayer(req.params.uuid);
    res.json(player);
  });

  app.post('/api/buy', (req, res) => {
    const { uuid, type, key } = req.body;
    const player = getPlayer(uuid);
    const list = type === 'weapon' ? WEAPONS : ARMORS;
    const item = list[key];
    if (!item || player.gold < item.cost) return res.status(400).json({ error: 'Cannot buy' });
    if (player.inventory.includes(key)) return res.status(400).json({ error: 'Already owned' });
    player.gold -= item.cost;
    player.inventory.push(key);
    savePlayer(uuid, player);
    res.json(player);
  });

  app.post('/api/equip', (req, res) => {
    const { uuid, type, key } = req.body;
    const player = getPlayer(uuid);
    if (!player.inventory.includes(key)) return res.status(400).json({ error: 'Not owned' });
    if (type === 'weapon') {
      if (!WEAPONS[key]) return res.status(400).json({ error: 'Invalid weapon' });
      player.equipped_weapon = key;
    } else if (type === 'armor') {
      if (!ARMORS[key]) return res.status(400).json({ error: 'Invalid armor' });
      player.equipped_armor = key;
    }
    savePlayer(uuid, player);
    res.json(player);
  });

  app.post('/api/dummyDefeat', (req, res) => {
    const { uuid } = req.body;
    const player = getPlayer(uuid);
    const goldReward = 10 + Math.floor(Math.random() * 10);
    player.gold += goldReward;
    player.wins += 1;
    savePlayer(uuid, player);
    res.json(player);
  });

  app.get('/api/leaderboard', (req, res) => {
    const results = getLeaderboard();
    res.json(results);
  });

  const httpServer = http.createServer(app);

  const gameServer = new Server({
    server: httpServer,
  });

  try {
    const { LobbyRoom } = require('./rooms/LobbyRoom');
    const { ArenaMatchRoom } = require('./rooms/ArenaMatchRoom');
    gameServer.define('lobby', LobbyRoom);
    gameServer.define('arena_match', ArenaMatchRoom);
    console.log('✅ Rooms registered: lobby, arena_match');
  } catch (err) {
    console.error('❌ Failed to load room classes:', err);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  gameServer.listen(PORT).then(() => {
    console.log(`🏟️  Arena server running on http://localhost:${PORT}`);
  });
}

start();