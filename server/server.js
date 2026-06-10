/**
 * NoteVault – Express + MongoDB Atlas + JWT Auth Backend
 * ======================================================
 * Supports: Email/Password, Google OAuth, GitHub OAuth, Phone+Password
 * Run:  node server.js
 * API:  http://localhost:4000
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;

// ── Environment ─────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
const PORT      = parseInt(process.env.PORT || '4000', 10);

if (!MONGO_URI) {
  console.error('  ⚠️  MONGO_URI not set in .env – cannot start.');
  process.exit(1);
}

// ── Cloudinary ──────────────────────────────────────────
const CLOUD_NAME   = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUD_KEY    = process.env.CLOUDINARY_API_KEY || '';
const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET || '';

if (CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET) {
  cloudinary.config({ cloud_name: CLOUD_NAME, api_key: CLOUD_KEY, api_secret: CLOUD_SECRET, secure: true });
  console.log('  ✅ Cloudinary configured');
} else {
  console.log('  ⚠️  Cloudinary not configured – images will use base64 fallback');
}

// ── Main ────────────────────────────────────────────────
async function main() {
  // Connect to MongoDB (with connection pool config)
  const client = new MongoClient(MONGO_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
  });
  await client.connect();
  const db = client.db('notevault');
  console.log('  ✅ Connected to MongoDB – database: notevault');

  // Create indexes (same as server.py)
  await db.collection('users').createIndex({ email: 1 },    { unique: true, sparse: true });
  await db.collection('users').createIndex({ phone: 1 },    { unique: true, sparse: true });
  await db.collection('users').createIndex({ oauth_id: 1 }, { sparse: true });
  await db.collection('notes').createIndex({ user_id: 1, modified: -1 });
  await db.collection('notes').createIndex({ user_id: 1, deleted_at: 1 });
  await db.collection('notes').createIndex({ user_id: 1, title: 1, deleted_at: 1 });
  await db.collection('notes').createIndex({ user_id: 1, folder: 1 });
  await db.collection('token_blacklist').createIndex({ token: 1 });
  await db.collection('user_folders').createIndex({ user_id: 1, name: 1 }, { unique: true });
  await db.collection('pending_registrations').createIndex({ createdAt: 1 }, { expireAfterSeconds: 600 }); // 10 min TTL
  await db.collection('user_folders').createIndex({ user_id: 1, deleted_at: 1 });
  await db.collection('auth_codes').createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 }); // 60s TTL
  await db.collection('oauth_states').createIndex({ createdAt: 1 }, { expireAfterSeconds: 600 }); // 10 min TTL

  // Token blacklist for logout
  const { initBlacklist } = require('./middleware/auth');
  initBlacklist(db);

  // ── Express App ─────────────────────────────────────
  const app = express();

  // Middleware
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(compression());

  const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  // Always allow Capacitor WebView origins for mobile APK
  const CAPACITOR_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];
  const allOrigins = [...new Set([...ALLOWED, ...CAPACITOR_ORIGINS])];
  app.use(cors({
    origin: ALLOWED.length ? allOrigins : '*',
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Rate limit auth endpoints (20 requests per 15-min window)
  app.use('/api/auth/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts — please try again in 15 minutes.' },
  }));

  // Rate limit notes endpoints (120 requests per minute)
  app.use('/api/notes/', rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — slow down.' },
  }));

  // ── Health Check (used by frontend to detect local server) ──
  app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

  // ── API Routes ──────────────────────────────────────
  app.use('/api/auth',   require('./routes/auth')(db));
  app.use('/api/notes',  require('./routes/notes')(db));
  app.use('/api/images', require('./routes/images')());
  app.use('/api/sync',   require('./routes/sync')(db));

  // ── Serve Frontend (React build) ─────────────────────
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  const fs = require('fs');

  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    // SPA fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    console.warn('  ⚠️  client/dist not found — run: cd client && npm run build');
    app.get('*', (req, res) => res.status(503).json({ error: 'Frontend not built. Run: cd client && npm run build' }));
  }

  // ── Start Server ────────────────────────────────────
  app.listen(PORT, '0.0.0.0', () => {
    const url = `http://localhost:${PORT}`;
    console.log();
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   NoteVault Server – running!                ║');
    console.log(`  ║   Open: ${url.padEnd(37)}║`);
    console.log('  ║   Auth: Email · Phone · Google · GitHub      ║');
    console.log('  ║   DB:   MongoDB Atlas                        ║');
    console.log('  ║   Stack: Node.js + Express                   ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log();

    // Auto-open browser (skip on Render/production)
    // if (!process.env.RENDER) {
    //   const { exec } = require('child_process');
    //   const cmd = process.platform === 'win32' ? `start ${url}` :
    //               process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    //   exec(cmd);
    // }
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => { console.log('\n  🛑 SIGTERM received — shutting down...'); process.exit(0); });
process.on('SIGINT',  () => { console.log('\n  🛑 SIGINT received — shutting down...');  process.exit(0); });
