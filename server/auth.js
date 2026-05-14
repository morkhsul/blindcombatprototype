const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'arena-secret-change-in-production';

async function register(email, password) {
  const hash = bcrypt.hashSync(password, 10);
  const uuid = uuidv4();
  try {
    db.createAccount(email, hash, uuid);
    return uuid;
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) throw new Error('Email already exists');
    throw e;
  }
}

function login(email, password) {
  const acc = db.getAccountByEmail(email);
  if (!acc) return null;
  if (bcrypt.compareSync(password, acc[1])) {
    return acc[2];
  }
  return null;
}

function generateToken(uuid) {
  return jwt.sign({ uuid }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET).uuid;
  } catch (e) {
    return null;
  }
}

module.exports = { register, login, generateToken, verifyToken };