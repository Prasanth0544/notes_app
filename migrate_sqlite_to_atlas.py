"""
migrate_sqlite_to_atlas.py
==========================
Migrates all notes from local notes.db (SQLite)
to MongoDB Atlas under a new user account.

Run ONCE:  python migrate_sqlite_to_atlas.py
"""

import os
import sqlite3
import bcrypt
from datetime import datetime, timezone
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

# ── Config ───────────────────────────────────────────────────────
MONGO_URI = os.getenv('MONGO_URI')
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
DB_PATH   = os.path.join(BASE_DIR, 'notes.db')

# ── Your account details (CHANGE THESE before running) ───────────
USER_EMAIL    = os.getenv('MIGRATE_EMAIL', 'your_email@example.com')
USER_PASSWORD = os.getenv('MIGRATE_PASSWORD', 'your_password_here')
USER_NAME     = os.getenv('MIGRATE_NAME', 'Your Name')
USER_AGE      = os.getenv('MIGRATE_AGE', '20')
USER_ROLE     = os.getenv('MIGRATE_ROLE', 'Student')
USER_USERNAME = os.getenv('MIGRATE_USERNAME', 'username')

# ── Connect ───────────────────────────────────────────────────────
print('\n🔌 Connecting to MongoDB Atlas…')
client    = MongoClient(MONGO_URI)
db        = client['notevault']
users_col = db['users']
notes_col = db['notes']

# ── Create/get user ───────────────────────────────────────────────
existing = users_col.find_one({'email': USER_EMAIL})
if existing:
    user_id = str(existing['_id'])
    print(f'✅ Account already exists → using existing user (id: {user_id})')
else:
    pw_hash = bcrypt.hashpw(USER_PASSWORD.encode(), bcrypt.gensalt())
    doc = {
        'email':          USER_EMAIL,
        'password_hash':  pw_hash,
        'name':           USER_NAME,
        'username':       USER_USERNAME,
        'age':            USER_AGE,
        'role':           USER_ROLE,
        'avatar':         '',
        'auth_providers': ['email'],
        'profile_done':   True,
        'created_at':     datetime.now(timezone.utc),
    }
    result = users_col.insert_one(doc)
    user_id = str(result.inserted_id)
    print(f'✅ Created account for {USER_EMAIL} (id: {user_id})')

# ── Read SQLite notes ─────────────────────────────────────────────
if not os.path.exists(DB_PATH):
    print('⚠️  notes.db not found – nothing to migrate.')
    exit(0)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
rows = conn.execute('SELECT * FROM notes ORDER BY modified DESC').fetchall()
conn.close()

print(f'\n📂 Found {len(rows)} notes in SQLite…')

if not rows:
    print('No notes to migrate.')
    exit(0)

# ── Migrate each note ─────────────────────────────────────────────
migrated = 0
skipped  = 0

for row in rows:
    d = dict(row)
    tags = [t.strip() for t in d.get('tags', '').split(',') if t.strip()]

    # Check if this note was already migrated (by matching old id stored in metadata)
    if notes_col.find_one({'sqlite_id': d['id'], 'user_id': user_id}):
        skipped += 1
        continue

    notes_col.insert_one({
        'user_id':   user_id,
        'sqlite_id': d['id'],         # keep reference so we can re-run safely
        'title':     d.get('title', 'Untitled Note'),
        'content':   d.get('content', ''),
        'tags':      tags,
        'created':   d.get('created', 0),
        'modified':  d.get('modified', 0),
    })
    migrated += 1
    print(f'  ✓ Migrated: {d.get("title", "Untitled")[:60]}')

print(f'\n🎉 Done! Migrated: {migrated} notes, Skipped (already there): {skipped}')
print(f'   Login with:  {USER_EMAIL}  /  {USER_PASSWORD}')
print(f'   Open:        http://localhost:5000\n')
