// ArenaMatchRoom.js
const { Room } = require('colyseus');
const { ArenaMatchState } = require('../schema/ArenaMatchState');
const { Fighter } = require('../schema/Fighter');
const { Bet } = require('../schema/ArenaMatchState');
const db = require('../db');
const { WEAPONS, ARMORS, SPELLS, SPECIALS } = require('../items');
const { activeMatches } = require('../matchRegistry');

const TICK_RATE = 20;
const MATCH_BETTING_TIME = 30;

class ArenaMatchRoom extends Room {
  onCreate(options) {
    this.setState(new ArenaMatchState());
    this.maxClients = 20;
    this.fighterUUIDs = [options.fighterUUID1, options.fighterUUID2]; // persistent identifiers
    this.spectators = new Set();
    this.layoutSubmissions = new Set();
    this.selfBetsDeducted = new Set();
    this.combatTimers = {};
    this.tickInterval = null;
    this.matchStartTime = 0;

    // Register in active matches (store UUIDs for listing)
    activeMatches.set(this.roomId, {
      roomId: this.roomId,
      fighter1: options.fighterUUID1,
      fighter2: options.fighterUUID2,
      startedAt: Date.now()
    });

    this.onMessage('setLayout', (client, msg) => {
      if (this.state.phase !== 'layout') return;
      const fighter = this.state.fighters.get(client.sessionId);
      if (!fighter) return;
      const layout = msg.layout;
      if (!layout) return;

      const SELF_BET_OPTIONS = [50, 100, 500, 1000];
      const selfBet = layout.selfBet || 50;
      if (!SELF_BET_OPTIONS.includes(selfBet)) return client.send('error', { msg: 'Invalid bet amount' });

      const playerData = db.getPlayer(fighter.uuid);
      if (!playerData || playerData.gold < selfBet) return client.send('error', { msg: 'Not enough gold' });

      playerData.gold -= selfBet;
      db.savePlayer(fighter.uuid, playerData);
      fighter.goldOnFile = playerData.gold;

      fighter.layout.weapon1 = layout.weapon1 || 'rusty_dagger';
      fighter.layout.weapon2 = layout.weapon2 || 'rusty_dagger';
      fighter.layout.armor = layout.armor || '';
      fighter.layout.spells = layout.spells || ['fireball','heal','shield'];
      fighter.layout.special = layout.special || 'berserk';
      fighter.layout.potions.set('heal', layout.healPotions || 0);
      fighter.layout.potions.set('mana', layout.manaPotions || 0);
      fighter.layout.selfBet = selfBet;
      this.layoutSubmissions.add(client.sessionId);
      this.selfBetsDeducted.add(client.sessionId);

      if (this.layoutSubmissions.size >= 2) {
        this.startBettingPhase();
      }
    });

    this.onMessage('placeBet', (client, msg) => {
      if (this.state.phase !== 'betting') return;
      if (this.state.fighters.has(client.sessionId)) return;
      const amount = Math.floor(msg.amount);
      if (isNaN(amount) || amount <= 0) return;
      const fighterId = msg.fighterId;
      if (!this.state.fighters.has(fighterId)) return;

      const uuid = this.getSpectatorUUID(client.sessionId);
      if (!uuid) return client.send('error', { msg: 'Invalid spectator' });
      const playerData = db.getPlayer(uuid);
      if (!playerData || playerData.gold < amount) return client.send('error', { msg: 'Not enough gold' });

      playerData.gold -= amount;
      db.savePlayer(uuid, playerData);

      const bet = new Bet();
      bet.sessionId = client.sessionId;
      bet.fighterId = fighterId;
      bet.amount = amount;
      this.state.bets.set(client.sessionId, bet);
      if (!this.spectatorUuids) this.spectatorUuids = new Map();
      this.spectatorUuids.set(client.sessionId, uuid);
    });

    this.onMessage('attack', (client, msg) => {
      if (this.state.phase !== 'combat') return;
      const attacker = this.state.fighters.get(client.sessionId);
      if (!attacker || !attacker.alive) return;
      this.performAttack(attacker, msg.type);
    });

    this.onMessage('useSpell', (client, msg) => {
      if (this.state.phase !== 'combat') return;
      const caster = this.state.fighters.get(client.sessionId);
      if (!caster || !caster.alive) return;
      this.castSpell(caster, msg.spell);
    });

    this.onMessage('usePotion', (client, msg) => {
      if (this.state.phase !== 'combat') return;
      const user = this.state.fighters.get(client.sessionId);
      if (!user || !user.alive) return;
      this.usePotion(user, msg.type);
    });
  }

  getSpectatorUUID(sessionId) {
    return this.spectatorUuids ? this.spectatorUuids.get(sessionId) : null;
  }

  startBettingPhase() {
    this.state.phase = 'betting';
    this.state.countdown = MATCH_BETTING_TIME;
    const countdownInterval = setInterval(() => {
      this.state.countdown--;
      if (this.state.countdown <= 0) {
        clearInterval(countdownInterval);
        this.startCombatPhase();
      }
    }, 1000);
  }

  startCombatPhase() {
    this.state.phase = 'combat';
    this.matchStartTime = Date.now();
    for (const [sessionId, fighter] of this.state.fighters) {
      this.combatTimers[sessionId] = {
        lastAttack: 0,
        spellCooldowns: {},
        specialCooldown: 0,
        activeEffects: []
      };
    }
    this.tickInterval = setInterval(() => this.combatTick(), 1000 / TICK_RATE);
  }

  combatTick() {
    const now = Date.now();
    const fighters = [...this.state.fighters.values()];
    for (const f of fighters) {
      if (!f.alive) continue;
      const timers = this.combatTimers[f.sessionId];
      for (const effect of timers.activeEffects) {
        if (effect.type === 'poison' && now < effect.endTime) {
          f.hp -= effect.data.damage;
        }
      }
    }
    for (const f of fighters) {
      if (f.hp <= 0 && f.alive) {
        f.alive = false;
        this.checkEndCondition();
      }
    }
  }

  performAttack(attacker, type) {
    const now = Date.now();
    const timers = this.combatTimers[attacker.sessionId];
    const weapon = WEAPONS[attacker.layout.weapon1];
    const speed = weapon.speed;
    if (now - timers.lastAttack < speed) return;

    timers.lastAttack = now;
    let damage = weapon.damage;
    if (type === 'heavy') damage = Math.floor(damage * 1.5);

    const opponent = this.getOpponent(attacker.sessionId);
    if (!opponent) return;

    const armor = ARMORS[opponent.layout.armor];
    const defense = armor ? armor.defense : 0;
    damage = Math.max(1, damage - defense);

    const oppTimer = this.combatTimers[opponent.sessionId];
    const shield = oppTimer.activeEffects.find(e => e.type === 'shield');
    if (shield && now < shield.endTime) {
      damage = Math.floor(damage * (1 - shield.data.reduction));
    }

    opponent.hp -= damage;
  }

  castSpell(caster, spellKey) {
    const spell = SPELLS[spellKey];
    if (!spell) return;
    const timers = this.combatTimers[caster.sessionId];
    const now = Date.now();
    if (timers.spellCooldowns[spellKey] && now - timers.spellCooldowns[spellKey] < spell.cooldown) return;
    if (caster.mana < spell.manaCost) return;

    caster.mana -= spell.manaCost;
    timers.spellCooldowns[spellKey] = now;

    const opponent = this.getOpponent(caster.sessionId);
    if (spellKey === 'fireball' && opponent) {
      let dmg = spell.damage;
      const armor = ARMORS[opponent.layout.armor];
      const defense = armor ? armor.defense : 0;
      dmg = Math.max(1, dmg - defense);
      opponent.hp -= dmg;
    } else if (spellKey === 'heal') {
      caster.hp = Math.min(caster.maxHp, caster.hp + spell.healAmount);
    } else if (spellKey === 'shield') {
      timers.activeEffects.push({
        type: 'shield',
        endTime: now + spell.duration,
        data: { reduction: spell.damageReduction }
      });
    } else if (spellKey === 'poison' && opponent) {
      opponent.hp -= spell.dotDamage * spell.ticks;
    } else if (spellKey === 'lightning' && opponent) {
      let dmg = spell.damage;
      const armor = ARMORS[opponent.layout.armor];
      const defense = armor ? armor.defense : 0;
      dmg = Math.max(1, dmg - defense);
      opponent.hp -= dmg;
    }
  }

  usePotion(user, type) {
    const layout = user.layout;
    const count = layout.potions.get(type) || 0;
    if (count <= 0) return;
    if (type === 'heal') {
      user.hp = Math.min(user.maxHp, user.hp + 30);
    } else if (type === 'mana') {
      user.mana = Math.min(user.maxMana, user.mana + 40);
    }
    layout.potions.set(type, count - 1);
  }

  getOpponent(sessionId) {
    for (const [id, f] of this.state.fighters) {
      if (id !== sessionId && f.alive) return f;
    }
    return null;
  }

  checkEndCondition() {
    const aliveFighters = [...this.state.fighters.values()].filter(f => f.alive);
    if (aliveFighters.length === 1) {
      this.endMatch(aliveFighters[0].sessionId);
    }
  }

  endMatch(winnerSessionId) {
    clearInterval(this.tickInterval);
    this.state.phase = 'results';
    this.state.winner = winnerSessionId;

    const fighters = [...this.state.fighters.values()];
    const winner = fighters.find(f => f.sessionId === winnerSessionId);
    const loser = fighters.find(f => f !== winner);

    let totalBets = winner.layout.selfBet + loser.layout.selfBet;
    for (const bet of this.state.bets.values()) {
      totalBets += bet.amount;
    }

    let winnerPool = winner.layout.selfBet;
    for (const bet of this.state.bets.values()) {
      if (bet.fighterId === winnerSessionId) winnerPool += bet.amount;
    }

    const ratio = totalBets > 0 ? winnerPool / totalBets : 0;
    const isUnderdog = ratio <= 0.3;
    const multiplier = isUnderdog ? 3 : 2;

    const winnerData = db.getPlayer(winner.uuid);
    if (winnerData) {
      winnerData.gold += winner.layout.selfBet * multiplier;
      winnerData.stars = (winnerData.stars || 0) + 1;
      if (winnerData.stars >= 10) {
        winnerData.stars = 0;
        winnerData.tier = Math.min(4, (winnerData.tier || 0) + 1);
      }
      winnerData.wins = (winnerData.wins || 0) + 1;
      db.savePlayer(winner.uuid, winnerData);
    }

    const loserData = db.getPlayer(loser.uuid);
    if (loserData) {
      loserData.stars = Math.max(0, (loserData.stars || 0) - 1);
      db.savePlayer(loser.uuid, loserData);
    }

    for (const bet of this.state.bets.values()) {
      if (bet.fighterId === winnerSessionId) {
        const bettorUuid = this.getSpectatorUUID(bet.sessionId);
        if (bettorUuid) {
          const bettorData = db.getPlayer(bettorUuid);
          if (bettorData) {
            bettorData.gold += bet.amount * multiplier;
            db.savePlayer(bettorUuid, bettorData);
          }
        }
      }
    }

    this.state.underdogBonus = isUnderdog;
    activeMatches.delete(this.roomId);

    setTimeout(() => this.disconnect(), 10000);
  }

  onAuth(client, options, request) {
    return options.token || options.uuid || 'guest-' + client.sessionId;
  }

  async onJoin(client, options, auth) {
    const sessionId = client.sessionId;
    const uuid = auth;
    const isSpectator = options.spectate === true;

    if (isSpectator) {
      this.spectators.add(sessionId);
      if (!this.spectatorUuids) this.spectatorUuids = new Map();
      this.spectatorUuids.set(sessionId, uuid);
      client.send('session', { sessionId, role: 'spectator' });
      return;
    }

    // Fighter check by UUID instead of session ID
    if (this.fighterUUIDs.includes(uuid)) {
      const fighter = new Fighter();
      fighter.sessionId = sessionId;
      fighter.uuid = uuid;
      this.state.fighters.set(sessionId, fighter);
      if (this.state.fighters.size === 2) {
        this.state.phase = 'layout';
      }
    }
  }

  onLeave(client, consented) {
    this.spectators.delete(client.sessionId);
    const fighter = this.state.fighters.get(client.sessionId);
    if (fighter && fighter.alive && (this.state.phase === 'combat' || this.state.phase === 'layout' || this.state.phase === 'betting')) {
      fighter.alive = false;
      this.checkEndCondition();
    }
    this.state.fighters.delete(client.sessionId);
    this.state.bets.delete(client.sessionId);
  }

  onDispose() {
    clearInterval(this.tickInterval);
    activeMatches.delete(this.roomId);
  }
}

module.exports = { ArenaMatchRoom };