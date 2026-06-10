import { openDB } from 'idb';

const DB_NAME = 'notevault_offline';
const DB_VERSION = 3;
const MAX_SYNC_RETRIES = 5;

// ═══════════════════════════════════════════════════════
//  CONNECTION POOLING — singleton cached DB instance
// ═══════════════════════════════════════════════════════

let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // Switch fall-through pattern for clean version migrations
        switch (oldVersion) {
          case 0: {
            // Fresh install — create all stores
            const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
            noteStore.createIndex('by_modified', 'modified');
            noteStore.createIndex('by_deleted', 'deleted_at');
            const syncStore = db.createObjectStore('sync_queue', { keyPath: 'qid', autoIncrement: true });
            syncStore.createIndex('note_id', 'note_id');
            db.createObjectStore('folders', { keyPath: 'name' });
            db.createObjectStore('meta', { keyPath: 'key' });
            break;
          }
          case 1:
            // v1 → v2: add folders and meta stores
            if (!db.objectStoreNames.contains('folders')) {
              db.createObjectStore('folders', { keyPath: 'name' });
            }
            if (!db.objectStoreNames.contains('meta')) {
              db.createObjectStore('meta', { keyPath: 'key' });
            }
            // fall through to v2 → v3
          // eslint-disable-next-line no-fallthrough
          case 2: {
            // v2 → v3: add indexes on notes store for faster queries
            const ns = tx.objectStore('notes');
            if (!ns.indexNames.contains('by_modified')) ns.createIndex('by_modified', 'modified');
            if (!ns.indexNames.contains('by_deleted')) ns.createIndex('by_deleted', 'deleted_at');
            break;
          }
        }
      },
      blocked() { dbPromise = null; },
      terminated() { dbPromise = null; },
    });
  }
  return dbPromise;
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
      } catch (cleanupErr) {
        console.warn('Failed to clear old IndexedDB cache:', cleanupErr);
      }
      return await fn(); // retry
    }
    throw e;
  }
}

// ─── Sync queue deduplication helper ──────────────────
async function dedupeQueue(syncStore, noteId, action) {
  const index = syncStore.index('note_id');
  const existing = await index.getAll(noteId);
  for (const entry of existing) {
    if (entry.action === action) {
      await syncStore.delete(entry.qid);
    }
  }
}

// ─── Content compression (for notes > 10KB) ──────────
async function compress(text) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

async function decompress(compressed) {
  if (typeof DecompressionStream === 'undefined' || !compressed) return null;
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch { return null; }
}

async function storeNoteWithCompression(store, note) {
  if (note.content && note.content.length > 10240 && typeof CompressionStream !== 'undefined') {
    const compressed = await compress(note.content);
    if (compressed && compressed.byteLength < note.content.length * 0.8) {
      // Compression saved >20%, use it
      await store.put({ ...note, content_compressed: compressed, content: '' });
      return;
    }
  }
  await store.put(note);
}

async function readNoteContent(note) {
  if (note.content_compressed) {
    const decompressed = await decompress(note.content_compressed);
    if (decompressed !== null) {
      return { ...note, content: decompressed, content_compressed: undefined };
    }
  }
  return note;
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

// ─── Storage estimation & persistence ─────────────────
export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return {
    usedMB: Math.round(usage / 1024 / 1024 * 10) / 10,
    totalMB: Math.round(quota / 1024 / 1024 * 10) / 10,
    percentUsed: Math.round(usage / quota * 100),
  };
}

export async function requestPersistentStorage() {
  if (navigator.storage?.persist) {
    return await navigator.storage.persist();
  }
  return false;
}

// ─── Incremental sync timestamps ──────────────────────
export async function getLastSync() {
  return (await getMeta('last_sync')) || 0;
}

export async function setLastSync(ts) {
  await setMeta('last_sync', ts || Date.now());
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
      await storeNoteWithCompression(tx.store, {
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
    const tx = db.transaction('notes', 'readwrite');
    await storeNoteWithCompression(tx.store, {
      ...note,
      tags: note.tags || [],
      folder: note.folder || '',
      pinned: note.pinned || false,
      deleted_at: note.deleted_at || null,
      is_dirty: false,
    });
    await tx.done;
  });
}

// ─── Read: all active notes list (lazy — no content) ──
export async function getOfflineNotes() {
  const db = await getDb();
  const all = await db.getAll('notes');
  return all
    .filter(n => !n.deleted_at)
    .map(n => ({
      id: n.id, title: n.title, tags: n.tags || [], folder: n.folder || '',
      pinned: n.pinned || false, modified: n.modified || 0, created: n.created || 0,
      // Omit content and content_compressed for list performance
    }))
    .sort((a, b) => {
      // Pinned first, then by modified desc
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.modified || 0) - (a.modified || 0);
    });
}

// ─── Read: trashed notes (lazy — no content) ──────────
export async function getOfflineTrash() {
  const db = await getDb();
  const all = await db.getAll('notes');
  return all
    .filter(n => !!n.deleted_at)
    .map(n => ({
      id: n.id, title: n.title, tags: n.tags || [], folder: n.folder || '',
      pinned: n.pinned || false, deleted_at: n.deleted_at,
      modified: n.modified || 0, created: n.created || 0,
    }))
    .sort((a, b) => (b.deleted_at || 0) - (a.deleted_at || 0));
}

// ─── Read: single note (with content decompression) ───
export async function getOfflineNote(id) {
  const db = await getDb();
  const note = await db.get('notes', id);
  if (!note) return null;
  return await readNoteContent(note);
}

// ═══════════════════════════════════════════════════════
//  OFFLINE WRITE OPERATIONS (atomic transactions)
// ═══════════════════════════════════════════════════════

// ─── Write: save note offline (mark dirty) ────────────
export async function saveNoteOffline(noteId, title, content, tags, folder) {
  const now = Date.now();
  const isNew = !noteId || noteId === 'new';
  const id = isNew ? 'local_' + now : noteId;

  const result = await safeWrite(async () => {
    const db = await getDb();
    const tx = db.transaction(['notes', 'sync_queue'], 'readwrite');
    const noteStore = tx.objectStore('notes');
    const syncStore = tx.objectStore('sync_queue');

    // Preserve existing fields (folder, pinned, created) for updates
    let noteFolder = folder || '', pinned = false, created = now;
    if (!isNew) {
      const existing = await noteStore.get(id);
      if (existing) {
        noteFolder = folder || existing.folder || '';
        pinned = existing.pinned || false;
        created = existing.created || now;
      }
    }

    await storeNoteWithCompression(noteStore, {
      id, title: title || '', content: content || '',
      tags: tags || [], folder: noteFolder, pinned,
      deleted_at: null, modified: now, created, is_dirty: true,
    });

    // Deduplicate: remove existing update entries for this note
    const action = isNew ? 'create' : 'update';
    await dedupeQueue(syncStore, id, action);

    await syncStore.add({
      note_id: id,
      action,
      payload: JSON.stringify({ title, content, tags, folder: noteFolder }),
      created_at: new Date().toISOString(),
      retries: 0,
    });

    await tx.done;
    return { id, title, content, tags, folder: noteFolder, modified: now, created };
  });

  return result;
}

// ─── Delete: trash note offline (atomic) ──────────────
export async function trashNoteOffline(noteId) {
  const db = await getDb();
  const tx = db.transaction(['notes', 'sync_queue'], 'readwrite');
  const noteStore = tx.objectStore('notes');
  const syncStore = tx.objectStore('sync_queue');

  const note = await noteStore.get(noteId);
  if (note) {
    note.deleted_at = Date.now();
    note.is_dirty = true;
    await noteStore.put(note);
  }
  if (!noteId.startsWith('local_')) {
    await dedupeQueue(syncStore, noteId, 'trash');
    await syncStore.add({
      note_id: noteId, action: 'trash',
      payload: '{}', created_at: new Date().toISOString(), retries: 0,
    });
  }
  await tx.done;
}

// ─── Restore note offline (atomic) ───────────────────
export async function restoreNoteOffline(noteId) {
  const db = await getDb();
  const tx = db.transaction(['notes', 'sync_queue'], 'readwrite');
  const noteStore = tx.objectStore('notes');
  const syncStore = tx.objectStore('sync_queue');

  const note = await noteStore.get(noteId);
  if (note) {
    note.deleted_at = null;
    note.is_dirty = true;
    await noteStore.put(note);
  }
  if (!noteId.startsWith('local_')) {
    await dedupeQueue(syncStore, noteId, 'restore');
    await syncStore.add({
      note_id: noteId, action: 'restore',
      payload: '{}', created_at: new Date().toISOString(), retries: 0,
    });
  }
  await tx.done;
}

// ─── Permanent delete offline (atomic) ────────────────
export async function permanentDeleteOffline(noteId) {
  const db = await getDb();
  const tx = db.transaction(['notes', 'sync_queue'], 'readwrite');
  const noteStore = tx.objectStore('notes');
  const syncStore = tx.objectStore('sync_queue');

  await noteStore.delete(noteId);
  if (!noteId.startsWith('local_')) {
    await dedupeQueue(syncStore, noteId, 'permanent_delete');
    await syncStore.add({
      note_id: noteId, action: 'permanent_delete',
      payload: '{}', created_at: new Date().toISOString(), retries: 0,
    });
  }
  await tx.done;
}

// ─── Pin note offline (atomic) ────────────────────────
export async function pinNoteOffline(noteId) {
  const db = await getDb();
  const tx = db.transaction(['notes', 'sync_queue'], 'readwrite');
  const noteStore = tx.objectStore('notes');
  const syncStore = tx.objectStore('sync_queue');

  const note = await noteStore.get(noteId);
  if (note) {
    note.pinned = !note.pinned;
    note.is_dirty = true;
    await noteStore.put(note);
  }
  if (!noteId.startsWith('local_')) {
    await dedupeQueue(syncStore, noteId, 'pin');
    await syncStore.add({
      note_id: noteId, action: 'pin',
      payload: '{}', created_at: new Date().toISOString(), retries: 0,
    });
  }
  await tx.done;
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
    for (const f of foldersArray) {
      // Handle both string (old) and object (new) formats
      const obj = typeof f === 'string'
        ? { name: f }
        : { name: f.name, last_accessed: f.last_accessed || 0 };
      await tx.store.put(obj);
    }
    await tx.done;
  });
}

export async function getOfflineFolders() {
  const db = await getDb();
  const all = await db.getAll('folders');
  return all; // Returns [{name, last_accessed}, ...] — caller extracts what it needs
}

// ─── Check which notes already have full content cached ──
export async function getNoteIdsWithContent() {
  const db = await getDb();
  const all = await db.getAll('notes');
  return new Set(
    all.filter(n => !n.deleted_at && (n.content || n.content_compressed))
       .map(n => n.id)
  );
}

// ─── Remove IDB notes that no longer exist on server ──
export async function cleanupStaleNotes(serverNoteIds) {
  const serverSet = new Set(serverNoteIds);
  const db = await getDb();
  const all = await db.getAll('notes');
  const staleIds = all.filter(n => !n.is_dirty && !serverSet.has(n.id)).map(n => n.id);
  if (staleIds.length === 0) return 0;
  const tx = db.transaction('notes', 'readwrite');
  for (const id of staleIds) {
    await tx.store.delete(id);
  }
  await tx.done;
  return staleIds.length;
}

export async function createFolderOffline(name) {
  const db = await getDb();
  const tx = db.transaction(['folders', 'sync_queue'], 'readwrite');
  await tx.objectStore('folders').put({ name });
  await tx.objectStore('sync_queue').add({
    note_id: name, action: 'create_folder',
    payload: JSON.stringify({ name }),
    created_at: new Date().toISOString(), retries: 0,
  });
  await tx.done;
}

export async function deleteFolderOffline(name) {
  const db = await getDb();
  const tx = db.transaction(['folders', 'sync_queue'], 'readwrite');
  await tx.objectStore('folders').delete(name);
  await tx.objectStore('sync_queue').add({
    note_id: name, action: 'delete_folder',
    payload: JSON.stringify({ name }),
    created_at: new Date().toISOString(), retries: 0,
  });
  await tx.done;
}

// ═══════════════════════════════════════════════════════
//  SYNC QUEUE PROCESSING (with retry & backoff)
// ═══════════════════════════════════════════════════════

export async function syncQueue(apiBase, token) {
  const db = await getDb();
  const items = await db.getAll('sync_queue');
  if (!items.length) return;

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  async function requireOk(res, acceptedStatuses = []) {
    if (res.ok || acceptedStatuses.includes(res.status)) return res;
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error ? `: ${data.error}` : '';
    } catch (parseErr) {
      detail = parseErr?.message ? `: ${parseErr.message}` : '';
    }
    throw new Error(`Sync request failed (${res.status})${detail}`);
  }

  for (const item of items) {
    if ((item.retries || 0) >= MAX_SYNC_RETRIES) {
      console.warn('Discarding permanently failed sync item:', item.qid, item.action, item.note_id);
      await db.delete('sync_queue', item.qid);
      continue;
    }

    try {
      switch (item.action) {
        case 'create': {
          const payload = JSON.parse(item.payload);
          const res = await fetch(apiBase + '/notes', { method: 'POST', headers, body: JSON.stringify(payload) });
          if (res.ok) {
            const newNote = await res.json();
            const tx = db.transaction('notes', 'readwrite');
            await tx.store.delete(item.note_id);
            await tx.store.put({ ...newNote, folder: newNote.folder || '', pinned: newNote.pinned || false, deleted_at: null, is_dirty: false });
            await tx.done;
          } else if (res.status === 409) {
            console.warn('Sync conflict for create:', item.note_id, 'skipping duplicate');
          } else {
            await requireOk(res);
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
            console.warn('Sync conflict for note', item.note_id, 'server version kept');
          } else {
            await requireOk(res);
          }
          break;
        }

        case 'trash':
          await requireOk(await fetch(apiBase + '/notes/' + item.note_id, { method: 'DELETE', headers }), [404]);
          break;

        case 'restore':
          await requireOk(await fetch(apiBase + '/notes/' + item.note_id + '/restore', { method: 'POST', headers }));
          break;

        case 'permanent_delete':
          await requireOk(await fetch(apiBase + '/notes/' + item.note_id + '/permanent', { method: 'DELETE', headers }), [404]);
          break;

        case 'pin':
          await requireOk(await fetch(apiBase + '/notes/' + item.note_id + '/pin', { method: 'POST', headers }));
          break;

        case 'create_folder': {
          const payload = JSON.parse(item.payload);
          await requireOk(await fetch(apiBase + '/notes/folders', { method: 'POST', headers, body: JSON.stringify(payload) }), [409]);
          break;
        }

        case 'delete_folder': {
          const payload = JSON.parse(item.payload);
          await requireOk(await fetch(apiBase + '/notes/folders/' + encodeURIComponent(payload.name), { method: 'DELETE', headers }), [404]);
          break;
        }

        default:
          if (item.action === 'delete') {
            await requireOk(await fetch(apiBase + '/notes/' + item.note_id, { method: 'DELETE', headers }), [404]);
          }
          break;
      }
      await db.delete('sync_queue', item.qid);
    } catch (err) {
      const retries = (item.retries || 0) + 1;
      console.warn(`Sync item ${item.qid} failed (attempt ${retries}/${MAX_SYNC_RETRIES}):`, err.message);
      await db.put('sync_queue', { ...item, retries });
      if (!navigator.onLine || err.name === 'TypeError') break;
    }
  }
  console.log('Sync complete');
}
