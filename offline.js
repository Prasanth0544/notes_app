/* ============================================================
   NoteVault – offline.js  (SQLite Cache + Sync Engine)
   Works with @capacitor-community/sqlite & @capacitor/network
   ============================================================ */

'use strict';

// ─── Globals ──────────────────────────────────────────────────
let _db = null;
let _isOnline = true;
let _syncInProgress = false;

const DB_NAME = 'notevault_offline';

// ─── Init: open DB & create tables ────────────────────────────
async function offlineInit() {
  if (!window.CapacitorSQLite) {
    console.warn('CapacitorSQLite not available — offline disabled');
    return false;
  }

  try {
    // Check network status
    if (window.CapacitorNetwork) {
      const status = await window.CapacitorNetwork.getStatus();
      _isOnline = status.connected;

      window.CapacitorNetwork.addListener('networkStatusChange', (s) => {
        const wasOffline = !_isOnline;
        _isOnline = s.connected;
        updateOfflineBanner();
        // Auto-sync when coming back online
        if (wasOffline && _isOnline) {
          console.log('📶 Back online — syncing...');
          syncQueue();
        }
      });
    }

    // Open or create the database
    const sqlite = window.CapacitorSQLite;
    await sqlite.createConnection({ database: DB_NAME, encrypted: false, mode: 'no-encryption', version: 1 });
    await sqlite.open({ database: DB_NAME });
    _db = sqlite;

    // Create tables
    await _db.execute({
      database: DB_NAME,
      statements: `
        CREATE TABLE IF NOT EXISTS notes (
          id          TEXT PRIMARY KEY,
          title       TEXT DEFAULT '',
          content     TEXT DEFAULT '',
          tags        TEXT DEFAULT '[]',
          updated_at  TEXT DEFAULT '',
          created_at  TEXT DEFAULT '',
          is_dirty    INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sync_queue (
          qid         INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id     TEXT,
          action      TEXT,
          payload     TEXT DEFAULT '{}',
          created_at  TEXT DEFAULT ''
        );
      `
    });

    updateOfflineBanner();
    console.log('✅ Offline DB ready');
    return true;
  } catch (err) {
    console.error('Offline init failed:', err);
    return false;
  }
}

// ─── UI: offline banner ───────────────────────────────────────
function updateOfflineBanner() {
  let banner = document.getElementById('offlineBanner');
  if (!banner) return;
  if (_isOnline) {
    banner.classList.remove('show');
  } else {
    banner.classList.add('show');
  }
}

function isOnline() { return _isOnline; }
function isOfflineReady() { return _db !== null; }

// ─── Cache: save notes from API into SQLite ───────────────────
async function cacheNotes(notesArray) {
  if (!_db) return;
  for (const n of notesArray) {
    const existing = await _db.query({
      database: DB_NAME,
      statement: 'SELECT id, is_dirty FROM notes WHERE id = ?',
      values: [n.id]
    });
    // Don't overwrite locally-dirty notes
    if (existing.values && existing.values.length > 0 && existing.values[0].is_dirty === 1) {
      continue;
    }
    await _db.run({
      database: DB_NAME,
      statement: `INSERT OR REPLACE INTO notes (id, title, content, tags, updated_at, created_at, is_dirty)
                  VALUES (?, ?, ?, ?, ?, ?, 0)`,
      values: [
        n.id,
        n.title || '',
        n.content || '',
        JSON.stringify(n.tags || []),
        n.updated_at || '',
        n.created_at || ''
      ]
    });
  }
}

// ─── Cache: save single note ──────────────────────────────────
async function cacheNote(note) {
  if (!_db) return;
  await _db.run({
    database: DB_NAME,
    statement: `INSERT OR REPLACE INTO notes (id, title, content, tags, updated_at, created_at, is_dirty)
                VALUES (?, ?, ?, ?, ?, ?, 0)`,
    values: [
      note.id,
      note.title || '',
      note.content || '',
      JSON.stringify(note.tags || []),
      note.updated_at || '',
      note.created_at || ''
    ]
  });
}

// ─── Read: get all notes from SQLite ──────────────────────────
async function getOfflineNotes() {
  if (!_db) return [];
  const result = await _db.query({
    database: DB_NAME,
    statement: 'SELECT * FROM notes ORDER BY updated_at DESC'
  });
  if (!result.values) return [];
  return result.values.map(row => ({
    id:         row.id,
    title:      row.title,
    content:    row.content,
    tags:       JSON.parse(row.tags || '[]'),
    updated_at: row.updated_at,
    created_at: row.created_at,
    _dirty:     row.is_dirty === 1
  }));
}

// ─── Read: get single note from SQLite ────────────────────────
async function getOfflineNote(id) {
  if (!_db) return null;
  const result = await _db.query({
    database: DB_NAME,
    statement: 'SELECT * FROM notes WHERE id = ?',
    values: [id]
  });
  if (!result.values || result.values.length === 0) return null;
  const row = result.values[0];
  return {
    id:         row.id,
    title:      row.title,
    content:    row.content,
    tags:       JSON.parse(row.tags || '[]'),
    updated_at: row.updated_at,
    created_at: row.created_at,
    _dirty:     row.is_dirty === 1
  };
}

// ─── Write: save note offline (mark dirty + queue sync) ───────
async function saveNoteOffline(noteId, title, content, tags) {
  if (!_db) return null;

  const now = new Date().toISOString();
  const isNew = !noteId || noteId === 'new';
  const id = isNew ? 'local_' + Date.now() : noteId;

  await _db.run({
    database: DB_NAME,
    statement: `INSERT OR REPLACE INTO notes (id, title, content, tags, updated_at, created_at, is_dirty)
                VALUES (?, ?, ?, ?, ?, ?, 1)`,
    values: [id, title || '', content || '', JSON.stringify(tags || []), now, now]
  });

  // Add to sync queue
  await _db.run({
    database: DB_NAME,
    statement: 'INSERT INTO sync_queue (note_id, action, payload, created_at) VALUES (?, ?, ?, ?)',
    values: [
      id,
      isNew ? 'create' : 'update',
      JSON.stringify({ title, content, tags }),
      now
    ]
  });

  return { id, title, content, tags, updated_at: now, created_at: now };
}

// ─── Delete: mark for deletion + queue sync ───────────────────
async function deleteNoteOffline(noteId) {
  if (!_db) return;
  await _db.run({
    database: DB_NAME,
    statement: 'DELETE FROM notes WHERE id = ?',
    values: [noteId]
  });
  // Only queue server-side delete for real (non-local) IDs
  if (!noteId.startsWith('local_')) {
    await _db.run({
      database: DB_NAME,
      statement: 'INSERT INTO sync_queue (note_id, action, payload, created_at) VALUES (?, ?, ?, ?)',
      values: [noteId, 'delete', '{}', new Date().toISOString()]
    });
  }
}

// ─── Sync: process queue when online ──────────────────────────
async function syncQueue() {
  if (!_db || _syncInProgress || !_isOnline) return;
  _syncInProgress = true;

  try {
    const token = localStorage.getItem('nv_token');
    if (!token) return;

    const queue = await _db.query({
      database: DB_NAME,
      statement: 'SELECT * FROM sync_queue ORDER BY qid ASC'
    });

    if (!queue.values || queue.values.length === 0) {
      _syncInProgress = false;
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    };

    for (const item of queue.values) {
      try {
        if (item.action === 'create') {
          const payload = JSON.parse(item.payload);
          const res = await fetch(API + '/notes', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const newNote = await res.json();
            // Replace local ID with server ID
            await _db.run({
              database: DB_NAME,
              statement: 'UPDATE notes SET id = ?, is_dirty = 0 WHERE id = ?',
              values: [newNote.id, item.note_id]
            });
          }
        } else if (item.action === 'update') {
          const payload = JSON.parse(item.payload);
          await fetch(API + '/notes/' + item.note_id, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload)
          });
          await _db.run({
            database: DB_NAME,
            statement: 'UPDATE notes SET is_dirty = 0 WHERE id = ?',
            values: [item.note_id]
          });
        } else if (item.action === 'delete') {
          await fetch(API + '/notes/' + item.note_id, {
            method: 'DELETE',
            headers
          });
        }

        // Remove processed queue entry
        await _db.run({
          database: DB_NAME,
          statement: 'DELETE FROM sync_queue WHERE qid = ?',
          values: [item.qid]
        });
      } catch (err) {
        console.warn('Sync item failed:', item, err);
        break; // Stop on first failure, retry later
      }
    }

    console.log('✅ Sync complete');
  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    _syncInProgress = false;
  }
}
