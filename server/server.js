/**
 * NoteVault – Express + MongoDB Atlas + JWT Auth Backend
 * ======================================================
 * Supports: Email/Password, Google OAuth, GitHub OAuth, Phone+Password
 * Run:  node server.js
 * API:  http://localhost:5000
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;

// ── Environment ─────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
const PORT      = parseInt(process.env.PORT || '5000', 10);

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
  // Connect to MongoDB
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('notevault');
  console.log('  ✅ Connected to MongoDB Atlas – database: notevault');

  // Create indexes (same as server.py)
  await db.collection('users').createIndex({ email: 1 },    { unique: true, sparse: true });
  await db.collection('users').createIndex({ phone: 1 },    { unique: true, sparse: true });
  await db.collection('users').createIndex({ oauth_id: 1 }, { sparse: true });
  await db.collection('notes').createIndex({ user_id: 1, modified: -1 });

  // ── Express App ─────────────────────────────────────
  const app = express();

  // Middleware
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // ── API Routes ──────────────────────────────────────
  app.use('/api/auth',   require('./routes/auth')(db));
  app.use('/api/notes',  require('./routes/notes')(db));
  app.use('/api/images', require('./routes/images')());
  app.use('/api/sync',   require('./routes/sync')(db));

  // ── Serve Frontend (React build or static files) ────
  // In production, Vite builds to ../client/dist
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  const staticDir  = path.join(__dirname, '..');

  // Try React build first, fall back to root static files
  const fs = require('fs');
  const servePath = fs.existsSync(path.join(clientDist, 'index.html')) ? clientDist : staticDir;

  app.use(express.static(servePath));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(servePath, 'index.html'));
  });

  // ── Start Server ────────────────────────────────────
  app.listen(PORT, '0.0.0.0', () => {
    const url = `http://localhost:${PORT}`;
    console.log();
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   NoteVault Server – running!                ║');
    console.log(`  ║   Open: ${url.padEnd(37)}║`);
    console.log('  ║   Auth: Email · Phone · Google · GitHub     ║');
    console.log('  ║   DB:   MongoDB Atlas (notevault)           ║');
    console.log('  ║   Stack: Node.js + Express                  ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log();

    // Auto-open browser (skip on Render/production)
    if (!process.env.RENDER) {
      const { exec } = require('child_process');
      const cmd = process.platform === 'win32' ? `start ${url}` :
                  process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
      exec(cmd);
    }
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
