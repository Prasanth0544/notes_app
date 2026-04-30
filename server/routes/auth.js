/**
 * Auth Routes – Email, Phone, Google OAuth, GitHub OAuth, Profile
 * Replaces server.py lines 174–426
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const axios = require('axios');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { authMiddleware, makeToken, blacklistToken } = require('../middleware/auth');
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
  const authCodes = db.collection('auth_codes');

  // Helper: generate a one-time auth code and store it (60s TTL via index)
  async function generateAuthCode(token) {
    const code = crypto.randomBytes(32).toString('hex');
    await authCodes.insertOne({ code, token, createdAt: new Date() });
    return code;
  }

  // ════════════════════════════════════════════════════
  //  EMAIL / PASSWORD (with OTP)
  // ════════════════════════════════════════════════════

  const nodemailer = require('nodemailer');
  const transporter = process.env.SMTP_HOST ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT == '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  }) : null;

  router.post('/register/send-otp', async (req, res) => {
    try {
      const { email: rawEmail, password, name } = req.body;
      const email = (rawEmail || '').trim().toLowerCase();

      if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      if (await users.findOne({ email })) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // If no SMTP configured, return a specific error or fallback
      if (!transporter) {
        return res.status(501).json({ error: 'SMTP not configured. Use direct registration.' });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
      const password_hash = await bcrypt.hash(password, 10);

      // Save to pending registrations
      const pendingCol = db.collection('pending_registrations');
      await pendingCol.updateOne(
        { email },
        { 
          $set: { 
            email, 
            password_hash, 
            name: (name || '').trim() || email.split('@')[0], 
            otp, 
            createdAt: new Date() // TTL index uses this
          } 
        },
        { upsert: true }
      );

      // Send Email
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"NoteVault" <noreply@notevault.com>',
        to: email,
        subject: 'Your NoteVault Verification Code',
        text: `Your NoteVault registration code is: ${otp}\n\nThis code expires in 10 minutes.`,
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #6c63ff; margin-top: 0;">Welcome to NoteVault!</h2>
            <p style="color: #4b5563;">Your email verification code is:</p>
            <div style="background: #f3f4f6; padding: 16px; border-radius: 6px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #111827; margin: 20px 0;">
              ${otp}
            </div>
            <p style="color: #6b7280; font-size: 14px;">This code will expire in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
          </div>
        `
      });

      res.json({ ok: true, message: 'OTP sent successfully' });
    } catch (err) {
      console.error('Send OTP error:', err);
      res.status(500).json({ error: 'Failed to send OTP email' });
    }
  });

  router.post('/register/verify-otp', async (req, res) => {
    try {
      const { email: rawEmail, otp } = req.body;
      const email = (rawEmail || '').trim().toLowerCase();

      if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

      const pendingCol = db.collection('pending_registrations');
      const pending = await pendingCol.findOne({ email });

      if (!pending) {
        return res.status(400).json({ error: 'OTP expired or invalid. Please request a new one.' });
      }

      if (pending.otp !== otp) {
        return res.status(400).json({ error: 'Incorrect OTP' });
      }

      // OTP matches! Create the user account
      if (await users.findOne({ email })) {
        await pendingCol.deleteOne({ email });
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      const doc = {
        email,
        password_hash: pending.password_hash,
        name: pending.name,
        username: '', age: '', role: '', avatar: '',
        auth_providers: ['email'],
        profile_done: false,
        created_at: new Date(),
      };
      
      const result = await users.insertOne(doc);
      doc._id = result.insertedId;
      
      // Clean up pending registration
      await pendingCol.deleteOne({ email });

      const token = makeToken(doc._id);
      res.status(201).json({ token, user: formatUser(doc) });
    } catch (err) {
      console.error('Verify OTP error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

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
  const APP_URL           = process.env.APP_URL || 'http://localhost:4000';

  router.get('/google', (req, res) => {
    if (!GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google OAuth not configured' });
    const state = req.query.link_token ? JSON.stringify({ link_token: req.query.link_token }) : '';
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      ...(state && { state }),
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

      // If linking, redirect back with code (not raw token)
      let linkToken = null;
      try { linkToken = JSON.parse(req.query.state || '{}').link_token; } catch {}
      if (linkToken) {
        // Link the Google provider to the account that owns this token
        const jwt = require('jsonwebtoken');
        try {
          const decoded = jwt.verify(linkToken, process.env.JWT_SECRET_KEY);
          await users.updateOne({ _id: new ObjectId(decoded.id) }, { $addToSet: { auth_providers: 'google' } });
        } catch {}
        const code = await generateAuthCode(linkToken);
        return res.redirect(`/login?code=${code}&linked=google`);
      }

      const code = await generateAuthCode(token);
      res.redirect(`/login?code=${code}`);
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
    const state = req.query.link_token || '';
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/github/callback`,
      scope: 'user:email',
      ...(state && { state }),
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

      // If linking, redirect back with code
      const linkToken = req.query.state || '';
      if (linkToken) {
        const jwt = require('jsonwebtoken');
        try {
          const decoded = jwt.verify(linkToken, process.env.JWT_SECRET_KEY);
          await users.updateOne({ _id: new ObjectId(decoded.id) }, { $addToSet: { auth_providers: 'github' } });
        } catch {}
        const code = await generateAuthCode(linkToken);
        return res.redirect(`/login?code=${code}&linked=github`);
      }

      const code = await generateAuthCode(token);
      res.redirect(`/login?code=${code}`);
    } catch (err) {
      console.error('GitHub OAuth error:', err.message);
      res.redirect('/login.html?error=github_failed');
    }
  });

  // ════════════════════════════════════════════════════
  //  EXCHANGE AUTH CODE → TOKEN (one-time, 60s expiry)
  // ════════════════════════════════════════════════════

  router.post('/exchange', async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Code is required' });
      const doc = await authCodes.findOneAndDelete({ code });
      if (!doc) return res.status(401).json({ error: 'Invalid or expired code' });
      res.json({ token: doc.token });
    } catch (err) {
      console.error('Code exchange error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ════════════════════════════════════════════════════
  //  LINK PHONE NUMBER
  // ════════════════════════════════════════════════════

  router.post('/link/phone', authMiddleware, async (req, res) => {
    try {
      const phone = (req.body.phone || '').trim();
      if (!phone) return res.status(400).json({ error: 'Phone number required' });
      // Check if phone already used by another account
      const existing = await users.findOne({ phone, _id: { $ne: new ObjectId(req.userId) } });
      if (existing) return res.status(409).json({ error: 'Phone number already linked to another account' });
      await users.updateOne(
        { _id: new ObjectId(req.userId) },
        { $set: { phone }, $addToSet: { auth_providers: 'phone' } }
      );
      const user = await users.findOne({ _id: new ObjectId(req.userId) });
      res.json(formatUser(user));
    } catch (err) {
      console.error('Link phone error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ════════════════════════════════════════════════════
  //  PROFILE
  // ════════════════════════════════════════════════════

  router.get('/me', authMiddleware, async (req, res) => {
    try {
      const user = await users.findOne({ _id: new ObjectId(req.userId) });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(formatUser(user));
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/profile', authMiddleware, async (req, res) => {
    try {
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
  // ════════════════════════════════════════════════════
  //  CHANGE PASSWORD
  // ════════════════════════════════════════════════════

  router.put('/password', authMiddleware, async (req, res) => {
    try {
      const { old_password, new_password } = req.body;
      if (!old_password || !new_password) return res.status(400).json({ error: 'Old and new passwords are required' });
      if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

      const user = await users.findOne({ _id: new ObjectId(req.userId) });
      if (!user || !user.password_hash) return res.status(400).json({ error: 'No password set — use profile to set one' });

      const hashStr = getHashString(user.password_hash);
      const match = await bcrypt.compare(old_password, hashStr);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

      const newHash = await bcrypt.hash(new_password, 10);
      await users.updateOne({ _id: new ObjectId(req.userId) }, { $set: { password_hash: newHash } });
      res.json({ ok: true, message: 'Password changed successfully' });
    } catch (err) {
      console.error('Change password error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ════════════════════════════════════════════════════
  //  LOGOUT (blacklist token)
  // ════════════════════════════════════════════════════

  router.post('/logout', authMiddleware, async (req, res) => {
    try {
      const token = req.headers.authorization.split(' ')[1];
      await blacklistToken(token);
      res.json({ ok: true, message: 'Logged out — token revoked' });
    } catch (err) {
      console.error('Logout error:', err);
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

