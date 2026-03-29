/**
 * Auth Routes – Email, Phone, Google OAuth, GitHub OAuth, Profile
 * Replaces server.py lines 174–426
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { authMiddleware, makeToken } = require('../middleware/auth');
const { formatUser } = require('../utils/helpers');

// Python bcrypt stores hashes as Binary in MongoDB.
// This helper converts Buffer/Binary → string for bcryptjs comparison.
function getHashString(hash) {
  if (!hash) return '';
  if (typeof hash === 'string') return hash;
  if (Buffer.isBuffer(hash)) return hash.toString('utf8');
  if (hash.buffer) return Buffer.from(hash.buffer).toString('utf8');
  return String(hash);
}

module.exports = function (db) {
  const users = db.collection('users');

  // ════════════════════════════════════════════════════
  //  EMAIL / PASSWORD
  // ════════════════════════════════════════════════════

  router.post('/register', async (req, res) => {
    try {
      const { email: rawEmail, password, name } = req.body;
      const email = (rawEmail || '').trim().toLowerCase();

      if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      if (await users.findOne({ email })) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      const password_hash = await bcrypt.hash(password, 10);
      const doc = {
        email,
        password_hash,
        name: (name || '').trim() || email.split('@')[0],
        username: '', age: '', role: '', avatar: '',
        auth_providers: ['email'],
        profile_done: false,
        created_at: new Date(),
      };
      const result = await users.insertOne(doc);
      doc._id = result.insertedId;
      const token = makeToken(doc._id);
      res.status(201).json({ token, user: formatUser(doc) });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { email: rawEmail, password } = req.body;
      const email = (rawEmail || '').trim().toLowerCase();

      if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

      const user = await users.findOne({ email });
      if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

      const hashStr = getHashString(user.password_hash);
      const match = await bcrypt.compare(password, hashStr);
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });

      const token = makeToken(user._id);
      res.json({ token, user: formatUser(user) });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ════════════════════════════════════════════════════
  //  PHONE + PASSWORD
  // ════════════════════════════════════════════════════

  router.post('/register/phone', async (req, res) => {
    try {
      const { phone: rawPhone, password, name } = req.body;
      const phone = (rawPhone || '').trim();

      if (!phone || !password) return res.status(400).json({ error: 'Phone and password are required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      if (await users.findOne({ phone })) {
        return res.status(409).json({ error: 'An account with this phone already exists' });
      }

      const password_hash = await bcrypt.hash(password, 10);
      const doc = {
        email: '', phone,
        password_hash,
        name: (name || '').trim() || `User ${phone.slice(-4)}`,
        username: '', age: '', role: '', avatar: '',
        auth_providers: ['phone'],
        profile_done: false,
        created_at: new Date(),
      };
      const result = await users.insertOne(doc);
      doc._id = result.insertedId;
      const token = makeToken(doc._id);
      res.status(201).json({ token, user: formatUser(doc) });
    } catch (err) {
      console.error('Phone register error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.post('/login/phone', async (req, res) => {
    try {
      const { phone: rawPhone, password } = req.body;
      const phone = (rawPhone || '').trim();

      const user = await users.findOne({ phone });
      if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid phone or password' });

      const hashStr = getHashString(user.password_hash);
      const match = await bcrypt.compare(password, hashStr);
      if (!match) return res.status(401).json({ error: 'Invalid phone or password' });

      const token = makeToken(user._id);
      res.json({ token, user: formatUser(user) });
    } catch (err) {
      console.error('Phone login error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ════════════════════════════════════════════════════
  //  GOOGLE OAUTH
  // ════════════════════════════════════════════════════

  const GOOGLE_CLIENT_ID  = process.env.GOOGLE_CLIENT_ID || '';
  const GOOGLE_CLIENT_SEC = process.env.GOOGLE_CLIENT_SECRET || '';
  const APP_URL           = process.env.APP_URL || 'http://localhost:5000';

  router.get('/google', (req, res) => {
    if (!GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google OAuth not configured' });
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  router.get('/google/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/login.html?error=google_denied');

    try {
      const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SEC,
        redirect_uri: `${APP_URL}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      });

      const idToken = tokenResp.data.id_token;
      if (!idToken) return res.redirect('/login.html?error=google_failed');

      // Decode ID token payload
      const parts = idToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      const { email, name, picture: avatar, sub: oauth_id } = payload;
      const { user } = await findOrCreateOAuthUser(users, email, name, avatar, 'google', oauth_id);
      const token = makeToken(user._id);
      const nextPage = user.profile_done ? 'index.html' : 'profile-setup.html';
      res.redirect(`/${nextPage}?token=${token}`);
    } catch (err) {
      console.error('Google OAuth error:', err.message);
      res.redirect('/login.html?error=google_failed');
    }
  });

  // ════════════════════════════════════════════════════
  //  GITHUB OAUTH
  // ════════════════════════════════════════════════════

  const GITHUB_CLIENT_ID  = process.env.GITHUB_CLIENT_ID || '';
  const GITHUB_CLIENT_SEC = process.env.GITHUB_CLIENT_SECRET || '';

  router.get('/github', (req, res) => {
    if (!GITHUB_CLIENT_ID) return res.status(501).json({ error: 'GitHub OAuth not configured' });
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/github/callback`,
      scope: 'user:email',
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get('/github/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/login.html?error=github_denied');

    try {
      const tokenResp = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SEC,
        code,
      }, { headers: { Accept: 'application/json' } });

      const accessToken = tokenResp.data.access_token;
      if (!accessToken) return res.redirect('/login.html?error=github_failed');

      const ghHeaders = { Authorization: `token ${accessToken}`, Accept: 'application/json' };
      const [userInfo, emails] = await Promise.all([
        axios.get('https://api.github.com/user', { headers: ghHeaders }),
        axios.get('https://api.github.com/user/emails', { headers: ghHeaders }),
      ]);

      const email = (emails.data.find(e => e.primary && e.verified) || {}).email || '';
      const name = userInfo.data.name || userInfo.data.login || '';
      const avatar = userInfo.data.avatar_url || '';
      const oauth_id = String(userInfo.data.id || '');

      const { user } = await findOrCreateOAuthUser(users, email, name, avatar, 'github', oauth_id);
      const token = makeToken(user._id);
      const nextPage = user.profile_done ? 'index.html' : 'profile-setup.html';
      res.redirect(`/${nextPage}?token=${token}`);
    } catch (err) {
      console.error('GitHub OAuth error:', err.message);
      res.redirect('/login.html?error=github_failed');
    }
  });

  // ════════════════════════════════════════════════════
  //  PROFILE
  // ════════════════════════════════════════════════════

  router.get('/me', authMiddleware, async (req, res) => {
    try {
      const { ObjectId } = require('mongodb');
      const user = await users.findOne({ _id: new ObjectId(req.userId) });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(formatUser(user));
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/profile', authMiddleware, async (req, res) => {
    try {
      const { ObjectId } = require('mongodb');
      const data = req.body;
      const updates = {};

      if (data.username) updates.username = String(data.username).trim();
      if (data.name)     updates.name = String(data.name).trim();
      if (data.age)      updates.age = String(data.age).trim();
      if (data.role)     updates.role = String(data.role).trim();
      updates.profile_done = true;

      // Handle backup password
      const backupPw = (data.backup_password || '').trim();
      if (backupPw && backupPw.length >= 6) {
        updates.password_hash = await bcrypt.hash(backupPw, 10);
        await users.updateOne(
          { _id: new ObjectId(req.userId) },
          { $addToSet: { auth_providers: 'email' } }
        );
      }

      await users.updateOne({ _id: new ObjectId(req.userId) }, { $set: updates });
      const user = await users.findOne({ _id: new ObjectId(req.userId) });
      res.json(formatUser(user));
    } catch (err) {
      console.error('Profile update error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};

// ── Helper: find or create OAuth user ─────────────────
async function findOrCreateOAuthUser(users, email, name, avatar, provider, oauth_id) {
  let user = email ? await users.findOne({ email }) : null;
  if (!user) user = await users.findOne({ oauth_id });

  if (user) {
    if (!(user.auth_providers || []).includes(provider)) {
      await users.updateOne({ _id: user._id }, {
        $addToSet: { auth_providers: provider },
        $set: { avatar: avatar || user.avatar || '', name: name || user.name || '' },
      });
    }
    user = await users.findOne({ _id: user._id });
    return { user, isNew: false };
  }

  const doc = {
    email: email || '',
    oauth_id,
    name: name || '',
    username: '', age: '', role: '',
    avatar: avatar || '',
    auth_providers: [provider],
    profile_done: false,
    created_at: new Date(),
  };
  const result = await users.insertOne(doc);
  doc._id = result.insertedId;
  return { user: doc, isNew: true };
}
