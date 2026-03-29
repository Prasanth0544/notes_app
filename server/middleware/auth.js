/**
 * JWT Authentication Middleware
 * Verifies Bearer token and attaches userId to req
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'fallback-change-me';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function makeToken(userId) {
  return jwt.sign({ id: String(userId) }, JWT_SECRET, { expiresIn: '30d' });
}

module.exports = { authMiddleware, makeToken };
