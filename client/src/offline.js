import { openDB } from 'idb';

const DB_NAME = 'notevault_offline';
const DB_VERSION = 2;

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v1 stores
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        const store = db.createObjectStore('sync_queue', { keyPath: 'qid', autoIncrement: true });
        store.createIndex('note_id', 'note_id');
      }
      // v2 stores
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      }
    },
  });
}

// ─── Quota-safe write wrapper ─────────────────────────
async function safeWrite(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('⚠️ IndexedDB quota exceeded — clearing old cache');
      try {
        const db = await getDb();
        const tx = db.transaction('notes', 'readwrite');
        const all = await tx.store.getAll();
        const clean = all.filter(n => !n.is_dirty).sort((a, b) => (a.modified || 0) - (b.modified || 0));
        // Delete oldest 50% of clean notes to free space
        for (let i = 0; i < Math.floor(clean.length / 2); i++) {
          await tx.store.delete(clean[i].id);
        }
        await tx.done;
      } catch {}
      return await fn(); // retry
    }
    throw e;
  }
}

// ─── Meta store (key-value for settings, timestamps) ──
export async function setMeta(key, value) {
  const db = await getDb();
  await db.put('meta', { key, value });
}

export async function getMeta(key) {
  const db = await getDb();
  const row = await db.get('meta', key);
  return row ? row.value : null;
}

// ═══════════════════════════════════════════════════════
//  NOTES CACHE
// ═══════════════════════════════════════════════════════

// ─── Cache: save all notes from API ───────────────────
export async function cacheNotes(notesArray) {
  await safeWrite(async () => {
    const db = await getDb();
    const tx = db.transaction('notes', 'readwrite');
    for (const n of notesArray) {
      const existing = await tx.store.get(n.id);
      if (existing) {
        if (existing.is_dirty) continue; // Don't overwrite local edits
        if (existing.modified >= n.modified) continue; // Server data is older
      }
      await tx.store.put({
        ...n,
        tags: n.tags || [],
        folder: n.folder || '',
        pinned: n.pinned || false,
        deleted_at: n.deleted_at || null,
        is_dirty: false,
      });
    }
    await tx.done;
  });
}

// ─── Cache: save single note ──────────────────────────
export async function cacheNote(note) {
  await safeWrite(async () => {
    const db = await getDb();
    await db.put('notes', {
      ...note,
      tags: note.tags || [],
      folder: note.folder || '',
      pinned: note.pinned || false,
      deleted_at: note.deleted_at || null,
      is_dirty: false,
    });
  });
}

// ─── Read: all active notes (non-trashed) ─────────────
export async function getOfflineNotes() {
  const db = await getDb();
  const all = await db.getAll('notes');
  return all
    .filter(n => !n.deleted_at)
    .sort((a, b) => {
      // Pinned first, then by modified desc
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.modified || 0) - (a.modified || 0);
    });
}

// ─── Read: trashed notes ─────────────────────────────
export async function getOfflineTrash() {
  const db = await getDb();
  const all = await db.getAll('notes');
  return all
    .filter(n => !!n.deleted_at)
    .sort((a, b) => (b.deleted_at || 0) - (a.deleted_at || 0));
}

// ─── Read: single note ───────────────────────────────
export async function getOfflineNote(id) {
  const db = await getDb();
  return (await db.get('notes', id)) || null;
}

// ═══════════════════════════════════════════════════════
//  OFFLINE WRITE OPERATIONS
// ═══════════════════════════════════════════════════════

// ─── Write: save note offline (mark dirty) ────────────
export async function saveNoteOffline(noteId, title, content, tags) {
  const db = await getDb();
  const now = Date.now();
  const isNew = !noteId || noteId === 'new';
  const id = isNew ? 'local_' + now : noteId;

  // Preserve existing fields (folder, pinned, created) for updates
  let folder = '', pinned = false, created = now;
  if (!isNew) {
    const existing = await db.get('notes', id);
    if (existing) {
      folder = existing.folder || '';
      pinned = existing.pinned || false;
      created = existing.created || now;
    }
  }

  await safeWrite(async () => {
    await db.put('notes', {
      id, title: title || '', content: content || '',
      tags: tags || [], folder, pinned,
      deleted_at: null, modified: now, created, is_dirty: true,
    });

    await db.add('sync_queue', {
      note_id: id,
      action: isNew ? 'create' : 'update',
      payload: JSON.stringify({ title, content, tags }),
      created_at: new Date().toISOString(),
    });
  });

  return { id, title, content, tags, modified: now, created };
}

// ─── Delete: trash note offline ───────────────────────
export async function trashNoteOffline(noteId) {
  const db = await getDb();
  const note = await db.get('notes', noteId);
  if (note) {
    note.deleted_at = Date.now();
    note.is_dirty = true;
    await db.put('notes', note);
  }
  if (!noteId.startsWith('local_')) {
    await db.add('sync_queue', {
      note_id: noteId, action: 'trash',
      payload: '{}', created_at: new Date().toISOString(),
    });
  }
}

// ─── Restore note offline ─────────────────────────────
export async function restoreNoteOffline(noteId) {
  const db = await getDb();
  const note = await db.get('notes', noteId);
  if (note) {
    note.deleted_at = null;
    note.is_dirty = true;
    await db.put('notes', note);
  }
  if (!noteId.startsWith('local_')) {
    await db.add('sync_queue', {
      note_id: noteId, action: 'restore',
      payload: '{}', created_at: new Date().toISOString(),
    });
  }
}

// ─── Permanent delete offline ─────────────────────────
export async function permanentDeleteOffline(noteId) {
  const db = await getDb();
  await db.delete('notes', noteId);
  if (!noteId.startsWith('local_')) {
    await db.add('sync_queue', {
      note_id: noteId, action: 'permanent_delete',
      payload: '{}', created_at: new Date().toISOString(),
    });
  }
}

// ─── Pin note offline ─────────────────────────────────
export async function pinNoteOffline(noteId) {
  const db = await getDb();
  const note = await db.get('notes', noteId);
  if (note) {
    note.pinned = !note.pinned;
    note.is_dirty = true;
    await db.put('notes', note);
  }
  if (!noteId.startsWith('local_')) {
    await db.add('sync_queue', {
      note_id: noteId, action: 'pin',
      payload: '{}', created_at: new Date().toISOString(),
    });
  }
  return note;
}

// ─── Legacy: delete note offline (backward compat) ────
export async function deleteNoteOffline(noteId) {
  return trashNoteOffline(noteId);
}

// ═══════════════════════════════════════════════════════
//  FOLDERS CACHE
// ═══════════════════════════════════════════════════════

export async function cacheFolders(foldersArray) {
  await safeWrite(async () => {
    const db = await getDb();
    const tx = db.transaction('folders', 'readwrite');
    await tx.store.clear();
    for (const name of foldersArray) {
      await tx.store.put({ name });
    }
    await tx.done;
  });
}

export async function getOfflineFolders() {
  const db = await getDb();
  const all = await db.getAll('folders');
  return all.map(f => f.name);
}

export async function createFolderOffline(name) {
  const db = await getDb();
  await db.put('folders', { name });
  await db.add('sync_queue', {
    note_id: name, action: 'create_folder',
    payload: JSON.stringify({ name }),
    created_at: new Date().toISOString(),
  });
}

export async function deleteFolderOffline(name) {
  const db = await getDb();
  await db.delete('folders', name);
  await db.add('sync_queue', {
    note_id: name, action: 'delete_folder',
    payload: JSON.stringify({ name }),
    created_at: new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════════════════
//  SYNC QUEUE PROCESSING
// ═══════════════════════════════════════════════════════

export async function syncQueue(apiBase, token) {
  const db = await getDb();
  const items = await db.getAll('sync_queue');
  if (!items.length) return;

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  for (const item of items) {
    try {
      switch (item.action) {
        case 'create': {
          const payload = JSON.parse(item.payload);
          const res = await fetch(apiBase + '/notes', { method: 'POST', headers, body: JSON.stringify(payload) });
          if (res.ok) {
            const newNote = await res.json();
            // Clean up local_ ID and store with real server ID
            const tx = db.transaction('notes', 'readwrite');
            await tx.store.delete(item.note_id);
            await tx.store.put({ ...newNote, folder: newNote.folder || '', pinned: newNote.pinned || false, deleted_at: null, is_dirty: false });
            await tx.done;
          }
          break;
        }

        case 'update': {
          const payload = JSON.parse(item.payload);
          const res = await fetch(apiBase + '/notes/' + item.note_id, { method: 'PUT', headers, body: JSON.stringify(payload) });
          if (res.ok) {
            const updated = await res.json();
            const tx = db.transaction('notes', 'readwrite');
            await tx.store.put({ ...updated, folder: updated.folder || '', pinned: updated.pinned || false, deleted_at: null, is_dirty: false });
            await tx.done;
          } else if (res.status === 409) {
            // Conflict — server data is newer, discard local changes
            console.warn('Sync conflict for note', item.note_id, '— server version kept');
          }
          break;
        }

        case 'trash': {
          await fetch(apiBase + '/notes/' + item.note_id, { method: 'DELETE', headers });
          break;
        }

        case 'restore': {
          await fetch(apiBase + '/notes/' + item.note_id + '/restore', { method: 'POST', headers });
          break;
        }

        case 'permanent_delete': {
          await fetch(apiBase + '/notes/' + item.note_id + '/permanent', { method: 'DELETE', headers });
          break;
        }

        case 'pin': {
          await fetch(apiBase + '/notes/' + item.note_id + '/pin', { method: 'POST', headers });
          break;
        }

        case 'create_folder': {
          const payload = JSON.parse(item.payload);
          await fetch(apiBase + '/notes/folders', { method: 'POST', headers, body: JSON.stringify(payload) });
          break;
        }

        case 'delete_folder': {
          const payload = JSON.parse(item.payload);
          await fetch(apiBase + '/notes/folders/' + encodeURIComponent(payload.name), { method: 'DELETE', headers });
          break;
        }

        default:
          // Legacy 'delete' action
          if (item.action === 'delete') {
            await fetch(apiBase + '/notes/' + item.note_id, { method: 'DELETE', headers });
          }
          break;
      }
      // Remove processed queue item
      await db.delete('sync_queue', item.qid);
    } catch (err) {
      console.warn('Sync item failed:', err);
      break; // Stop on first failure, retry later
    }
  }
  console.log('✅ Sync complete');
}
