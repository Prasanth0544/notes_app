/**
 * JWT Authentication Middleware
 * Verifies Bearer token and checks blacklist
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET_KEY;
if (!JWT_SECRET) {
  console.error('⛔ JWT_SECRET_KEY not set in .env — cannot start.');
  process.exit(1);
}

// Blacklist collection reference (set by initBlacklist)
let blacklistCol = null;

function initBlacklist(db) {
  blacklistCol = db.collection('token_blacklist');
  // TTL index: MongoDB auto-deletes expired entries
  blacklistCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
}

// In-memory cache for recently-verified clean tokens (TTL: 30s)
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 30000;

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check blacklist (with in-memory cache to skip DB on hot paths)
    if (blacklistCol) {
      const cached = tokenCache.get(token);
      if (cached && Date.now() - cached < TOKEN_CACHE_TTL) {
        // Token was verified clean recently — skip DB query
      } else {
        const banned = await blacklistCol.findOne({ token });
        if (banned) {
          tokenCache.delete(token);
          return res.status(401).json({ error: 'Token revoked — please sign in again' });
        }
        tokenCache.set(token, Date.now());
        // Prune cache if it grows too large (>500 entries)
        if (tokenCache.size > 500) {
          const now = Date.now();
          for (const [k, v] of tokenCache) {
            if (now - v > TOKEN_CACHE_TTL) tokenCache.delete(k);
          }
        }
      }
    }

    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

async function blacklistToken(token) {
  if (!blacklistCol) return;
  try {
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 86400000);
    await blacklistCol.insertOne({ token, expiresAt, blacklistedAt: new Date() });
  } catch {}
}

function makeToken(userId) {
  return jwt.sign({ id: String(userId) }, JWT_SECRET, { expiresIn: '30d' });
}

module.exports = { authMiddleware, makeToken, initBlacklist, blacklistToken };
